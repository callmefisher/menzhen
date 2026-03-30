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

// TenantHandler handles tenant management endpoints.
type TenantHandler struct {
	db *gorm.DB
}

// NewTenantHandler creates a new TenantHandler.
func NewTenantHandler(db *gorm.DB) *TenantHandler {
	return &TenantHandler{db: db}
}

// List handles GET /api/v1/tenants.
// Super admin (username=admin + user:manage) sees all tenants.
// Other users see only their own tenant as a single-item list.
func (h *TenantHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	userID := middleware.GetUserID(c)
	isSuperAdmin := service.IsProtectedAdminAccount(h.db, userID)

	svc := service.NewTenantService(h.db)

	if isSuperAdmin {
		tenants, total, err := svc.ListTenants(page, size)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"code":    500,
				"message": "failed to list tenants",
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"code":    0,
			"message": "success",
			"data": gin.H{
				"list":  tenants,
				"total": total,
				"page":  page,
				"size":  size,
			},
		})
		return
	}

	// Non-super-admin: return only their own tenant.
	tenantID := middleware.GetTenantID(c)
	tenant, err := svc.GetTenant(tenantID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{
				"code":    0,
				"message": "success",
				"data": gin.H{
					"list":  []interface{}{},
					"total": 0,
					"page":  page,
					"size":  size,
				},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to get tenant",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  []interface{}{tenant},
			"total": 1,
			"page":  page,
			"size":  size,
		},
	})
}

// Create handles POST /api/v1/tenants.
func (h *TenantHandler) Create(c *gin.Context) {
	var req service.CreateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	svc := service.NewTenantService(h.db)
	tenant, err := svc.CreateTenant(&req)
	if err != nil {
		if errors.Is(err, service.ErrTenantCodeExist) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": "诊所编码已存在",
			})
			return
		}
		if errors.Is(err, service.ErrTenantNameExist) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": "诊所名称已存在",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "创建诊所失败",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    tenant,
	})
}

// Update handles PUT /api/v1/tenants/:id.
// Only super admin (username=admin + user:manage) may update tenant information.
func (h *TenantHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "诊所 ID 无效",
		})
		return
	}

	userID := middleware.GetUserID(c)
	if !service.IsProtectedAdminAccount(h.db, userID) {
		c.JSON(http.StatusForbidden, gin.H{
			"code":    403,
			"message": "仅超级管理员可修改诊所信息",
		})
		return
	}

	var req service.UpdateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	svc := service.NewTenantService(h.db)
	tenant, err := svc.UpdateTenant(id, &req)
	if err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "诊所不存在",
			})
			return
		}
		if errors.Is(err, service.ErrTenantCodeExist) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": "诊所编码已存在",
			})
			return
		}
		if errors.Is(err, service.ErrTenantNameExist) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": "诊所名称已存在",
			})
			return
		}
		if errors.Is(err, service.ErrTenantHasAdmin) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "更新诊所失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    tenant,
	})
}

// Delete handles DELETE /api/v1/tenants/:id.
func (h *TenantHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "诊所 ID 无效",
		})
		return
	}

	svc := service.NewTenantService(h.db)
	if err := svc.DeleteTenant(id); err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "诊所不存在",
			})
			return
		}
		if errors.Is(err, service.ErrTenantHasAdmin) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "删除诊所失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}
