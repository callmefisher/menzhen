package service

import (
	"bytes"
	"context"
	"encoding/json"
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
