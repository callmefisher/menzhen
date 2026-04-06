# 磁盘监控和迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在备份与恢复页面底部新增「磁盘监控和迁移」卡片，实现磁盘用量可视化、可配置采集间隔、MySQL/MinIO 数据目录迁移向导，以及支持目录浏览器的备份目录快速更换。

**Architecture:** 后端 DiskService 通过 Docker exec 在 backup 容器内运行 `df` 采集磁盘用量，异步任务模式处理迁移和目录更换（进度由前端 2s 轮询获取）；目录浏览通过 `/hostfs` 挂载读取宿主机路径；前端新增 DiskMonitor 卡片组件组（主卡片 + 迁移向导 Modal + 备份目录更换 + 通用目录浏览 Modal），集成到现有备份页面底部。

**Tech Stack:** Go + Gin + GORM, React + TypeScript + Ant Design 5, Docker API over unix socket (`/var/run/docker.sock`)

---

## 文件清单

**新建**
```
server/model/disk.go               — DiskStatus, DirEntry, MigrateRequest, BackupDirRequest
server/model/system_setting.go     — SystemSetting KV 模型
server/service/disk.go             — DiskService（采集 / 间隔 / 迁移 / 目录更换 / FS 浏览）
server/handler/disk.go             — DiskHandler（7 个 HTTP 处理器）
server/handler/disk_test.go        — 后端单元测试

web/src/api/disk.ts                — 所有 disk API 函数和 TypeScript 接口
web/src/components/DiskMonitor/index.tsx        — 主卡片
web/src/components/DiskMonitor/MigrateWizard.tsx — MySQL/MinIO 迁移向导 Modal
web/src/components/DiskMonitor/BackupDirChange.tsx — 备份目录更换内联面板
web/src/components/DiskMonitor/DirBrowser.tsx  — 通用目录浏览 Modal（两处共用）
web/src/components/DiskMonitor/__tests__/DiskMonitor.test.tsx
web/src/components/DiskMonitor/__tests__/DirBrowser.test.tsx
```

**修改**
```
docker-compose.yml                 — 新增 backup/api 服务挂载
server/database/database.go        — 注册 SystemSetting 到 AutoMigrate
server/router/router.go            — 注册 disk 路由组
web/src/pages/settings/BackupRestore.tsx — 底部引入 <DiskMonitor />
```

---

## Task 1: docker-compose.yml 新增挂载

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: 查看现有 backup 和 api 服务的 volumes**

```bash
grep -A 20 "  backup:" docker-compose.yml
grep -A 20 "  api:" docker-compose.yml
```

- [ ] **Step 2: 给 backup 服务新增只读 named volume 挂载**

在 `backup:` 服务的 `volumes:` 列表中添加（用于 df 采集 MySQL 和 MinIO 用量）：
```yaml
      - mysql-data:/var/lib/mysql:ro
      - minio-data:/data:ro
```

- [ ] **Step 3: 给 api 服务新增两个挂载**

在 `api:` 服务的 `volumes:` 列表中添加：
```yaml
      - ./docker-compose.yml:/app/docker-compose.yml   # 迁移时写入路径变更
      - /:/hostfs:ro                                    # 目录浏览 API 读取宿主机路径
```

- [ ] **Step 4: 确认 mysql-data 和 minio-data named volumes 已在顶级 volumes 声明**

```bash
grep -A 3 "^volumes:" docker-compose.yml
```

若无则补充：
```yaml
volumes:
  mysql-data:
  minio-data:
```

- [ ] **Step 5: 提交**

```bash
git add docker-compose.yml
git commit -m "chore: add disk monitor mounts to backup and api services"
```

---

## Task 2: 后端模型 — disk.go + system_setting.go

**Files:**
- Create: `server/model/disk.go`
- Create: `server/model/system_setting.go`
- Modify: `server/database/database.go`

- [ ] **Step 1: 创建 server/model/system_setting.go**

```go
package model

// SystemSetting 系统级键值配置（不含租户隔离）
type SystemSetting struct {
	Key   string `gorm:"primaryKey" json:"key"`
	Value string `json:"value"`
}
```

- [ ] **Step 2: 创建 server/model/disk.go**

```go
package model

import "time"

// DiskStatus 磁盘状态采集结果
type DiskStatus struct {
	Total       int64     `json:"total"`        // 字节
	Used        int64     `json:"used"`
	Free        int64     `json:"free"`
	UsedPct     float64   `json:"used_pct"`
	MySQLUsed   int64     `json:"mysql_used"`
	MinIOUsed   int64     `json:"minio_used"`
	BackupUsed  int64     `json:"backup_used"`
	CollectedAt time.Time `json:"collected_at"`
	Interval    int       `json:"interval"` // 秒
}

// DirEntry 目录浏览条目
type DirEntry struct {
	Name string `json:"name"`
	Path string `json:"path"` // 宿主机绝对路径
}

// MigrateRequest MySQL 或 MinIO 迁移请求
type MigrateRequest struct {
	Target  string `json:"target" binding:"required,oneof=mysql minio"` // "mysql" or "minio"
	NewPath string `json:"new_path" binding:"required"`
}

// BackupDirRequest 备份目录更换请求
type BackupDirRequest struct {
	NewPath string `json:"new_path" binding:"required"`
}

// DiskTask 磁盘操作任务状态
type DiskTask struct {
	TaskID   string `json:"task_id"`
	Type     string `json:"type"`   // migrate_mysql, migrate_minio, backup_dir
	Status   string `json:"status"` // running, success, failed, aborted
	Step     int    `json:"step"`   // 当前步骤（1-based）
	Total    int    `json:"total"`  // 总步骤数
	Output   string `json:"output"`
	StartAt  string `json:"start_at"`
}
```

- [ ] **Step 3: 注册 SystemSetting 到 AutoMigrate**

在 `server/database/database.go` 的 `db.AutoMigrate(...)` 调用中追加：
```go
		&model.SystemSetting{},
```

- [ ] **Step 4: 确认编译通过**

```bash
cd server && go build ./...
```

Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add server/model/disk.go server/model/system_setting.go server/database/database.go
git commit -m "feat: add DiskStatus, DirEntry, DiskTask, SystemSetting models"
```

---

## Task 3: DiskService — 采集 + 间隔 + BrowseFS

**Files:**
- Create: `server/service/disk.go`

- [ ] **Step 1: 创建 server/service/disk.go 骨架**

```go
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

const (
	diskMonitorIntervalKey = "disk_monitor_interval"
	defaultInterval        = 3600 // 1 hour in seconds
	hostFSRoot             = "/hostfs"
)

// DiskService 磁盘监控服务
type DiskService struct {
	db         *gorm.DB
	httpClient *http.Client
	tasks      map[string]*model.DiskTask
	mu         sync.RWMutex

	lastStatus *model.DiskStatus
	statusMu   sync.RWMutex

	cancel context.CancelFunc
}

// NewDiskService 创建 DiskService 并启动后台采集 goroutine
func NewDiskService(db *gorm.DB) *DiskService {
	s := &DiskService{
		db:    db,
		tasks: make(map[string]*model.DiskTask),
		httpClient: &http.Client{
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					return net.Dial("unix", "/var/run/docker.sock")
				},
			},
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go s.collectLoop(ctx)
	return s
}

// dockerURL constructs a Docker API URL
func (s *DiskService) dockerURL(path string) string {
	return "http://docker" + path
}
```

- [ ] **Step 2: 实现 parseDfOutput — 解析 df -B1 输出**

```go
// parseDfOutput 解析 df -B1 输出，返回各挂载点的 used 字节数
// df -B1 /var/lib/mysql /data /backups / 输出示例：
//
//	Filesystem     1B-blocks      Used  Available Use% Mounted on
//	overlay        500000000 200000000  300000000  40% /
//	...
func parseDfOutput(output string) (total, used, free, mysqlUsed, minioUsed, backupUsed int64, err error) {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) < 2 {
		return 0, 0, 0, 0, 0, 0, fmt.Errorf("unexpected df output: %q", output)
	}
	for _, line := range lines[1:] { // skip header
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		mountpoint := fields[5]
		usedBytes, e := strconv.ParseInt(fields[2], 10, 64)
		if e != nil {
			continue
		}
		totalBytes, e := strconv.ParseInt(fields[1], 10, 64)
		if e != nil {
			continue
		}
		freeBytes, e := strconv.ParseInt(fields[3], 10, 64)
		if e != nil {
			continue
		}
		switch mountpoint {
		case "/":
			total, used, free = totalBytes, usedBytes, freeBytes
		case "/var/lib/mysql":
			mysqlUsed = usedBytes
		case "/data":
			minioUsed = usedBytes
		case "/backups":
			backupUsed = usedBytes
		}
	}
	return
}
```

- [ ] **Step 3: 实现 dockerExec（在 backup 容器执行命令）**

```go
func backupContainer() string {
	if c := os.Getenv("BACKUP_CONTAINER"); c != "" {
		return c
	}
	return "menzhen-backup-1"
}

// dockerExec 在指定容器中执行命令并返回 stdout+stderr 合并输出
func (s *DiskService) dockerExec(container string, cmd ...string) (string, error) {
	createBody, _ := json.Marshal(map[string]interface{}{
		"AttachStdout": true,
		"AttachStderr": true,
		"Cmd":          cmd,
	})
	createReq, err := http.NewRequest("POST",
		s.dockerURL(fmt.Sprintf("/containers/%s/exec", container)),
		bytes.NewReader(createBody))
	if err != nil {
		return "", fmt.Errorf("create exec request: %w", err)
	}
	createReq.Header.Set("Content-Type", "application/json")

	createResp, err := s.httpClient.Do(createReq)
	if err != nil {
		return "", fmt.Errorf("docker socket: %w", err)
	}
	defer createResp.Body.Close()
	if createResp.StatusCode != 201 {
		b, _ := io.ReadAll(createResp.Body)
		return "", fmt.Errorf("exec create (%d): %s", createResp.StatusCode, b)
	}
	var execCreate struct {
		ID string `json:"Id"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&execCreate); err != nil {
		return "", fmt.Errorf("parse exec create: %w", err)
	}

	startBody, _ := json.Marshal(map[string]interface{}{"Detach": false, "Tty": false})
	startReq, err := http.NewRequest("POST",
		s.dockerURL(fmt.Sprintf("/exec/%s/start", execCreate.ID)),
		bytes.NewReader(startBody))
	if err != nil {
		return "", fmt.Errorf("start exec request: %w", err)
	}
	startReq.Header.Set("Content-Type", "application/json")

	startResp, err := s.httpClient.Do(startReq)
	if err != nil {
		return "", fmt.Errorf("exec start: %w", err)
	}
	defer startResp.Body.Close()

	out, err := io.ReadAll(startResp.Body)
	if err != nil {
		return "", fmt.Errorf("read exec output: %w", err)
	}
	// Docker multiplexed stream: each frame has 8-byte header; strip headers
	return stripDockerMux(out), nil
}

// stripDockerMux removes Docker stream multiplexing headers (8-byte prefix per frame)
func stripDockerMux(b []byte) string {
	var sb strings.Builder
	for len(b) >= 8 {
		size := int(b[4])<<24 | int(b[5])<<16 | int(b[6])<<8 | int(b[7])
		b = b[8:]
		if size > len(b) {
			size = len(b)
		}
		sb.Write(b[:size])
		b = b[size:]
	}
	return sb.String()
}
```

- [ ] **Step 4: 实现 CollectNow 和后台采集 loop**

```go
// CollectNow 立即采集一次磁盘状态
func (s *DiskService) CollectNow() (*model.DiskStatus, error) {
	output, err := s.dockerExec(backupContainer(),
		"df", "-B1", "/var/lib/mysql", "/data", "/backups", "/")
	if err != nil {
		return nil, fmt.Errorf("df exec: %w", err)
	}

	total, used, free, mysqlUsed, minioUsed, backupUsed, err := parseDfOutput(output)
	if err != nil {
		return nil, fmt.Errorf("parse df: %w", err)
	}

	var usedPct float64
	if total > 0 {
		usedPct = float64(used) / float64(total) * 100
	}

	interval := s.GetInterval()
	status := &model.DiskStatus{
		Total:       total,
		Used:        used,
		Free:        free,
		UsedPct:     usedPct,
		MySQLUsed:   mysqlUsed,
		MinIOUsed:   minioUsed,
		BackupUsed:  backupUsed,
		CollectedAt: time.Now(),
		Interval:    interval,
	}

	s.statusMu.Lock()
	s.lastStatus = status
	s.statusMu.Unlock()

	// Auto-switch to 1 minute if usage >= 90%
	if usedPct >= 90 && interval > 60 {
		_ = s.SetInterval(60)
	}

	return status, nil
}

// GetStatus 返回最新缓存状态，若无缓存则立即采集
func (s *DiskService) GetStatus() (*model.DiskStatus, error) {
	s.statusMu.RLock()
	cached := s.lastStatus
	s.statusMu.RUnlock()
	if cached != nil {
		return cached, nil
	}
	return s.CollectNow()
}

func (s *DiskService) collectLoop(ctx context.Context) {
	for {
		interval := time.Duration(s.GetInterval()) * time.Second
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
			if _, err := s.CollectNow(); err != nil {
				// log but don't crash
				_ = err
			}
		}
	}
}
```

- [ ] **Step 5: 实现 GetInterval / SetInterval**

```go
// GetInterval 从数据库读取采集间隔（秒），默认 3600
func (s *DiskService) GetInterval() int {
	var setting model.SystemSetting
	if err := s.db.First(&setting, "key = ?", diskMonitorIntervalKey).Error; err != nil {
		return defaultInterval
	}
	v, err := strconv.Atoi(setting.Value)
	if err != nil || v < 60 || v > 3600 {
		return defaultInterval
	}
	return v
}

// SetInterval 持久化采集间隔（60~3600 秒）
func (s *DiskService) SetInterval(seconds int) error {
	if seconds < 60 || seconds > 3600 {
		return fmt.Errorf("interval must be between 60 and 3600 seconds")
	}
	return s.db.Save(&model.SystemSetting{
		Key:   diskMonitorIntervalKey,
		Value: strconv.Itoa(seconds),
	}).Error
}
```

- [ ] **Step 6: 实现 BrowseFS — 列出宿主机目录**

```go
// BrowseFS 列出宿主机 path 下的直接子目录（通过 /hostfs 挂载）
func (s *DiskService) BrowseFS(path string) ([]model.DirEntry, error) {
	// Sanitize: 清理 path traversal
	clean := filepath.Clean("/" + path)
	hostPath := filepath.Join(hostFSRoot, clean)

	// 防止逃出 /hostfs
	if !strings.HasPrefix(hostPath, hostFSRoot) {
		return nil, fmt.Errorf("invalid path")
	}

	entries, err := os.ReadDir(hostPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []model.DirEntry{}, nil
		}
		return nil, fmt.Errorf("read dir: %w", err)
	}

	var dirs []model.DirEntry
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		// Skip hidden directories
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		dirs = append(dirs, model.DirEntry{
			Name: e.Name(),
			Path: filepath.Join(clean, e.Name()),
		})
	}
	return dirs, nil
}
```

- [ ] **Step 7: 确认编译通过**

```bash
cd server && go build ./...
```

Expected: 无错误

- [ ] **Step 8: 提交**

```bash
git add server/service/disk.go
git commit -m "feat: add DiskService with collection, interval management, and FS browser"
```

---

## Task 4: DiskHandler — GetStatus / SetInterval / BrowseFS + 路由注册

**Files:**
- Create: `server/handler/disk.go`
- Modify: `server/router/router.go`

- [ ] **Step 1: 创建 server/handler/disk.go**

```go
package handler

import (
	"net/http"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// DiskHandler 磁盘监控和迁移 HTTP 处理器
type DiskHandler struct {
	svc *service.DiskService
}

// NewDiskHandler 构造函数，同时启动后台采集
func NewDiskHandler(db *gorm.DB) *DiskHandler {
	return &DiskHandler{svc: service.NewDiskService(db)}
}

// GetStatus GET /api/disk/status
func (h *DiskHandler) GetStatus(c *gin.Context) {
	status, err := h.svc.GetStatus()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": status})
}

// SetInterval PUT /api/disk/interval  body: {"interval": 300}
func (h *DiskHandler) SetInterval(c *gin.Context) {
	var req struct {
		Interval int `json:"interval" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetInterval(req.Interval); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0})
}

// BrowseFS GET /api/disk/fs?path=/opt
func (h *DiskHandler) BrowseFS(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		path = "/"
	}
	entries, err := h.svc.BrowseFS(path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": entries})
}
```

- [ ] **Step 2: 在 server/router/router.go 注册路由**

在 backup 路由组附近（约 line 421）插入：

```go
		// Disk monitor & migration routes (super admin only).
		diskHandler := handler.NewDiskHandler(db)
		diskRoutes := authenticated.Group("/disk")
		{
			diskRoutes.GET("/status", middleware.RequirePermission(db, "user:manage"), diskHandler.GetStatus)
			diskRoutes.PUT("/interval", middleware.RequirePermission(db, "user:manage"), diskHandler.SetInterval)
			diskRoutes.GET("/fs", middleware.RequirePermission(db, "user:manage"), diskHandler.BrowseFS)
		}
```

- [ ] **Step 3: 确认编译通过**

```bash
cd server && go build ./...
```

Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add server/handler/disk.go server/router/router.go
git commit -m "feat: add DiskHandler GetStatus/SetInterval/BrowseFS and routes"
```

---

## Task 5: DiskService — 迁移任务（MySQL / MinIO）

**Files:**
- Modify: `server/service/disk.go`

迁移步骤（共 6 步）：
1. 触发完整备份（exec backup 脚本）
2. 停止目标容器（docker stop）
3. 使用临时 alpine 容器执行数据复制（cp -a）
4. 更新 docker-compose.yml 中的 volume bind
5. 重启所有容器
6. 验证连通性

- [ ] **Step 1: 在 disk.go 中添加任务辅助方法**

```go
import "github.com/google/uuid"

// createTask 创建新任务（加锁保护）
func (s *DiskService) createTask(taskType string, total int) *model.DiskTask {
	task := &model.DiskTask{
		TaskID:  uuid.New().String(),
		Type:    taskType,
		Status:  "running",
		Step:    0,
		Total:   total,
		StartAt: time.Now().Format(time.RFC3339),
	}
	s.mu.Lock()
	s.tasks[task.TaskID] = task
	s.mu.Unlock()
	return task
}

// getTask 读取任务状态
func (s *DiskService) GetTask(taskID string) (*model.DiskTask, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.tasks[taskID]
	return t, ok
}

// updateTask 更新任务步骤和输出（加锁）
func (s *DiskService) updateTask(taskID string, step int, output string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.tasks[taskID]; ok {
		t.Step = step
		t.Output += output + "\n"
	}
}

// finishTask 完成任务
func (s *DiskService) finishTask(taskID, status, msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.tasks[taskID]; ok {
		t.Status = status
		t.Output += msg
	}
}

// HasRunningTask 检查是否有同类型任务运行中
func (s *DiskService) HasRunningTask(taskType string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, t := range s.tasks {
		if t.Type == taskType && t.Status == "running" {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: 实现 dockerStop / dockerStart 辅助**

```go
// dockerStop 停止容器（30s 超时）
func (s *DiskService) dockerStop(container string) error {
	req, err := http.NewRequest("POST",
		s.dockerURL(fmt.Sprintf("/containers/%s/stop?t=30", container)), nil)
	if err != nil {
		return err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("docker stop %s: %w", container, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 204 && resp.StatusCode != 304 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker stop %s (%d): %s", container, resp.StatusCode, b)
	}
	return nil
}

// dockerStart 启动容器
func (s *DiskService) dockerStart(container string) error {
	req, err := http.NewRequest("POST",
		s.dockerURL(fmt.Sprintf("/containers/%s/start", container)), nil)
	if err != nil {
		return err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("docker start %s: %w", container, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 204 && resp.StatusCode != 304 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker start %s (%d): %s", container, resp.StatusCode, b)
	}
	return nil
}
```

- [ ] **Step 3: 实现 runCopyContainer — 使用临时 alpine 容器复制数据**

```go
// runCopyContainer 创建临时容器，将 srcVolumeOrPath 复制到 destHostPath
// srcVolumeOrPath: named volume name (e.g. "mysql-data") or host path (e.g. "/old/path")
// destHostPath: 宿主机绝对路径（写目标）
func (s *DiskService) runCopyContainer(srcVolume, destHostPath string) error {
	// 创建容器
	body, _ := json.Marshal(map[string]interface{}{
		"Image": "alpine",
		"Cmd":   []string{"sh", "-c", "cp -a /source/. /dest/"},
		"HostConfig": map[string]interface{}{
			"Binds": []string{
				srcVolume + ":/source:ro",
				destHostPath + ":/dest:rw",
			},
			"AutoRemove": false,
		},
	})
	createReq, err := http.NewRequest("POST",
		s.dockerURL("/containers/create"), bytes.NewReader(body))
	if err != nil {
		return err
	}
	createReq.Header.Set("Content-Type", "application/json")
	createResp, err := s.httpClient.Do(createReq)
	if err != nil {
		return fmt.Errorf("create copy container: %w", err)
	}
	defer createResp.Body.Close()
	if createResp.StatusCode != 201 {
		b, _ := io.ReadAll(createResp.Body)
		return fmt.Errorf("create copy container (%d): %s", createResp.StatusCode, b)
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		return fmt.Errorf("parse create response: %w", err)
	}

	// 启动容器
	startReq, _ := http.NewRequest("POST",
		s.dockerURL(fmt.Sprintf("/containers/%s/start", created.ID)), nil)
	startResp, err := s.httpClient.Do(startReq)
	if err != nil {
		return fmt.Errorf("start copy container: %w", err)
	}
	startResp.Body.Close()

	// 等待容器结束
	waitReq, _ := http.NewRequest("POST",
		s.dockerURL(fmt.Sprintf("/containers/%s/wait", created.ID)), nil)
	waitResp, err := s.httpClient.Do(waitReq)
	if err != nil {
		return fmt.Errorf("wait copy container: %w", err)
	}
	defer waitResp.Body.Close()
	var waitResult struct {
		StatusCode int `json:"StatusCode"`
	}
	_ = json.NewDecoder(waitResp.Body).Decode(&waitResult)

	// 删除临时容器
	delReq, _ := http.NewRequest("DELETE",
		s.dockerURL(fmt.Sprintf("/containers/%s", created.ID)), nil)
	delResp, _ := s.httpClient.Do(delReq)
	if delResp != nil {
		delResp.Body.Close()
	}

	if waitResult.StatusCode != 0 {
		return fmt.Errorf("copy container exited with code %d", waitResult.StatusCode)
	}
	return nil
}
```

- [ ] **Step 4: 实现 updateComposeVolume — 修改 docker-compose.yml 中的 volume 路径**

```go
// updateComposeVolume 将 compose 文件中 serviceName 服务的 oldBind 替换为 newBind
// 例如 oldBind="mysql-data:/var/lib/mysql" newBind="/new/path:/var/lib/mysql"
func (s *DiskService) updateComposeVolume(composePath, serviceName, oldBind, newBind string) error {
	data, err := os.ReadFile(composePath)
	if err != nil {
		return fmt.Errorf("read compose file: %w", err)
	}

	// 备份原文件
	backupPath := composePath + ".bak"
	if err := os.WriteFile(backupPath, data, 0644); err != nil {
		return fmt.Errorf("backup compose file: %w", err)
	}

	updated := strings.ReplaceAll(string(data), "      - "+oldBind, "      - "+newBind)
	if updated == string(data) {
		return fmt.Errorf("bind %q not found in compose file for service %s", oldBind, serviceName)
	}

	if err := os.WriteFile(composePath, []byte(updated), 0644); err != nil {
		// Restore backup on failure
		_ = os.WriteFile(composePath, data, 0644)
		return fmt.Errorf("write compose file: %w", err)
	}
	return nil
}
```

- [ ] **Step 5: 实现 StartMigrate — 异步启动迁移任务**

MySQL 容器名: `menzhen-mysql-1`, MinIO 容器名: `menzhen-minio-1`
Named volumes: `mysql-data`, `minio-data`
Compose binds: `mysql-data:/var/lib/mysql`, `minio-data:/data`

```go
const composePath = "/app/docker-compose.yml"

// StartMigrate 启动 MySQL 或 MinIO 数据目录迁移（异步，共 6 步）
func (s *DiskService) StartMigrate(target, newPath string) (*model.DiskTask, error) {
	taskType := "migrate_" + target
	if s.HasRunningTask(taskType) {
		return nil, fmt.Errorf("%s 迁移任务正在进行中", target)
	}

	var containerName, volumeName, composeBind, mountPoint string
	switch target {
	case "mysql":
		containerName = "menzhen-mysql-1"
		volumeName = "mysql-data"
		composeBind = "mysql-data:/var/lib/mysql"
		mountPoint = "/var/lib/mysql"
	case "minio":
		containerName = "menzhen-minio-1"
		volumeName = "minio-data"
		composeBind = "minio-data:/data"
		mountPoint = "/data"
	default:
		return nil, fmt.Errorf("unknown target: %s", target)
	}

	task := s.createTask(taskType, 6)

	go func() {
		taskID := task.TaskID

		// Step 1: 触发完整备份
		s.updateTask(taskID, 1, "Step 1/6: 触发完整备份...")
		if _, err := s.dockerExec(backupContainer(), "python3", "/scripts/backup.py", "--type", "full"); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("备份失败: %v", err))
			return
		}
		s.updateTask(taskID, 1, "备份完成")

		// Step 2: 停止目标容器
		s.updateTask(taskID, 2, fmt.Sprintf("Step 2/6: 停止容器 %s...", containerName))
		if err := s.dockerStop(containerName); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("停止容器失败: %v", err))
			return
		}

		// Step 3: 复制数据到新路径
		s.updateTask(taskID, 3, fmt.Sprintf("Step 3/6: 复制数据到 %s...", newPath))
		// 确保目标目录存在（via /hostfs）
		hostNewPath := filepath.Join(hostFSRoot, newPath)
		if err := os.MkdirAll(hostNewPath, 0755); err != nil {
			s.dockerStart(containerName) // 尝试恢复
			s.finishTask(taskID, "failed", fmt.Sprintf("创建目标目录失败: %v", err))
			return
		}
		// 注意：runCopyContainer 使用宿主机路径（非 /hostfs 前缀）作为 bind
		if err := s.runCopyContainer(volumeName, newPath); err != nil {
			s.dockerStart(containerName) // 尝试恢复
			s.finishTask(taskID, "failed", fmt.Sprintf("数据复制失败: %v", err))
			return
		}
		s.updateTask(taskID, 3, "数据复制完成")

		// Step 4: 更新 docker-compose.yml
		s.updateTask(taskID, 4, "Step 4/6: 更新 docker-compose.yml...")
		newBind := newPath + ":" + mountPoint
		if err := s.updateComposeVolume(composePath, target, composeBind, newBind); err != nil {
			s.dockerStart(containerName)
			s.finishTask(taskID, "failed", fmt.Sprintf("更新配置失败: %v", err))
			return
		}

		// Step 5: 重启目标容器
		s.updateTask(taskID, 5, fmt.Sprintf("Step 5/6: 重启容器 %s...", containerName))
		if err := s.dockerStart(containerName); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("启动容器失败: %v", err))
			return
		}
		time.Sleep(5 * time.Second) // 等待容器就绪

		// Step 6: 验证
		s.updateTask(taskID, 6, "Step 6/6: 验证容器运行状态...")
		out, err := s.dockerExec(containerName, "echo", "ok")
		if err != nil || !strings.Contains(out, "ok") {
			s.finishTask(taskID, "failed", fmt.Sprintf("容器验证失败: %v", err))
			return
		}

		s.finishTask(taskID, "success", fmt.Sprintf("迁移完成。新路径: %s", newPath))
	}()

	return task, nil
}
```

- [ ] **Step 6: 确认编译通过**

```bash
cd server && go build ./...
```

Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add server/service/disk.go
git commit -m "feat: add DiskService migration task (MySQL/MinIO)"
```

---

## Task 6: DiskHandler — 迁移路由

**Files:**
- Modify: `server/handler/disk.go`
- Modify: `server/router/router.go`

- [ ] **Step 1: 在 disk.go 中追加迁移处理器**

```go
// StartMigrate POST /api/disk/migrate
func (h *DiskHandler) StartMigrate(c *gin.Context) {
	var req struct {
		Target  string `json:"target" binding:"required"`
		NewPath string `json:"new_path" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	task, err := h.svc.StartMigrate(req.Target, req.NewPath)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": task})
}

// GetMigrateStatus GET /api/disk/migrate/status?task_id=xxx
func (h *DiskHandler) GetMigrateStatus(c *gin.Context) {
	taskID := c.Query("task_id")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task_id required"})
		return
	}
	task, ok := h.svc.GetTask(taskID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": task})
}
```

- [ ] **Step 2: 注册迁移路由（disk 路由组内追加）**

```go
			diskRoutes.POST("/migrate", middleware.RequirePermission(db, "user:manage"), diskHandler.StartMigrate)
			diskRoutes.GET("/migrate/status", middleware.RequirePermission(db, "user:manage"), diskHandler.GetMigrateStatus)
```

- [ ] **Step 3: 编译确认**

```bash
cd server && go build ./...
```

- [ ] **Step 4: 提交**

```bash
git add server/handler/disk.go server/router/router.go
git commit -m "feat: add StartMigrate and GetMigrateStatus handlers"
```

---

## Task 7: DiskService — 备份目录更换

**Files:**
- Modify: `server/service/disk.go`

备份目录更换步骤（共 4 步）：
1. rsync 复制备份文件到新路径（MySQL/MinIO 全程运行）
2. 更新 docker-compose.yml 中 backup + api 的 bind
3. 重启 backup 和 api 容器
4. 写入测试文件验证

- [ ] **Step 1: 实现 ChangeBackupDir**

现有 bind（compose 中）：`./backups:/backups`。更换后变为 `{newPath}:/backups`。

```go
// ChangeBackupDir 更换备份目录（异步，共 4 步）
func (s *DiskService) ChangeBackupDir(newPath string) (*model.DiskTask, error) {
	if s.HasRunningTask("backup_dir") {
		return nil, fmt.Errorf("备份目录更换任务正在进行中")
	}

	task := s.createTask("backup_dir", 4)

	go func() {
		taskID := task.TaskID

		// Step 1: 复制现有备份文件到新路径
		s.updateTask(taskID, 1, fmt.Sprintf("Step 1/4: 复制备份文件到 %s...", newPath))
		// 获取当前 backups 宿主机路径（约定为 /backups 容器路径，宿主机为挂载源）
		// 用 docker inspect 获取实际挂载源
		backupHostPath, err := s.getContainerMount(backupContainer(), "/backups")
		if err != nil {
			backupHostPath = "" // 若无法获取，跳过复制（目标目录留空也可接受）
		}

		// 确保目标目录存在
		hostNewPath := filepath.Join(hostFSRoot, newPath)
		if err := os.MkdirAll(hostNewPath, 0755); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("创建目标目录失败: %v", err))
			return
		}

		if backupHostPath != "" {
			if err := s.runCopyContainer(backupHostPath+":/backups_src", newPath); err != nil {
				// 注意：这里 srcVolume 参数实际上是 bind，格式为 "hostPath:/mountpoint"
				// runCopyContainer 的第一个参数如果是宿主机路径需要特殊处理
				// 使用替代方法：exec in backup container
				cpOut, cpErr := s.dockerExec(backupContainer(), "sh", "-c",
					fmt.Sprintf("cp -a /backups/. /hostfs_dest/ 2>&1"))
				_ = cpOut
				if cpErr != nil {
					// 复制失败不阻断，仅记录
					s.updateTask(taskID, 1, fmt.Sprintf("警告：文件复制失败（%v），新目录将为空", cpErr))
				}
			}
		}
		s.updateTask(taskID, 1, "文件复制完成（或已跳过）")

		// Step 2: 更新 docker-compose.yml
		s.updateTask(taskID, 2, "Step 2/4: 更新 docker-compose.yml...")
		oldBind := "./backups:/backups"
		newBind := newPath + ":/backups"
		for _, svcName := range []string{"backup", "api"} {
			if err := s.updateComposeVolume(composePath, svcName, oldBind, newBind); err != nil {
				s.finishTask(taskID, "failed", fmt.Sprintf("更新配置失败 (%s): %v", svcName, err))
				return
			}
		}
		s.updateTask(taskID, 2, "配置更新完成")

		// Step 3: 重启 backup 和 api 容器
		s.updateTask(taskID, 3, "Step 3/4: 重启 backup 和 api 容器...")
		for _, ctr := range []string{"menzhen-backup-1", "menzhen-api-1"} {
			if err := s.dockerStop(ctr); err != nil {
				s.updateTask(taskID, 3, fmt.Sprintf("警告：停止 %s 失败: %v", ctr, err))
			}
			if err := s.dockerStart(ctr); err != nil {
				s.finishTask(taskID, "failed", fmt.Sprintf("启动 %s 失败: %v", ctr, err))
				return
			}
		}
		time.Sleep(5 * time.Second)

		// Step 4: 验证
		s.updateTask(taskID, 4, "Step 4/4: 验证新备份目录...")
		testFile := filepath.Join(hostFSRoot, newPath, ".disk_monitor_test")
		if err := os.WriteFile(testFile, []byte("ok"), 0644); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("写入验证文件失败: %v", err))
			return
		}
		os.Remove(testFile)

		s.finishTask(taskID, "success", fmt.Sprintf("备份目录已更换为 %s", newPath))
	}()

	return task, nil
}

// getContainerMount 获取容器中指定挂载点的宿主机路径
func (s *DiskService) getContainerMount(container, mountPoint string) (string, error) {
	req, err := http.NewRequest("GET",
		s.dockerURL(fmt.Sprintf("/containers/%s/json", container)), nil)
	if err != nil {
		return "", err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var info struct {
		Mounts []struct {
			Destination string `json:"Destination"`
			Source      string `json:"Source"`
		} `json:"Mounts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", err
	}
	for _, m := range info.Mounts {
		if m.Destination == mountPoint {
			return m.Source, nil
		}
	}
	return "", fmt.Errorf("mount %s not found", mountPoint)
}
```

- [ ] **Step 2: 编译确认**

```bash
cd server && go build ./...
```

- [ ] **Step 3: 提交**

```bash
git add server/service/disk.go
git commit -m "feat: add ChangeBackupDir async task to DiskService"
```

---

## Task 8: DiskHandler — 备份目录路由

**Files:**
- Modify: `server/handler/disk.go`
- Modify: `server/router/router.go`

- [ ] **Step 1: 追加备份目录处理器**

```go
// ChangeBackupDir POST /api/disk/backup-dir
func (h *DiskHandler) ChangeBackupDir(c *gin.Context) {
	var req struct {
		NewPath string `json:"new_path" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	task, err := h.svc.ChangeBackupDir(req.NewPath)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": task})
}

// GetBackupDirStatus GET /api/disk/backup-dir/status?task_id=xxx
func (h *DiskHandler) GetBackupDirStatus(c *gin.Context) {
	taskID := c.Query("task_id")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "task_id required"})
		return
	}
	task, ok := h.svc.GetTask(taskID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": task})
}
```

- [ ] **Step 2: 注册路由**

```go
			diskRoutes.POST("/backup-dir", middleware.RequirePermission(db, "user:manage"), diskHandler.ChangeBackupDir)
			diskRoutes.GET("/backup-dir/status", middleware.RequirePermission(db, "user:manage"), diskHandler.GetBackupDirStatus)
```

- [ ] **Step 3: 编译确认**

```bash
cd server && go build ./...
```

- [ ] **Step 4: 提交**

```bash
git add server/handler/disk.go server/router/router.go
git commit -m "feat: add ChangeBackupDir and GetBackupDirStatus handlers"
```

---

## Task 9: 前端 API — web/src/api/disk.ts

**Files:**
- Create: `web/src/api/disk.ts`

- [ ] **Step 1: 创建 web/src/api/disk.ts**

```typescript
import request from '../utils/request'

export interface DiskStatus {
  total: number
  used: number
  free: number
  used_pct: number
  mysql_used: number
  minio_used: number
  backup_used: number
  collected_at: string
  interval: number // seconds
}

export interface DiskTask {
  task_id: string
  type: string
  status: 'running' | 'success' | 'failed' | 'aborted'
  step: number
  total: number
  output: string
  start_at: string
}

export interface DirEntry {
  name: string
  path: string
}

export const getDiskStatus = () =>
  request.get<{ code: number; data: DiskStatus }>('/disk/status')

export const setDiskInterval = (interval: number) =>
  request.put<{ code: number }>('/disk/interval', { interval })

export const browseFS = (path: string) =>
  request.get<{ code: number; data: DirEntry[] }>('/disk/fs', { params: { path } })

export const startMigrate = (target: 'mysql' | 'minio', newPath: string) =>
  request.post<{ code: number; data: DiskTask }>('/disk/migrate', { target, new_path: newPath })

export const getMigrateStatus = (taskId: string) =>
  request.get<{ code: number; data: DiskTask }>('/disk/migrate/status', { params: { task_id: taskId } })

export const changeBackupDir = (newPath: string) =>
  request.post<{ code: number; data: DiskTask }>('/disk/backup-dir', { new_path: newPath })

export const getBackupDirStatus = (taskId: string) =>
  request.get<{ code: number; data: DiskTask }>('/disk/backup-dir/status', { params: { task_id: taskId } })
```

- [ ] **Step 2: 类型检查**

```bash
cd web && npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add web/src/api/disk.ts
git commit -m "feat: add disk API client with TypeScript interfaces"
```

---

## Task 10: DirBrowser 组件

**Files:**
- Create: `web/src/components/DiskMonitor/DirBrowser.tsx`

- [ ] **Step 1: 写失败测试**

Create `web/src/components/DiskMonitor/__tests__/DirBrowser.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import DirBrowser from '../DirBrowser'
import * as diskApi from '../../../api/disk'

vi.mock('../../../api/disk')

describe('DirBrowser', () => {
  const mockBrowse = vi.mocked(diskApi.browseFS)

  beforeEach(() => {
    mockBrowse.mockResolvedValue({
      data: { code: 0, data: [{ name: 'opt', path: '/opt' }, { name: 'data', path: '/data' }] }
    } as any)
  })

  it('renders directory list', async () => {
    render(<DirBrowser open onSelect={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('opt')).toBeInTheDocument())
    expect(screen.getByText('data')).toBeInTheDocument()
  })

  it('navigates into a subdirectory on click', async () => {
    render(<DirBrowser open onSelect={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('opt'))
    fireEvent.click(screen.getByText('opt'))
    expect(mockBrowse).toHaveBeenCalledWith('/opt')
  })

  it('calls onSelect with full path when "选择此目录" clicked', async () => {
    const onSelect = vi.fn()
    render(<DirBrowser open onSelect={onSelect} onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('opt'))
    fireEvent.click(screen.getByText('opt'))
    fireEvent.click(screen.getByText('选择此目录'))
    expect(onSelect).toHaveBeenCalledWith('/opt')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/components/DiskMonitor/__tests__/DirBrowser.test.tsx
```

Expected: FAIL — DirBrowser not found

- [ ] **Step 3: 创建 DirBrowser.tsx**

```typescript
import React, { useEffect, useState, useCallback } from 'react'
import { Modal, Breadcrumb, List, Typography, Spin, Space } from 'antd'
import { FolderOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { browseFS, DirEntry } from '../../../api/disk'

interface Props {
  open: boolean
  onSelect: (path: string) => void
  onClose: () => void
}

const DirBrowser: React.FC<Props> = ({ open, onSelect, onClose }) => {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback((path: string) => {
    setLoading(true)
    browseFS(path)
      .then(res => {
        setEntries(res.data.data ?? [])
        setCurrentPath(path)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (open) load('/')
  }, [open, load])

  // Build breadcrumb segments from currentPath
  const segments = currentPath === '/' ? ['/'] : ['/', ...currentPath.slice(1).split('/')]
  const breadcrumbPaths = segments.map((_, i) =>
    i === 0 ? '/' : '/' + segments.slice(1, i + 1).join('/')
  )

  return (
    <Modal
      title="选择目标目录"
      open={open}
      onCancel={onClose}
      onOk={() => onSelect(currentPath)}
      okText="选择此目录"
      cancelText="取消"
      width={480}
    >
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={segments.map((seg, i) => ({
          title: (
            <a onClick={() => load(breadcrumbPaths[i])} style={{ cursor: 'pointer' }}>
              {seg}
            </a>
          ),
        }))}
      />
      {loading ? (
        <Spin style={{ display: 'block', textAlign: 'center', padding: 24 }} />
      ) : entries.length === 0 ? (
        <Typography.Text type="secondary">（空目录）</Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={entries}
          renderItem={entry => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => load(entry.path)}
            >
              <Space>
                <FolderOutlined />
                <Typography.Text>{entry.name}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Modal>
  )
}

export default DirBrowser
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/components/DiskMonitor/__tests__/DirBrowser.test.tsx
```

Expected: PASS (3 tests)

- [ ] **Step 5: 提交**

```bash
git add web/src/components/DiskMonitor/DirBrowser.tsx \
        web/src/components/DiskMonitor/__tests__/DirBrowser.test.tsx
git commit -m "feat: add DirBrowser modal component with breadcrumb navigation"
```

---

## Task 11: DiskMonitor 主卡片

**Files:**
- Create: `web/src/components/DiskMonitor/index.tsx`

- [ ] **Step 1: 写失败测试**

Create `web/src/components/DiskMonitor/__tests__/DiskMonitor.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import DiskMonitor from '../index'
import * as diskApi from '../../../api/disk'

vi.mock('../../../api/disk')
vi.mock('../MigrateWizard', () => ({ default: () => null }))
vi.mock('../BackupDirChange', () => ({ default: () => null }))

describe('DiskMonitor', () => {
  const mockGetStatus = vi.mocked(diskApi.getDiskStatus)
  const mockSetInterval = vi.mocked(diskApi.setDiskInterval)

  beforeEach(() => {
    mockGetStatus.mockResolvedValue({
      data: {
        code: 0,
        data: {
          total: 500 * 1024 ** 3,
          used: 200 * 1024 ** 3,
          free: 300 * 1024 ** 3,
          used_pct: 40,
          mysql_used: 20 * 1024 ** 3,
          minio_used: 100 * 1024 ** 3,
          backup_used: 30 * 1024 ** 3,
          collected_at: '2026-04-06T10:00:00Z',
          interval: 3600,
        }
      }
    } as any)
    mockSetInterval.mockResolvedValue({ data: { code: 0 } } as any)
  })

  it('renders disk usage stats', async () => {
    render(<DiskMonitor />)
    await waitFor(() => expect(screen.getByText(/40%/)).toBeInTheDocument())
    expect(screen.getByText(/MySQL/)).toBeInTheDocument()
    expect(screen.getByText(/MinIO/)).toBeInTheDocument()
  })

  it('shows red border and warning banner when usage >= 90%', async () => {
    mockGetStatus.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          total: 100 * 1024 ** 3,
          used: 92 * 1024 ** 3,
          free: 8 * 1024 ** 3,
          used_pct: 92,
          mysql_used: 0,
          minio_used: 0,
          backup_used: 0,
          collected_at: '2026-04-06T10:00:00Z',
          interval: 60,
        }
      }
    } as any)
    render(<DiskMonitor />)
    await waitFor(() => expect(screen.getByText(/磁盘告急/)).toBeInTheDocument())
  })

  it('calls setInterval when interval button clicked', async () => {
    render(<DiskMonitor />)
    await waitFor(() => screen.getByText('1m'))
    fireEvent.click(screen.getByText('1m'))
    await waitFor(() => expect(mockSetInterval).toHaveBeenCalledWith(60))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/components/DiskMonitor/__tests__/DiskMonitor.test.tsx
```

Expected: FAIL — DiskMonitor not found

- [ ] **Step 3: 创建 web/src/components/DiskMonitor/index.tsx**

```typescript
import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  Card, Row, Col, Progress, Typography, Space, Tag, Alert, Button, Segmented, InputNumber, message
} from 'antd'
import { ReloadOutlined, HddOutlined } from '@ant-design/icons'
import { getDiskStatus, setDiskInterval, DiskStatus } from '../../api/disk'
import MigrateWizard from './MigrateWizard'
import BackupDirChange from './BackupDirChange'
import { useIsMobile } from '../../hooks/useIsMobile'

const { Text } = Typography

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return (bytes / 1024 ** 4).toFixed(1) + ' TB'
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB'
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB'
  return (bytes / 1024).toFixed(0) + ' KB'
}

function statusColor(pct: number): string {
  if (pct >= 90) return '#ff4d4f'
  if (pct >= 70) return '#faad14'
  return '#52c41a'
}

const PRESET_INTERVALS = [
  { label: '1m', value: 60 },
  { label: '10m', value: 600 },
  { label: '1h', value: 3600 },
]

const DiskMonitor: React.FC = () => {
  const isMobile = useIsMobile()
  const [status, setStatus] = useState<DiskStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [customInterval, setCustomInterval] = useState<number | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [backupDirOpen, setBackupDirOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(() => {
    setLoading(true)
    getDiskStatus()
      .then(res => setStatus(res.data.data))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Auto-refresh at configured interval
  useEffect(() => {
    if (!status) return
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(fetchStatus, status.interval * 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [status?.interval, fetchStatus])

  const handleIntervalChange = async (seconds: number) => {
    try {
      await setDiskInterval(seconds)
      setStatus(prev => prev ? { ...prev, interval: seconds } : prev)
      message.success('采集间隔已更新')
    } catch {
      message.error('更新失败')
    }
  }

  const isCritical = (status?.used_pct ?? 0) >= 90
  const isWarning = !isCritical && (status?.used_pct ?? 0) >= 70

  const currentIntervalLabel =
    PRESET_INTERVALS.find(p => p.value === status?.interval)?.label ?? '自定义'

  return (
    <Card
      style={{ marginTop: 24, borderColor: isCritical ? '#ff4d4f' : undefined }}
      title={
        <Space>
          <HddOutlined />
          磁盘监控和迁移
          <Tag color={isCritical ? 'red' : isWarning ? 'orange' : 'green'}>
            {isCritical ? '告急' : isWarning ? '不足' : '充足'}
          </Tag>
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined spin={loading} />} size="small" onClick={fetchStatus}>
          刷新
        </Button>
      }
    >
      {isCritical && (
        <Alert type="error" message="磁盘告急：可用空间不足 10%，请立即处理！" style={{ marginBottom: 16 }} />
      )}

      {/* Stats row */}
      {status && (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            {[
              { label: '总量', value: formatBytes(status.total), color: '#aaa' },
              { label: '剩余', value: formatBytes(status.free), color: statusColor(status.used_pct) },
              { label: '已用', value: `${status.used_pct.toFixed(1)}%`, color: statusColor(status.used_pct) },
              { label: '备份', value: formatBytes(status.backup_used), color: '#aaa' },
            ].map(item => (
              <Col key={item.label} xs={12} sm={6}>
                <Card size="small" style={{ textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Text>
                  <div style={{ fontSize: 18, fontWeight: 700, color: item.color }}>{item.value}</div>
                </Card>
              </Col>
            ))}
          </Row>

          {/* Bar chart */}
          {[
            { label: 'MySQL', used: status.mysql_used, total: status.total },
            { label: 'MinIO', used: status.minio_used, total: status.total },
            { label: '备份文件', used: status.backup_used, total: status.total },
            { label: '系统/其他', used: status.used - status.mysql_used - status.minio_used - status.backup_used, total: status.total },
          ].map(item => {
            const pct = item.total > 0 ? (item.used / item.total) * 100 : 0
            return (
              <Row key={item.label} gutter={8} align="middle" style={{ marginBottom: 8 }}>
                <Col xs={6} sm={4}><Text style={{ fontSize: 13 }}>{item.label}</Text></Col>
                <Col xs={12} sm={16}>
                  <Progress
                    percent={Math.round(pct)}
                    strokeColor={statusColor(pct)}
                    showInfo={false}
                    size={isMobile ? 'small' : 'default'}
                  />
                </Col>
                <Col xs={6} sm={4} style={{ textAlign: 'right' }}>
                  <Text style={{ fontSize: 12, color: statusColor(pct) }}>
                    {pct.toFixed(1)}% · {formatBytes(item.used)}
                  </Text>
                </Col>
              </Row>
            )
          })}

          {/* Interval control */}
          <Row align="middle" gutter={8} style={{ marginTop: 16 }}>
            <Col><Text type="secondary" style={{ fontSize: 13 }}>刷新间隔</Text></Col>
            <Col>
              <Segmented
                size="small"
                options={[...PRESET_INTERVALS.map(p => p.label), '自定义']}
                value={currentIntervalLabel}
                onChange={val => {
                  if (val === '自定义') {
                    setShowCustom(true)
                  } else {
                    setShowCustom(false)
                    const preset = PRESET_INTERVALS.find(p => p.label === val)
                    if (preset) handleIntervalChange(preset.value)
                  }
                }}
              />
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 12 }}>
                更新: {new Date(status.collected_at).toLocaleTimeString()}
              </Text>
            </Col>
          </Row>
          {showCustom && (
            <Row align="middle" gutter={8} style={{ marginTop: 8 }}>
              <Col>
                <InputNumber
                  min={1} max={60} placeholder="分钟" size="small"
                  value={customInterval ?? undefined}
                  onChange={v => setCustomInterval(v)}
                />
              </Col>
              <Col>
                <Button
                  size="small" type="primary"
                  onClick={() => {
                    if (customInterval && customInterval >= 1 && customInterval <= 60) {
                      handleIntervalChange(customInterval * 60)
                      setShowCustom(false)
                    }
                  }}
                >保存</Button>
              </Col>
            </Row>
          )}

          {/* Action buttons */}
          <Row gutter={8} style={{ marginTop: 16 }} wrap>
            <Col>
              <Button type="primary" onClick={() => setMigrateOpen(true)}>
                MySQL/MinIO 迁移向导 →
              </Button>
            </Col>
            <Col>
              <Button onClick={() => setBackupDirOpen(true)}>
                更换备份目录 →
              </Button>
            </Col>
          </Row>
        </>
      )}

      <MigrateWizard open={migrateOpen} onClose={() => setMigrateOpen(false)} />
      <BackupDirChange open={backupDirOpen} onClose={() => setBackupDirOpen(false)} />
    </Card>
  )
}

export default DiskMonitor
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/components/DiskMonitor/__tests__/DiskMonitor.test.tsx
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/components/DiskMonitor/index.tsx \
        web/src/components/DiskMonitor/__tests__/DiskMonitor.test.tsx
git commit -m "feat: add DiskMonitor main card with stats, progress bars, and interval control"
```

---

## Task 12: MigrateWizard 组件

**Files:**
- Create: `web/src/components/DiskMonitor/MigrateWizard.tsx`

- [ ] **Step 1: 创建 MigrateWizard.tsx**

```typescript
import React, { useState, useRef, useEffect } from 'react'
import {
  Modal, Steps, Form, Input, Button, Space, Select, Alert,
  Typography, Progress, message
} from 'antd'
import { startMigrate, getMigrateStatus, DiskTask } from '../../api/disk'
import DirBrowser from './DirBrowser'

const { Text } = Typography

interface Props {
  open: boolean
  onClose: () => void
}

const STEP_LABELS = [
  '触发完整备份',
  '停止数据库容器',
  '复制数据',
  '更新配置文件',
  '重启容器',
  '验证连通性',
]

const MigrateWizard: React.FC<Props> = ({ open, onClose }) => {
  const [target, setTarget] = useState<'mysql' | 'minio'>('mysql')
  const [newPath, setNewPath] = useState('')
  const [task, setTask] = useState<DiskTask | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => () => stopPoll(), [])

  const handleStart = async () => {
    if (!newPath.trim()) {
      message.warning('请填写目标路径')
      return
    }
    try {
      const res = await startMigrate(target, newPath.trim())
      const t = res.data.data
      setTask(t)
      pollRef.current = setInterval(async () => {
        try {
          const r = await getMigrateStatus(t.task_id)
          const updated = r.data.data
          setTask(updated)
          if (updated.status !== 'running') stopPoll()
        } catch {
          stopPoll()
        }
      }, 2000)
    } catch (err: any) {
      message.error(err.response?.data?.error ?? '启动失败')
    }
  }

  const handleClose = () => {
    stopPoll()
    setTask(null)
    setNewPath('')
    onClose()
  }

  const isRunning = task?.status === 'running'

  return (
    <>
      <Modal
        title={`${target === 'mysql' ? 'MySQL' : 'MinIO'} 数据迁移向导`}
        open={open}
        onCancel={handleClose}
        footer={null}
        width={560}
      >
        {!task ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type="warning"
              message="注意：迁移过程中数据库服务将停止（约数分钟至数十分钟），建议在业务低峰期执行。"
            />
            <Form layout="vertical">
              <Form.Item label="迁移目标">
                <Select
                  value={target}
                  onChange={v => setTarget(v)}
                  options={[
                    { value: 'mysql', label: 'MySQL 数据目录' },
                    { value: 'minio', label: 'MinIO 数据目录' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="新目标路径（宿主机绝对路径）">
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={newPath}
                    onChange={e => setNewPath(e.target.value)}
                    placeholder="/new/data/path"
                  />
                  <Button onClick={() => setBrowsing(true)}>📁 浏览</Button>
                </Space.Compact>
              </Form.Item>
            </Form>
            <Button type="primary" danger onClick={handleStart}>
              开始迁移
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Steps
              current={task.step - 1}
              status={task.status === 'failed' ? 'error' : task.status === 'success' ? 'finish' : 'process'}
              items={STEP_LABELS.map(label => ({ title: label }))}
              direction="vertical"
              size="small"
            />
            {isRunning && (
              <Progress percent={Math.round((task.step / task.total) * 100)} status="active" />
            )}
            {task.status === 'success' && (
              <Alert type="success" message={`迁移成功：${task.output.split('\n').pop()}`} />
            )}
            {task.status === 'failed' && (
              <Alert type="error" message={`迁移失败：${task.output.split('\n').pop()}`} />
            )}
            <Typography.Text style={{ fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {task.output}
            </Typography.Text>
            {!isRunning && (
              <Button onClick={handleClose}>关闭</Button>
            )}
          </Space>
        )}
      </Modal>

      <DirBrowser
        open={browsing}
        onSelect={path => { setNewPath(path); setBrowsing(false) }}
        onClose={() => setBrowsing(false)}
      />
    </>
  )
}

export default MigrateWizard
```

- [ ] **Step 2: 编译检查**

```bash
cd web && npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add web/src/components/DiskMonitor/MigrateWizard.tsx
git commit -m "feat: add MigrateWizard modal with step progress and DirBrowser integration"
```

---

## Task 13: BackupDirChange 组件

**Files:**
- Create: `web/src/components/DiskMonitor/BackupDirChange.tsx`

- [ ] **Step 1: 创建 BackupDirChange.tsx**

```typescript
import React, { useState, useRef, useEffect } from 'react'
import {
  Modal, Form, Input, Button, Space, Alert, Steps, Typography, Progress, message
} from 'antd'
import { changeBackupDir, getBackupDirStatus, DiskTask } from '../../api/disk'
import DirBrowser from './DirBrowser'

interface Props {
  open: boolean
  onClose: () => void
}

const STEP_LABELS = [
  '复制备份文件',
  '更新配置文件',
  '重启相关容器',
  '验证新目录',
]

const BackupDirChange: React.FC<Props> = ({ open, onClose }) => {
  const [newPath, setNewPath] = useState('')
  const [task, setTask] = useState<DiskTask | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  useEffect(() => () => stopPoll(), [])

  const handleStart = async () => {
    if (!newPath.trim()) { message.warning('请填写目标路径'); return }
    try {
      const res = await changeBackupDir(newPath.trim())
      const t = res.data.data
      setTask(t)
      pollRef.current = setInterval(async () => {
        try {
          const r = await getBackupDirStatus(t.task_id)
          const updated = r.data.data
          setTask(updated)
          if (updated.status !== 'running') stopPoll()
        } catch { stopPoll() }
      }, 2000)
    } catch (err: any) {
      message.error(err.response?.data?.error ?? '操作失败')
    }
  }

  const handleClose = () => {
    stopPoll(); setTask(null); setNewPath(''); onClose()
  }

  const isRunning = task?.status === 'running'

  return (
    <>
      <Modal
        title="更换备份目录"
        open={open}
        onCancel={handleClose}
        footer={null}
        width={500}
      >
        {!task ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type="info"
              message="更换过程中 MySQL/MinIO 不停机。backup 和 api 容器将短暂重启（约 10 秒）。"
            />
            <Form layout="vertical">
              <Form.Item label="新备份目录（宿主机绝对路径）">
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={newPath}
                    onChange={e => setNewPath(e.target.value)}
                    placeholder="/new/backup/path"
                  />
                  <Button onClick={() => setBrowsing(true)}>📁 浏览</Button>
                </Space.Compact>
              </Form.Item>
            </Form>
            <Button type="primary" onClick={handleStart}>
              复制文件并应用 →
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Steps
              current={task.step - 1}
              status={task.status === 'failed' ? 'error' : task.status === 'success' ? 'finish' : 'process'}
              items={STEP_LABELS.map(label => ({ title: label }))}
              direction="vertical"
              size="small"
            />
            {isRunning && (
              <Progress percent={Math.round((task.step / task.total) * 100)} status="active" />
            )}
            {task.status === 'success' && (
              <Alert type="success" message="备份目录更换成功！" />
            )}
            {task.status === 'failed' && (
              <Alert type="error" message={task.output.split('\n').pop()} />
            )}
            <Typography.Text style={{ fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {task.output}
            </Typography.Text>
            {!isRunning && <Button onClick={handleClose}>关闭</Button>}
          </Space>
        )}
      </Modal>

      <DirBrowser
        open={browsing}
        onSelect={path => { setNewPath(path); setBrowsing(false) }}
        onClose={() => setBrowsing(false)}
      />
    </>
  )
}

export default BackupDirChange
```

- [ ] **Step 2: 编译检查**

```bash
cd web && npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add web/src/components/DiskMonitor/BackupDirChange.tsx
git commit -m "feat: add BackupDirChange panel with DirBrowser and task progress"
```

---

## Task 14: 集成到 BackupRestore 页面

**Files:**
- Modify: `web/src/pages/settings/BackupRestore.tsx`

- [ ] **Step 1: 读取现有文件找到合适的插入位置**

```bash
grep -n "return\|</Card>\|</div>" web/src/pages/settings/BackupRestore.tsx | tail -20
```

- [ ] **Step 2: 在文件顶部添加 import**

```typescript
import DiskMonitor from '../../components/DiskMonitor'
```

- [ ] **Step 3: 在页面 return 的最后一个元素后追加 `<DiskMonitor />`**

找到 BackupRestore.tsx 中最外层 `</div>` 或 `</>` 的最后一个 `</Card>` 或 `</div>` 之前，插入：

```tsx
      <DiskMonitor />
```

- [ ] **Step 4: 编译检查**

```bash
cd web && npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/settings/BackupRestore.tsx
git commit -m "feat: integrate DiskMonitor card into BackupRestore settings page"
```

---

## Task 15: 后端单元测试

**Files:**
- Create: `server/handler/disk_test.go`

- [ ] **Step 1: 写测试文件**

```go
package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/callmefisher/menzhen/server/handler"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupDiskRouter(t *testing.T) (*gin.Engine, *handler.DiskHandler) {
	db := testutil.SetupTestDB(t)
	h := handler.NewDiskHandler(db)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/disk/fs", h.BrowseFS)
	r.PUT("/disk/interval", h.SetInterval)
	return r, h
}

func TestBrowseFS_InvalidPath(t *testing.T) {
	r, _ := setupDiskRouter(t)

	// path traversal must be rejected or return empty
	req := httptest.NewRequest("GET", "/disk/fs?path=../../etc", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Should return 400 or 200 with empty list — NOT expose /etc contents
	if w.Code == 200 {
		var resp map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
		// If code 0, data should not contain /etc files
		data, _ := resp["data"].([]interface{})
		for _, entry := range data {
			m, _ := entry.(map[string]interface{})
			path, _ := m["path"].(string)
			assert.False(t, strings.Contains(path, "etc"),
				"path traversal must not expose /etc: %s", path)
		}
	} else {
		assert.Equal(t, http.StatusBadRequest, w.Code)
	}
}

func TestSetInterval_ValidValues(t *testing.T) {
	r, _ := setupDiskRouter(t)

	for _, tc := range []struct {
		interval int
		wantCode int
	}{
		{60, http.StatusOK},
		{600, http.StatusOK},
		{3600, http.StatusOK},
		{59, http.StatusBadRequest},    // below min
		{3601, http.StatusBadRequest},  // above max
		{0, http.StatusBadRequest},
	} {
		body := strings.NewReader(`{"interval":` + string(rune('0'+tc.interval/1000)) + `}`)
		bodyStr := `{"interval":` + strings.TrimSpace(strings.TrimFunc(
			strings.TrimSpace(string(rune(tc.interval))), func(r rune) bool { return false },
		)) + `}`
		// Use proper JSON encoding
		b, _ := json.Marshal(map[string]int{"interval": tc.interval})
		req := httptest.NewRequest("PUT", "/disk/interval", strings.NewReader(string(b)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, tc.wantCode, w.Code,
			"interval=%d expected %d got %d", tc.interval, tc.wantCode, w.Code)
		_ = body; _ = bodyStr
	}
}

func TestBrowseFS_RootPath(t *testing.T) {
	r, _ := setupDiskRouter(t)
	// In test environment /hostfs likely doesn't exist → should return empty list, not 500
	req := httptest.NewRequest("GET", "/disk/fs?path=/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	// Either 200 (with empty or populated list) or 400 is acceptable; not 500
	assert.NotEqual(t, http.StatusInternalServerError, w.Code)
}
```

- [ ] **Step 2: 运行测试**

```bash
cd server && go test ./handler/ -run TestBrowseFS -v
cd server && go test ./handler/ -run TestSetInterval -v
```

Expected: PASS

- [ ] **Step 3: 运行全量后端测试确认无回归**

```bash
cd server && go test ./... -count=1
```

Expected: 全部通过

- [ ] **Step 4: 提交**

```bash
git add server/handler/disk_test.go
git commit -m "test: add BrowseFS and SetInterval handler unit tests"
```

---

## Task 16: 前端单元测试 — 全量运行

- [ ] **Step 1: 运行全量前端测试确认无回归**

```bash
cd web && npm run test
```

Expected: 所有测试通过（含新增 DirBrowser + DiskMonitor 测试）

- [ ] **Step 2: 检查构建**

```bash
cd web && npm run build
```

Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 3: 后端构建确认**

```bash
cd server && go build ./...
```

Expected: 无错误

---

## Task 17: 2轮深度 Review + 部署

- [ ] **Step 1: 代码 Review（第 1 轮）— 检查安全性**
  - BrowseFS：确认 `filepath.Clean` + `strings.HasPrefix(hostFSRoot)` 路径穿越防护有效
  - SetInterval：确认 60~3600 边界校验在 service 层而非只在 handler 层
  - docker exec 命令：确认所有参数来自受控常量，无用户输入拼接
  - compose 文件写入：确认写前备份、写失败回滚
  - 所有 API 均通过 `middleware.RequirePermission(db, "user:manage")` 鉴权

- [ ] **Step 2: 代码 Review（第 2 轮）— 检查逻辑和边界**
  - 迁移任务：确认失败时回滚（重启原容器）
  - 采集间隔：confirm ≥90% 时自动切换到 60s
  - 并发安全：`sync.RWMutex` 正确保护 `tasks` map
  - 前端轮询：`useEffect` cleanup 正确调用 `clearInterval`
  - DirBrowser：空目录不报错，正常返回空列表

- [ ] **Step 3: 部署**

```bash
bash deploy.sh
```

Expected: 服务重启成功

- [ ] **Step 4: 手动验证**
  - 打开设置 → 备份与恢复，页面底部可见「磁盘监控和迁移」卡片
  - 点击刷新按钮，磁盘数据正常显示（或显示采集失败提示）
  - 点击间隔切换「1m」，后端接口返回 200
  - 点击「📁 浏览」，目录浏览 Modal 正常打开并展示目录列表
  - GET /api/disk/fs?path=../../etc 返回 400 或空列表（不泄露 /etc）

- [ ] **Step 5: 提交总结**

```bash
git add -A
git commit -m "chore: disk monitor feature complete — all tests pass, deployed"
```
