package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	diskMonitorIntervalKey = "disk_monitor_interval"
	defaultInterval        = 3600 // 1 hour in seconds
	hostFSRoot             = "/hostfs"
)

// ErrTaskAlreadyRunning is returned when an identical task type is already running.
var ErrTaskAlreadyRunning = errors.New("task already running")

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

// NewDiskService 创建磁盘监控服务实例并启动后台采集循环
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
			Timeout: 60 * time.Second,
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go s.collectLoop(ctx)
	return s
}

func (s *DiskService) dockerURL(path string) string {
	return "http://docker" + path
}

// parseDfOutput parses `df -B1 /var/lib/mysql /data /backups /` output.
// Returns: total, used, free, mysqlUsed, minioUsed, backupUsed (all in bytes).
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

// backupContainer returns the Docker container name used for exec commands.
func backupContainer() string {
	if c := os.Getenv("BACKUP_CONTAINER"); c != "" {
		return c
	}
	return "menzhen-backup-1"
}

// dockerExec runs a command inside the specified container via the Docker socket.
func (s *DiskService) dockerExec(container string, cmd ...string) (string, error) {
	createBody, err := json.Marshal(map[string]interface{}{
		"AttachStdout": true,
		"AttachStderr": true,
		"Cmd":          cmd,
	})
	if err != nil {
		return "", fmt.Errorf("marshal exec body: %w", err)
	}

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
	if execCreate.ID == "" {
		return "", fmt.Errorf("docker exec create returned empty ID")
	}

	startBody, err := json.Marshal(map[string]interface{}{"Detach": false, "Tty": false})
	if err != nil {
		return "", fmt.Errorf("marshal start body: %w", err)
	}
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
	if startResp.StatusCode != 200 {
		b, _ := io.ReadAll(startResp.Body)
		return "", fmt.Errorf("exec start (%d): %s", startResp.StatusCode, b)
	}

	out, err := io.ReadAll(startResp.Body)
	if err != nil {
		return "", fmt.Errorf("read exec output: %w", err)
	}
	return stripDockerMux(out), nil
}

// stripDockerMux removes Docker multiplexed stream headers from raw output.
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

// CollectNow runs df inside the backup container and updates the cached status.
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
		if setErr := s.SetInterval(60); setErr != nil {
			return status, fmt.Errorf("auto-set interval: %w", setErr)
		}
	}

	return status, nil
}

// GetStatus returns the cached disk status, collecting fresh data if not yet available.
func (s *DiskService) GetStatus() (*model.DiskStatus, error) {
	s.statusMu.RLock()
	cached := s.lastStatus
	s.statusMu.RUnlock()
	if cached != nil {
		return cached, nil
	}
	return s.CollectNow()
}

// collectLoop runs CollectNow on the configured interval until ctx is cancelled.
func (s *DiskService) collectLoop(ctx context.Context) {
	for {
		interval := time.Duration(s.GetInterval()) * time.Second
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
			if _, err := s.CollectNow(); err != nil {
				log.Printf("[disk] collectLoop error: %v", err)
			}
		}
	}
}

// GetInterval returns the configured collection interval in seconds.
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

// SetInterval updates the collection interval (60–3600 seconds).
func (s *DiskService) SetInterval(seconds int) error {
	if seconds < 60 || seconds > 3600 {
		return fmt.Errorf("interval must be between 60 and 3600 seconds")
	}
	return s.db.Save(&model.SystemSetting{
		Key:   diskMonitorIntervalKey,
		Value: strconv.Itoa(seconds),
	}).Error
}

// BrowseFS lists non-hidden entries under path on the host filesystem (mounted at /hostfs).
func (s *DiskService) BrowseFS(path string) ([]model.DirEntry, error) {
	// Sanitize: prevent path traversal
	clean := filepath.Clean("/" + path)
	hostPath := filepath.Join(hostFSRoot, clean)

	// Guard: must have hostFSRoot+"/" prefix OR equal hostFSRoot exactly
	if hostPath != hostFSRoot && !strings.HasPrefix(hostPath, hostFSRoot+"/") {
		return nil, fmt.Errorf("invalid path")
	}

	entries, err := os.ReadDir(hostPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []model.DirEntry{}, nil
		}
		return nil, fmt.Errorf("read dir: %w", err)
	}

	dirs := make([]model.DirEntry, 0, len(entries))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		_, err := e.Info()
		if err != nil {
			continue
		}
		dirs = append(dirs, model.DirEntry{
			Name:  e.Name(),
			Path:  filepath.Join(clean, e.Name()),
			IsDir: e.IsDir(),
		})
	}
	return dirs, nil
}

// Shutdown stops the background collection loop.
func (s *DiskService) Shutdown() {
	s.cancel()
}

// ─── Task management helpers ───────────────────────────────────────────────

// createTask creates a new DiskTask and stores it in the task map.
func (s *DiskService) createTask(taskType string, total int) *model.DiskTask {
	task := &model.DiskTask{
		TaskID:  uuid.New().String(),
		Type:    taskType,
		Status:  "running",
		Step:    0,
		Total:   total,
		StartAt: time.Now(),
	}
	s.mu.Lock()
	s.tasks[task.TaskID] = task
	s.mu.Unlock()
	return task
}

// GetTask returns a copy of the task by ID (zero value, false if not found).
func (s *DiskService) GetTask(taskID string) (model.DiskTask, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.tasks[taskID]
	if !ok {
		return model.DiskTask{}, false
	}
	return *t, ok
}

// updateTask appends output and updates step number (thread-safe).
func (s *DiskService) updateTask(taskID string, step int, output string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.tasks[taskID]; ok {
		t.Step = step
		t.Output += output + "\n"
	}
}

// finishTask sets final status and appends a final message.
func (s *DiskService) finishTask(taskID, status, msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.tasks[taskID]; ok {
		t.Status = status
		t.Output += msg
	}
}

// HasRunningTask checks if any task of the given type is currently running.
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

// ─── Docker container helpers ──────────────────────────────────────────────

// dockerStop stops a container (30s grace period).
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

// dockerStart starts a container.
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

// ─── runCopyContainer ──────────────────────────────────────────────────────

// runCopyContainer copies data from a named Docker volume to a host directory.
// srcVolume: named volume name (e.g. "mysql-data")
// destHostPath: absolute host path (writable via /hostfs mount)
func (s *DiskService) runCopyContainer(srcVolume, destHostPath string) error {
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
		return fmt.Errorf("create copy container request: %w", err)
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
	if created.ID == "" {
		return fmt.Errorf("create copy container returned empty ID")
	}

	// Start container
	startReq, err := http.NewRequest("POST",
		s.dockerURL(fmt.Sprintf("/containers/%s/start", created.ID)), nil)
	if err != nil {
		return fmt.Errorf("start copy container request: %w", err)
	}
	startResp, err := s.httpClient.Do(startReq)
	if err != nil {
		return fmt.Errorf("start copy container: %w", err)
	}
	if startResp.StatusCode != 204 {
		b, _ := io.ReadAll(startResp.Body)
		startResp.Body.Close()
		return fmt.Errorf("start copy container (%d): %s", startResp.StatusCode, b)
	}
	startResp.Body.Close()

	// Wait for container to exit (may take up to 30 minutes for large data sets)
	waitCtx, waitCancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer waitCancel()
	waitClient := &http.Client{
		Transport: s.httpClient.Transport, // reuse the unix socket transport
	}
	waitReq, err := http.NewRequestWithContext(waitCtx, "POST",
		s.dockerURL(fmt.Sprintf("/containers/%s/wait", created.ID)), nil)
	if err != nil {
		return fmt.Errorf("wait copy container request: %w", err)
	}
	waitResp, err := waitClient.Do(waitReq)
	if err != nil {
		return fmt.Errorf("wait copy container: %w", err)
	}
	defer waitResp.Body.Close()
	var waitResult struct {
		StatusCode int `json:"StatusCode"`
	}
	if err := json.NewDecoder(waitResp.Body).Decode(&waitResult); err != nil {
		return fmt.Errorf("parse wait response: %w", err)
	}

	// Delete the temporary container
	delReq, err := http.NewRequest("DELETE",
		s.dockerURL(fmt.Sprintf("/containers/%s", created.ID)), nil)
	if err != nil {
		log.Printf("[disk] failed to build delete request for copy container %s: %v", created.ID, err)
	} else {
		delResp, err := s.httpClient.Do(delReq)
		if err != nil {
			log.Printf("[disk] failed to delete copy container %s: %v", created.ID, err)
		} else {
			delResp.Body.Close()
		}
	}

	if waitResult.StatusCode != 0 {
		return fmt.Errorf("copy container exited with code %d", waitResult.StatusCode)
	}
	return nil
}

// ─── updateComposeVolume ───────────────────────────────────────────────────

const composePath = "/app/docker-compose.yml"

// updateComposeVolume replaces oldBind with newBind in the compose file.
// Creates a .bak backup before writing. Restores on write failure.
func (s *DiskService) updateComposeVolume(oldBind, newBind string) error {
	data, err := os.ReadFile(composePath)
	if err != nil {
		return fmt.Errorf("read compose file: %w", err)
	}

	// Backup original
	backupPath := composePath + ".bak"
	if err := os.WriteFile(backupPath, data, 0644); err != nil {
		return fmt.Errorf("backup compose file: %w", err)
	}

	original := string(data)
	updated := strings.ReplaceAll(original, "      - "+oldBind, "      - "+newBind)
	if updated == original {
		return fmt.Errorf("bind %q not found in compose file", oldBind)
	}

	if err := os.WriteFile(composePath, []byte(updated), 0644); err != nil {
		// Restore backup
		if restoreErr := os.WriteFile(composePath, data, 0644); restoreErr != nil {
			log.Printf("[disk] failed to restore compose backup: %v", restoreErr)
		}
		return fmt.Errorf("write compose file: %w", err)
	}
	return nil
}

// ─── getContainerMount ─────────────────────────────────────────────────────

// getContainerMount inspects a container and returns the host path for the given container path.
func (s *DiskService) getContainerMount(container, containerPath string) (string, error) {
	req, err := http.NewRequest("GET",
		s.dockerURL(fmt.Sprintf("/containers/%s/json", container)), nil)
	if err != nil {
		return "", fmt.Errorf("inspect request: %w", err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("docker inspect %s: %w", container, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("docker inspect %s (%d): %s", container, resp.StatusCode, b)
	}

	var info struct {
		Mounts []struct {
			Type        string `json:"Type"`
			Source      string `json:"Source"`
			Destination string `json:"Destination"`
			Name        string `json:"Name"`
		} `json:"Mounts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", fmt.Errorf("parse inspect: %w", err)
	}

	for _, m := range info.Mounts {
		if m.Destination == containerPath {
			return m.Source, nil
		}
	}
	return "", fmt.Errorf("mount %q not found in container %s", containerPath, container)
}

// ─── findCurrentBackupsBind ────────────────────────────────────────────────

// findCurrentBackupsBind reads docker-compose.yml and finds the current /backups bind mount.
// Returns the bind string (e.g. "./backups:/backups" or "/mnt/backup:/backups").
func (s *DiskService) findCurrentBackupsBind() (string, error) {
	data, err := os.ReadFile(composePath)
	if err != nil {
		return "", fmt.Errorf("read compose: %w", err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- ") {
			bind := strings.TrimPrefix(trimmed, "- ")
			if strings.HasSuffix(bind, ":/backups") {
				return bind, nil
			}
		}
	}
	return "", fmt.Errorf(":/backups bind not found in compose file")
}

// ─── StartMigrate ──────────────────────────────────────────────────────────

// StartMigrate starts an async 6-step MySQL or MinIO data directory migration.
// target: "mysql" or "minio"
// newPath: absolute host path for the new data location
func (s *DiskService) StartMigrate(target, newPath string) (*model.DiskTask, error) {
	taskType := "migrate_" + target
	if s.HasRunningTask(taskType) {
		return nil, fmt.Errorf("%s 迁移任务正在进行中: %w", target, ErrTaskAlreadyRunning)
	}

	// Validate newPath: must be absolute and not escape hostFSRoot
	cleanPath := filepath.Clean(newPath)
	if !filepath.IsAbs(cleanPath) {
		return nil, fmt.Errorf("new_path must be an absolute path")
	}
	hostNewPathCheck := filepath.Join(hostFSRoot, cleanPath)
	if hostNewPathCheck != hostFSRoot && !strings.HasPrefix(hostNewPathCheck, hostFSRoot+"/") {
		return nil, fmt.Errorf("invalid path: %s", newPath)
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

		// Step 1: trigger full backup
		s.updateTask(taskID, 1, "Step 1/6: 触发完整备份...")
		if _, err := s.dockerExec(backupContainer(), "python3", "/scripts/backup.py", "--type", "full"); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("备份失败: %v", err))
			return
		}
		s.updateTask(taskID, 1, "备份完成")

		// Step 2: stop target container
		s.updateTask(taskID, 2, fmt.Sprintf("Step 2/6: 停止容器 %s...", containerName))
		if err := s.dockerStop(containerName); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("停止容器失败: %v", err))
			return
		}

		// Step 3: copy data to new path
		s.updateTask(taskID, 3, fmt.Sprintf("Step 3/6: 复制数据到 %s...", newPath))
		hostNewPath := filepath.Join(hostFSRoot, newPath)
		if err := os.MkdirAll(hostNewPath, 0755); err != nil {
			if startErr := s.dockerStart(containerName); startErr != nil {
				log.Printf("[disk] failed to restart %s after mkdirall failure: %v", containerName, startErr)
			}
			s.finishTask(taskID, "failed", fmt.Sprintf("创建目标目录失败: %v", err))
			return
		}
		if err := s.runCopyContainer(volumeName, hostNewPath); err != nil {
			if startErr := s.dockerStart(containerName); startErr != nil {
				log.Printf("[disk] failed to restart %s after copy failure: %v", containerName, startErr)
			}
			s.finishTask(taskID, "failed", fmt.Sprintf("数据复制失败: %v", err))
			return
		}
		s.updateTask(taskID, 3, "数据复制完成")

		// Step 4: update docker-compose.yml
		s.updateTask(taskID, 4, "Step 4/6: 更新 docker-compose.yml...")
		newBind := newPath + ":" + mountPoint
		if err := s.updateComposeVolume(composeBind, newBind); err != nil {
			if startErr := s.dockerStart(containerName); startErr != nil {
				log.Printf("[disk] failed to restart %s after compose update failure: %v", containerName, startErr)
			}
			s.finishTask(taskID, "failed", fmt.Sprintf("更新配置失败: %v", err))
			return
		}

		// Step 5: restart container
		s.updateTask(taskID, 5, fmt.Sprintf("Step 5/6: 重启容器 %s...", containerName))
		if err := s.dockerStart(containerName); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("启动容器失败: %v", err))
			return
		}
		time.Sleep(5 * time.Second)

		// Step 6: verify
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

// ChangeBackupDir changes the backup directory (4-step async task).
// Steps: rsync/copy files → update compose → restart backup+api → verify
func (s *DiskService) ChangeBackupDir(newPath string) (*model.DiskTask, error) {
	if s.HasRunningTask("backup_dir") {
		return nil, fmt.Errorf("备份目录更换任务正在进行中: %w", ErrTaskAlreadyRunning)
	}

	// Validate newPath
	cleanPath := filepath.Clean(newPath)
	if !filepath.IsAbs(cleanPath) {
		return nil, fmt.Errorf("new_path must be an absolute path")
	}
	hostNewPath := filepath.Join(hostFSRoot, cleanPath)
	if hostNewPath != hostFSRoot && !strings.HasPrefix(hostNewPath, hostFSRoot+"/") {
		return nil, fmt.Errorf("invalid path: %s", newPath)
	}

	task := s.createTask("backup_dir", 4)

	go func() {
		taskID := task.TaskID

		// Step 1: copy existing backup files to new path
		s.updateTask(taskID, 1, fmt.Sprintf("Step 1/4: 复制备份文件到 %s...", newPath))
		if err := os.MkdirAll(hostNewPath, 0755); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("创建目标目录失败: %v", err))
			return
		}
		// Get current backup host path to copy from
		backupHostPath, getErr := s.getContainerMount(backupContainer(), "/backups")
		if getErr != nil {
			log.Printf("[disk] could not get current backup mount path: %v — skipping file copy", getErr)
		} else if backupHostPath != "" && backupHostPath != newPath {
			// runCopyContainer accepts either a named volume or a host path as source
			if copyErr := s.runCopyContainer(backupHostPath, newPath); copyErr != nil {
				log.Printf("[disk] backup copy warning: %v — new directory may be empty", copyErr)
			}
		}
		s.updateTask(taskID, 1, "文件复制完成（或已跳过）")

		// Step 2: update docker-compose.yml
		s.updateTask(taskID, 2, "Step 2/4: 更新 docker-compose.yml...")
		newBind := cleanPath + ":/backups"
		// Read current compose to find actual bind (handles repeated changes)
		oldBind, readErr := s.findCurrentBackupsBind()
		if readErr != nil {
			log.Printf("[disk] could not read current backups bind, using default: %v", readErr)
			oldBind = "./backups:/backups"
		}
		if err := s.updateComposeVolume(oldBind, newBind); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("更新配置失败: %v", err))
			return
		}
		s.updateTask(taskID, 2, "配置更新完成")

		// Step 3: restart backup and api containers
		s.updateTask(taskID, 3, "Step 3/4: 重启 backup 和 api 容器...")
		for _, ctr := range []string{"menzhen-backup-1", "menzhen-api-1"} {
			if err := s.dockerStop(ctr); err != nil {
				log.Printf("[disk] warning: stop %s: %v", ctr, err)
			}
			if err := s.dockerStart(ctr); err != nil {
				s.finishTask(taskID, "failed", fmt.Sprintf("启动 %s 失败: %v", ctr, err))
				return
			}
		}
		time.Sleep(5 * time.Second)

		// Step 4: verify new backup directory is writable
		s.updateTask(taskID, 4, "Step 4/4: 验证新备份目录...")
		testFile := filepath.Join(hostNewPath, ".disk_monitor_test")
		if err := os.WriteFile(testFile, []byte("ok"), 0644); err != nil {
			s.finishTask(taskID, "failed", fmt.Sprintf("写入验证文件失败: %v", err))
			return
		}
		os.Remove(testFile)

		s.finishTask(taskID, "success", fmt.Sprintf("备份目录已更换为 %s", newPath))
	}()

	return task, nil
}
