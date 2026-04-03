package handler

import (
	"net/http"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
)

// PatientSettingsHandler handles admin-side patient portal config.
type PatientSettingsHandler struct {
	patientAuthSvc *service.PatientAuthService
}

// NewPatientSettingsHandler creates a new PatientSettingsHandler.
func NewPatientSettingsHandler(svc *service.PatientAuthService) *PatientSettingsHandler {
	return &PatientSettingsHandler{patientAuthSvc: svc}
}

// GetPortalConfig handles GET /api/v1/tenant/patient-portal-config.
func (h *PatientSettingsHandler) GetPortalConfig(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	cfg := h.patientAuthSvc.GetPortalConfig(tenantID)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": cfg})
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
