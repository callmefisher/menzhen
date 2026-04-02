package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
)

type SlotConfigHandler struct {
	svc *service.SlotConfigService
}

func NewSlotConfigHandler(svc *service.SlotConfigService) *SlotConfigHandler {
	return &SlotConfigHandler{svc: svc}
}

// List GET /appointment-slots?doctor_id=
func (h *SlotConfigHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	var doctorID *uint
	if raw := c.Query("doctor_id"); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid doctor_id"})
			return
		}
		id := uint(parsed)
		doctorID = &id
	}
	list, err := h.svc.List(uint(tenantID), doctorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"list": list}})
}

type slotConfigInput struct {
	DoctorID  *uint  `json:"doctor_id"`
	SlotStart string `json:"slot_start" binding:"required"`
	SlotEnd   string `json:"slot_end" binding:"required"`
	MaxCount  int    `json:"max_count"`
}

// Create POST /appointment-slots
func (h *SlotConfigHandler) Create(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	var in slotConfigInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}
	var doctorID uint = 0
	if in.DoctorID != nil {
		doctorID = *in.DoctorID
	}
	cfg, err := h.svc.Create(uint(tenantID), service.UpsertSlotInput{
		DoctorID: doctorID, SlotStart: in.SlotStart, SlotEnd: in.SlotEnd, MaxCount: in.MaxCount,
	})
	if err != nil {
		if errors.Is(err, service.ErrInvalidTimeFormat) || errors.Is(err, service.ErrSlotEndBeforeStart) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": cfg})
}

type slotConfigUpdateInput struct {
	SlotStart string `json:"slot_start" binding:"required"`
	SlotEnd   string `json:"slot_end" binding:"required"`
	MaxCount  int    `json:"max_count"`
}

// Update PUT /appointment-slots/:id
func (h *SlotConfigHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
		return
	}
	var in slotConfigUpdateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}
	cfg, err := h.svc.Update(uint(tenantID), uint(id), service.UpsertSlotInput{
		SlotStart: in.SlotStart, SlotEnd: in.SlotEnd, MaxCount: in.MaxCount,
	})
	if err != nil {
		if errors.Is(err, service.ErrSlotConfigNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
			return
		}
		if errors.Is(err, service.ErrInvalidTimeFormat) || errors.Is(err, service.ErrSlotEndBeforeStart) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": cfg})
}

// Delete DELETE /appointment-slots/:id
func (h *SlotConfigHandler) Delete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
		return
	}
	if err := h.svc.Delete(uint(tenantID), uint(id)); err != nil {
		if errors.Is(err, service.ErrSlotConfigNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}
