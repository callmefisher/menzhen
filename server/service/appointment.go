package service

import (
	"errors"
	"fmt"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrAppointmentNotFound  = errors.New("appointment not found")
	ErrDuplicateAppointment = errors.New("该患者当日已有预约，请勿重复预约")
	ErrNotQueued            = errors.New("该预约尚未入队，无法签到")
	ErrCheckinWrongDate     = errors.New("只能在预约当日签到")
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

type AppointmentService struct {
	DB *gorm.DB
}

func NewAppointmentService(db *gorm.DB) *AppointmentService {
	return &AppointmentService{DB: db}
}

// CreateAppointment creates an appointment. Same patient same date is rejected.
func (s *AppointmentService) CreateAppointment(tenantID uint, in CreateAppointmentInput) (*model.Appointment, error) {
	var count int64
	if err := s.DB.Model(&model.Appointment{}).
		Where("tenant_id = ? AND patient_name = ? AND appoint_date = ? AND status NOT IN (?,?)",
			tenantID, in.PatientName, in.AppointDate,
			model.AppointmentStatusCancelled, model.AppointmentStatusNoShow).
		Count(&count).Error; err != nil {
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

// ListByDate returns appointments for a given date, optionally filtered by doctorID.
func (s *AppointmentService) ListByDate(tenantID uint, date string, doctorID *uint) ([]model.Appointment, error) {
	q := s.DB.Where("tenant_id = ? AND appoint_date = ?", tenantID, date)
	if doctorID != nil {
		q = q.Where("doctor_id = ?", *doctorID)
	}
	var list []model.Appointment
	err := q.Order("slot_start ASC, id ASC").Find(&list).Error
	return list, err
}

// Cancel cancels a pending appointment.
func (s *AppointmentService) Cancel(tenantID, apptID uint) error {
	result := s.DB.Model(&model.Appointment{}).
		Where("id = ? AND tenant_id = ? AND status = ?", apptID, tenantID, model.AppointmentStatusPending).
		Update("status", model.AppointmentStatusCancelled)
	if result.Error != nil {
		return fmt.Errorf("cancel appointment: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrAppointmentNotFound
	}
	return nil
}

// EnqueueAppointment converts a pending appointment into a QueueEntry (source=appointment).
// Idempotent: returns nil if already queued.
func (s *AppointmentService) EnqueueAppointment(tenantID, apptID uint, queueSvc *QueueService) error {
	var appt model.Appointment
	if err := s.DB.Where("id = ? AND tenant_id = ?", apptID, tenantID).First(&appt).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrAppointmentNotFound
		}
		return fmt.Errorf("load appointment: %w", err)
	}
	if appt.Status == model.AppointmentStatusQueued {
		return nil // idempotent
	}

	return s.DB.Transaction(func(tx *gorm.DB) error {
		txQueueSvc := &QueueService{DB: tx}
		seq, err := txQueueSvc.NextSeq(tenantID)
		if err != nil {
			return fmt.Errorf("next seq: %w", err)
		}
		now := time.Now()
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
			ArrivalTime:   &now,
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
	if appt.AppointDate != time.Now().Format("2006-01-02") {
		return nil, ErrCheckinWrongDate
	}

	now := time.Now()
	var entry model.QueueEntry
	if err := s.DB.Where("id = ? AND tenant_id = ?", *appt.QueueEntryID, tenantID).First(&entry).Error; err != nil {
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

// AutoEnqueueToday enqueues all pending appointments for today.
// Returns (failedIDs, successCount). Per-item failures don't stop others.
func (s *AppointmentService) AutoEnqueueToday(queueSvc *QueueService) (failedIDs []uint, successCount int) {
	var appts []model.Appointment
	if err := s.DB.Where("appoint_date = ? AND status = ?",
		time.Now().Format("2006-01-02"), model.AppointmentStatusPending).
		Find(&appts).Error; err != nil {
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
