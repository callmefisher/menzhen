package handler

import (
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// OpLogHandler handles operation log query endpoints.
type OpLogHandler struct {
	db *gorm.DB
}

// NewOpLogHandler creates a new OpLogHandler.
func NewOpLogHandler(db *gorm.DB) *OpLogHandler {
	return &OpLogHandler{db: db}
}

// ListOpLogs handles GET /api/v1/oplogs.
// Query params: name, start_date, end_date, page (default 1), size (default 20).
func (h *OpLogHandler) ListOpLogs(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    401,
			"message": "unauthorized",
		})
		return
	}

	name := c.Query("name")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewOpLogService(h.db)
	logs, total, err := svc.QueryOpLogs(tenantID, name, startDate, endDate, page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to query operation logs",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  logs,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// DeleteOpLog handles DELETE /api/v1/oplogs/:id.
func (h *OpLogHandler) DeleteOpLog(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    401,
			"message": "unauthorized",
		})
		return
	}

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid oplog id",
		})
		return
	}

	svc := service.NewOpLogService(h.db)
	if err := svc.DeleteOpLog(tenantID, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to delete operation log",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}

// BatchDeleteOpLogs handles POST /api/v1/oplogs/batch-delete.
func (h *OpLogHandler) BatchDeleteOpLogs(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    401,
			"message": "unauthorized",
		})
		return
	}

	var req struct {
		IDs []uint64 `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: ids required",
		})
		return
	}

	svc := service.NewOpLogService(h.db)
	deleted, err := svc.BatchDeleteOpLogs(tenantID, req.IDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to batch delete operation logs",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"deleted": deleted,
		},
	})
}
