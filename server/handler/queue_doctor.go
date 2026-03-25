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
	svc *service.QueueDoctorService
	db  *gorm.DB
}

// NewQueueDoctorHandler creates a new QueueDoctorHandler.
func NewQueueDoctorHandler(svc *service.QueueDoctorService, db *gorm.DB) *QueueDoctorHandler {
	return &QueueDoctorHandler{svc: svc, db: db}
}

// List handles GET /queue-doctors — returns all queue doctors for the tenant with user_name populated.
func (h *QueueDoctorHandler) List(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))

	doctors, err := h.svc.List(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	// Populate user_name from users table
	if len(doctors) > 0 {
		userIDs := make([]uint, len(doctors))
		for i, d := range doctors {
			userIDs[i] = d.UserID
		}
		var users []model.User
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

	var req struct {
		UserID uint   `json:"user_id" binding:"required"`
		Room   string `json:"room"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	doc := &model.QueueDoctor{
		TenantID: tenantID,
		UserID:   req.UserID,
		Room:     req.Room,
		Enabled:  true,
	}

	if err := h.svc.Create(doc); err != nil {
		if errors.Is(err, service.ErrQueueDoctorDuplicate) {
			c.JSON(http.StatusConflict, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": doc})
}

// Update handles PUT /queue-doctors/:id — edits room and enabled status.
func (h *QueueDoctorHandler) Update(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))

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
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": doc})
}

// Delete handles DELETE /queue-doctors/:id — removes a doctor from the tenant's queue list.
func (h *QueueDoctorHandler) Delete(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
		return
	}

	if err := h.svc.Delete(tenantID, uint(id)); err != nil {
		if errors.Is(err, service.ErrQueueDoctorNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// UpdateSort handles PUT /queue-doctors/sort — batch updates sort_order values.
func (h *QueueDoctorHandler) UpdateSort(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))

	var req struct {
		Orders []service.SortOrder `json:"orders" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	if err := h.svc.UpdateSort(tenantID, req.Orders); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// GetQueueEnabled handles GET /tenant/queue-enabled — returns whether queue feature is enabled.
func (h *QueueDoctorHandler) GetQueueEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))

	enabled, err := h.svc.GetQueueEnabled(tenantID)
	if err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"enabled": enabled}})
}

// SetQueueEnabled handles PUT /tenant/queue-enabled — toggles the queue feature for the tenant.
func (h *QueueDoctorHandler) SetQueueEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	if err := h.svc.SetQueueEnabled(tenantID, req.Enabled); err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}
