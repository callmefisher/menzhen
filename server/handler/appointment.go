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

// AppointmentHandler handles appointment CRUD and lifecycle endpoints.
type AppointmentHandler struct {
	db       *gorm.DB
	svc      *service.AppointmentService
	queueSvc *service.QueueService
}

// NewAppointmentHandler creates a new AppointmentHandler.
func NewAppointmentHandler(db *gorm.DB) *AppointmentHandler {
	return &AppointmentHandler{
		db:       db,
		svc:      service.NewAppointmentService(db),
		queueSvc: service.NewQueueService(db),
	}
}

// createAppointmentRequest is the JSON body for Create.
type createAppointmentRequest struct {
	PatientName string `json:"patient_name" binding:"required"`
	PatientID   *uint  `json:"patient_id"`
	DoctorID    uint   `json:"doctor_id"   binding:"required"`
	DoctorName  string `json:"doctor_name" binding:"required"`
	Room        string `json:"room"`
	AppointDate string `json:"appoint_date" binding:"required"`
	SlotStart   string `json:"slot_start"   binding:"required"`
	SlotEnd     string `json:"slot_end"     binding:"required"`
}

// Create handles POST /appointments
// Success  200: { code: 0, data: Appointment }
// Conflict 409: duplicate appointment
// Bad req  400: validation failure
func (h *AppointmentHandler) Create(c *gin.Context) {
	var req createAppointmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	tenantID := middleware.GetTenantID(c)
	in := service.CreateAppointmentInput{
		PatientName: req.PatientName,
		PatientID:   req.PatientID,
		DoctorID:    req.DoctorID,
		DoctorName:  req.DoctorName,
		Room:        req.Room,
		AppointDate: req.AppointDate,
		SlotStart:   req.SlotStart,
		SlotEnd:     req.SlotEnd,
	}

	appt, err := h.svc.CreateAppointment(uint(tenantID), in)
	if err != nil {
		if errors.Is(err, service.ErrDuplicateAppointment) {
			c.JSON(http.StatusConflict, gin.H{"code": 1, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": appt})
}

// List handles GET /appointments?date=2006-01-02[&doctor_id=N]
// Success 200: { code: 0, data: { list: []Appointment } }
func (h *AppointmentHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	date := c.Query("date")

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

	list, err := h.svc.ListByDate(uint(tenantID), date, doctorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"list": list}})
}

// Checkin handles POST /appointments/:id/checkin
// Success  200: { code: 0, data: QueueEntry }
// Not found 404
// Bad req   400: not queued or wrong date
func (h *AppointmentHandler) Checkin(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	idStr := c.Param("id")
	apptID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid appointment id"})
		return
	}

	entry, err := h.svc.Checkin(uint(tenantID), uint(apptID))
	if err != nil {
		switch {
		case errors.Is(err, service.ErrAppointmentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
		case errors.Is(err, service.ErrNotQueued):
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		case errors.Is(err, service.ErrCheckinWrongDate):
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		}
		return
	}

	if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type:    "queue_update",
			Payload: gin.H{"action": "checkin", "entry": entry},
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": entry})
}

// Cancel handles POST /appointments/:id/cancel
// Success  200: { code: 0, data: nil }
// Not found 404
// Conflict  409: ErrCancelNotAllowed
func (h *AppointmentHandler) Cancel(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	idStr := c.Param("id")
	apptID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid appointment id"})
		return
	}

	if err := h.svc.Cancel(uint(tenantID), uint(apptID)); err != nil {
		switch {
		case errors.Is(err, service.ErrAppointmentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
		case errors.Is(err, service.ErrCancelNotAllowed):
			c.JSON(http.StatusConflict, gin.H{"code": 1, "message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}
