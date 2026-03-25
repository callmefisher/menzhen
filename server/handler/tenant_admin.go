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

// TenantAdminHandler handles tenant-scoped user and role management endpoints.
// Each method extracts tenantID from the JWT context via middleware.GetTenantID,
// enforcing strict tenant isolation at the handler level.
type TenantAdminHandler struct {
	db *gorm.DB
}

// NewTenantAdminHandler creates a new TenantAdminHandler.
func NewTenantAdminHandler(db *gorm.DB) *TenantAdminHandler {
	return &TenantAdminHandler{db: db}
}

// CreateUser handles POST /tenant/users.
// Tenant admin can create a user under their own tenant.
func (h *TenantAdminHandler) CreateUser(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	var req struct {
		Username string `json:"username" binding:"required,min=2,max=50"`
		Password string `json:"password" binding:"required,min=6,max=50"`
		RealName string `json:"real_name" binding:"required"`
		Phone    string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	authSvc := service.NewAuthService(h.db)
	user, err := authSvc.Register(tenantID, req.Username, req.Password, req.RealName, req.Phone)
	if err != nil {
		if errors.Is(err, service.ErrUsernameExists) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": "该用户名已存在",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "创建用户失败",
		})
		return
	}

	middleware.LogOperation(h.db, c, "create", "user", user.ID, nil, map[string]string{
		"username":  user.Username,
		"real_name": user.RealName,
	})

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "创建成功",
		"data":    user,
	})
}

// ListUsers handles GET /tenant/users?page=1&size=20.
// Returns a paginated list of users belonging to the caller's tenant.
func (h *TenantAdminHandler) ListUsers(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewTenantAdminService(h.db)
	currentUserID := middleware.GetUserID(c)
	users, total, err := svc.ListUsers(tenantID, page, size, currentUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list users",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  users,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// UpdateUser handles PUT /tenant/users/:id.
// Updates profile fields for a user that belongs to the caller's tenant.
// Returns 404 if the user does not exist in this tenant (cross-tenant protection).
func (h *TenantAdminHandler) UpdateUser(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid user id",
		})
		return
	}

	var req service.TenantUpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	// Prevent self-disable.
	currentUserID := middleware.GetUserID(c)
	if currentUserID == id && req.Status != nil && *req.Status == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "不能禁用自己的账号",
		})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	user, err := svc.UpdateUser(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrProtectedUser) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "无法修改系统管理员账号",
			})
			return
		}
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "user not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update user",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    user,
	})
}

// DeleteUser handles DELETE /tenant/users/:id.
// Permanently removes the user within the caller's tenant.
func (h *TenantAdminHandler) DeleteUser(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid user id",
		})
		return
	}

	// Prevent self-deletion.
	currentUserID := middleware.GetUserID(c)
	if currentUserID == id {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "不能删除自己的账号",
		})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	deletedUser, err := svc.DeleteUser(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrProtectedUser) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "无法删除系统管理员账号",
			})
			return
		}
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "user not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to delete user",
		})
		return
	}

	middleware.LogOperation(h.db, c, "delete", "user", id, map[string]string{
		"username":  deletedUser.Username,
		"real_name": deletedUser.RealName,
	}, nil)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}

// ResetPassword handles POST /tenant/users/:id/reset-password.
func (h *TenantAdminHandler) ResetPassword(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid user id",
		})
		return
	}

	currentUserID := middleware.GetUserID(c)
	if currentUserID == id {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "不能重置自己的密码，请使用修改密码功能",
		})
		return
	}

	var req struct {
		NewPassword string `json:"new_password" binding:"required,min=6,max=50"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "密码长度需 6-50 个字符",
		})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	if err := svc.ResetPassword(tenantID, id, req.NewPassword); err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "user not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to reset password",
		})
		return
	}

	middleware.LogOperation(h.db, c, "update", "user", id, nil, map[string]string{
		"action": "reset_password",
	})

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "密码重置成功",
	})
}

// AssignRoles handles POST /tenant/users/:id/roles.
// Replaces the roles for a user within the caller's tenant.
// All specified role IDs must belong to the same tenant.
func (h *TenantAdminHandler) AssignRoles(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid user id",
		})
		return
	}

	var req service.AssignRolesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	if err := svc.AssignRoles(tenantID, id, req.RoleIDs); err != nil {
		if errors.Is(err, service.ErrProtectedUser) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "无法修改系统管理员角色",
			})
			return
		}
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "user not found",
			})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}

// ListRoles handles GET /tenant/roles.
// Returns all roles belonging to the caller's tenant with preloaded permissions.
func (h *TenantAdminHandler) ListRoles(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	svc := service.NewTenantAdminService(h.db)
	roles, err := svc.ListRoles(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list roles",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    roles,
	})
}

// CreateRole handles POST /tenant/roles.
// Creates a new role for the caller's tenant, filtering out global admin permission codes.
func (h *TenantAdminHandler) CreateRole(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	var req service.TenantCreateRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	role, err := svc.CreateRole(tenantID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to create role",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    role,
	})
}

// UpdateRole handles PUT /tenant/roles/:id.
// Updates an existing role belonging to the caller's tenant.
// Returns 404 if the role does not exist in this tenant.
func (h *TenantAdminHandler) UpdateRole(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid role id",
		})
		return
	}

	var req service.TenantUpdateRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	role, err := svc.UpdateRole(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrRoleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "role not found",
			})
			return
		}
		if errors.Is(err, service.ErrRoleIsAdmin) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "无法修改管理员角色",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update role",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    role,
	})
}

// DeleteRole handles DELETE /tenant/roles/:id.
func (h *TenantAdminHandler) DeleteRole(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid role id",
		})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	if err := svc.DeleteRole(tenantID, id); err != nil {
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
				"message": "无法删除管理员角色",
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

// ListTenantPermissions handles GET /tenant/permissions.
// Returns all permissions visible to tenant admins, excluding global admin codes
// (user:manage, role:manage, tenant:manage).
func (h *TenantAdminHandler) ListTenantPermissions(c *gin.Context) {
	svc := service.NewTenantAdminService(h.db)
	permissions, err := svc.ListTenantPermissions()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list permissions",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    permissions,
	})
}
