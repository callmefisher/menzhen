package handler

import (
	"log"
	"net/http"
	"regexp"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
)

// safeFilename 验证文件名只包含安全字符，防止路径穿越
var safeFilename = regexp.MustCompile(`^[A-Za-z0-9_.\-]+$`)

// BackupHandler 备份恢复 HTTP handler
type BackupHandler struct {
	svc *service.BackupService
}

// NewBackupHandler 创建备份 handler（单例 service 实例）
func NewBackupHandler() *BackupHandler {
	return &BackupHandler{
		svc: service.NewBackupService(),
	}
}

// DockerStatus GET /backup/docker-status
func (h *BackupHandler) DockerStatus(c *gin.Context) {
	available := h.svc.CheckDockerAvailable()
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"available": available}})
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
		c.JSON(http.StatusConflict, gin.H{"code": 409, "message": err.Error()})
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
		log.Printf("[backup] list local files error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "获取本地备份列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": files})
}

// ListCloudFiles GET /backup/list/cloud
func (h *BackupHandler) ListCloudFiles(c *gin.Context) {
	files, err := h.svc.ListCloudFiles()
	if err != nil {
		log.Printf("[backup] list cloud files error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "获取云端备份列表失败"})
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

	if req.MySQLFile != "" && !safeFilename.MatchString(req.MySQLFile) {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "非法文件名"})
		return
	}
	if req.MinIOFile != "" && !safeFilename.MatchString(req.MinIOFile) {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "非法文件名"})
		return
	}

	if req.MySQLFile == "" && req.MinIOFile == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请至少选择一个备份文件"})
		return
	}

	taskID, err := h.svc.TriggerRestore(req.Source, req.MySQLFile, req.MinIOFile)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"code": 409, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "恢复已开始", "data": gin.H{"task_id": taskID}})
}
