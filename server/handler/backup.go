package handler

import (
	"log"
	"net/http"
	"regexp"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// safeFilename 验证文件名只包含安全字符，防止路径穿越
var safeFilename = regexp.MustCompile(`^[A-Za-z0-9_.\-]+$`)

// backupTypeLabels 备份类型的中文标签
var backupTypeLabels = map[string]string{
	"full":  "全量备份",
	"mysql": "仅备份MySQL",
	"minio": "仅备份MinIO",
}

// BackupHandler 备份恢复 HTTP handler
type BackupHandler struct {
	svc *service.BackupService
	db  *gorm.DB
}

// NewBackupHandler 创建备份 handler（单例 service 实例）
func NewBackupHandler(db *gorm.DB) *BackupHandler {
	return &BackupHandler{
		svc: service.NewBackupService(),
		db:  db,
	}
}

// getTenantName 查询租户名称
func (h *BackupHandler) getTenantName(tenantID uint64) string {
	if tenantID == 0 {
		return ""
	}
	var tenant model.Tenant
	if err := h.db.Select("name").First(&tenant, tenantID).Error; err != nil {
		return ""
	}
	return tenant.Name
}

// getUserRealName 查询用户真实姓名，回退到 username
func (h *BackupHandler) getUserRealName(userID uint64, fallback string) string {
	if userID == 0 {
		return fallback
	}
	var user model.User
	if err := h.db.Select("real_name").First(&user, userID).Error; err == nil && user.RealName != "" {
		return user.RealName
	}
	return fallback
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

	// 提取用户上下文（在 goroutine 前捕获）
	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)
	userName := h.getUserRealName(userID, middleware.GetUsername(c))
	tenantName := h.getTenantName(tenantID)

	onComplete := func(status string) {
		newData := map[string]interface{}{
			"backup_type":       req.Type,
			"backup_type_label": backupTypeLabels[req.Type],
			"status":            status,
			"tenant_name":       tenantName,
		}
		svc := service.NewOpLogService(h.db)
		if err := svc.CreateOpLog(tenantID, userID, userName, "backup", "system", 0, nil, newData); err != nil {
			log.Printf("[oplog] failed to record backup oplog: %v", err)
		}
	}

	taskID, err := h.svc.TriggerBackup(req.Type, onComplete)
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

	// 提取用户上下文（在 goroutine 前捕获）
	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)
	userName := h.getUserRealName(userID, middleware.GetUsername(c))
	tenantName := h.getTenantName(tenantID)

	sourceLabel := "本地恢复"
	if req.Source == "cloud" {
		sourceLabel = "云端恢复"
	}

	onComplete := func(status string) {
		newData := map[string]interface{}{
			"source":       req.Source,
			"source_label": sourceLabel,
			"status":       status,
			"tenant_name":  tenantName,
		}
		if req.MySQLFile != "" {
			newData["mysql_file"] = req.MySQLFile
		}
		if req.MinIOFile != "" {
			newData["minio_file"] = req.MinIOFile
		}
		svc := service.NewOpLogService(h.db)
		if err := svc.CreateOpLog(tenantID, userID, userName, "restore", "system", 0, nil, newData); err != nil {
			log.Printf("[oplog] failed to record restore oplog: %v", err)
		}
	}

	taskID, err := h.svc.TriggerRestore(req.Source, req.MySQLFile, req.MinIOFile, onComplete)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"code": 409, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "恢复已开始", "data": gin.H{"task_id": taskID}})
}
