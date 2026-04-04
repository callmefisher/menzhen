package handler

import (
	"net/http"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetPortalConfigResponse embeds PatientPortalConfig and adds the tenant code and name.
type GetPortalConfigResponse struct {
	model.PatientPortalConfig
	TenantCode string `json:"tenant_code"`
	TenantName string `json:"tenant_name"`
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

	// Single query: tenant code + portal config via LEFT JOIN.
	// If no portal config row exists, bool columns are NULL → defaults applied in Go.
	type rawRow struct {
		TenantCode         string `gorm:"column:tenant_code"`
		TenantName         string `gorm:"column:tenant_name"`
		LoginEnabled       *bool  `gorm:"column:login_enabled"`
		RegisterEnabled    *bool  `gorm:"column:register_enabled"`
		AppointmentEnabled *bool  `gorm:"column:appointment_enabled"`
		QueueEnabled       *bool  `gorm:"column:queue_enabled"`
		RecordsEnabled     *bool  `gorm:"column:records_enabled"`
	}
	var row rawRow
	if err := h.db.Table("tenants").
		Select("tenants.code AS tenant_code, tenants.name AS tenant_name, ppc.login_enabled, ppc.register_enabled, ppc.appointment_enabled, ppc.queue_enabled, ppc.records_enabled").
		Joins("LEFT JOIN patient_portal_configs ppc ON ppc.tenant_id = tenants.id").
		Where("tenants.id = ?", tenantID).
		Scan(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "服务错误"})
		return
	}

	// If tenant doesn't exist, TenantCode will be empty string (Scan returns no rows without error).
	if row.TenantCode == "" {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "诊所不存在"})
		return
	}

	boolVal := func(p *bool, def bool) bool {
		if p == nil {
			return def
		}
		return *p
	}

	resp := GetPortalConfigResponse{
		PatientPortalConfig: model.PatientPortalConfig{
			TenantID:           tenantID,
			LoginEnabled:       boolVal(row.LoginEnabled, true),
			RegisterEnabled:    boolVal(row.RegisterEnabled, true),
			AppointmentEnabled: boolVal(row.AppointmentEnabled, true),
			QueueEnabled:       boolVal(row.QueueEnabled, true),
			RecordsEnabled:     boolVal(row.RecordsEnabled, true),
		},
		TenantCode: row.TenantCode,
		TenantName: row.TenantName,
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": resp})
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
