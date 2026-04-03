package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PatientLoginRequest is the JSON body for POST /api/v1/patient/auth/login.
type PatientLoginRequest struct {
	TenantCode string `json:"tenant_code" binding:"required,max=50"`
	Phone      string `json:"phone" binding:"required,max=20"`
	Name       string `json:"name" binding:"required,max=50"`
}

// PatientLoginResponse is returned on successful patient login.
type PatientLoginResponse struct {
	Token       string         `json:"token"`
	PatientUser PatientUserDTO `json:"patient_user"`
}

// PatientUserDTO is a safe patient user representation (no password).
type PatientUserDTO struct {
	ID        uint64  `json:"id"`
	Phone     string  `json:"phone"`
	Name      string  `json:"name"`
	TenantID  uint64  `json:"tenant_id"`
	PatientID *uint64 `json:"patient_id"`
}

// PatientAuthHandler handles patient portal authentication.
type PatientAuthHandler struct {
	patientAuthSvc *service.PatientAuthService
	jwtSecret      string
	db             *gorm.DB
}

// NewPatientAuthHandler creates a new PatientAuthHandler.
func NewPatientAuthHandler(svc *service.PatientAuthService, jwtSecret string, db *gorm.DB) *PatientAuthHandler {
	return &PatientAuthHandler{patientAuthSvc: svc, jwtSecret: jwtSecret, db: db}
}

// Login handles POST /api/v1/patient/auth/login.
func (h *PatientAuthHandler) Login(c *gin.Context) {
	var req PatientLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}
	req.TenantCode = strings.TrimSpace(req.TenantCode)
	req.Phone = strings.TrimSpace(req.Phone)
	req.Name = strings.TrimSpace(req.Name)

	// Look up tenant by code.
	var tenant model.Tenant
	if err := h.db.Where("code = ? AND status = 1", req.TenantCode).First(&tenant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "诊所不存在或已禁用"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "服务错误"})
		return
	}

	pu, err := h.patientAuthSvc.Login(tenant.ID, req.Phone, req.Name)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrPatientLoginDisabled):
			c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "患者登录暂未开放"})
		case errors.Is(err, service.ErrPatientRegisterDisabled):
			c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "患者注册暂未开放"})
		case errors.Is(err, service.ErrPatientWrongCredentials):
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "手机号或姓名不匹配"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "登录失败，请稍后重试"})
		}
		return
	}

	token, err := middleware.GeneratePatientToken(pu.ID, pu.PatientID, pu.TenantID, h.jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": PatientLoginResponse{
			Token: token,
			PatientUser: PatientUserDTO{
				ID:        pu.ID,
				Phone:     pu.Phone,
				Name:      pu.Name,
				TenantID:  pu.TenantID,
				PatientID: pu.PatientID,
			},
		},
	})
}

// Me handles GET /api/v1/patient/me.
func (h *PatientAuthHandler) Me(c *gin.Context) {
	patientUserID := middleware.GetPatientUserID(c)
	if patientUserID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "unauthorized"})
		return
	}
	var pu model.PatientUser
	if err := h.db.First(&pu, patientUserID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "patient user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": PatientUserDTO{
			ID:        pu.ID,
			Phone:     pu.Phone,
			Name:      pu.Name,
			TenantID:  pu.TenantID,
			PatientID: pu.PatientID,
		},
	})
}
