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
	db  *gorm.DB
	svc *service.QueueService
}

func NewQueueHandler(db *gorm.DB) *QueueHandler {
	return &QueueHandler{db: db, svc: service.NewQueueService(db)}
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
	userID := middleware.GetUserID(c)

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

	result, err := h.svc.TakeNumber(uint(tenantID), req.PatientName, req.DoctorID, req.DoctorName, req.Room, userID)
	if err != nil {
		if errors.Is(err, service.ErrDuplicatePatient) {
			c.JSON(http.StatusConflict, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	ws.DefaultHub.Broadcast(tenantID, ws.Message{
		Type:    "queue_update",
		Payload: gin.H{"action": "take", "entry": result.Entry},
	})

	// If patient was auto-created, notify patient list to refresh
	if result.CreatedPatient != nil {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type:    "patient_created",
			Payload: gin.H{"patient": result.CreatedPatient},
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result.Entry})
}

// Call handles POST /queue/:id/call — always broadcasts call notification (overlay),
// only broadcasts queue_update (list refresh) when status actually changed
// (i.e. no one was seeing and the entry transitioned waiting→seeing).
func (h *QueueHandler) Call(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
		return
	}

	entry, statusChanged, err := h.svc.Call(uint(tenantID), uint(id))
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

	// Always broadcast the call overlay notification
	ws.DefaultHub.Broadcast(tenantID, ws.Message{
		Type: "queue_call",
		Payload: gin.H{
			"doctor_id":    entry.DoctorID,
			"seq":          entry.SeqNumber,
			"patient_name": entry.PatientName,
			"room":         entry.Room,
			"doctor_name":  entry.DoctorName,
			"manual":       true,
		},
	})

	// Only broadcast queue_update when status actually changed (no seeing → first waiting became seeing)
	if statusChanged {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type:    "queue_update",
			Payload: gin.H{"action": "call", "entry": entry},
		})
	}

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
				"manual":       false,
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

// Doctors handles GET /queue/doctors — lightweight user list for take-number dropdown.
// Only requires queue:create, not user:manage.
func (h *QueueHandler) Doctors(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	var users []struct {
		ID       uint64 `json:"id"`
		RealName string `json:"real_name"`
		Username string `json:"username"`
	}
	if err := h.db.Table("users").
		Select("id, real_name, username").
		Where("tenant_id = ? AND status = 1", tenantID).
		Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	type doctorItem struct {
		ID   uint64 `json:"id"`
		Name string `json:"name"`
	}
	list := make([]doctorItem, 0, len(users))
	for _, u := range users {
		name := u.RealName
		if name == "" {
			name = u.Username
		}
		list = append(list, doctorItem{ID: u.ID, Name: name})
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"list": list}})
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
