package handler

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// TenantMigrateHandler handles HTTP requests for the tenant migration feature.
// Completely independent from BackupHandler.
type TenantMigrateHandler struct {
	svc *service.TenantMigrateService
	db  *gorm.DB
}

// NewTenantMigrateHandler creates a new handler instance.
func NewTenantMigrateHandler(svc *service.TenantMigrateService, db *gorm.DB) *TenantMigrateHandler {
	return &TenantMigrateHandler{svc: svc, db: db}
}

// uploadDir returns the temp directory for uploaded SQL files.
func uploadDir() string {
	dir := os.Getenv("BACKUP_DIR")
	if dir == "" {
		dir = "/backups"
	}
	return filepath.Join(dir, "migrate-tmp")
}

// Upload handles multipart file upload of a .sql or .sql.gz file.
// POST /api/v1/tenant-migrate/upload
func (h *TenantMigrateHandler) Upload(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择要上传的文件"})
		return
	}
	defer file.Close()

	name := header.Filename
	lower := strings.ToLower(name)
	if !strings.HasSuffix(lower, ".sql") && !strings.HasSuffix(lower, ".sql.gz") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 .sql 或 .sql.gz 文件"})
		return
	}
	if !safeFilename.MatchString(name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件名包含非法字符"})
		return
	}

	if err := os.MkdirAll(uploadDir(), 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "无法创建临时目录"})
		return
	}

	// Save to temp dir.
	destPath := filepath.Join(uploadDir(), name)
	out, err := os.Create(destPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "无法保存文件"})
		return
	}
	defer out.Close()

	if _, err := copyIO(out, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件写入失败: " + err.Error()})
		return
	}

	// Log the upload operation.
	userID := middleware.GetUserID(c)
	tenantID := middleware.GetTenantID(c)
	username := middleware.GetUsername(c)
	opSvc := service.NewOpLogService(h.db)
	newData := map[string]interface{}{
		"file":   name,
		"action": "tenant_migrate_upload",
	}
	if err := opSvc.CreateOpLog(tenantID, userID, username, "tenant_migrate", "system", 0, nil, newData); err != nil {
		log.Printf("[oplog] failed to record tenant migrate upload: %v", err)
	}

	// Create parse task and start async parsing.
	h.svc.CleanupOldTasks()
	taskID := h.svc.CreateTask(destPath, name)
	h.svc.ParseSQLAsync(taskID)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{"task_id": taskID, "file_name": name},
	})
}

// ParseFromBackup starts parsing an existing backup file (from local backup list).
// POST /api/v1/tenant-migrate/parse
func (h *TenantMigrateHandler) ParseFromBackup(c *gin.Context) {
	var req struct {
		BackupFile string `json:"backup_file" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请指定 backup_file"})
		return
	}
	if !safeFilename.MatchString(req.BackupFile) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件名包含非法字符"})
		return
	}

	backupDir := os.Getenv("BACKUP_DIR")
	if backupDir == "" {
		backupDir = "/backups"
	}
	filePath := filepath.Join(backupDir, req.BackupFile)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "备份文件不存在: " + req.BackupFile})
		return
	}

	h.svc.CleanupOldTasks()
	taskID := h.svc.CreateTask(filePath, req.BackupFile)
	h.svc.ParseSQLAsync(taskID)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{"task_id": taskID, "file_name": req.BackupFile},
	})
}

// GetStatus returns the current status of a parse or execute task.
// GET /api/v1/tenant-migrate/status/:task_id
func (h *TenantMigrateHandler) GetStatus(c *gin.Context) {
	taskID := c.Param("task_id")
	task, err := h.svc.GetTask(taskID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": task})
}

// Execute starts the tenant migration execution phase.
// POST /api/v1/tenant-migrate/execute
func (h *TenantMigrateHandler) Execute(c *gin.Context) {
	var req struct {
		TaskID         string `json:"task_id" binding:"required"`
		SourceTenantID uint64 `json:"source_tenant_id" binding:"required"`
		TargetTenantID uint64 `json:"target_tenant_id" binding:"required"`
		ConfirmCode    string `json:"confirm_code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	// Validate confirm code.
	expected := fmt.Sprintf("MIGRATE-%d-TO-%d", req.SourceTenantID, req.TargetTenantID)
	if req.ConfirmCode != expected {
		c.JSON(http.StatusBadRequest, gin.H{"error": "确认码不正确"})
		return
	}

	if err := h.svc.ExecuteAsync(service.ExecuteRequest{
		TaskID:         req.TaskID,
		SourceTenantID: req.SourceTenantID,
		TargetTenantID: req.TargetTenantID,
	}); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Log the execute operation.
	userID := middleware.GetUserID(c)
	tenantID := middleware.GetTenantID(c)
	username := middleware.GetUsername(c)
	opSvc2 := service.NewOpLogService(h.db)
	execData := map[string]interface{}{
		"source_tenant_id": req.SourceTenantID,
		"target_tenant_id": req.TargetTenantID,
		"action":           "tenant_migrate_execute",
	}
	if err := opSvc2.CreateOpLog(tenantID, userID, username, "tenant_migrate", "system", 0, nil, execData); err != nil {
		log.Printf("[oplog] failed to record tenant migrate execute: %v", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{"task_id": req.TaskID},
	})
}

// ListBackupFiles returns available .sql and .sql.gz files from the local backup dir.
// GET /api/v1/tenant-migrate/backup-files
func (h *TenantMigrateHandler) ListBackupFiles(c *gin.Context) {
	backupDir := os.Getenv("BACKUP_DIR")
	if backupDir == "" {
		backupDir = "/backups"
	}

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"files": []string{}}})
		return
	}

	type FileInfo struct {
		Filename string `json:"filename"`
		Size     int64  `json:"size"`
		Modified int64  `json:"modified"`
	}
	var files []FileInfo
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		lower := strings.ToLower(name)
		if strings.HasSuffix(lower, ".sql") || strings.HasSuffix(lower, ".sql.gz") {
			info, err := e.Info()
			if err != nil {
				continue
			}
			files = append(files, FileInfo{
				Filename: name,
				Size:     info.Size(),
				Modified: info.ModTime().Unix(),
			})
		}
	}

	// Sort by modified time, newest first.
	for i := 0; i < len(files); i++ {
		for j := i + 1; j < len(files); j++ {
			if files[i].Modified < files[j].Modified {
				files[i], files[j] = files[j], files[i]
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"files": files}})
}

// copyIO copies from src to dst, returning bytes written.
func copyIO(dst io.Writer, src io.Reader) (int64, error) {
	return io.Copy(dst, src)
}
