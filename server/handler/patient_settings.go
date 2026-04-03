package handler

import (
	"net/http"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetPortalConfigResponse embeds PatientPortalConfig and adds the tenant code.
type GetPortalConfigResponse struct {
	model.PatientPortalConfig
	TenantCode string `json:"tenant_code"`
}

// PatientSettingsHandler handles admin-side patient portal config.
type PatientSettingsHandler struct {
	patientAuthSvc *service.PatientAuthService
	db             *gorm.DB
}

// NewPatientSettingsHandler creates a new PatientSettingsHandler.
func NewPatientSettingsHandler(svc *service.PatientAuthService, db *gorm.DB) *PatientSettingsHandler {
	return &PatientSettingsHandler{patientAuthSvc: svc, db: db}
}

// GetPortalConfig handles GET /api/v1/tenant/patient-portal-config.
func (h *PatientSettingsHandler) GetPortalConfig(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	cfg := h.patientAuthSvc.GetPortalConfig(tenantID)
	var t model.Tenant
	h.db.Select("code").Where("id = ?", tenantID).First(&t)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": GetPortalConfigResponse{PatientPortalConfig: cfg, TenantCode: t.Code}})
}

// UpdatePortalConfig handles PUT /api/v1/tenant/patient-portal-config.
func (h *PatientSettingsHandler) UpdatePortalConfig(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	var req model.PatientPortalConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}
	req.TenantID = tenantID
	if err := h.patientAuthSvc.SavePortalConfig(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "保存失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": req})
}
