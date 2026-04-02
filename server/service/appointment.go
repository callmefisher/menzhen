package service

import (
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrAppointmentNotFound  = errors.New("appointment not found")
	ErrDuplicateAppointment = errors.New("该患者当日已有预约，请勿重复预约")
	ErrNotQueued            = errors.New("该预约尚未入队，无法签到")
	ErrCheckinWrongDate     = errors.New("只能在预约当日签到")
	ErrCancelNotAllowed     = errors.New("预约状态不允许取消")
	ErrUpdateNotAllowed     = errors.New("appointment cannot be updated in current status")
)

type CreateAppointmentInput struct {
	PatientName string
	PatientID   *uint
	DoctorID    uint
	DoctorName  string
	Room        string
	AppointDate string // "2006-01-02"
	SlotStart   string // "09:00"
	SlotEnd     string // "09:30"
}

type UpdateAppointmentInput struct {
	PatientName string
	PatientID   *uint
	DoctorID    uint
	DoctorName  string
	Room        string
	AppointDate string // "2006-01-02"
	SlotStart   string // "09:00"
	SlotEnd     string // "09:30"
}

type AppointmentService struct {
	DB *gorm.DB
}

func NewAppointmentService(db *gorm.DB) *AppointmentService {
	return &AppointmentService{DB: db}
}

// CreateAppointment creates an appointment. Same patient same doctor same date is rejected.
func (s *AppointmentService) CreateAppointment(tenantID uint, in CreateAppointmentInput) (*model.Appointment, error) {
	var count int64
	dupQuery := s.DB.Model(&model.Appointment{}).
		Where("tenant_id = ? AND doctor_id = ? AND appoint_date = ? AND status NOT IN (?,?)",
			tenantID, in.DoctorID, in.AppointDate,
			model.AppointmentStatusCancelled, model.AppointmentStatusNoShow)
	if in.PatientID != nil {
		dupQuery = dupQuery.Where("patient_id = ?", *in.PatientID)
	} else {
		dupQuery = dupQuery.Where("patient_name = ?", in.PatientName)
	}
	if err := dupQuery.Count(&count).Error; err != nil {
		return nil, fmt.Errorf("check duplicate appointment: %w", err)
	}
	if count > 0 {
		return nil, ErrDuplicateAppointment
	}

	appt := &model.Appointment{
		TenantID:    tenantID,
		PatientID:   in.PatientID,
		PatientName: in.PatientName,
		DoctorID:    in.DoctorID,
		DoctorName:  in.DoctorName,
		Room:        in.Room,
		AppointDate: in.AppointDate,
		SlotStart:   in.SlotStart,
		SlotEnd:     in.SlotEnd,
		Status:      model.AppointmentStatusPending,
	}
	if err := s.DB.Create(appt).Error; err != nil {
		return nil, fmt.Errorf("create appointment: %w", err)
	}
	return appt, nil
}

// Update updates a pending or queued appointment's fields.
func (s *AppointmentService) Update(tenantID, apptID uint, in UpdateAppointmentInput) (*model.Appointment, error) {
	var appt model.Appointment
	if err := s.DB.Where("id = ? AND tenant_id = ?", apptID, tenantID).First(&appt).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAppointmentNotFound
		}
		return nil, fmt.Errorf("load appointment: %w", err)
	}
	if appt.Status != model.AppointmentStatusPending && appt.Status != model.AppointmentStatusQueued {
		return nil, ErrUpdateNotAllowed
	}
	if err := s.DB.Model(&appt).Updates(map[string]interface{}{
		"patient_name": in.PatientName,
		"patient_id":   in.PatientID,
		"doctor_id":    in.DoctorID,
		"doctor_name":  in.DoctorName,
		"room":         in.Room,
		"appoint_date": in.AppointDate,
		"slot_start":   in.SlotStart,
		"slot_end":     in.SlotEnd,
	}).Error; err != nil {
		return nil, fmt.Errorf("update appointment: %w", err)
	}
	// Reload to return fresh data (GORM Updates does not refresh the struct)
	if err := s.DB.First(&appt, appt.ID).Error; err != nil {
		return nil, fmt.Errorf("reload appointment: %w", err)
	}
	return &appt, nil
}

// ListByDate returns appointments for a given date, optionally filtered by doctorID.
func (s *AppointmentService) ListByDate(tenantID uint, date string, doctorID *uint) ([]model.Appointment, error) {
	q := s.DB.Where("tenant_id = ? AND appoint_date = ?", tenantID, date)
	if doctorID != nil {
		q = q.Where("doctor_id = ?", *doctorID)
	}
	var list []model.Appointment
	err := q.Order("slot_start ASC, id ASC").Find(&list).Error
	if err != nil {
		return nil, fmt.Errorf("list appointments: %w", err)
	}
	return list, nil
}

// Cancel cancels a pending appointment.
func (s *AppointmentService) Cancel(tenantID, apptID uint) error {
	var appt model.Appointment
	if err := s.DB.Where("id = ? AND tenant_id = ?", apptID, tenantID).First(&appt).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrAppointmentNotFound
		}
		return fmt.Errorf("load appointment: %w", err)
	}
	if appt.Status != model.AppointmentStatusPending {
		return ErrCancelNotAllowed
	}
	if err := s.DB.Model(&appt).Update("status", model.AppointmentStatusCancelled).Error; err != nil {
		return fmt.Errorf("cancel appointment: %w", err)
	}
	return nil
}

// EnqueueAppointment converts a pending appointment into a QueueEntry (source=appointment).
// Idempotent: returns nil if already queued.
// Only today's appointments can be enqueued; past/future dates are skipped (returns nil).
func (s *AppointmentService) EnqueueAppointment(tenantID, apptID uint, queueSvc *QueueService) error {
	return s.DB.Transaction(func(tx *gorm.DB) error {
		// Load appointment inside transaction with a row-level lock to prevent concurrent enqueue.
		var appt model.Appointment
		if err := tx.Raw(
			"SELECT * FROM appointments WHERE id = ? AND tenant_id = ? FOR UPDATE",
			apptID, tenantID,
		).Scan(&appt).Error; err != nil {
			return fmt.Errorf("load appointment: %w", err)
		}
		if appt.ID == 0 {
			return ErrAppointmentNotFound
		}
		if appt.Status == model.AppointmentStatusQueued {
			return nil // idempotent
		}

		// Only enqueue appointments for today; skip past/future dates silently.
		if appt.AppointDate != time.Now().Format("2006-01-02") {
			return nil
		}

		txQueueSvc := &QueueService{DB: tx}
		seq, err := txQueueSvc.NextSeq(tenantID)
		if err != nil {
			return fmt.Errorf("next seq: %w", err)
		}
		entry := &model.QueueEntry{
			TenantID:      tenantID,
			PatientID:     appt.PatientID,
			PatientName:   appt.PatientName,
			DoctorID:      appt.DoctorID,
			DoctorName:    appt.DoctorName,
			Room:          appt.Room,
			SeqNumber:     seq,
			Status:        model.QueueStatusWaiting,
			Source:        "appointment",
			QueueDate:     appt.AppointDate,
			CheckinStatus: model.CheckinStatusPending,
			AppointmentID: &appt.ID,
			SlotStart:     appt.SlotStart,
			SlotEnd:       appt.SlotEnd,
		}
		if err := tx.Create(entry).Error; err != nil {
			return fmt.Errorf("create queue entry: %w", err)
		}
		if err := tx.Model(&appt).Updates(map[string]interface{}{
			"status":         model.AppointmentStatusQueued,
			"queue_entry_id": entry.ID,
		}).Error; err != nil {
			return fmt.Errorf("update appointment status: %w", err)
		}
		return nil
	})
}

// Checkin marks an appointment's queue entry as checked-in.
// Sign-in is allowed for any time slot as long as it's the appointment date.
func (s *AppointmentService) Checkin(tenantID, apptID uint) (*model.QueueEntry, error) {
	var appt model.Appointment
	if err := s.DB.Where("id = ? AND tenant_id = ?", apptID, tenantID).First(&appt).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAppointmentNotFound
		}
		return nil, fmt.Errorf("load appointment: %w", err)
	}
	if appt.Status != model.AppointmentStatusQueued || appt.QueueEntryID == nil {
		return nil, ErrNotQueued
	}
	now := time.Now()
	if appt.AppointDate != now.Format("2006-01-02") {
		return nil, ErrCheckinWrongDate
	}
	var entry model.QueueEntry
	if err := s.DB.Where("id = ? AND tenant_id = ?", *appt.QueueEntryID, tenantID).First(&entry).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotQueued
		}
		return nil, fmt.Errorf("load queue entry: %w", err)
	}
	if err := s.DB.Model(&entry).Updates(map[string]interface{}{
		"checkin_status": model.CheckinStatusDone,
		"arrival_time":   now,
	}).Error; err != nil {
		return nil, fmt.Errorf("update checkin: %w", err)
	}
	entry.CheckinStatus = model.CheckinStatusDone
	entry.ArrivalTime = &now
	return &entry, nil
}

// MarkNoShowAllTenantsForPastDates marks yesterday-and-earlier unattended queued appointments as
// no_show across ALL tenants. Intentionally cross-tenant — called by the midnight scheduler only.
func (s *AppointmentService) MarkNoShowAllTenantsForPastDates() (int64, error) {
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	// intentional: cross-tenant scheduled job — marks no_show across all tenants
	result := s.DB.Model(&model.Appointment{}).
		Where("appoint_date <= ? AND status = ? AND queue_entry_id IS NOT NULL",
			yesterday, model.AppointmentStatusQueued).
		Update("status", model.AppointmentStatusNoShow)
	if result.Error != nil {
		return 0, fmt.Errorf("mark no_show: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// SlotInfo describes the availability of a single time slot for a given doctor and date.
type SlotInfo struct {
	SlotStart   string `json:"slot_start"`
	SlotEnd     string `json:"slot_end"`
	MaxCount    int    `json:"max_count"`
	BookedCount int    `json:"booked_count"`
	Available   bool   `json:"available"`
}

// ListSlots returns all configured time slots for the given doctor and date,
// annotated with booking counts. If the doctor has no slot configs, an empty
// slice is returned so the caller can degrade gracefully.
func (s *AppointmentService) ListSlots(tenantID uint, date string, doctorID uint) ([]SlotInfo, error) {
	// 1. Read the slot configs for this doctor.
	var configs []model.AppointmentSlotConfig
	if err := s.DB.Where("tenant_id = ? AND doctor_id = ?", tenantID, doctorID).
		Order("slot_start ASC").Find(&configs).Error; err != nil {
		return nil, fmt.Errorf("list slot configs: %w", err)
	}
	if len(configs) == 0 {
		// Fall back to global defaults (doctor_id = 0).
		if err := s.DB.Where("tenant_id = ? AND doctor_id = 0", tenantID).
			Order("slot_start ASC").Find(&configs).Error; err != nil {
			return nil, fmt.Errorf("list global slot configs: %w", err)
		}
		if len(configs) == 0 {
			return []SlotInfo{}, nil
		}
	}

	// 2. Count bookings per slot_start (only pending/queued statuses).
	type slotCount struct {
		SlotStart string
		Count     int
	}
	var counts []slotCount
	if err := s.DB.Model(&model.Appointment{}).
		Select("slot_start, COUNT(*) as count").
		Where("tenant_id = ? AND doctor_id = ? AND appoint_date = ? AND status IN (?,?)",
			tenantID, doctorID, date,
			model.AppointmentStatusPending, model.AppointmentStatusQueued).
		Group("slot_start").
		Scan(&counts).Error; err != nil {
		return nil, fmt.Errorf("count slot bookings: %w", err)
	}
	countMap := make(map[string]int, len(counts))
	for _, c := range counts {
		countMap[c.SlotStart] = c.Count
	}

	// 3. Assemble results.
	result := make([]SlotInfo, 0, len(configs))
	for _, cfg := range configs {
		booked := countMap[cfg.SlotStart]
		result = append(result, SlotInfo{
			SlotStart:   cfg.SlotStart,
			SlotEnd:     cfg.SlotEnd,
			MaxCount:    cfg.MaxCount,
			BookedCount: booked,
			Available:   booked < cfg.MaxCount,
		})
	}
	return result, nil
}

// AutoEnqueueToday enqueues all pending appointments for today.
// Returns (failedIDs, successCount). Per-item failures don't stop others.
func (s *AppointmentService) AutoEnqueueToday(queueSvc *QueueService) (failedIDs []uint, successCount int) {
	var appts []model.Appointment
	// intentional: cross-tenant scheduled job — each item is enqueued under its own appt.TenantID
	if err := s.DB.Where("appoint_date = ? AND status = ?",
		time.Now().Format("2006-01-02"), model.AppointmentStatusPending).
		Find(&appts).Error; err != nil {
		log.Printf("auto_enqueue_today: failed to load appointments: %v", err)
		return nil, 0
	}
	for _, appt := range appts {
		if err := s.EnqueueAppointment(appt.TenantID, appt.ID, queueSvc); err != nil {
			failedIDs = append(failedIDs, appt.ID)
		} else {
			successCount++
		}
	}
	return failedIDs, successCount
}
