package handler

import (
	"errors"
	"net/http"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---------- Request / Response structs ----------

// LoginRequest is the JSON body for POST /api/v1/auth/login.
type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// LoginResponse is returned on successful login.
type LoginResponse struct {
	Token       string       `json:"token"`
	User        UserBriefDTO `json:"user"`
	Permissions []string     `json:"permissions"`
}

// RegisterRequest is the JSON body for POST /api/v1/auth/register.
type RegisterRequest struct {
	TenantCode string `json:"tenant_code" binding:"required"`
	Username   string `json:"username" binding:"required"`
	Password   string `json:"password" binding:"required,min=6"`
	RealName   string `json:"real_name" binding:"required"`
	Phone      string `json:"phone"`
}

// UserBriefDTO is a compact user representation.
type UserBriefDTO struct {
	ID         uint64 `json:"id"`
	Username   string `json:"username"`
	RealName   string `json:"real_name"`
	TenantID   uint64 `json:"tenant_id"`
	TenantName string `json:"tenant_name"`
}

// MeResponse is returned by GET /api/v1/auth/me.
type MeResponse struct {
	User        UserBriefDTO `json:"user"`
	Permissions []string     `json:"permissions"`
}

// ChangePasswordRequest is the JSON body for POST /api/v1/auth/change-password.
type ChangePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=6"`
}

// ---------- Handler ----------

// AuthHandler handles authentication endpoints.
type AuthHandler struct {
	authService *service.AuthService
	jwtSecret   string
	db          *gorm.DB
}

// NewAuthHandler creates a new AuthHandler.
func NewAuthHandler(authService *service.AuthService, jwtSecret string, db *gorm.DB) *AuthHandler {
	return &AuthHandler{
		authService: authService,
		jwtSecret:   jwtSecret,
		db:          db,
	}
}

// Login handles POST /api/v1/auth/login.
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	user, err := h.authService.Login(req.Username, req.Password)
	if err != nil {
		status := http.StatusUnauthorized
		if errors.Is(err, service.ErrUserDisabled) {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{
			"code":    status,
			"message": err.Error(),
		})
		return
	}

	token, err := middleware.GenerateToken(user.ID, user.TenantID, user.Username, h.jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to generate token",
		})
		return
	}

	// Fetch user permissions for the login response.
	_, permissions, permErr := h.authService.GetCurrentUser(user.ID)
	if permErr != nil {
		permissions = []string{}
	}

	// Fetch tenant name for display.
	var tenantName string
	var tenant model.Tenant
	if err := h.db.First(&tenant, user.TenantID).Error; err == nil {
		tenantName = tenant.Name
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": LoginResponse{
			Token: token,
			User: UserBriefDTO{
				ID:         user.ID,
				Username:   user.Username,
				RealName:   user.RealName,
				TenantID:   user.TenantID,
				TenantName: tenantName,
			},
			Permissions: permissions,
		},
	})
}

// Register handles POST /api/v1/auth/register.
func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	// Look up tenant by code.
	var tenant model.Tenant
	if err := h.db.Where("code = ? AND status = 1", req.TenantCode).First(&tenant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": "tenant not found or disabled",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to query tenant",
		})
		return
	}

	user, err := h.authService.Register(tenant.ID, req.Username, req.Password, req.RealName, req.Phone)
	if err != nil {
		if errors.Is(err, service.ErrUsernameExists) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to register user",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data": UserBriefDTO{
			ID:       user.ID,
			Username: user.Username,
			RealName: user.RealName,
			TenantID: user.TenantID,
		},
	})
}

// Logout handles POST /api/v1/auth/logout.
// For now, this is a no-op; the client is responsible for discarding the token.
func (h *AuthHandler) Logout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "logged out successfully",
	})
}

// Me handles GET /api/v1/auth/me.
func (h *AuthHandler) Me(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    401,
			"message": "unauthorized",
		})
		return
	}

	user, permissions, err := h.authService.GetCurrentUser(userID)
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
			"message": "failed to get user info",
		})
		return
	}

	// Fetch tenant name for display.
	var tenantName string
	var tenant model.Tenant
	if err := h.db.First(&tenant, user.TenantID).Error; err == nil {
		tenantName = tenant.Name
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": MeResponse{
			User: UserBriefDTO{
				ID:         user.ID,
				Username:   user.Username,
				RealName:   user.RealName,
				TenantID:   user.TenantID,
				TenantName: tenantName,
			},
			Permissions: permissions,
		},
	})
}

// ChangePassword handles POST /api/v1/auth/change-password.
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    401,
			"message": "unauthorized",
		})
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	if err := h.authService.ChangePassword(userID, req.OldPassword, req.NewPassword); err != nil {
		if errors.Is(err, service.ErrWrongOldPassword) {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": err.Error(),
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
			"message": "failed to change password",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "密码修改成功",
	})
}
