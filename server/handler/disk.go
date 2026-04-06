package handler

import (
	"errors"
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
		status := http.StatusBadRequest
		if errors.Is(err, service.ErrTaskAlreadyRunning) {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
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
		status := http.StatusBadRequest
		if errors.Is(err, service.ErrTaskAlreadyRunning) {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
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
