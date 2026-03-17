# 备份与恢复 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在系统设置下新增"备份与恢复"页面，支持手动触发 MySQL/MinIO 备份、从本地或七牛云恢复数据。

**Architecture:** 后端新增 backup handler/service，通过 exec.Command 调用现有 shell 脚本执行备份/恢复，用内存 map+mutex 跟踪任务状态。前端新增 BackupRestore 页面（上下分区式），移动端自适应。云端文件列表通过修改 Python 脚本增加 `--action list` 模式获取。

**Tech Stack:** Go/Gin (backend), React/Ant Design/TypeScript (frontend), exec.Command (script execution), Python qiniu SDK (cloud listing)

**Spec:** `docs/superpowers/specs/2026-03-16-backup-restore-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/service/backup.go` | 任务管理(内存map)、脚本执行、本地/云端文件列表 |
| `server/handler/backup.go` | HTTP handler，参数校验，调用 service |
| `server/service/backup_test.go` | Service 层单元测试 |
| `web/src/api/backup.ts` | 前端 API 客户端 + 类型定义 |
| `web/src/pages/settings/BackupRestore.tsx` | 备份恢复页面组件 |
| `web/src/pages/settings/__tests__/BackupRestore.test.tsx` | 页面组件测试 |

### Modified Files
| File | Change |
|------|--------|
| `server/router/router.go` | 新增 `/backup` 和 `/restore` 路由组 |
| `web/src/App.tsx` | 新增 `/settings/backup` 路由 |
| `web/src/components/Layout.tsx` | 侧边栏添加"备份与恢复"菜单项 + selectedKeys |
| `scripts/download_from_qiniu.py` | 新增 `--action list` 模式输出 JSON |

---

## Chunk 1: Backend

### Task 1: 修改 Python 脚本支持 list 模式

**Files:**
- Modify: `scripts/download_from_qiniu.py`

- [ ] **Step 1: 添加 --action 参数支持 list 模式**

在 `scripts/download_from_qiniu.py` 的 argparse 部分添加 `--action` 参数，当 `--action list` 时只输出 JSON 文件列表不下载：

```python
# 在 argparse 部分添加
parser.add_argument('--action', choices=['download', 'list'], default='download',
                    help='Action: download (default) or list (output JSON)')
```

在 `list_files` 函数返回后，如果 action == 'list'，输出 JSON 格式：

```python
import json

def list_files_json(bucket_mgr, bucket, prefix, site_id):
    """List backup files and return as JSON."""
    results = {"mysql": [], "minio": []}

    # Try SITE_ID-scoped prefix first
    for file_type in ["mysql", "minio"]:
        if file_type == "mysql":
            search_prefix = f"{prefix}{site_id}/{site_id}_"
        else:
            search_prefix = f"{prefix}{site_id}/{site_id}_minio_"

        ret, eof, info = bucket_mgr.list(bucket, prefix=search_prefix, limit=50)
        if ret and 'items' in ret:
            for item in ret['items']:
                results[file_type].append({
                    "filename": item['key'].split('/')[-1],
                    "key": item['key'],
                    "size": item['fsize'],
                    "modified": item['putTime'] // 10000000  # Qiniu timestamp to unix
                })

    # Fallback to legacy prefix if empty
    if not results["mysql"] and not results["minio"]:
        for file_type in ["mysql", "minio"]:
            if file_type == "mysql":
                search_prefix = f"{prefix}"
                suffix = ".sql"
            else:
                search_prefix = f"{prefix}"
                suffix = ".tar.gz"

            ret, eof, info = bucket_mgr.list(bucket, prefix=search_prefix, limit=50)
            if ret and 'items' in ret:
                for item in ret['items']:
                    key = item['key']
                    fname = key.split('/')[-1]
                    if file_type == "mysql" and fname.endswith(".sql"):
                        results["mysql"].append({
                            "filename": fname,
                            "key": key,
                            "size": item['fsize'],
                            "modified": item['putTime'] // 10000000
                        })
                    elif file_type == "minio" and fname.endswith(".tar.gz"):
                        results["minio"].append({
                            "filename": fname,
                            "key": key,
                            "size": item['fsize'],
                            "modified": item['putTime'] // 10000000
                        })

    print(json.dumps(results))

# 在 main 中：
if args.action == 'list':
    list_files_json(bucket_mgr, bucket, prefix, site_id)
    sys.exit(0)
```

- [ ] **Step 2: 测试 list 模式**

Run: `cd /Users/xiayanji/qbox/menzhen && python3 scripts/download_from_qiniu.py --action list --type all`
Expected: JSON 输出 `{"mysql": [...], "minio": [...]}`

- [ ] **Step 3: Commit**

```bash
git add scripts/download_from_qiniu.py
git commit -m "feat: add --action list mode to download_from_qiniu.py for JSON output"
```

---

### Task 2: Backend Service — 任务管理器 + 备份触发

**Files:**
- Create: `server/service/backup.go`
- Test: `server/service/backup_test.go`

- [ ] **Step 1: 写 BackupService 任务管理的失败测试**

```go
// server/service/backup_test.go
package service

import (
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

	// 查询不存在的任务
	_, err = svc.GetTaskStatus("nonexistent")
	assert.Error(t, err)
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run TestBackupService_TaskLifecycle -v`
Expected: FAIL — NewBackupService 未定义

- [ ] **Step 3: 实现 BackupService 任务管理**

```go
// server/service/backup.go
package service

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// TaskStatus 备份/恢复任务状态
type TaskStatus struct {
	TaskID  string `json:"task_id"`
	Type    string `json:"type"`    // mysql, minio, full, restore
	Status  string `json:"status"`  // running, success, failed
	Output  string `json:"output"`
	StartAt string `json:"start_at"`
}

// BackupFileInfo 备份文件信息
type BackupFileInfo struct {
	Filename string `json:"filename"`
	Key      string `json:"key,omitempty"` // 七牛 key（云端）
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"` // unix timestamp
}

// BackupFileList 备份文件列表
type BackupFileList struct {
	MySQL []BackupFileInfo `json:"mysql"`
	MinIO []BackupFileInfo `json:"minio"`
}

// BackupService 备份恢复服务
type BackupService struct {
	tasks map[string]*TaskStatus
	mu    sync.RWMutex
}

func NewBackupService() *BackupService {
	return &BackupService{
		tasks: make(map[string]*TaskStatus),
	}
}

// CreateTask 创建一个新任务
func (s *BackupService) CreateTask(taskType string) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := uuid.New().String()
	s.tasks[id] = &TaskStatus{
		TaskID:  id,
		Type:    taskType,
		Status:  "running",
		StartAt: time.Now().Format(time.RFC3339),
	}
	return id
}

// GetTaskStatus 获取任务状态
func (s *BackupService) GetTaskStatus(taskID string) (*TaskStatus, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	task, ok := s.tasks[taskID]
	if !ok {
		return nil, fmt.Errorf("task %s not found", taskID)
	}
	return task, nil
}

// UpdateTask 更新任务状态
func (s *BackupService) UpdateTask(taskID, status, output string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if task, ok := s.tasks[taskID]; ok {
		task.Status = status
		task.Output = output
	}
}

// TriggerBackup 异步触发备份
func (s *BackupService) TriggerBackup(backupType string) (string, error) {
	taskID := s.CreateTask(backupType)

	go func() {
		var output string
		var err error

		switch backupType {
		case "mysql":
			output, err = s.execScript("scripts/backup.sh")
		case "minio":
			output, err = s.execScript("scripts/backup-minio.sh")
		case "full":
			output1, err1 := s.execScript("scripts/backup.sh")
			output2, err2 := s.execScript("scripts/backup-minio.sh")
			output = output1 + "\n---\n" + output2
			if err1 != nil {
				err = err1
			} else if err2 != nil {
				err = err2
			}
		default:
			err = fmt.Errorf("unknown backup type: %s", backupType)
		}

		if err != nil {
			s.UpdateTask(taskID, "failed", output+"\nError: "+err.Error())
		} else {
			s.UpdateTask(taskID, "success", output)
		}
	}()

	return taskID, nil
}

// TriggerRestore 异步触发恢复
func (s *BackupService) TriggerRestore(source, mysqlFile, minioFile string) (string, error) {
	taskID := s.CreateTask("restore")

	go func() {
		var output string
		var err error

		if source == "local" {
			output, err = s.execScript("scripts/restore.sh", "--auto")
		} else {
			// cloud: 先用 Python 脚本下载文件到本地，再调用 restore.sh
			dlArgs := []string{"scripts/download_from_qiniu.py", "--type", "all"}
			dlOutput, dlErr := s.execPython(dlArgs...)
			if dlErr != nil {
				s.UpdateTask(taskID, "failed", dlOutput+"\nDownload Error: "+dlErr.Error())
				return
			}
			// 下载完成后，用 restore.sh --auto 恢复（自动找到最新下载的文件）
			restoreArgs := []string{"--auto"}
			output, err = s.execScript("scripts/restore.sh", restoreArgs...)
			output = dlOutput + "\n---\n" + output
		}

		if err != nil {
			s.UpdateTask(taskID, "failed", output+"\nError: "+err.Error())
		} else {
			s.UpdateTask(taskID, "success", output)
		}
	}()

	return taskID, nil
}

// CleanupOldTasks 清理超过 1 小时的已完成任务
func (s *BackupService) CleanupOldTasks() {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().Add(-1 * time.Hour)
	for id, task := range s.tasks {
		if task.Status != "running" {
			startAt, _ := time.Parse(time.RFC3339, task.StartAt)
			if startAt.Before(cutoff) {
				delete(s.tasks, id)
			}
		}
	}
}

// execPython 执行 Python 脚本
func (s *BackupService) execPython(args ...string) (string, error) {
	cmd := exec.Command("python3", args...)
	cmd.Dir = getProjectRoot()
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// ListLocalFiles 列出本地备份文件
func (s *BackupService) ListLocalFiles() (*BackupFileList, error) {
	backupDir := os.Getenv("BACKUP_DIR")
	if backupDir == "" {
		backupDir = "/backups"
	}
	siteID := os.Getenv("SITE_ID")
	if siteID == "" {
		siteID = "default"
	}

	result := &BackupFileList{
		MySQL: []BackupFileInfo{},
		MinIO: []BackupFileInfo{},
	}

	// 扫描 MySQL 备份
	if entries, err := os.ReadDir(backupDir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if strings.HasPrefix(name, siteID+"_") && strings.HasSuffix(name, ".sql") {
				info, _ := e.Info()
				if info != nil {
					result.MySQL = append(result.MySQL, BackupFileInfo{
						Filename: name,
						Size:     info.Size(),
						Modified: info.ModTime().Unix(),
					})
				}
			}
		}
	}

	// 扫描 MinIO 备份
	minioDir := filepath.Join(backupDir, "minio")
	if entries, err := os.ReadDir(minioDir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if strings.HasSuffix(name, ".tar.gz") {
				info, _ := e.Info()
				if info != nil {
					result.MinIO = append(result.MinIO, BackupFileInfo{
						Filename: name,
						Size:     info.Size(),
						Modified: info.ModTime().Unix(),
					})
				}
			}
		}
	}

	// 按修改时间倒序排列
	sort.Slice(result.MySQL, func(i, j int) bool {
		return result.MySQL[i].Modified > result.MySQL[j].Modified
	})
	sort.Slice(result.MinIO, func(i, j int) bool {
		return result.MinIO[i].Modified > result.MinIO[j].Modified
	})

	return result, nil
}

// ListCloudFiles 列出七牛云备份文件
func (s *BackupService) ListCloudFiles() (*BackupFileList, error) {
	cmd := exec.Command("python3", "scripts/download_from_qiniu.py", "--action", "list", "--type", "all")
	cmd.Dir = getProjectRoot()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("list cloud files failed: %s, output: %s", err, string(out))
	}

	var result BackupFileList
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, fmt.Errorf("parse cloud file list failed: %s, raw: %s", err, string(out))
	}
	return &result, nil
}

// execScript 执行脚本并返回输出
func (s *BackupService) execScript(script string, args ...string) (string, error) {
	cmdArgs := append([]string{script}, args...)
	cmd := exec.Command("bash", cmdArgs...)
	cmd.Dir = getProjectRoot()
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// getProjectRoot 获取项目根目录
func getProjectRoot() string {
	// 优先使用 APP_ROOT 环境变量
	if root := os.Getenv("APP_ROOT"); root != "" {
		return root
	}
	// Docker 环境默认 /app
	return "/app"
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run TestBackupService_TaskLifecycle -v`
Expected: PASS

- [ ] **Step 5: 写 ListLocalFiles 测试**

```go
func TestBackupService_ListLocalFiles(t *testing.T) {
	// 创建临时目录模拟备份目录
	tmpDir := t.TempDir()
	t.Setenv("BACKUP_DIR", tmpDir)
	t.Setenv("SITE_ID", "test")

	// 创建测试文件
	os.WriteFile(filepath.Join(tmpDir, "test_20260316_140000.sql"), []byte("dump"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "test_20260315_120000.sql"), []byte("dump2"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "other.txt"), []byte("skip"), 0644)

	minioDir := filepath.Join(tmpDir, "minio")
	os.MkdirAll(minioDir, 0755)
	os.WriteFile(filepath.Join(minioDir, "test_minio_20260316_140000.tar.gz"), []byte("tar"), 0644)

	svc := NewBackupService()
	result, err := svc.ListLocalFiles()

	assert.NoError(t, err)
	assert.Len(t, result.MySQL, 2)
	assert.Len(t, result.MinIO, 1)
	assert.Equal(t, "test_20260316_140000.sql", result.MySQL[0].Filename) // 最新在前
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run TestBackupService_ListLocalFiles -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/service/backup.go server/service/backup_test.go
git commit -m "feat: add BackupService with task management and local file listing"
```

---

### Task 3: Backend Handler

**Files:**
- Create: `server/handler/backup.go`

- [ ] **Step 1: 实现 BackupHandler**

```go
// server/handler/backup.go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"menzhen/server/service"
)

type BackupHandler struct {
	svc *service.BackupService
}

func NewBackupHandler() *BackupHandler {
	return &BackupHandler{
		svc: service.NewBackupService(),
	}
}

// TriggerBackup POST /backup/trigger
func (h *BackupHandler) TriggerBackup(c *gin.Context) {
	var req struct {
		Type string `json:"type" binding:"required,oneof=mysql minio full"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "type 必须是 mysql/minio/full"})
		return
	}

	taskID, err := h.svc.TriggerBackup(req.Type)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "备份已开始", "data": gin.H{"task_id": taskID}})
}

// GetTaskStatus GET /backup/status/:task_id 或 /restore/status/:task_id
func (h *BackupHandler) GetTaskStatus(c *gin.Context) {
	taskID := c.Param("task_id")
	status, err := h.svc.GetTaskStatus(taskID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "任务不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": status})
}

// ListLocalFiles GET /backup/list/local
func (h *BackupHandler) ListLocalFiles(c *gin.Context) {
	files, err := h.svc.ListLocalFiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": files})
}

// ListCloudFiles GET /backup/list/cloud
func (h *BackupHandler) ListCloudFiles(c *gin.Context) {
	files, err := h.svc.ListCloudFiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": files})
}

// TriggerRestore POST /restore/trigger
func (h *BackupHandler) TriggerRestore(c *gin.Context) {
	var req struct {
		Source    string `json:"source" binding:"required,oneof=local cloud"`
		MySQLFile string `json:"mysql_file"`
		MinIOFile string `json:"minio_file"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "source 必须是 local/cloud"})
		return
	}

	if req.Source == "cloud" && req.MySQLFile == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "云端恢复必须选择 MySQL 备份文件"})
		return
	}

	taskID, err := h.svc.TriggerRestore(req.Source, req.MySQLFile, req.MinIOFile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "恢复已开始", "data": gin.H{"task_id": taskID}})
}
```

- [ ] **Step 2: 确认编译通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./...`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add server/handler/backup.go
git commit -m "feat: add BackupHandler for backup/restore API endpoints"
```

---

### Task 4: 注册路由

**Files:**
- Modify: `server/router/router.go`

- [ ] **Step 1: 在 router.go 中添加备份恢复路由**

在 `configRoutes` 之后（约 line 310 附近），添加：

```go
	// 备份恢复
	backupHandler := handler.NewBackupHandler()
	backupRoutes := authenticated.Group("/backup")
	{
		backupRoutes.POST("/trigger", middleware.RequirePermission(db, "user:manage"), backupHandler.TriggerBackup)
		backupRoutes.GET("/status/:task_id", middleware.RequirePermission(db, "user:manage"), backupHandler.GetTaskStatus)
		backupRoutes.GET("/list/local", middleware.RequirePermission(db, "user:manage"), backupHandler.ListLocalFiles)
		backupRoutes.GET("/list/cloud", middleware.RequirePermission(db, "user:manage"), backupHandler.ListCloudFiles)
	}
	restoreRoutes := authenticated.Group("/restore")
	{
		restoreRoutes.POST("/trigger", middleware.RequirePermission(db, "user:manage"), backupHandler.TriggerRestore)
		restoreRoutes.GET("/status/:task_id", middleware.RequirePermission(db, "user:manage"), backupHandler.GetTaskStatus)
	}
```

- [ ] **Step 2: 确认编译通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./...`
Expected: 编译成功

- [ ] **Step 3: 运行后端全量测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./... -count=1`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add server/router/router.go
git commit -m "feat: register backup/restore API routes"
```

---

## Chunk 2: Frontend

### Task 5: 前端 API 客户端

**Files:**
- Create: `web/src/api/backup.ts`

- [ ] **Step 1: 创建 API 客户端**

```typescript
// web/src/api/backup.ts
import request from '../utils/request';

export interface BackupFileInfo {
  filename: string;
  key?: string;       // 七牛 key（云端）
  size: number;
  modified: number;   // unix timestamp
}

export interface BackupFileList {
  mysql: BackupFileInfo[];
  minio: BackupFileInfo[];
}

export interface TaskResult {
  task_id: string;
}

export interface TaskStatus {
  task_id: string;
  type: string;
  status: 'running' | 'success' | 'failed';
  output: string;
  start_at: string;
}

/** 触发备份 */
export function triggerBackup(type: 'mysql' | 'minio' | 'full') {
  return request.post<TaskResult>('/backup/trigger', { type });
}

/** 查询备份任务状态 */
export function getBackupStatus(taskId: string) {
  return request.get<TaskStatus>(`/backup/status/${taskId}`);
}

/** 列出本地备份文件 */
export function listLocalFiles() {
  return request.get<BackupFileList>('/backup/list/local');
}

/** 列出云端备份文件 */
export function listCloudFiles() {
  return request.get<BackupFileList>('/backup/list/cloud');
}

/** 触发恢复 */
export function triggerRestore(data: {
  source: 'local' | 'cloud';
  mysql_file?: string;
  minio_file?: string;
}) {
  return request.post<TaskResult>('/restore/trigger', data);
}

/** 查询恢复任务状态 */
export function getRestoreStatus(taskId: string) {
  return request.get<TaskStatus>(`/restore/status/${taskId}`);
}
```

- [ ] **Step 2: 确认前端编译**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add web/src/api/backup.ts
git commit -m "feat: add backup/restore API client"
```

---

### Task 6: BackupRestore 页面组件

**Files:**
- Create: `web/src/pages/settings/BackupRestore.tsx`

- [ ] **Step 1: 实现页面组件**

```tsx
// web/src/pages/settings/BackupRestore.tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Card, Button, Space, Typography, Alert, Modal, Drawer,
  Radio, List, Tag, message, Spin, Popconfirm,
} from 'antd';
import {
  CloudUploadOutlined, DatabaseOutlined, CloudDownloadOutlined,
  DesktopOutlined, CloudServerOutlined, ReloadOutlined,
} from '@ant-design/icons';
import useIsMobile from '../../hooks/useIsMobile';
import {
  triggerBackup, getBackupStatus, listLocalFiles, listCloudFiles,
  triggerRestore, getRestoreStatus,
  BackupFileInfo, BackupFileList, TaskStatus,
} from '../../api/backup';

const { Title, Text } = Typography;

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

/** 格式化时间戳 */
function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

export default function BackupRestore() {
  const isMobile = useIsMobile();

  // 备份状态
  const [backupLoading, setBackupLoading] = useState<string | null>(null); // mysql | minio | full
  const [backupResult, setBackupResult] = useState<{ status: string; output: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // 恢复弹窗状态
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [cloudFiles, setCloudFiles] = useState<BackupFileList | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [selectedMySQL, setSelectedMySQL] = useState<string>('');
  const [selectedMinIO, setSelectedMinIO] = useState<string>('');
  const [restoreLoading, setRestoreLoading] = useState(false);

  // 清理轮询
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /** 轮询任务状态 */
  const pollTaskStatus = useCallback((taskId: string, getter: (id: string) => Promise<unknown>, onDone: (s: TaskStatus) => void) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await getter(taskId) as unknown as { code: number; data: TaskStatus };
        if (res.data.status !== 'running') {
          clearInterval(pollRef.current!);
          onDone(res.data);
        }
      } catch {
        clearInterval(pollRef.current!);
      }
    }, 3000);
  }, []);

  /** 触发备份 */
  const handleBackup = useCallback(async (type: 'mysql' | 'minio' | 'full') => {
    setBackupLoading(type);
    setBackupResult(null);
    try {
      const res = await triggerBackup(type) as unknown as { code: number; data: { task_id: string } };
      message.info('备份任务已启动');
      pollTaskStatus(res.data.task_id, getBackupStatus, (status) => {
        setBackupLoading(null);
        setBackupResult({ status: status.status, output: status.output });
        if (status.status === 'success') {
          message.success('备份完成');
        } else {
          message.error('备份失败');
        }
      });
    } catch {
      setBackupLoading(null);
      message.error('启动备份失败');
    }
  }, [pollTaskStatus]);

  /** 打开云端恢复弹窗 */
  const openCloudRestore = useCallback(async () => {
    setRestoreModalOpen(true);
    setCloudLoading(true);
    setSelectedMySQL('');
    setSelectedMinIO('');
    try {
      const res = await listCloudFiles() as unknown as { code: number; data: BackupFileList };
      setCloudFiles(res.data);
    } catch {
      message.error('获取云端备份列表失败');
    } finally {
      setCloudLoading(false);
    }
  }, []);

  /** 触发本地恢复 */
  const handleLocalRestore = useCallback(async () => {
    setRestoreLoading(true);
    try {
      const res = await triggerRestore({ source: 'local' }) as unknown as { code: number; data: { task_id: string } };
      message.info('恢复任务已启动');
      pollTaskStatus(res.data.task_id, getRestoreStatus, (status) => {
        setRestoreLoading(false);
        if (status.status === 'success') {
          message.success('恢复完成，服务即将重启');
        } else {
          message.error('恢复失败: ' + status.output.slice(0, 200));
        }
      });
    } catch {
      setRestoreLoading(false);
      message.error('启动恢复失败');
    }
  }, [pollTaskStatus]);

  /** 触发云端恢复 */
  const handleCloudRestore = useCallback(async () => {
    if (!selectedMySQL) {
      message.warning('请选择 MySQL 备份文件');
      return;
    }
    setRestoreLoading(true);
    setRestoreModalOpen(false);
    try {
      const res = await triggerRestore({
        source: 'cloud',
        mysql_file: selectedMySQL,
        minio_file: selectedMinIO || undefined,
      }) as unknown as { code: number; data: { task_id: string } };
      message.info('恢复任务已启动，正在下载并恢复...');
      pollTaskStatus(res.data.task_id, getRestoreStatus, (status) => {
        setRestoreLoading(false);
        if (status.status === 'success') {
          message.success('恢复完成，服务即将重启');
        } else {
          message.error('恢复失败');
        }
      });
    } catch {
      setRestoreLoading(false);
      message.error('启动恢复失败');
    }
  }, [selectedMySQL, selectedMinIO, pollTaskStatus]);

  /** 渲染文件选择列表 */
  const renderFileList = (
    files: BackupFileInfo[],
    selected: string,
    onSelect: (f: string) => void,
    label: string,
    optional?: boolean,
  ) => (
    <div style={{ marginBottom: 16 }}>
      <Text strong>{label}{optional && <Text type="secondary">（可选）</Text>}</Text>
      <Radio.Group
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        style={{ display: 'block', marginTop: 8 }}
      >
        <List
          size="small"
          bordered
          dataSource={files}
          locale={{ emptyText: '暂无备份文件' }}
          renderItem={(item) => (
            <List.Item
              style={{
                cursor: 'pointer',
                background: selected === item.filename ? '#e6f7ff' : undefined,
                padding: isMobile ? '10px 12px' : '8px 12px',
              }}
              onClick={() => onSelect(item.filename)}
            >
              <Radio value={item.filename} style={{ marginRight: 8 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text ellipsis style={{ display: 'block' }}>{item.filename}</Text>
                {isMobile && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatSize(item.size)} · {formatTime(item.modified)}
                  </Text>
                )}
              </div>
              {!isMobile && (
                <Text type="secondary">{formatSize(item.size)} · {formatTime(item.modified)}</Text>
              )}
            </List.Item>
          )}
        />
      </Radio.Group>
    </div>
  );

  /** 云端恢复内容 */
  const cloudRestoreContent = (
    <Spin spinning={cloudLoading}>
      {cloudFiles && (
        <>
          {renderFileList(cloudFiles.mysql, selectedMySQL, setSelectedMySQL, '🗄️ MySQL 备份')}
          {renderFileList(cloudFiles.minio, selectedMinIO, setSelectedMinIO, '📁 MinIO 备份', true)}
        </>
      )}
      <Alert
        type="error"
        message="恢复将覆盖当前全部数据，此操作不可撤销！"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <div style={{ textAlign: isMobile ? 'center' : 'right' }}>
        <Space direction={isMobile ? 'vertical' : 'horizontal'} style={{ width: isMobile ? '100%' : undefined }}>
          <Button onClick={() => setRestoreModalOpen(false)} style={isMobile ? { width: '100%' } : undefined}>
            取消
          </Button>
          <Button
            danger
            type="primary"
            disabled={!selectedMySQL}
            loading={restoreLoading}
            onClick={handleCloudRestore}
            style={isMobile ? { width: '100%' } : undefined}
          >
            确认恢复
          </Button>
        </Space>
      </div>
    </Spin>
  );

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={4}>备份与恢复</Title>

      {/* 数据备份区域 */}
      <Card
        title={<><CloudUploadOutlined /> 数据备份</>}
        style={{ marginBottom: 16 }}
        extra={backupResult && (
          <Tag color={backupResult.status === 'success' ? 'green' : 'red'}>
            {backupResult.status === 'success' ? '备份成功' : '备份失败'}
          </Tag>
        )}
      >
        <Alert
          type="info"
          message="手动触发备份会立即执行备份脚本，并上传到七牛云。自动备份仍按配置间隔执行。"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Space direction={isMobile ? 'vertical' : 'horizontal'} style={{ width: isMobile ? '100%' : undefined }}>
          <Button
            type="primary"
            icon={<DatabaseOutlined />}
            loading={backupLoading === 'mysql'}
            disabled={!!backupLoading}
            onClick={() => handleBackup('mysql')}
            style={isMobile ? { width: '100%' } : undefined}
          >
            备份 MySQL
          </Button>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            loading={backupLoading === 'minio'}
            disabled={!!backupLoading}
            onClick={() => handleBackup('minio')}
            style={isMobile ? { width: '100%' } : undefined}
          >
            备份 MinIO
          </Button>
          <Button
            type="primary"
            style={isMobile ? { width: '100%', background: '#52c41a', borderColor: '#52c41a' } : { background: '#52c41a', borderColor: '#52c41a' }}
            icon={<ReloadOutlined />}
            loading={backupLoading === 'full'}
            disabled={!!backupLoading}
            onClick={() => handleBackup('full')}
          >
            全量备份
          </Button>
        </Space>
      </Card>

      {/* 数据恢复区域 */}
      <Card title={<><CloudDownloadOutlined /> 数据恢复</>}>
        <Alert
          type="warning"
          message="恢复操作将覆盖当前数据，请确认后再操作"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: 16,
        }}>
          <Popconfirm
            title="从本地恢复"
            description="将使用本地最新备份恢复数据，确定继续？"
            onConfirm={handleLocalRestore}
            okText="确认恢复"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Card
              hoverable
              style={{ flex: 1, textAlign: 'center' }}
              loading={restoreLoading}
            >
              <DesktopOutlined style={{ fontSize: 32, color: '#1890ff', marginBottom: 8 }} />
              <div><Text strong>从本地恢复</Text></div>
              <Text type="secondary" style={{ fontSize: 12 }}>自动查找本地最新备份</Text>
            </Card>
          </Popconfirm>

          <Card
            hoverable
            style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}
            onClick={openCloudRestore}
          >
            <CloudServerOutlined style={{ fontSize: 32, color: '#1890ff', marginBottom: 8 }} />
            <div><Text strong>从云端恢复</Text></div>
            <Text type="secondary" style={{ fontSize: 12 }}>从七牛云选择备份文件</Text>
          </Card>
        </div>
      </Card>

      {/* 云端恢复弹窗 — 桌面端 Modal / 移动端 Drawer */}
      {isMobile ? (
        <Drawer
          title="☁️ 从云端恢复"
          placement="bottom"
          height="85vh"
          open={restoreModalOpen}
          onClose={() => setRestoreModalOpen(false)}
          footer={null}
        >
          {cloudRestoreContent}
        </Drawer>
      ) : (
        <Modal
          title="☁️ 从云端恢复"
          width={560}
          open={restoreModalOpen}
          onCancel={() => setRestoreModalOpen(false)}
          footer={null}
        >
          {cloudRestoreContent}
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 确认前端编译**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/settings/BackupRestore.tsx
git commit -m "feat: add BackupRestore page with responsive layout"
```

---

### Task 7: 注册前端路由

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 在 App.tsx 添加路由**

在 `settings/config` 路由旁边添加：

```tsx
import BackupRestore from './pages/settings/BackupRestore';

// 在 Route path="settings/config" 后面添加:
<Route path="settings/backup" element={<BackupRestore />} />
```

- [ ] **Step 2: 在侧边栏导航添加入口**

在 `web/src/components/Layout.tsx` 的 `menuItems` useMemo 中，找到 `settingsChildren` 数组（约 line 254），在 `canManageConfig` 的 if 块（`key: '/settings/config'`）后面添加：

```tsx
// 在 Layout.tsx 顶部添加 import:
import { CloudSyncOutlined } from '@ant-design/icons';

// 在 settingsChildren 中，'/settings/config' 之后添加:
if (canManageConfig) {
  settingsChildren.push({
    key: '/settings/backup',
    icon: <CloudSyncOutlined />,
    label: '备份与恢复',
  });
}
```

同时在 `selectedKeys` useMemo 中添加：
```tsx
if (path.startsWith('/settings/backup')) return ['/settings/backup'];
```

- [ ] **Step 3: 确认前端编译 + 运行**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: add backup/restore route and navigation entry"
```

---

## Chunk 3: Tests

### Task 8: 前端组件测试

**Files:**
- Create: `web/src/pages/settings/__tests__/BackupRestore.test.tsx`

- [ ] **Step 1: 写组件渲染测试**

```tsx
// web/src/pages/settings/__tests__/BackupRestore.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import BackupRestore from '../BackupRestore';

// Mock API
vi.mock('../../../api/backup', () => ({
  triggerBackup: vi.fn().mockResolvedValue({ code: 0, data: { task_id: 'test-123' } }),
  getBackupStatus: vi.fn().mockResolvedValue({ code: 0, data: { status: 'success', output: 'ok' } }),
  listLocalFiles: vi.fn().mockResolvedValue({ code: 0, data: { mysql: [], minio: [] } }),
  listCloudFiles: vi.fn().mockResolvedValue({
    code: 0,
    data: {
      mysql: [{ filename: 'test_20260316.sql', size: 2300000, modified: 1773897000 }],
      minio: [{ filename: 'test_minio_20260316.tar.gz', size: 156000000, modified: 1773897000 }],
    },
  }),
  triggerRestore: vi.fn().mockResolvedValue({ code: 0, data: { task_id: 'restore-123' } }),
  getRestoreStatus: vi.fn().mockResolvedValue({ code: 0, data: { status: 'success', output: 'ok' } }),
}));

// Mock useIsMobile
vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

describe('BackupRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders backup and restore sections', () => {
    render(<BackupRestore />);
    expect(screen.getByText('备份与恢复')).toBeInTheDocument();
    expect(screen.getByText('数据备份')).toBeInTheDocument();
    expect(screen.getByText('数据恢复')).toBeInTheDocument();
  });

  it('renders three backup buttons', () => {
    render(<BackupRestore />);
    expect(screen.getByText('备份 MySQL')).toBeInTheDocument();
    expect(screen.getByText('备份 MinIO')).toBeInTheDocument();
    expect(screen.getByText('全量备份')).toBeInTheDocument();
  });

  it('renders restore options', () => {
    render(<BackupRestore />);
    expect(screen.getByText('从本地恢复')).toBeInTheDocument();
    expect(screen.getByText('从云端恢复')).toBeInTheDocument();
  });

  it('opens cloud restore modal on click', async () => {
    const user = userEvent.setup();
    render(<BackupRestore />);
    await user.click(screen.getByText('从云端恢复'));
    expect(await screen.findByText('☁️ 从云端恢复')).toBeInTheDocument();
  });

  it('triggers backup on button click', async () => {
    const { triggerBackup: mockTrigger } = await import('../../../api/backup');
    const user = userEvent.setup();
    render(<BackupRestore />);
    await user.click(screen.getByText('备份 MySQL'));
    expect(mockTrigger).toHaveBeenCalledWith('mysql');
  });
});
```

- [ ] **Step 2: 运行前端测试**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx vitest run src/pages/settings/__tests__/BackupRestore.test.tsx`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/settings/__tests__/BackupRestore.test.tsx
git commit -m "test: add BackupRestore component tests"
```

---

### Task 9: 全量验证

- [ ] **Step 1: 后端全量测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./... -count=1`
Expected: 全部 PASS

- [ ] **Step 2: 前端全量测试**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 3: 前端 build**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run build`
Expected: 编译成功

- [ ] **Step 4: 后端 build**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./...`
Expected: 编译成功

- [ ] **Step 5: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "feat: backup and restore UI complete"
```
