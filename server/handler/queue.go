package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/ws"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type QueueHandler struct {
	svc *service.QueueService
}

func NewQueueHandler(db *gorm.DB) *QueueHandler {
	return &QueueHandler{svc: service.NewQueueService(db)}
}

// List handles GET /queue?doctor_id=N
func (h *QueueHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

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

	entries, err := h.svc.ListToday(uint(tenantID), doctorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"list": entries}})
}

// TakeNumber handles POST /queue/take
func (h *QueueHandler) TakeNumber(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	var req struct {
		PatientName string `json:"patient_name" binding:"required"`
		DoctorID    uint   `json:"doctor_id" binding:"required"`
		DoctorName  string `json:"doctor_name" binding:"required"`
		Room        string `json:"room"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	entry, err := h.svc.TakeNumber(uint(tenantID), req.PatientName, req.DoctorID, req.DoctorName, req.Room)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	ws.DefaultHub.Broadcast(tenantID, ws.Message{
		Type:    "queue_update",
		Payload: gin.H{"action": "take", "entry": entry},
	})

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": entry})
}

// Call handles POST /queue/:id/call
func (h *QueueHandler) Call(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
		return
	}

	entry, err := h.svc.Call(uint(tenantID), uint(id))
	if err != nil {
		if errors.Is(err, service.ErrQueueEntryNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
			return
		}
		if errors.Is(err, service.ErrInvalidStatus) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	ws.DefaultHub.Broadcast(tenantID, ws.Message{
		Type: "queue_call",
		Payload: gin.H{
			"doctor_id":    entry.DoctorID,
			"seq":          entry.SeqNumber,
			"patient_name": entry.PatientName,
			"room":         entry.Room,
			"doctor_name":  entry.DoctorName,
		},
	})
	ws.DefaultHub.Broadcast(tenantID, ws.Message{
		Type:    "queue_update",
		Payload: gin.H{"action": "call", "entry": entry},
	})

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": entry})
}

// Complete handles POST /queue/:id/complete
func (h *QueueHandler) Complete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
		return
	}

	completed, next, err := h.svc.Complete(uint(tenantID), uint(id))
	if err != nil {
		if errors.Is(err, service.ErrQueueEntryNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
			return
		}
		if errors.Is(err, service.ErrInvalidStatus) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	ws.DefaultHub.Broadcast(tenantID, ws.Message{
		Type:    "queue_update",
		Payload: gin.H{"action": "complete", "entry": completed},
	})

	if next != nil {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type: "queue_call",
			Payload: gin.H{
				"doctor_id":    next.DoctorID,
				"seq":          next.SeqNumber,
				"patient_name": next.PatientName,
				"room":         next.Room,
				"doctor_name":  next.DoctorName,
			},
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"completed": completed, "next": next}})
}

// Clear handles POST /queue/clear
func (h *QueueHandler) Clear(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	deleted, err := h.svc.Clear(uint(tenantID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	ws.DefaultHub.Broadcast(tenantID, ws.Message{
		Type:    "queue_clear",
		Payload: gin.H{"deleted": deleted},
	})

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"deleted": deleted}})
}

// Stats handles GET /queue/stats
func (h *QueueHandler) Stats(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	stats, err := h.svc.Stats(uint(tenantID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": stats})
}
