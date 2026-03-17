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
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// TaskStatus 备份/恢复任务状态
type TaskStatus struct {
	TaskID  string `json:"task_id"`
	Type    string `json:"type"`   // mysql, minio, full, restore
	Status  string `json:"status"` // running, success, failed
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
	tasks      map[string]*TaskStatus
	mu         sync.RWMutex
	httpClient *http.Client
}

// NewBackupService 创建备份服务实例
func NewBackupService() *BackupService {
	return &BackupService{
		tasks: make(map[string]*TaskStatus),
		httpClient: &http.Client{
			Transport: &http.Transport{
				DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
					return net.Dial("unix", "/var/run/docker.sock")
				},
			},
			Timeout: 10 * time.Minute,
		},
	}
}

// CheckDockerAvailable 检测 Docker socket 是否可用
func (s *BackupService) CheckDockerAvailable() bool {
	pingClient := &http.Client{
		Transport: s.httpClient.Transport,
		Timeout:   3 * time.Second,
	}
	resp, err := pingClient.Get("http://localhost/v1.41/_ping")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
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
	copied := *task
	return &copied, nil
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

// HasRunningTask 检查是否有冲突任务正在运行
// restore 与所有操作互斥，backup 与同类型和 restore 互斥
func (s *BackupService) HasRunningTask(taskType string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, task := range s.tasks {
		if task.Status != "running" {
			continue
		}
		// restore 与所有操作互斥
		if taskType == "restore" || task.Type == "restore" {
			return true
		}
		// 同类型 backup 互斥
		if task.Type == taskType {
			return true
		}
	}
	return false
}

// TriggerBackup 异步触发备份
func (s *BackupService) TriggerBackup(backupType string) (string, error) {
	s.CleanupOldTasks()
	if s.HasRunningTask(backupType) {
		return "", fmt.Errorf("已有同类型备份任务正在运行")
	}
	taskID := s.CreateTask(backupType)

	go func() {
		var output string
		var err error

		switch backupType {
		case "mysql":
			output, err = s.dockerExecStreaming(taskID, "bash", "/scripts/backup.sh")
		case "minio":
			output, err = s.dockerExecStreaming(taskID, "bash", "/scripts/backup-minio.sh")
		case "full":
			output1, err1 := s.dockerExecStreaming(taskID, "bash", "/scripts/backup.sh")
			prefix := output1 + "\n--- 开始 MinIO 备份 ---\n"
			s.UpdateTask(taskID, "running", prefix)
			output2, err2 := s.dockerExecStreamingWithPrefix(taskID, prefix, "bash", "/scripts/backup-minio.sh")
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
	s.CleanupOldTasks()
	if s.HasRunningTask("restore") {
		return "", fmt.Errorf("已有任务正在运行，请等待完成")
	}
	taskID := s.CreateTask("restore")

	go func() {
		var output string
		var err error

		if source == "local" {
			cmdArgs := s.buildRestoreArgs(mysqlFile, minioFile)
			output, err = s.dockerExecStreaming(taskID, cmdArgs...)
		} else {
			// cloud: 下载用户选择的特定文件
			if mysqlFile == "" && minioFile == "" {
				s.UpdateTask(taskID, "failed", "未指定任何备份文件")
				return
			}
			s.UpdateTask(taskID, "running", "正在从七牛云下载备份文件...\n")
			dlArgs := []string{"python3", "/scripts/download_from_qiniu.py"}
			if mysqlFile != "" {
				dlArgs = append(dlArgs, "--mysql-file", mysqlFile)
			}
			if minioFile != "" {
				dlArgs = append(dlArgs, "--minio-file", minioFile)
			}
			dlOutput, dlErr := s.dockerExecStreaming(taskID, dlArgs...)
			if dlErr != nil {
				s.UpdateTask(taskID, "failed", dlOutput+"\nDownload Error: "+dlErr.Error())
				return
			}
			// 再恢复
			prefix := dlOutput + "\n--- 开始恢复数据 ---\n"
			s.UpdateTask(taskID, "running", prefix)
			cmdArgs := s.buildRestoreArgs(mysqlFile, minioFile)
			restoreOutput, restoreErr := s.dockerExecStreamingWithPrefix(taskID, prefix, cmdArgs...)
			output = dlOutput + "\n---\n" + restoreOutput
			err = restoreErr
		}

		if err != nil {
			s.UpdateTask(taskID, "failed", output+"\nError: "+err.Error())
		} else {
			s.UpdateTask(taskID, "success", output)
			// MySQL 恢复后延迟重启 API 容器，让压缩配置重新生效
			if mysqlFile != "" {
				go func() {
					time.Sleep(15 * time.Second)
					if restartErr := s.RestartAPIContainer(); restartErr != nil {
						log.Printf("[backup] WARNING: auto-restart API after restore failed: %v", restartErr)
					}
				}()
			}
		}
	}()

	return taskID, nil
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

	if entries, err := os.ReadDir(backupDir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if strings.HasPrefix(name, siteID+"_") && (strings.HasSuffix(name, ".sql.gz") || strings.HasSuffix(name, ".sql")) {
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

	minioDir := filepath.Join(backupDir, "minio")
	if entries, err := os.ReadDir(minioDir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if strings.HasPrefix(name, siteID+"_") && strings.HasSuffix(name, ".tar.gz") {
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

	sort.Slice(result.MySQL, func(i, j int) bool {
		return result.MySQL[i].Modified > result.MySQL[j].Modified
	})
	sort.Slice(result.MinIO, func(i, j int) bool {
		return result.MinIO[i].Modified > result.MinIO[j].Modified
	})

	return result, nil
}

// ListCloudFiles 列出七牛云备份文件（通过 backup 容器执行 Python 脚本）
func (s *BackupService) ListCloudFiles() (*BackupFileList, error) {
	out, err := s.dockerExec("python3", "/scripts/download_from_qiniu.py", "--action", "list", "--type", "all")
	if err != nil {
		return nil, fmt.Errorf("获取云端备份列表失败: %v", err)
	}

	// Python 脚本 stdout 可能包含进度日志，只取最后一行 JSON
	lines := strings.Split(strings.TrimSpace(out), "\n")
	jsonLine := lines[len(lines)-1]

	var result BackupFileList
	if err := json.Unmarshal([]byte(jsonLine), &result); err != nil {
		return nil, fmt.Errorf("解析云端文件列表失败: %v", err)
	}
	return &result, nil
}

// dockerExecStreaming 在 backup 容器中执行命令，实时更新 task output
func (s *BackupService) dockerExecStreaming(taskID string, cmd ...string) (string, error) {
	container := backupContainerName()

	createBody, _ := json.Marshal(map[string]interface{}{
		"AttachStdout": true,
		"AttachStderr": true,
		"Cmd":          cmd,
	})

	createReq, err := http.NewRequest("POST",
		fmt.Sprintf("http://localhost/v1.41/containers/%s/exec", container),
		bytes.NewReader(createBody))
	if err != nil {
		return "", fmt.Errorf("create exec request failed: %v", err)
	}
	createReq.Header.Set("Content-Type", "application/json")

	createResp, err := s.httpClient.Do(createReq)
	if err != nil {
		return "", fmt.Errorf("docker socket 连接失败: %v", err)
	}
	defer createResp.Body.Close()

	if createResp.StatusCode != 201 {
		body, _ := io.ReadAll(createResp.Body)
		return "", fmt.Errorf("docker exec create failed (%d): %s", createResp.StatusCode, string(body))
	}

	var execCreate struct {
		ID string `json:"Id"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&execCreate); err != nil {
		return "", fmt.Errorf("parse exec create response failed: %v", err)
	}

	startBody, _ := json.Marshal(map[string]interface{}{
		"Detach": false,
		"Tty":    false,
	})
	startReq, err := http.NewRequest("POST",
		fmt.Sprintf("http://localhost/v1.41/exec/%s/start", execCreate.ID),
		bytes.NewReader(startBody))
	if err != nil {
		return "", fmt.Errorf("start exec request failed: %v", err)
	}
	startReq.Header.Set("Content-Type", "application/json")

	startResp, err := s.httpClient.Do(startReq)
	if err != nil {
		return "", fmt.Errorf("exec start failed: %v", err)
	}
	defer startResp.Body.Close()
	if startResp.StatusCode != 200 {
		body, _ := io.ReadAll(startResp.Body)
		return "", fmt.Errorf("exec start failed (%d): %s", startResp.StatusCode, string(body))
	}

	// 实时读取输出并更新 task
	output := s.readDockerStream(startResp.Body, func(partial string) {
		s.UpdateTask(taskID, "running", partial)
	})

	// Inspect exit code
	inspectReq, _ := http.NewRequest("GET",
		fmt.Sprintf("http://localhost/v1.41/exec/%s/json", execCreate.ID), nil)
	inspectResp, err := s.httpClient.Do(inspectReq)
	if err != nil {
		return output, fmt.Errorf("无法获取执行结果")
	}
	defer inspectResp.Body.Close()

	var execInspect struct {
		ExitCode int `json:"ExitCode"`
	}
	if err := json.NewDecoder(inspectResp.Body).Decode(&execInspect); err != nil {
		return output, nil
	}
	if execInspect.ExitCode != 0 {
		log.Printf("[backup] command %v exited with code %d", cmd, execInspect.ExitCode)
		return output, fmt.Errorf("命令执行失败 (exit code %d)", execInspect.ExitCode)
	}
	return output, nil
}

// dockerExecStreamingWithPrefix 带前缀的流式执行，确保多阶段进度不倒退
func (s *BackupService) dockerExecStreamingWithPrefix(taskID, prefix string, cmd ...string) (string, error) {
	container := backupContainerName()

	createBody, _ := json.Marshal(map[string]interface{}{
		"AttachStdout": true,
		"AttachStderr": true,
		"Cmd":          cmd,
	})
	createReq, err := http.NewRequest("POST",
		fmt.Sprintf("http://localhost/v1.41/containers/%s/exec", container),
		bytes.NewReader(createBody))
	if err != nil {
		return "", fmt.Errorf("create exec request failed: %v", err)
	}
	createReq.Header.Set("Content-Type", "application/json")

	createResp, err := s.httpClient.Do(createReq)
	if err != nil {
		return "", fmt.Errorf("docker socket 连接失败: %v", err)
	}
	defer createResp.Body.Close()
	if createResp.StatusCode != 201 {
		body, _ := io.ReadAll(createResp.Body)
		return "", fmt.Errorf("docker exec create failed (%d): %s", createResp.StatusCode, string(body))
	}

	var execCreate struct {
		ID string `json:"Id"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&execCreate); err != nil {
		return "", fmt.Errorf("parse exec create response failed: %v", err)
	}

	startBody, _ := json.Marshal(map[string]interface{}{"Detach": false, "Tty": false})
	startReq, err := http.NewRequest("POST",
		fmt.Sprintf("http://localhost/v1.41/exec/%s/start", execCreate.ID),
		bytes.NewReader(startBody))
	if err != nil {
		return "", fmt.Errorf("start exec request failed: %v", err)
	}
	startReq.Header.Set("Content-Type", "application/json")

	startResp, err := s.httpClient.Do(startReq)
	if err != nil {
		return "", fmt.Errorf("exec start failed: %v", err)
	}
	defer startResp.Body.Close()
	if startResp.StatusCode != 200 {
		body, _ := io.ReadAll(startResp.Body)
		return "", fmt.Errorf("exec start failed (%d): %s", startResp.StatusCode, string(body))
	}

	output := s.readDockerStream(startResp.Body, func(partial string) {
		s.UpdateTask(taskID, "running", prefix+partial)
	})

	inspectReq, _ := http.NewRequest("GET",
		fmt.Sprintf("http://localhost/v1.41/exec/%s/json", execCreate.ID), nil)
	inspectResp, err := s.httpClient.Do(inspectReq)
	if err != nil {
		return output, fmt.Errorf("无法获取执行结果")
	}
	defer inspectResp.Body.Close()

	var execInspect struct {
		ExitCode int `json:"ExitCode"`
	}
	if err := json.NewDecoder(inspectResp.Body).Decode(&execInspect); err != nil {
		return output, nil
	}
	if execInspect.ExitCode != 0 {
		log.Printf("[backup] command %v exited with code %d", cmd, execInspect.ExitCode)
		return output, fmt.Errorf("命令执行失败 (exit code %d)", execInspect.ExitCode)
	}
	return output, nil
}

// buildRestoreArgs 根据选中的文件构建 restore.sh 参数（MySQL 和 MinIO 都可选）
func (s *BackupService) buildRestoreArgs(mysqlFile, minioFile string) []string {
	cmdArgs := []string{"bash", "/scripts/restore.sh"}
	if mysqlFile != "" {
		cmdArgs = append(cmdArgs, "--sql", "/backups/"+mysqlFile)
	}
	if minioFile != "" {
		cmdArgs = append(cmdArgs, "--minio-tar", "/backups/minio/"+minioFile)
	}
	return cmdArgs
}

// backupContainerName 获取 backup 容器名称
func backupContainerName() string {
	if name := os.Getenv("BACKUP_CONTAINER"); name != "" {
		return name
	}
	return "menzhen-backup-1"
}

// apiContainerName 获取 API 容器名称
func apiContainerName() string {
	if name := os.Getenv("API_CONTAINER"); name != "" {
		return name
	}
	return "menzhen-api-1"
}

// RestartAPIContainer 通过 Docker socket 重启 API 容器（用于恢复后重新加载压缩配置）
func (s *BackupService) RestartAPIContainer() error {
	container := apiContainerName()
	req, err := http.NewRequest("POST",
		fmt.Sprintf("http://localhost/v1.41/containers/%s/restart?t=3", container), nil)
	if err != nil {
		return fmt.Errorf("create restart request failed: %v", err)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("restart API container failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 204 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("restart API container failed (%d): %s", resp.StatusCode, string(body))
	}
	log.Printf("[backup] API container %s restart triggered", container)
	return nil
}

// dockerExec 通过 Docker socket 在 backup 容器中执行命令
func (s *BackupService) dockerExec(cmd ...string) (string, error) {
	container := backupContainerName()

	// Step 1: Create exec instance
	createBody, _ := json.Marshal(map[string]interface{}{
		"AttachStdout": true,
		"AttachStderr": true,
		"Cmd":          cmd,
	})

	createReq, err := http.NewRequest("POST",
		fmt.Sprintf("http://localhost/v1.41/containers/%s/exec", container),
		bytes.NewReader(createBody))
	if err != nil {
		return "", fmt.Errorf("create exec request failed: %v", err)
	}
	createReq.Header.Set("Content-Type", "application/json")

	createResp, err := s.httpClient.Do(createReq)
	if err != nil {
		return "", fmt.Errorf("docker socket 连接失败，请确认已挂载 docker.sock: %v", err)
	}
	defer createResp.Body.Close()

	if createResp.StatusCode != 201 {
		body, _ := io.ReadAll(createResp.Body)
		return "", fmt.Errorf("docker exec create failed (%d): %s", createResp.StatusCode, string(body))
	}

	var execCreate struct {
		ID string `json:"Id"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&execCreate); err != nil {
		return "", fmt.Errorf("parse exec create response failed: %v", err)
	}

	// Step 2: Start exec and read output
	startBody, _ := json.Marshal(map[string]interface{}{
		"Detach": false,
		"Tty":    false,
	})

	startReq, err := http.NewRequest("POST",
		fmt.Sprintf("http://localhost/v1.41/exec/%s/start", execCreate.ID),
		bytes.NewReader(startBody))
	if err != nil {
		return "", fmt.Errorf("start exec request failed: %v", err)
	}
	startReq.Header.Set("Content-Type", "application/json")

	startResp, err := s.httpClient.Do(startReq)
	if err != nil {
		return "", fmt.Errorf("exec start failed: %v", err)
	}
	defer startResp.Body.Close()

	// Read multiplexed stream (Docker exec output format: 8-byte header + payload)
	output := s.readDockerStream(startResp.Body, nil)

	// Step 3: Inspect exec to get exit code
	inspectReq, err := http.NewRequest("GET",
		fmt.Sprintf("http://localhost/v1.41/exec/%s/json", execCreate.ID),
		nil)
	if err != nil {
		log.Printf("[backup] exec inspect request create failed: %v", err)
		return output, fmt.Errorf("无法获取执行结果")
	}

	inspectResp, err := s.httpClient.Do(inspectReq)
	if err != nil {
		log.Printf("[backup] exec inspect failed: %v", err)
		return output, fmt.Errorf("无法获取执行结果")
	}
	defer inspectResp.Body.Close()

	var execInspect struct {
		ExitCode int `json:"ExitCode"`
	}
	if err := json.NewDecoder(inspectResp.Body).Decode(&execInspect); err != nil {
		return output, nil
	}

	if execInspect.ExitCode != 0 {
		log.Printf("[backup] command %v exited with code %d, output: %s", cmd, execInspect.ExitCode, output)
		return output, fmt.Errorf("命令执行失败 (exit code %d)", execInspect.ExitCode)
	}

	return output, nil
}

// readDockerStream 读取 Docker exec 的多路复用流，支持 onChunk 回调实时输出
func (s *BackupService) readDockerStream(r io.Reader, onChunk func(string)) string {
	var buf bytes.Buffer
	header := make([]byte, 8)
	for {
		_, err := io.ReadFull(r, header)
		if err != nil {
			break
		}
		size := int(header[4])<<24 | int(header[5])<<16 | int(header[6])<<8 | int(header[7])
		if size <= 0 {
			continue
		}
		payload := make([]byte, size)
		_, err = io.ReadFull(r, payload)
		if err != nil {
			break
		}
		buf.Write(payload)
		if onChunk != nil {
			onChunk(buf.String())
		}
	}
	return buf.String()
}
