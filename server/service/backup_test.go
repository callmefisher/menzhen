package service

import (
	"os"
	"path/filepath"
	"testing"

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
