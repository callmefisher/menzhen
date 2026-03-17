package handler

import (
	"log"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// DBCleanupHandler handles database orphan data cleanup endpoints.
type DBCleanupHandler struct {
	db *gorm.DB
}

// NewDBCleanupHandler creates a new DBCleanupHandler.
func NewDBCleanupHandler(db *gorm.DB) *DBCleanupHandler {
	return &DBCleanupHandler{db: db}
}

// CleanupOrphanData handles POST /api/v1/db/cleanup.
// Query param dry_run=false triggers actual deletion; default is dry_run=true (scan only).
func (h *DBCleanupHandler) CleanupOrphanData(c *gin.Context) {
	dryRun := c.DefaultQuery("dry_run", "true") != "false"

	svc := service.NewDBCleanupService(h.db)

	if dryRun {
		result, err := svc.ScanOrphanData()
		if err != nil {
			log.Printf("[db_cleanup] scan error: %v", err)
			Error(c, 500, "扫描孤立数据失败")
			return
		}
		Success(c, result)
		return
	}

	result, err := svc.CleanupOrphanData()
	if err != nil {
		log.Printf("[db_cleanup] cleanup error: %v", err)
		Error(c, 500, "清理孤立数据失败")
		return
	}
	Success(c, result)
}
