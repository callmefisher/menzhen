package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// UserHandler handles user management endpoints.
type UserHandler struct {
	db *gorm.DB
}

// NewUserHandler creates a new UserHandler.
func NewUserHandler(db *gorm.DB) *UserHandler {
	return &UserHandler{db: db}
}

// checkProtectedAdmin returns true and writes a 403 response if the target user
// is the protected admin account and the caller is not themselves.
func (h *UserHandler) checkProtectedAdmin(c *gin.Context, targetID uint64) bool {
	currentUserID := middleware.GetUserID(c)
	if currentUserID != targetID && service.IsProtectedAdminAccount(h.db, targetID) {
		c.JSON(http.StatusForbidden, gin.H{
			"code":    403,
			"message": "admin 账号受保护，不可被其他账号修改",
		})
		return true
	}
	return false
}

// CreateUser handles POST /api/v1/users.
// Admin can create a user under a specified tenant.
func (h *UserHandler) CreateUser(c *gin.Context) {
	var req struct {
		TenantID uint64 `json:"tenant_id" binding:"required"`
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
	user, err := authSvc.Register(req.TenantID, req.Username, req.Password, req.RealName, req.Phone)
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

// List handles GET /api/v1/users.
// Super admin (username=admin + user:manage) sees all users across tenants.
// Other users see only their own tenant's users.
func (h *UserHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewUserService(h.db)
	currentUserID := middleware.GetUserID(c)
	isSuperAdmin := service.IsProtectedAdminAccount(h.db, currentUserID)

	var users []model.User
	var total int64
	var err error

	if isSuperAdmin {
		users, total, err = svc.ListUsers(page, size, currentUserID)
	} else {
		tenantID := middleware.GetTenantID(c)
		users, total, err = svc.ListUsersByTenant(tenantID, page, size, currentUserID)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "查询用户列表失败",
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

// Update handles PUT /api/v1/users/:id.
// Super admin may update users across tenants; others are restricted to their own tenant.
func (h *UserHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "用户 ID 无效",
		})
		return
	}

	if h.checkProtectedAdmin(c, id) {
		return
	}

	var req service.UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误: " + err.Error(),
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

	// Super admin may update across tenants; others are scoped to their own tenant.
	isSuperAdmin := service.IsProtectedAdminAccount(h.db, currentUserID)
	var tenantID uint64
	if !isSuperAdmin {
		tenantID = middleware.GetTenantID(c)
	}

	svc := service.NewUserService(h.db)
	user, err := svc.UpdateUser(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "用户不存在",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "更新用户失败",
		})
		return
	}

	middleware.LogOperation(h.db, c, "update", "user", id, nil, user)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    user,
	})
}

// Delete handles DELETE /api/v1/users/:id.
// Super admin may delete users across tenants; others are restricted to their own tenant.
func (h *UserHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "用户 ID 无效",
		})
		return
	}

	if h.checkProtectedAdmin(c, id) {
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

	// Super admin may delete across tenants; others are scoped to their own tenant.
	isSuperAdmin := service.IsProtectedAdminAccount(h.db, currentUserID)
	var tenantID uint64
	if !isSuperAdmin {
		tenantID = middleware.GetTenantID(c)
	}

	svc := service.NewUserService(h.db)
	deletedUser, err := svc.DeleteUser(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "用户不存在",
			})
			return
		}
		if errors.Is(err, service.ErrProtectedUser) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "admin 账号不可删除",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "删除用户失败",
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

// AssignRoles handles POST /api/v1/users/:id/roles.
// Non-super-admin callers may only assign roles to users within their own tenant.
func (h *UserHandler) AssignRoles(c *gin.Context) {
	callerTenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "用户 ID 无效",
		})
		return
	}

	if h.checkProtectedAdmin(c, id) {
		return
	}

	// Non-super-admin: verify target user belongs to the caller's tenant.
	callerID := middleware.GetUserID(c)
	if !service.IsProtectedAdminAccount(h.db, callerID) {
		var target model.User
		if err := h.db.Select("id, tenant_id").First(&target, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{
					"code":    404,
					"message": "用户不存在",
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{
				"code":    500,
				"message": "查询用户失败",
			})
			return
		}
		if target.TenantID != callerTenantID {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "无权操作其他租户的用户",
			})
			return
		}
	}

	var req service.AssignRolesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	svc := service.NewUserService(h.db)
	if err := svc.AssignRoles(callerTenantID, id, req.RoleIDs); err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "用户不存在",
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

// ResetPassword handles POST /api/v1/users/:id/reset-password.
// Super admin may reset passwords across tenants; others are restricted to their own tenant.
func (h *UserHandler) ResetPassword(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "用户 ID 无效",
		})
		return
	}

	if h.checkProtectedAdmin(c, id) {
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

	// Super admin may reset across tenants; others are scoped to their own tenant.
	isSuperAdmin := service.IsProtectedAdminAccount(h.db, currentUserID)
	var tenantID uint64
	if !isSuperAdmin {
		tenantID = middleware.GetTenantID(c)
	}

	svc := service.NewUserService(h.db)
	if err := svc.ResetPassword(tenantID, id, req.NewPassword); err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "用户不存在",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "重置密码失败",
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
