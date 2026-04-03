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

// QueueDoctorHandler handles HTTP endpoints for managing the per-tenant doctor queue list.
type QueueDoctorHandler struct {
	svc      *service.QueueDoctorService
	schedSvc *service.DoctorScheduleService
	db       *gorm.DB
}

// NewQueueDoctorHandler creates a new QueueDoctorHandler.
func NewQueueDoctorHandler(svc *service.QueueDoctorService, schedSvc *service.DoctorScheduleService, db *gorm.DB) *QueueDoctorHandler {
	return &QueueDoctorHandler{svc: svc, schedSvc: schedSvc, db: db}
}

// List handles GET /queue-doctors — returns all queue doctors for the tenant with user_name populated.
func (h *QueueDoctorHandler) List(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	doctors, err := h.svc.List(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	// Populate user_name from users table
	if len(doctors) > 0 {
		userIDs := make([]uint, len(doctors))
		for i, d := range doctors {
			userIDs[i] = d.UserID
		}
		var users []model.User
		// best-effort: if lookup fails, user names remain empty strings in the response
		h.db.Select("id, real_name, username").Where("id IN ? AND tenant_id = ?", userIDs, tenantID).Find(&users)
		nameMap := make(map[uint]string)
		for _, u := range users {
			name := u.RealName
			if name == "" {
				name = u.Username
			}
			nameMap[uint(u.ID)] = name
		}
		for i := range doctors {
			doctors[i].UserName = nameMap[doctors[i].UserID]
		}
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"list": doctors}})
}

// Create handles POST /queue-doctors — adds a doctor to the tenant's queue list.
func (h *QueueDoctorHandler) Create(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	var req struct {
		UserID  uint   `json:"user_id" binding:"required"`
		Room    string `json:"room"`
		Enabled *bool  `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	doc := &model.QueueDoctor{
		TenantID: tenantID,
		UserID:   req.UserID,
		Room:     req.Room,
		Enabled:  enabled,
	}

	if err := h.svc.Create(doc); err != nil {
		if errors.Is(err, service.ErrQueueDoctorDuplicate) {
			c.JSON(http.StatusConflict, gin.H{"code": 1, "message": "doctor already in queue"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": doc})
}

// Update handles PUT /queue-doctors/:id — edits room and enabled status.
func (h *QueueDoctorHandler) Update(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
		return
	}

	var req struct {
		Room    string `json:"room"`
		Enabled bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	doc, err := h.svc.Update(tenantID, uint(id), req.Room, req.Enabled)
	if err != nil {
		if errors.Is(err, service.ErrQueueDoctorNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "queue doctor not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": doc})
}

// Delete handles DELETE /queue-doctors/:id — removes a doctor from the tenant's queue list.
func (h *QueueDoctorHandler) Delete(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
		return
	}

	if err := h.svc.Delete(tenantID, uint(id)); err != nil {
		if errors.Is(err, service.ErrQueueDoctorNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "queue doctor not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// UpdateSort handles PUT /queue-doctors/sort — batch updates sort_order values.
func (h *QueueDoctorHandler) UpdateSort(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	var req struct {
		Orders []service.SortOrder `json:"orders" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	if err := h.svc.UpdateSort(tenantID, req.Orders); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// GetQueueEnabled handles GET /tenant/queue-enabled — returns whether queue feature is enabled.
func (h *QueueDoctorHandler) GetQueueEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	enabled, err := h.svc.GetQueueEnabled(tenantID)
	if err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"enabled": enabled}})
}

// SetQueueEnabled handles PUT /tenant/queue-enabled — toggles the queue feature for the tenant.
func (h *QueueDoctorHandler) SetQueueEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	if err := h.svc.SetQueueEnabled(tenantID, req.Enabled); err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// GetCallDisplayDuration handles GET /tenant/call-duration — returns the call overlay display duration.
func (h *QueueDoctorHandler) GetCallDisplayDuration(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	seconds, err := h.svc.GetCallDisplayDuration(tenantID)
	if err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"seconds": seconds}})
}

// SetCallDisplayDuration handles PUT /tenant/call-duration — updates the call overlay display duration.
func (h *QueueDoctorHandler) SetCallDisplayDuration(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	var req struct {
		Seconds int `json:"seconds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	if err := h.svc.SetCallDisplayDuration(tenantID, req.Seconds); err != nil {
		if errors.Is(err, service.ErrCallDurationOutOfRange) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "call duration out of range"})
			return
		}
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// GetShowArrivalTime handles GET /tenant/show-arrival-time — returns whether arrival time display is enabled.
func (h *QueueDoctorHandler) GetShowArrivalTime(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	show, err := h.svc.GetShowArrivalTime(tenantID)
	if err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"show": show}})
}

// SetShowArrivalTime handles PUT /tenant/show-arrival-time — toggles arrival time display for the tenant.
func (h *QueueDoctorHandler) SetShowArrivalTime(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	var req struct {
		Show bool `json:"show"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	if err := h.svc.SetShowArrivalTime(tenantID, req.Show); err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// GetAppointmentEnabled handles GET /tenant/appointment-enabled — returns whether appointment feature is enabled.
func (h *QueueDoctorHandler) GetAppointmentEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	enabled, err := h.svc.GetAppointmentEnabled(tenantID)
	if err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"enabled": enabled}})
}

// SetAppointmentEnabled handles PUT /tenant/appointment-enabled — toggles the appointment feature.
func (h *QueueDoctorHandler) SetAppointmentEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	if err := h.svc.SetAppointmentEnabled(tenantID, req.Enabled); err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// GetCallSoundEnabled handles GET /tenant/call-sound-enabled — returns whether call sound broadcast is enabled.
func (h *QueueDoctorHandler) GetCallSoundEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	enabled, err := h.svc.GetCallSoundEnabled(tenantID)
	if err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"enabled": enabled}})
}

// SetCallSoundEnabled handles PUT /tenant/call-sound-enabled — toggles the call sound broadcast for the tenant.
func (h *QueueDoctorHandler) SetCallSoundEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	if err := h.svc.SetCallSoundEnabled(tenantID, req.Enabled); err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// GetAppointmentConfig handles GET /tenant/appointment-config — returns global appointment parameters.
func (h *QueueDoctorHandler) GetAppointmentConfig(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	cfg, err := h.svc.GetAppointmentConfig(tenantID)
	if err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": cfg})
}

// SetAppointmentConfig handles PUT /tenant/appointment-config — updates global appointment parameters.
func (h *QueueDoctorHandler) SetAppointmentConfig(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	var req service.AppointmentConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	if err := h.svc.SetAppointmentConfig(tenantID, req); err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "tenant not found"})
			return
		}
		if errors.Is(err, service.ErrSlotMinutesOutOfRange) ||
			errors.Is(err, service.ErrMaxPerSlotOutOfRange) ||
			errors.Is(err, service.ErrAdvanceDaysOutOfRange) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// GetDoctorSchedule handles GET /queue-doctors/:id/schedule
func (h *QueueDoctorHandler) GetDoctorSchedule(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	doctorID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || doctorID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid doctor id"})
		return
	}
	// Verify the doctor belongs to this tenant (doctorID is queue_doctor.id, not user_id)
	var qd model.QueueDoctor
	if err := h.db.Where("id = ? AND tenant_id = ?", doctorID, tenantID).First(&qd).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "doctor not found"})
		return
	}
	cfg, err := h.schedSvc.Get(tenantID, qd.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": cfg})
}

// SetDoctorSchedule handles PUT /queue-doctors/:id/schedule
func (h *QueueDoctorHandler) SetDoctorSchedule(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	doctorID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || doctorID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid doctor id"})
		return
	}
	// Verify the doctor belongs to this tenant (doctorID is queue_doctor.id, not user_id)
	var qd model.QueueDoctor
	if err := h.db.Where("id = ? AND tenant_id = ?", doctorID, tenantID).First(&qd).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": "doctor not found"})
		return
	}
	var req service.UpsertScheduleInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}
	cfg, err := h.schedSvc.Upsert(tenantID, qd.ID, req)
	if err != nil {
		if errors.Is(err, service.ErrInvalidRange) || errors.Is(err, service.ErrInvalidWeekdays) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": cfg})
}
