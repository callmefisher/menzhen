package handler

import (
	"net/http"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PatientPortalHandler handles patient-facing data endpoints.
type PatientPortalHandler struct {
	db             *gorm.DB
	patientAuthSvc *service.PatientAuthService
}

// NewPatientPortalHandler creates a new PatientPortalHandler.
func NewPatientPortalHandler(db *gorm.DB, svc *service.PatientAuthService) *PatientPortalHandler {
	return &PatientPortalHandler{db: db, patientAuthSvc: svc}
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

// ListDoctors handles GET /api/v1/patient/doctors.
func (h *PatientPortalHandler) ListDoctors(c *gin.Context) {
	tenantID := middleware.GetPatientTenantID(c)
	var doctors []model.QueueDoctor
	h.db.Where("tenant_id = ? AND enabled = true", tenantID).Order("sort_order").Find(&doctors)

	if len(doctors) > 0 {
		// Collect all user IDs in one pass, then fetch names in a single query.
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
		for i := range doctors {
			doctors[i].UserName = nameByID[doctors[i].UserID]
		}
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": doctors})
}

// ListAppointments handles GET /api/v1/patient/appointments.
func (h *PatientPortalHandler) ListAppointments(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	if patientID == nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": []model.Appointment{}})
		return
	}
	var appts []model.Appointment
	patientIDUint := uint(*patientID)
	h.db.Where("tenant_id = ? AND patient_id = ?", tenantID, patientIDUint).
		Order("appoint_date DESC, slot_start DESC").
		Limit(50).Find(&appts)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": appts})
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

	var slotConfigs []model.AppointmentSlotConfig
	h.db.Where("tenant_id = ? AND doctor_id = ?", tenantID, doctorID).Find(&slotConfigs)

	type SlotInfo struct {
		SlotStart   string `json:"slot_start"`
		SlotEnd     string `json:"slot_end"`
		MaxCount    int    `json:"max_count"`
		BookedCount int64  `json:"booked_count"`
		Available   bool   `json:"available"`
	}

	slots := make([]SlotInfo, 0, len(slotConfigs))
	for _, sc := range slotConfigs {
		var booked int64
		h.db.Model(&model.Appointment{}).
			Where("tenant_id = ? AND doctor_id = ? AND appoint_date = ? AND slot_start = ? AND status != ?",
				tenantID, doctorID, date, sc.SlotStart, model.AppointmentStatusCancelled).
			Count(&booked)
		slots = append(slots, SlotInfo{
			SlotStart:   sc.SlotStart,
			SlotEnd:     sc.SlotEnd,
			MaxCount:    sc.MaxCount,
			BookedCount: booked,
			Available:   booked < int64(sc.MaxCount),
		})
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": slots})
}

// CancelAppointment handles POST /api/v1/patient/appointments/:id/cancel.
func (h *PatientPortalHandler) CancelAppointment(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	id := c.Param("id")

	query := h.db.Model(&model.Appointment{}).
		Where("id = ? AND tenant_id = ? AND status = ?", id, tenantID, model.AppointmentStatusPending)
	if patientID != nil {
		v := uint(*patientID)
		query = query.Where("patient_id = ?", v)
	}

	result := query.Update("status", model.AppointmentStatusCancelled)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "取消失败"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "预约不存在或无法取消"})
		return
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

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "取号成功",
		"data": gin.H{
			"queue_entry":   entry,
			"waiting_ahead": waitingAhead,
		},
	})
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
			prescriptions[i].Items = itemsByPrescID[prescriptions[i].ID]
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
