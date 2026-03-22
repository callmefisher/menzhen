package service

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestBackupService_TaskLifecycle(t *testing.T) {
	svc := NewBackupService()

	// 创建任务
	taskID := svc.CreateTask("mysql")
	assert.NotEmpty(t, taskID)

	// 查询任务
	status, err := svc.GetTaskStatus(taskID)
	assert.NoError(t, err)
	assert.Equal(t, "running", status.Status)
	assert.Equal(t, "mysql", status.Type)

	// 更新任务完成
	svc.UpdateTask(taskID, "success", "backup completed")
	status, err = svc.GetTaskStatus(taskID)
	assert.NoError(t, err)
	assert.Equal(t, "success", status.Status)
	assert.Equal(t, "backup completed", status.Output)

	// 查询不存在的任务
	_, err = svc.GetTaskStatus("nonexistent")
	assert.Error(t, err)
}

func TestBackupService_ListLocalFiles(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("BACKUP_DIR", tmpDir)
	t.Setenv("SITE_ID", "test")

	// 创建测试文件（.sql 和 .sql.gz 两种格式）
	os.WriteFile(filepath.Join(tmpDir, "test_20260316_140000.sql"), []byte("dump"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "test_20260315_120000.sql"), []byte("dump2"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "test_20260317_080000.sql.gz"), []byte("gzipped"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "other.txt"), []byte("skip"), 0644)

	minioDir := filepath.Join(tmpDir, "minio")
	os.MkdirAll(minioDir, 0755)
	os.WriteFile(filepath.Join(minioDir, "test_minio_20260316_140000.tar.gz"), []byte("tar"), 0644)

	svc := NewBackupService()
	result, err := svc.ListLocalFiles()

	assert.NoError(t, err)
	assert.Len(t, result.MySQL, 3) // 2x .sql + 1x .sql.gz
	assert.Len(t, result.MinIO, 1)
	// 文件名匹配
	assert.Equal(t, "test_minio_20260316_140000.tar.gz", result.MinIO[0].Filename)
}

func TestBackupService_ListLocalFiles_EmptyDir(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("BACKUP_DIR", tmpDir)
	t.Setenv("SITE_ID", "test")

	svc := NewBackupService()
	result, err := svc.ListLocalFiles()

	assert.NoError(t, err)
	assert.Empty(t, result.MySQL)
	assert.Empty(t, result.MinIO)
}

func TestBackupService_CleanupOldTasks(t *testing.T) {
	svc := NewBackupService()

	// 创建任务并标记完成
	id1 := svc.CreateTask("mysql")
	svc.UpdateTask(id1, "success", "done")

	// 手动把 StartAt 设为 2 小时前
	svc.mu.Lock()
	svc.tasks[id1].StartAt = "2020-01-01T00:00:00Z"
	svc.mu.Unlock()

	// 创建一个还在运行的任务
	id2 := svc.CreateTask("minio")

	svc.CleanupOldTasks()

	// 过期的已完成任务被清理
	_, err := svc.GetTaskStatus(id1)
	assert.Error(t, err)

	// 运行中的任务保留
	_, err = svc.GetTaskStatus(id2)
	assert.NoError(t, err)
}

// ---------------------------------------------------------------------------
// Docker API version negotiation
// ---------------------------------------------------------------------------

func TestBackupService_DefaultDockerAPIVer(t *testing.T) {
	// NewBackupService may fail to connect to Docker socket in test env,
	// but should fall back to the default version gracefully.
	svc := NewBackupService()
	ver := svc.getDockerAPIVer()
	assert.NotEmpty(t, ver)
	assert.Equal(t, "v", ver[:1])
}

func TestBackupService_DockerURL(t *testing.T) {
	svc := &BackupService{}
	svc.dockerAPIVer.Store("v1.47")
	svc.apiVerFetchedAt.Store(time.Now().Unix()) // prevent TTL refresh
	assert.Equal(t, "http://localhost/v1.47/_ping", svc.dockerURL("/_ping"))
	assert.Equal(t, "http://localhost/v1.47/containers/foo/exec", svc.dockerURL("/containers/foo/exec"))
	assert.Equal(t, "http://localhost/v1.47/exec/abc123/start", svc.dockerURL("/exec/abc123/start"))
}

func TestBackupService_DockerURLWithDefaultVersion(t *testing.T) {
	svc := &BackupService{}
	svc.dockerAPIVer.Store(defaultDockerAPIVer)
	svc.apiVerFetchedAt.Store(time.Now().Unix())
	url := svc.dockerURL("/containers/test/restart?t=3")
	assert.Contains(t, url, defaultDockerAPIVer)
	assert.Contains(t, url, "/containers/test/restart?t=3")
}

func TestBackupService_NegotiateAPIVersionFallback(t *testing.T) {
	// When Docker is not available, negotiation should use default.
	svc := &BackupService{
		httpClient: &http.Client{
			Transport: &http.Transport{
				DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
					return nil, fmt.Errorf("no docker socket")
				},
			},
			Timeout: 1 * time.Second,
		},
	}
	svc.dockerAPIVer.Store("v0.0") // intentionally wrong
	svc.negotiateAPIVersion()
	ver, _ := svc.dockerAPIVer.Load().(string)
	assert.Equal(t, defaultDockerAPIVer, ver)
}

func TestBackupService_TTLRefresh(t *testing.T) {
	// When apiVerFetchedAt is stale, getDockerAPIVer should re-negotiate.
	svc := &BackupService{
		httpClient: &http.Client{
			Transport: &http.Transport{
				DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
					return nil, fmt.Errorf("no docker socket")
				},
			},
			Timeout: 1 * time.Second,
		},
	}
	svc.dockerAPIVer.Store("v1.99")
	svc.apiVerFetchedAt.Store(0) // force stale
	ver := svc.getDockerAPIVer()
	// Should have re-negotiated and fallen back to default
	assert.Equal(t, defaultDockerAPIVer, ver)
}

func TestBackupService_NoHardcodedV141(t *testing.T) {
	data, err := os.ReadFile("backup.go")
	assert.NoError(t, err)
	content := string(data)
	assert.NotContains(t, content, `"http://localhost/v1.`,
		"backup.go must not contain hardcoded Docker API version URLs")
}
