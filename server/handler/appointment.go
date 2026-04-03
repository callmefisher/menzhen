package handler

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/ws"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AppointmentHandler handles appointment CRUD and lifecycle endpoints.
type AppointmentHandler struct {
	svc      *service.AppointmentService
	queueSvc *service.QueueService
	schedSvc *service.DoctorScheduleService
}

// NewAppointmentHandler creates a new AppointmentHandler.
func NewAppointmentHandler(db *gorm.DB) *AppointmentHandler {
	return &AppointmentHandler{
		svc:      service.NewAppointmentService(db),
		queueSvc: service.NewQueueService(db),
		schedSvc: service.NewDoctorScheduleService(db),
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
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	// Validate appointment date against doctor's schedule weekday config.
	if err := validateAppointDateWeekday(h.schedSvc, uint(tenantID), req.DoctorID, req.AppointDate); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

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
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type:    "appt_created",
			Payload: gin.H{"appointment": appt},
		})
	}

	// Immediately enqueue if the appointment is for today so it appears in the queue
	// without waiting for the midnight scheduler.
	if err := h.svc.EnqueueAppointment(uint(tenantID), appt.ID, h.queueSvc); err != nil {
		log.Printf("appointment create: enqueue %d failed: %v", appt.ID, err)
	} else if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type:    "queue_update",
			Payload: gin.H{"action": "enqueued", "appointment_id": appt.ID},
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": appt})
}
// Success 200: { code: 0, data: { list: []Appointment } }
func (h *AppointmentHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	date := c.Query("date")
	if date == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "date is required"})
		return
	}
	if _, err := time.Parse("2006-01-02", date); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "date must be YYYY-MM-DD"})
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

	list, err := h.svc.ListByDate(uint(tenantID), date, doctorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
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
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
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
			c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
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

// Slots handles GET /appointments/slots?date=2006-01-02&doctor_id=N
// Returns all configured time slots for the given doctor and date with booking counts.
// Success 200: { code: 0, data: { slots: []SlotInfo } }
func (h *AppointmentHandler) Slots(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	date := c.Query("date")
	if date == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "date is required"})
		return
	}
	if _, err := time.Parse("2006-01-02", date); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "date must be YYYY-MM-DD"})
		return
	}
	rawDoctorID := c.Query("doctor_id")
	if rawDoctorID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "doctor_id is required"})
		return
	}
	parsed, err := strconv.ParseUint(rawDoctorID, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid doctor_id"})
		return
	}

	slots, err := h.svc.ListSlots(uint(tenantID), date, uint(parsed))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"list": slots}})
}

// updateAppointmentRequest is the JSON body for Update.
type updateAppointmentRequest struct {
	PatientName string `json:"patient_name" binding:"required"`
	PatientID   *uint  `json:"patient_id"`
	DoctorID    uint   `json:"doctor_id"    binding:"required"`
	DoctorName  string `json:"doctor_name"  binding:"required"`
	Room        string `json:"room"`
	AppointDate string `json:"appoint_date" binding:"required"`
	SlotStart   string `json:"slot_start"   binding:"required"`
	SlotEnd     string `json:"slot_end"     binding:"required"`
}

// Update handles PUT /appointments/:id
// Success  200: { code: 0, data: Appointment }
// Not found 404
// Conflict  409: ErrUpdateNotAllowed
// Bad req   400: invalid id or body
func (h *AppointmentHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	idStr := c.Param("id")
	apptID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid appointment id"})
		return
	}

	var req updateAppointmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	// Validate appointment date against doctor's schedule weekday config.
	if err := validateAppointDateWeekday(h.schedSvc, uint(tenantID), req.DoctorID, req.AppointDate); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
		return
	}

	in := service.UpdateAppointmentInput{
		PatientName: req.PatientName,
		PatientID:   req.PatientID,
		DoctorID:    req.DoctorID,
		DoctorName:  req.DoctorName,
		Room:        req.Room,
		AppointDate: req.AppointDate,
		SlotStart:   req.SlotStart,
		SlotEnd:     req.SlotEnd,
	}

	appt, err := h.svc.Update(uint(tenantID), uint(apptID), in)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrAppointmentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
		case errors.Is(err, service.ErrUpdateNotAllowed):
			c.JSON(http.StatusConflict, gin.H{"code": 1, "message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		}
		return
	}

	if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type:    "appt_updated",
			Payload: gin.H{"appointment": appt},
		})
	}

	// Enqueue immediately if the (possibly rescheduled) appointment is now for today.
	if err := h.svc.EnqueueAppointment(uint(tenantID), appt.ID, h.queueSvc); err != nil {
		log.Printf("appointment update: enqueue %d failed: %v", appt.ID, err)
	} else if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type:    "queue_update",
			Payload: gin.H{"action": "enqueued", "appointment_id": appt.ID},
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": appt})
}

// Cancel handles POST /appointments/:id/cancel
// Success  200: { code: 0, data: nil }
// Not found 404
// Conflict  409: ErrCancelNotAllowed
func (h *AppointmentHandler) Cancel(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
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
			c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		}
		return
	}

	if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type:    "appt_cancelled",
			Payload: gin.H{"appointment_id": apptID},
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}

// EnqueueToday handles POST /appointments/enqueue-today
// Manually enqueues all pending appointments for today for this tenant.
// Useful when the server was restarted after some appointments were created.
// Success 200: { code: 0, data: { enqueued: N, failed: [] } }
func (h *AppointmentHandler) EnqueueToday(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}
	failedIDs, count := h.svc.AutoEnqueueTodayForTenant(uint(tenantID), h.queueSvc)
	if count > 0 && ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(tenantID, ws.Message{
			Type:    "queue_update",
			Payload: gin.H{"action": "bulk_enqueued", "count": count},
		})
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"enqueued": count, "failed": failedIDs}})
}

// Matrix handles GET /appointments/matrix?start=YYYY-MM-DD
// start defaults to the Monday of the current week if omitted.
// Success 200: { code: 0, data: WeeklyMatrixResult }
func (h *AppointmentHandler) Matrix(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	startStr := c.Query("start")
	if startStr == "" {
		now := time.Now()
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7 // Sunday → treat as day 7
		}
		monday := now.AddDate(0, 0, -(weekday - 1))
		startStr = monday.Format("2006-01-02")
	} else {
		if _, err := time.Parse("2006-01-02", startStr); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "start must be YYYY-MM-DD"})
			return
		}
	}

	result, err := h.svc.WeeklyMatrix(uint(tenantID), startStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result})
}

// validateAppointDateWeekday checks the appointment date weekday against the doctor's schedule.
// Returns nil if weekdays=0 (no restriction) or if the date falls on an allowed weekday.
func validateAppointDateWeekday(schedSvc *service.DoctorScheduleService, tenantID, doctorID uint, appointDate string) error {
	cfg, err := schedSvc.Get(tenantID, doctorID)
	if err != nil {
		return fmt.Errorf("获取出诊配置失败")
	}
	if cfg.Weekdays == 0 {
		return nil // no restriction configured
	}
	t, err := time.Parse("2006-01-02", appointDate)
	if err != nil {
		return errors.New("日期格式错误")
	}
	dow := int(t.Weekday()) // 0=Sun,1=Mon,...,6=Sat
	if (cfg.Weekdays>>dow)&1 == 0 {
		return errors.New("该医生当天不出诊，请选择正确的出诊日期")
	}
	return nil
}
