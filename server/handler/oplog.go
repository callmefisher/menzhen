package handler

import (
	"errors"
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
// Query params: name, tenant_id, start_date, end_date, page (default 1), size (default 20).
// Super admin (username="admin" + user:manage permission) sees all tenants' logs.
// Power admin (has managed groups) sees logs for tenants in their managed groups.
func (h *OpLogHandler) ListOpLogs(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    401,
			"message": "unauthorized",
		})
		return
	}

	userID := middleware.GetUserID(c)
	isSuperAdmin := service.IsProtectedAdminAccount(h.db, userID)
	managedGroups := middleware.GetManagedGroups(c)
	isPowerAdmin := len(managedGroups) > 0 && !isSuperAdmin

	// Super admin and power admin query across tenants (tenantID=0 signals global mode).
	if isSuperAdmin || isPowerAdmin {
		tenantID = 0
	}

	// Optional: filter to a specific tenant (only effective for super/power admin).
	var filterTenantID uint64
	if tidStr := c.Query("tenant_id"); tidStr != "" {
		tid, err := strconv.ParseUint(tidStr, 10, 64)
		if err == nil && tid > 0 {
			filterTenantID = tid
		}
	}

	// Power admin: validate the requested tenant is within their managed groups.
	if isPowerAdmin && filterTenantID > 0 {
		tenantSvc := service.NewTenantService(h.db)
		t, err := tenantSvc.GetTenant(filterTenantID)
		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "无权查看该诊所的日志",
			})
			return
		}
		allowed := false
		for _, g := range managedGroups {
			if g == t.GroupName {
				allowed = true
				break
			}
		}
		if !allowed {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "无权查看该诊所的日志",
			})
			return
		}
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
	logs, total, err := svc.QueryOpLogs(tenantID, managedGroups, filterTenantID, name, startDate, endDate, page, size)
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
			"list":           logs,
			"total":          total,
			"page":           page,
			"size":           size,
			"is_super_admin": isSuperAdmin,
			"is_power_admin": isPowerAdmin,
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
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "operation log not found",
			})
			return
		}
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
	if len(req.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "ids must not be empty",
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
