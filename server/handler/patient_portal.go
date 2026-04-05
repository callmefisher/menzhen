package handler

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/ws"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PatientPortalHandler handles patient-facing data endpoints.
type PatientPortalHandler struct {
	db             *gorm.DB
	patientAuthSvc *service.PatientAuthService
	appointmentSvc *service.AppointmentService
	queueSvc       *service.QueueService
	schedSvc       *service.DoctorScheduleService
}

// NewPatientPortalHandler creates a new PatientPortalHandler.
func NewPatientPortalHandler(db *gorm.DB, svc *service.PatientAuthService) *PatientPortalHandler {
	return &PatientPortalHandler{
		db:             db,
		patientAuthSvc: svc,
		appointmentSvc: service.NewAppointmentService(db),
		queueSvc:       service.NewQueueService(db),
		schedSvc:       service.NewDoctorScheduleService(db),
	}
}

// portalEnabled aborts with 403 if a specific feature switch is off.
func (h *PatientPortalHandler) portalEnabled(c *gin.Context, check func(model.PatientPortalConfig) bool) bool {
	tenantID := middleware.GetPatientTenantID(c)
	cfg, err := h.patientAuthSvc.GetPortalConfig(tenantID)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "服务错误"})
		return false
	}
	if !check(cfg) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "message": "该功能暂未开放"})
		return false
	}
	return true
}

// doctorDisplayName returns the doctor's RealName from the users table for a given QueueDoctor.
func (h *PatientPortalHandler) doctorDisplayName(doctor model.QueueDoctor) string {
	var user model.User
	if err := h.db.Select("real_name").First(&user, doctor.UserID).Error; err != nil {
		return ""
	}
	return user.RealName
}

// patientDoctorDTO is the patient-facing doctor representation.
// Uses doctor_name to match the frontend patientPortal.ts Doctor interface.
type patientDoctorDTO struct {
	ID         uint   `json:"id"`
	DoctorName string `json:"doctor_name"`
	Room       string `json:"room"`
	SortOrder  int    `json:"sort_order"`
}

// ListDoctors handles GET /api/v1/patient/doctors.
func (h *PatientPortalHandler) ListDoctors(c *gin.Context) {
	tenantID := middleware.GetPatientTenantID(c)
	var doctors []model.QueueDoctor
	h.db.Where("tenant_id = ? AND enabled = true", tenantID).Order("sort_order").Find(&doctors)

	result := make([]patientDoctorDTO, 0, len(doctors))
	if len(doctors) > 0 {
		userIDs := make([]uint, 0, len(doctors))
		for _, d := range doctors {
			userIDs = append(userIDs, d.UserID)
		}
		var users []model.User
		h.db.Select("id, real_name").Where("id IN ?", userIDs).Find(&users)
		nameByID := make(map[uint]string, len(users))
		for _, u := range users {
			nameByID[uint(u.ID)] = u.RealName
		}
		for _, d := range doctors {
			result = append(result, patientDoctorDTO{
				ID:         uint(d.ID),
				DoctorName: nameByID[d.UserID],
				Room:       d.Room,
				SortOrder:  d.SortOrder,
			})
		}
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": result})
}

// apptListItem is the response shape for patient appointment list, adding checkin_status.
type apptListItem struct {
	model.Appointment
	CheckinStatus string `json:"checkin_status"`
}

// ListAppointments handles GET /api/v1/patient/appointments.
func (h *PatientPortalHandler) ListAppointments(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	if patientID == nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": []apptListItem{}})
		return
	}
	var appts []model.Appointment
	patientIDUint := uint(*patientID)
	h.db.Where("tenant_id = ? AND patient_id = ?", tenantID, patientIDUint).
		Order("appoint_date DESC, slot_start DESC").
		Limit(50).Find(&appts)

	// Populate checkin_status for today's queued appointments via single IN query.
	today := time.Now().Format("2006-01-02")
	var entryIDs []uint
	entryIdx := map[uint]int{} // queueEntryID → index in appts
	for i, a := range appts {
		if a.QueueEntryID != nil && strings.HasPrefix(a.AppointDate, today) {
			entryIDs = append(entryIDs, *a.QueueEntryID)
			entryIdx[*a.QueueEntryID] = i
		}
	}
	checkinByAppt := make(map[int]string) // appts index → checkin_status
	if len(entryIDs) > 0 {
		var entries []model.QueueEntry
		h.db.Select("id, checkin_status").Where("id IN ?", entryIDs).Find(&entries)
		for _, e := range entries {
			if idx, ok := entryIdx[e.ID]; ok {
				checkinByAppt[idx] = e.CheckinStatus
			}
		}
	}

	result := make([]apptListItem, len(appts))
	for i, a := range appts {
		result[i] = apptListItem{Appointment: a, CheckinStatus: checkinByAppt[i]}
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": result})
}

// CreateAppointmentRequest is the body for POST /api/v1/patient/appointments.
type CreateAppointmentRequest struct {
	DoctorID    uint   `json:"doctor_id" binding:"required"`
	AppointDate string `json:"appoint_date" binding:"required"`
	SlotStart   string `json:"slot_start" binding:"required"`
	SlotEnd     string `json:"slot_end" binding:"required"`
}

// CreateAppointment handles POST /api/v1/patient/appointments.
func (h *PatientPortalHandler) CreateAppointment(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientUserID := middleware.GetPatientUserID(c)
	patientID := middleware.GetPatientIDFromCtx(c)

	var req CreateAppointmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}

	var pu model.PatientUser
	if err := h.db.First(&pu, patientUserID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "患者信息获取失败"})
		return
	}

	var doctor model.QueueDoctor
	if err := h.db.Where("id = ? AND tenant_id = ?", req.DoctorID, tenantID).First(&doctor).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "医生不存在"})
		return
	}
	doctorName := h.doctorDisplayName(doctor)

	var slotCfg model.AppointmentSlotConfig
	h.db.Where("tenant_id = ? AND doctor_id = ? AND slot_start = ?", tenantID, req.DoctorID, req.SlotStart).First(&slotCfg)
	maxCount := 1
	if slotCfg.MaxCount > 0 {
		maxCount = slotCfg.MaxCount
	}

	var existingCount int64
	h.db.Model(&model.Appointment{}).
		Where("tenant_id = ? AND doctor_id = ? AND appoint_date = ? AND slot_start = ? AND status != ?",
			tenantID, req.DoctorID, req.AppointDate, req.SlotStart, model.AppointmentStatusCancelled).
		Count(&existingCount)

	if int(existingCount) >= maxCount {
		c.JSON(http.StatusConflict, gin.H{"code": 409, "message": "该时段已满，请选择其他时段"})
		return
	}

	// Validate appointment date weekday against doctor's schedule.
	if err := validateAppointDateWeekday(h.schedSvc, uint(tenantID), req.DoctorID, req.AppointDate); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": err.Error()})
		return
	}

	var patientIDPtr *uint
	if patientID != nil {
		v := uint(*patientID)
		patientIDPtr = &v
	}

	appt := model.Appointment{
		TenantID:    uint(tenantID),
		PatientID:   patientIDPtr,
		PatientName: pu.Name,
		DoctorID:    req.DoctorID,
		DoctorName:  doctorName,
		Room:        doctor.Room,
		AppointDate: req.AppointDate,
		SlotStart:   req.SlotStart,
		SlotEnd:     req.SlotEnd,
		Status:      model.AppointmentStatusPending,
	}
	if err := h.db.Create(&appt).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "预约失败，请稍后重试"})
		return
	}

	// Immediately enqueue if appointment is for today (server may be off at midnight,
	// so same-day patient bookings must be enqueued on creation).
	if err := h.appointmentSvc.EnqueueAppointment(uint(tenantID), appt.ID, h.queueSvc); err != nil {
		log.Printf("patient portal: enqueue appointment %d failed: %v", appt.ID, err)
	}

	// Notify admin dashboard to refresh — no PII in payload (all tenant clients receive this).
	if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(uint64(uint(tenantID)), ws.Message{
			Type:    "appt_created",
			Payload: gin.H{"action": "refresh"},
		})
	}

	c.JSON(http.StatusCreated, gin.H{"code": 0, "message": "预约成功", "data": appt})
}

// GetAppointmentSlots handles GET /api/v1/patient/appointments/slots?doctor_id=&date=.
func (h *PatientPortalHandler) GetAppointmentSlots(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	doctorID := c.Query("doctor_id")
	date := c.Query("date")
	if doctorID == "" || date == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "doctor_id 和 date 必填"})
		return
	}

	if _, err := time.Parse("2006-01-02", date); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "日期格式无效，应为 YYYY-MM-DD"})
		return
	}
	doctorIDUint, err := strconv.ParseUint(doctorID, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "无效的 doctor_id"})
		return
	}
	slots, err := h.appointmentSvc.ListSlots(uint(tenantID), date, uint(doctorIDUint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "获取时段失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": slots})
}

// CancelAppointment handles POST /api/v1/patient/appointments/:id/cancel.
// Patients may cancel their own pending or queued appointments.
func (h *PatientPortalHandler) CancelAppointment(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	idStr := c.Param("id")
	apptID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "无效的预约 ID"})
		return
	}

	// Require a linked patient record to prevent name-based horizontal privilege escalation.
	if patientID == nil {
		c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "请先绑定患者档案才能取消预约"})
		return
	}

	// Verify the appointment belongs to this patient before cancelling.
	var appt model.Appointment
	if err := h.db.Where("id = ? AND tenant_id = ? AND patient_id = ?",
		apptID, tenantID, uint(*patientID)).First(&appt).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "预约不存在"})
		return
	}

	if err := h.appointmentSvc.Cancel(uint(tenantID), uint(apptID)); err != nil {
		if errors.Is(err, service.ErrCancelNotAllowed) {
			c.JSON(http.StatusConflict, gin.H{"code": 409, "message": "该预约状态不支持取消"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "取消失败"})
		return
	}
	if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(uint64(tenantID), ws.Message{
			Type:    "appt_cancelled",
			Payload: gin.H{"action": "refresh"},
		})
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "预约已取消"})
}

// TakeQueueNumberRequest is the body for POST /api/v1/patient/queue/take.
type TakeQueueNumberRequest struct {
	DoctorID uint `json:"doctor_id" binding:"required"`
}

// TakeNumber handles POST /api/v1/patient/queue/take.
func (h *PatientPortalHandler) TakeNumber(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.QueueEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientUserID := middleware.GetPatientUserID(c)
	patientID := middleware.GetPatientIDFromCtx(c)

	var req TakeQueueNumberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}

	var pu model.PatientUser
	if err := h.db.First(&pu, patientUserID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "患者信息获取失败"})
		return
	}

	var doctor model.QueueDoctor
	if err := h.db.Where("id = ? AND tenant_id = ?", req.DoctorID, tenantID).First(&doctor).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "医生不存在"})
		return
	}
	doctorName := h.doctorDisplayName(doctor)

	today := time.Now().Format("2006-01-02")
	tenantIDUint := uint(tenantID)

	// Prevent duplicate: one active queue entry per patient per day (any doctor).
	var activeCount int64
	dupQuery := h.db.Model(&model.QueueEntry{}).
		Where("tenant_id = ? AND queue_date = ? AND patient_name = ? AND status IN ?",
			tenantIDUint, today, pu.Name, []string{model.QueueStatusWaiting, model.QueueStatusSeeing})
	if pu.PatientID != nil {
		dupQuery = h.db.Model(&model.QueueEntry{}).
			Where("tenant_id = ? AND queue_date = ? AND patient_id = ? AND status IN ?",
				tenantIDUint, today, uint(*pu.PatientID), []string{model.QueueStatusWaiting, model.QueueStatusSeeing})
	}
	if err := dupQuery.Count(&activeCount).Error; err == nil && activeCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"code": 409, "message": "您今日已在排队中，请勿重复取号"})
		return
	}

	var entry model.QueueEntry
	err := h.db.Transaction(func(tx *gorm.DB) error {
		var seq model.QueueSeq
		result := tx.Where("tenant_id = ? AND queue_date = ?", tenantIDUint, today).First(&seq)
		if result.Error != nil {
			seq = model.QueueSeq{TenantID: tenantIDUint, QueueDate: today, LastSeq: 0}
			if createErr := tx.Create(&seq).Error; createErr != nil {
				return createErr
			}
		}
		seq.LastSeq++
		if saveErr := tx.Save(&seq).Error; saveErr != nil {
			return saveErr
		}

		var patientIDUint *uint
		if patientID != nil {
			v := uint(*patientID)
			patientIDUint = &v
		}
		now := time.Now()
		entry = model.QueueEntry{
			TenantID:    tenantIDUint,
			PatientID:   patientIDUint,
			PatientName: pu.Name,
			DoctorID:    req.DoctorID,
			DoctorName:  doctorName,
			Room:        doctor.Room,
			SeqNumber:   seq.LastSeq,
			Status:      model.QueueStatusWaiting,
			Source:      "patient_portal",
			QueueDate:   today,
			ArrivalTime: &now,
		}
		return tx.Create(&entry).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "取号失败，请稍后重试"})
		return
	}

	var waitingAhead int64
	h.db.Model(&model.QueueEntry{}).
		Where("tenant_id = ? AND doctor_id = ? AND queue_date = ? AND status = ? AND seq_number < ?",
			tenantIDUint, req.DoctorID, today, model.QueueStatusWaiting, entry.SeqNumber).
		Count(&waitingAhead)

	// Notify admin dashboard to refresh queue.
	if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(uint64(tenantIDUint), ws.Message{
			Type:    "queue_update",
			Payload: gin.H{"action": "take", "entry": entry},
		})
	}

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "取号成功",
		"data": gin.H{
			"queue_entry":   entry,
			"waiting_ahead": waitingAhead,
		},
	})
}

// PatientCheckin handles POST /api/v1/patient/appointments/:id/checkin.
// Patient self-checkin: enqueues the appointment if still pending, then marks arrival.
// Broadcasts queue_update so admin dashboard and patient queue page refresh in real time.
func (h *PatientPortalHandler) PatientCheckin(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientUserID := middleware.GetPatientUserID(c)

	idStr := c.Param("id")
	apptID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "无效的预约 ID"})
		return
	}

	// Load patient user to validate ownership by name.
	var pu model.PatientUser
	if err := h.db.First(&pu, patientUserID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "患者信息获取失败"})
		return
	}

	// Validate the appointment belongs to this patient's tenant and name.
	var appt model.Appointment
	if err := h.db.Where("id = ? AND tenant_id = ? AND patient_name = ?",
		uint(apptID), uint(tenantID), pu.Name).First(&appt).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "预约不存在"})
		return
	}

	// EnqueueAppointment is idempotent — safe if already queued; no-op if not today.
	if err := h.appointmentSvc.EnqueueAppointment(uint(tenantID), uint(apptID), h.queueSvc); err != nil {
		if errors.Is(err, service.ErrAppointmentNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "预约不存在"})
			return
		}
		log.Printf("patient checkin: enqueue appt %d: %v", apptID, err)
	}

	entry, err := h.appointmentSvc.Checkin(uint(tenantID), uint(apptID))
	if err != nil {
		switch {
		case errors.Is(err, service.ErrAppointmentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "预约不存在"})
		case errors.Is(err, service.ErrNotQueued):
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "仅当天预约可签到"})
		case errors.Is(err, service.ErrCheckinWrongDate):
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "仅当天预约可签到"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "签到失败，请稍后重试"})
		}
		return
	}

	if ws.DefaultHub != nil {
		ws.DefaultHub.Broadcast(uint64(tenantID), ws.Message{
			Type:    "queue_update",
			Payload: gin.H{"action": "checkin"},
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "签到成功", "data": entry})
}

// GetMyQueueStatus handles GET /api/v1/patient/queue/my-status.
func (h *PatientPortalHandler) GetMyQueueStatus(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.QueueEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientUserID := middleware.GetPatientUserID(c)

	var pu model.PatientUser
	if err := h.db.First(&pu, patientUserID).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": nil})
		return
	}

	// PatientID must be set; without it we cannot safely identify the patient's queue entry.
	if pu.PatientID == nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": nil})
		return
	}

	today := time.Now().Format("2006-01-02")
	var entry model.QueueEntry
	err := h.db.Where("tenant_id = ? AND patient_id = ? AND queue_date = ? AND status IN ?",
		uint(tenantID), uint(*pu.PatientID), today, []string{model.QueueStatusWaiting, model.QueueStatusSeeing}).
		Order("created_at DESC").First(&entry).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": nil})
		return
	}

	var waitingAhead int64
	h.db.Model(&model.QueueEntry{}).
		Where("tenant_id = ? AND doctor_id = ? AND queue_date = ? AND status = ? AND seq_number < ?",
			uint(tenantID), entry.DoctorID, today, model.QueueStatusWaiting, entry.SeqNumber).
		Count(&waitingAhead)

	c.JSON(http.StatusOK, gin.H{
		"code": 0, "message": "success",
		"data": gin.H{"queue_entry": entry, "waiting_ahead": waitingAhead},
	})
}

// ListRecords handles GET /api/v1/patient/records.
func (h *PatientPortalHandler) ListRecords(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.RecordsEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	if patientID == nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": []model.MedicalRecord{}})
		return
	}
	var records []model.MedicalRecord
	h.db.Where("tenant_id = ? AND patient_id = ?", tenantID, *patientID).
		Order("visit_date DESC").Limit(100).Find(&records)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": records})
}

// GetRecord handles GET /api/v1/patient/records/:id.
func (h *PatientPortalHandler) GetRecord(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.RecordsEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	id := c.Param("id")

	var record model.MedicalRecord
	query := h.db.Where("id = ? AND tenant_id = ?", id, tenantID)
	if patientID != nil {
		query = query.Where("patient_id = ?", *patientID)
	}
	if err := query.First(&record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "记录不存在"})
		return
	}

	var prescriptions []model.Prescription
	h.db.Where("record_id = ?", record.ID).Find(&prescriptions)
	if len(prescriptions) > 0 {
		// Collect all prescription IDs, fetch all items in one query, then assign.
		prescriptionIDs := make([]uint64, 0, len(prescriptions))
		for _, p := range prescriptions {
			prescriptionIDs = append(prescriptionIDs, p.ID)
		}
		var allItems []model.PrescriptionItem
		h.db.Where("prescription_id IN ?", prescriptionIDs).Find(&allItems)
		itemsByPrescID := make(map[uint64][]model.PrescriptionItem)
		for _, item := range allItems {
			itemsByPrescID[item.PrescriptionID] = append(itemsByPrescID[item.PrescriptionID], item)
		}
		for i := range prescriptions {
			if items := itemsByPrescID[prescriptions[i].ID]; items != nil {
				prescriptions[i].Items = items
			} else {
				prescriptions[i].Items = []model.PrescriptionItem{}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0, "message": "success",
		"data": gin.H{"record": record, "prescriptions": prescriptions},
	})
}

// ListBillings handles GET /api/v1/patient/billings.
func (h *PatientPortalHandler) ListBillings(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.RecordsEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	if patientID == nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": []model.Billing{}})
		return
	}

	var recordIDs []uint64
	h.db.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND patient_id = ?", tenantID, *patientID).
		Pluck("id", &recordIDs)

	if len(recordIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": []model.Billing{}})
		return
	}

	var billings []model.Billing
	h.db.Where("tenant_id = ? AND record_id IN ?", tenantID, recordIDs).
		Order("created_at DESC").Limit(100).Find(&billings)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": billings})
}

// GetDoctorSchedule handles GET /api/v1/patient/doctors/:id/schedule
// Returns the doctor's schedule config (weekdays bitmask + booking range).
// Used by the patient portal to disable invalid dates in the DatePicker.
func (h *PatientPortalHandler) GetDoctorSchedule(c *gin.Context) {
	tenantID := middleware.GetPatientTenantID(c)
	doctorIDStr := c.Param("id")
	doctorID, err := strconv.ParseUint(doctorIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid doctor_id"})
		return
	}
	// Validate that the doctor belongs to this tenant.
	var doctor model.QueueDoctor
	if err := h.db.Where("id = ? AND tenant_id = ?", doctorID, tenantID).First(&doctor).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "医生不存在"})
		return
	}
	cfg, err := h.schedSvc.Get(uint(tenantID), uint(doctorID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "获取出诊配置失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": gin.H{
		"weekdays":    cfg.Weekdays,
		"range_start": cfg.RangeStart,
		"range_end":   cfg.RangeEnd,
	}})
}

// patientQueueEntryDTO is the patient-facing queue entry (no PII beyond patient's own name).
type patientQueueEntryDTO struct {
	ID          uint   `json:"id"`
	SeqNumber   int    `json:"seq_number"`
	PatientName string `json:"patient_name"`
	DoctorName  string `json:"doctor_name"`
	Room        string `json:"room"`
	Status      string `json:"status"`
}

// ListQueue handles GET /api/v1/patient/queue/list?doctor_id=.
// Returns today's waiting/seeing entries for the given doctor, for queue position display.
func (h *PatientPortalHandler) ListQueue(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.QueueEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	doctorIDStr := c.Query("doctor_id")
	if doctorIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "doctor_id 必填"})
		return
	}

	today := time.Now().Format("2006-01-02")
	// Validate that the doctor belongs to this tenant.
	var doctor model.QueueDoctor
	if err := h.db.Where("id = ? AND tenant_id = ?", doctorIDStr, uint(tenantID)).First(&doctor).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "医生不存在"})
		return
	}
	var entries []model.QueueEntry
	h.db.Where("tenant_id = ? AND doctor_id = ? AND queue_date = ? AND status IN ?",
		uint(tenantID), doctor.ID, today, []string{model.QueueStatusWaiting, model.QueueStatusSeeing}).
		Order("seq_number ASC").
		Find(&entries)

	result := make([]patientQueueEntryDTO, 0, len(entries))
	for _, e := range entries {
		result = append(result, patientQueueEntryDTO{
			ID:          uint(e.ID),
			SeqNumber:   e.SeqNumber,
			PatientName: e.PatientName,
			DoctorName:  e.DoctorName,
			Room:        e.Room,
			Status:      e.Status,
		})
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": result})
}
