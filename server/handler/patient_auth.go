package handler

import (
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// phoneRegex validates Chinese mainland mobile phone numbers (11 digits, starting with 1[3-9]).
var phoneRegex = regexp.MustCompile(`^1[3-9]\d{9}$`)

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
	ID         uint64  `json:"id"`
	Phone      string  `json:"phone"`
	Name       string  `json:"name"`
	TenantID   uint64  `json:"tenant_id"`
	TenantName string  `json:"tenant_name"`
	PatientID  *uint64 `json:"patient_id"`
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
				ID:         pu.ID,
				Phone:      pu.Phone,
				Name:       pu.Name,
				TenantID:   pu.TenantID,
				TenantName: tenant.Name,
				PatientID:  pu.PatientID,
			},
		},
	})
}

// TenantListItem is the DTO for a tenant returned by ListTenantsByPhone.
type TenantListItem struct {
	TenantID   uint64 `json:"tenant_id"`
	TenantName string `json:"tenant_name"`
	TenantCode string `json:"tenant_code"`
}

// ListTenantsByPhone handles GET /api/v1/patient/auth/tenant-list.
// It looks up all active tenants where the given phone number has a patient_user record.
// No authentication required — used before login to show clinic selection.
func (h *PatientAuthHandler) ListTenantsByPhone(c *gin.Context) {
	phone := strings.TrimSpace(c.Query("phone"))
	if phone == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}
	if len(phone) > 20 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}
	if !phoneRegex.MatchString(phone) {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}
	// Audit log — log phone suffix for security monitoring (not full phone per privacy rules).
	suffix := phone
	if len(phone) >= 4 {
		suffix = phone[len(phone)-4:]
	}
	log.Printf("[audit] tenant-list lookup for phone suffix ...%s from %s", suffix, c.ClientIP())
	var items []TenantListItem
	err := h.db.Table("patient_users").
		Select("patient_users.tenant_id, tenants.name AS tenant_name, tenants.code AS tenant_code").
		Joins("JOIN tenants ON tenants.id = patient_users.tenant_id").
		Where("patient_users.phone = ? AND tenants.status = 1", phone).
		Scan(&items).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "查询失败"})
		return
	}
	// Ensure JSON encodes as [] not null when no records found.
	if items == nil {
		items = []TenantListItem{}
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": items})
}

// GetTenantInfo handles GET /api/v1/patient/auth/tenant-info?code=XXX.
// Public endpoint — no auth required.
// Returns basic clinic info (name + code) for QR code landing page display.
func (h *PatientAuthHandler) GetTenantInfo(c *gin.Context) {
	code := strings.TrimSpace(c.Query("code"))
	if code == "" || len(code) > 50 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}
	var tenant model.Tenant
	if err := h.db.Where("code = ? AND status = 1", code).First(&tenant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "诊所不存在或已禁用"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "服务错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"tenant_name": tenant.Name,
			"tenant_code": tenant.Code,
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
	var tenant model.Tenant
	if err := h.db.Where("id = ? AND status = 1", pu.TenantID).First(&tenant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "诊所已禁用"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "服务错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": PatientUserDTO{
			ID:         pu.ID,
			Phone:      pu.Phone,
			Name:       pu.Name,
			TenantID:   pu.TenantID,
			TenantName: tenant.Name,
			PatientID:  pu.PatientID,
		},
	})
}
