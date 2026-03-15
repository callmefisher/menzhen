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
	users, total, err := svc.ListUsers(tenantID, page, size)
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

	svc := service.NewTenantAdminService(h.db)
	user, err := svc.UpdateUser(tenantID, id, &req)
	if err != nil {
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

// DisableUser handles DELETE /tenant/users/:id.
// Sets the user's status to 0 (disabled). Returns 404 for cross-tenant attempts.
func (h *TenantAdminHandler) DisableUser(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid user id",
		})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	if err := svc.DisableUser(tenantID, id); err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "user not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to disable user",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
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
