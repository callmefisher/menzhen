package handler

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RoleHandler handles role and permission management endpoints.
type RoleHandler struct {
	db *gorm.DB
}

// NewRoleHandler creates a new RoleHandler.
func NewRoleHandler(db *gorm.DB) *RoleHandler {
	return &RoleHandler{db: db}
}

// List handles GET /api/v1/roles.
// Only super admin (username=admin + user:manage) may use ?tenant_id to query another tenant's roles.
// All other users always see only their own tenant's roles.
func (h *RoleHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	// Only super admin may override tenant_id via query param.
	if tid := c.Query("tenant_id"); tid != "" {
		userID := middleware.GetUserID(c)
		if service.IsProtectedAdminAccount(h.db, userID) {
			if parsed, err := strconv.ParseUint(tid, 10, 64); err == nil && parsed > 0 {
				// Validate the tenant exists before switching context.
				tenantSvc := service.NewTenantService(h.db)
				if _, err := tenantSvc.GetTenant(parsed); err != nil {
					if errors.Is(err, service.ErrTenantNotFound) {
						c.JSON(http.StatusNotFound, gin.H{
							"code":    404,
							"message": "诊所不存在",
						})
						return
					}
					c.JSON(http.StatusInternalServerError, gin.H{
						"code":    500,
						"message": "查询诊所失败",
					})
					return
				}
				tenantID = parsed
			}
		}
	}

	svc := service.NewRoleService(h.db)
	roles, err := svc.ListRoles(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "查询角色列表失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    roles,
	})
}

// Create handles POST /api/v1/roles.
func (h *RoleHandler) Create(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	var req service.CreateRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	svc := service.NewRoleService(h.db)
	role, err := svc.CreateRole(tenantID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "创建角色失败",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    role,
	})
}

// Update handles PUT /api/v1/roles/:id.
func (h *RoleHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "角色 ID 无效",
		})
		return
	}

	var req service.UpdateRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	svc := service.NewRoleService(h.db)
	role, err := svc.UpdateRole(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrRoleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "角色不存在",
			})
			return
		}
		if errors.Is(err, service.ErrRoleIsAdmin) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "更新角色失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    role,
	})
}

// ListPermissions handles GET /api/v1/permissions.
func (h *RoleHandler) ListPermissions(c *gin.Context) {
	svc := service.NewRoleService(h.db)
	permissions, err := svc.ListPermissions()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "查询权限列表失败",
		})
		return
	}

	log.Printf("[ListPermissions] Returning %d permissions", len(permissions))
	for _, p := range permissions {
		if p.Code == "license:manage" {
			log.Printf("[ListPermissions] license:manage found: id=%d name=%s", p.ID, p.Name)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    permissions,
	})
}

// Delete handles DELETE /api/v1/roles/:id.
func (h *RoleHandler) Delete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "角色 ID 无效",
		})
		return
	}

	svc := service.NewRoleService(h.db)
	if err := svc.DeleteRole(tenantID, id); err != nil {
		if errors.Is(err, service.ErrRoleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "角色不存在",
			})
			return
		}
		if errors.Is(err, service.ErrRoleInUse) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": "该角色仍有用户使用，无法删除",
			})
			return
		}
		if errors.Is(err, service.ErrRoleIsAdmin) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "删除角色失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}
