package service

import (
	"errors"
	"fmt"
	"log"
	"strings"
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

// resolveQueueDoctorID normalizes a doctorID that may be either a queue_doctor.id or a
// user_id into the canonical queue_doctor.id for the given tenant.
// If the id cannot be resolved, the original value is returned unchanged.
// This is the single source of truth for doctorID normalization — reused by
// ListSlots, CreateAppointment, and EnqueueAppointment.
func resolveQueueDoctorID(db *gorm.DB, tenantID, doctorID uint) (queueDoctorID uint, qd model.QueueDoctor) {
	queueDoctorID = doctorID
	if err := db.Where("id = ? AND tenant_id = ?", doctorID, tenantID).First(&qd).Error; err != nil {
		// Not found by queue_doctor.id — try looking up by user_id instead.
		if err2 := db.Where("user_id = ? AND tenant_id = ?", doctorID, tenantID).First(&qd).Error; err2 == nil {
			queueDoctorID = uint(qd.ID)
		}
	} else {
		queueDoctorID = uint(qd.ID)
	}
	return
}

type CreateAppointmentInput struct {
	PatientName string
	PatientID   *uint
	DoctorID    uint
	DoctorName  string
	Room        string
	AppointDate string // "2006-01-02"
	SlotStart   string // "09:00"
	SlotEnd     string // "09:30"
	CreatedBy   uint64 // admin user_id for auto-patient creation; 0 = skip
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
// If CreatedBy is set and no existing patient record is found for the name, one is auto-created
// and the appointment's PatientID is populated — all within a single transaction.
func (s *AppointmentService) CreateAppointment(tenantID uint, in CreateAppointmentInput) (*model.Appointment, error) {
	// Normalize doctor_id to queue_doctor.id to ensure consistent storage.
	normalizedDoctorID, _ := resolveQueueDoctorID(s.DB, tenantID, in.DoctorID)
	in.DoctorID = normalizedDoctorID

	var result *model.Appointment
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var count int64
		dupQuery := tx.Model(&model.Appointment{}).
			Where("tenant_id = ? AND doctor_id = ? AND appoint_date = ? AND status NOT IN (?,?)",
				tenantID, in.DoctorID, in.AppointDate,
				model.AppointmentStatusCancelled, model.AppointmentStatusNoShow)
		if in.PatientID != nil {
			dupQuery = dupQuery.Where("patient_id = ?", *in.PatientID)
		} else {
			dupQuery = dupQuery.Where("patient_name = ?", in.PatientName)
		}
		if err := dupQuery.Count(&count).Error; err != nil {
			return fmt.Errorf("check duplicate appointment: %w", err)
		}
		if count > 0 {
			return ErrDuplicateAppointment
		}

		// Auto-create patient record if needed (admin-side creation with CreatedBy set).
		patientID := in.PatientID
		if patientID == nil && in.CreatedBy != 0 {
			var patient model.Patient
			err := tx.Where("tenant_id = ? AND name = ?", tenantID, in.PatientName).First(&patient).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				patient = model.Patient{
					TenantID:  uint64(tenantID),
					Name:      in.PatientName,
					CreatedBy: in.CreatedBy,
				}
				if createErr := tx.Create(&patient).Error; createErr != nil {
					return fmt.Errorf("auto-create patient: %w", createErr)
				}
			} else if err != nil {
				return fmt.Errorf("lookup patient: %w", err)
			}
			if patient.ID != 0 {
				pid := uint(patient.ID)
				patientID = &pid
			}
		}

		appt := &model.Appointment{
			TenantID:    tenantID,
			PatientID:   patientID,
			PatientName: in.PatientName,
			DoctorID:    in.DoctorID,
			DoctorName:  in.DoctorName,
			Room:        in.Room,
			AppointDate: in.AppointDate,
			SlotStart:   in.SlotStart,
			SlotEnd:     in.SlotEnd,
			Status:      model.AppointmentStatusPending,
		}
		if err := tx.Create(appt).Error; err != nil {
			return fmt.Errorf("create appointment: %w", err)
		}
		result = appt
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// Update updates a pending or queued appointment's fields.
func (s *AppointmentService) Update(tenantID, apptID uint, in UpdateAppointmentInput) (*model.Appointment, error) {
	// Normalize doctor_id to queue_doctor.id for consistent storage.
	normalizedDoctorID, _ := resolveQueueDoctorID(s.DB, tenantID, in.DoctorID)
	in.DoctorID = normalizedDoctorID

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
	updates := map[string]interface{}{
		"patient_name": in.PatientName,
		"doctor_id":    in.DoctorID,
		"doctor_name":  in.DoctorName,
		"room":         in.Room,
		"appoint_date": in.AppointDate,
		"slot_start":   in.SlotStart,
		"slot_end":     in.SlotEnd,
	}
	// Only update patient_id when explicitly provided; never overwrite an existing
	// patient link with NULL if the caller omits it.
	if in.PatientID != nil {
		updates["patient_id"] = *in.PatientID
	}
	if err := s.DB.Model(&appt).Updates(updates).Error; err != nil {
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

// Cancel cancels a pending or queued appointment.
// For queued appointments, the linked queue entry is marked as missed so it is
// removed from the active queue.
func (s *AppointmentService) Cancel(tenantID, apptID uint) error {
	return s.DB.Transaction(func(tx *gorm.DB) error {
		var appt model.Appointment
		if err := tx.Where("id = ? AND tenant_id = ?", apptID, tenantID).First(&appt).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAppointmentNotFound
			}
			return fmt.Errorf("load appointment: %w", err)
		}
		if appt.Status != model.AppointmentStatusPending && appt.Status != model.AppointmentStatusQueued {
			return ErrCancelNotAllowed
		}
		// If queued, mark the linked queue entry as missed to pull it from the active queue.
		if appt.Status == model.AppointmentStatusQueued && appt.QueueEntryID != nil {
			if err := tx.Model(&model.QueueEntry{}).
				Where("id = ? AND tenant_id = ?", *appt.QueueEntryID, tenantID).
				Update("status", model.QueueStatusMissed).Error; err != nil {
				return fmt.Errorf("mark queue entry missed: %w", err)
			}
		}
		if err := tx.Model(&appt).Update("status", model.AppointmentStatusCancelled).Error; err != nil {
			return fmt.Errorf("cancel appointment: %w", err)
		}
		return nil
	})
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
		// Use HasPrefix because Raw().Scan() on a DATE column may return a full
		// RFC3339 string (e.g. "2026-04-03T00:00:00+08:00") rather than "2026-04-03".
		today := time.Now().Format("2006-01-02")
		if !strings.HasPrefix(appt.AppointDate, today) {
			return nil
		}

		// NextSeq must run on the same tx connection (not a nested transaction).
		seq, err := nextSeqOnConn(tx, tenantID)
		if err != nil {
			return fmt.Errorf("next seq: %w", err)
		}
		// Resolve queue_doctor.id from appt.DoctorID using the shared normalization helper.
		// appointments.doctor_id may store either queue_doctor.id or user_id depending on
		// which path created the appointment. Normalize to queue_doctor.id here so all
		// queue_entries use a consistent doctor_id, matching how the dashboard groups.
		queueDoctorID, _ := resolveQueueDoctorID(tx, tenantID, appt.DoctorID)

		entry := &model.QueueEntry{
			TenantID:      tenantID,
			PatientID:     appt.PatientID,
			PatientName:   appt.PatientName,
			DoctorID:      queueDoctorID,
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
	// Use HasPrefix because parseTime=True in the DSN causes GORM to scan DATE
	// columns as a full timestamp string (e.g. "2026-04-04 00:00:00 +0800 CST").
	if !strings.HasPrefix(appt.AppointDate, now.Format("2006-01-02")) {
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
	var total int64

	// 1. Queued appointments from past dates that were never attended.
	r1 := s.DB.Model(&model.Appointment{}).
		Where("appoint_date <= ? AND status = ? AND queue_entry_id IS NOT NULL",
			yesterday, model.AppointmentStatusQueued).
		Update("status", model.AppointmentStatusNoShow)
	if r1.Error != nil {
		return 0, fmt.Errorf("mark no_show (queued): %w", r1.Error)
	}
	total += r1.RowsAffected

	// 2. Pending appointments from past dates that were never enqueued
	// (e.g. server was down all day — they missed their window entirely).
	r2 := s.DB.Model(&model.Appointment{}).
		Where("appoint_date <= ? AND status = ?",
			yesterday, model.AppointmentStatusPending).
		Update("status", model.AppointmentStatusNoShow)
	if r2.Error != nil {
		return 0, fmt.Errorf("mark no_show (pending): %w", r2.Error)
	}
	total += r2.RowsAffected

	return total, nil
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
	// Normalize doctorID to queue_doctor.id so queries are consistent regardless
	// of whether the caller passed a queue_doctor.id or a user_id.
	normalizedID, qd := resolveQueueDoctorID(s.DB, tenantID, doctorID)

	// Build the set of doctor_id values to count — covers both queue_doctor.id
	// and any legacy appointments that stored user_id as doctor_id.
	doctorIDSet := []uint{normalizedID}
	if qd.ID != 0 && uint(qd.UserID) != normalizedID {
		doctorIDSet = append(doctorIDSet, uint(qd.UserID))
	}

	// 1. Read the slot configs for this doctor.
	var configs []model.AppointmentSlotConfig
	if err := s.DB.Where("tenant_id = ? AND doctor_id = ?", tenantID, normalizedID).
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
	// Use IN clause to capture both queue_doctor.id and legacy user_id representations.
	type slotCount struct {
		SlotStart string
		Count     int
	}
	var counts []slotCount
	if err := s.DB.Model(&model.Appointment{}).
		Select("slot_start, COUNT(*) as count").
		Where("tenant_id = ? AND doctor_id IN ? AND appoint_date = ? AND status IN (?,?)",
			tenantID, doctorIDSet, date,
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

// AutoEnqueueTodayForTenant enqueues all pending appointments for today for a single tenant.
func (s *AppointmentService) AutoEnqueueTodayForTenant(tenantID uint, queueSvc *QueueService) (failedIDs []uint, successCount int) {
	var appts []model.Appointment
	if err := s.DB.Where("tenant_id = ? AND appoint_date = ? AND status = ?",
		tenantID, time.Now().Format("2006-01-02"), model.AppointmentStatusPending).
		Find(&appts).Error; err != nil {
		log.Printf("auto_enqueue_today_tenant %d: failed to load appointments: %v", tenantID, err)
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

// matrixRow is a (doctor_id, doctor_name, appoint_date) count row from the DB.
// Unexported: used only within WeeklyMatrix.
type matrixRow struct {
	DoctorID    uint
	DoctorName  string
	AppointDate string
	Count       int
}

// MatrixDoctor is a distinct doctor entry for the matrix header.
type MatrixDoctor struct {
	DoctorID   uint   `json:"doctor_id"`
	DoctorName string `json:"doctor_name"`
}

// WeeklyMatrixResult holds all data needed to render the heat matrix.
type WeeklyMatrixResult struct {
	Doctors    []MatrixDoctor          `json:"doctors"`
	Days       []string                `json:"days"`
	Counts     map[uint]map[string]int `json:"counts"`
	RowTotals  map[uint]int            `json:"row_totals"`
	ColTotals  map[string]int          `json:"col_totals"`
	GrandTotal int                     `json:"grand_total"`
}

// WeeklyMatrix returns appointment counts grouped by doctor and date for a 7-day window
// starting from startDate (inclusive). Only pending and queued appointments are counted.
// startDate must be "YYYY-MM-DD".
func (s *AppointmentService) WeeklyMatrix(tenantID uint, startDate string) (WeeklyMatrixResult, error) {
	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return WeeklyMatrixResult{}, fmt.Errorf("WeeklyMatrix: parse startDate: %w", err)
	}
	end := start.AddDate(0, 0, 6)
	endStr := end.Format("2006-01-02")

	days := make([]string, 7)
	for i := 0; i < 7; i++ {
		days[i] = start.AddDate(0, 0, i).Format("2006-01-02")
	}

	var rows []matrixRow
	err = s.DB.Model(&model.Appointment{}).
		Select("doctor_id, doctor_name, appoint_date, COUNT(*) as count").
		Where("tenant_id = ? AND appoint_date >= ? AND appoint_date <= ? AND status IN (?,?)",
			tenantID, startDate, endStr,
			model.AppointmentStatusPending, model.AppointmentStatusQueued).
		Group("doctor_id, doctor_name, appoint_date").
		Order("doctor_name ASC, appoint_date ASC").
		Scan(&rows).Error
	// doctor_name is included in GROUP BY to satisfy ONLY_FULL_GROUP_BY. If a doctor's
	// name is updated, old appointment rows may produce a separate matrix row until
	// back-filled. This is acceptable for the weekly overview use case.
	if err != nil {
		return WeeklyMatrixResult{}, fmt.Errorf("WeeklyMatrix: query: %w", err)
	}

	// Build a normalization map: raw doctor_id (may be user_id or queue_doctor.id) → canonical queue_doctor.id.
	// Collect unique raw IDs first, then batch-query to avoid N+1 (one round-trip per unique doctor, not per row).
	rawIDs := make([]uint, 0)
	seen := make(map[uint]bool)
	for _, r := range rows {
		if !seen[r.DoctorID] {
			seen[r.DoctorID] = true
			rawIDs = append(rawIDs, r.DoctorID)
		}
	}
	// Fetch all matching queue_doctors in two queries (by id, then by user_id for mismatches).
	canonicalIDMap := make(map[uint]uint) // raw → canonical
	if len(rawIDs) > 0 {
		var byID []model.QueueDoctor
		s.DB.Where("id IN ? AND tenant_id = ?", rawIDs, tenantID).Find(&byID)
		foundByID := make(map[uint]bool)
		for _, qd := range byID {
			canonicalIDMap[uint(qd.ID)] = uint(qd.ID)
			foundByID[uint(qd.ID)] = true
		}
		// For any raw IDs not matched by queue_doctor.id, try user_id lookup.
		unmatchedUserIDs := make([]uint, 0)
		for _, id := range rawIDs {
			if !foundByID[id] {
				unmatchedUserIDs = append(unmatchedUserIDs, id)
			}
		}
		if len(unmatchedUserIDs) > 0 {
			var byUserID []model.QueueDoctor
			s.DB.Where("user_id IN ? AND tenant_id = ?", unmatchedUserIDs, tenantID).Find(&byUserID)
			for _, qd := range byUserID {
				canonicalIDMap[qd.UserID] = uint(qd.ID)
			}
		}
	}
	// resolve returns the canonical queue_doctor.id for a raw doctor_id, falling back to the raw id.
	resolveCanonical := func(rawID uint) uint {
		if cid, ok := canonicalIDMap[rawID]; ok {
			return cid
		}
		return rawID
	}

	doctorOrder := make([]uint, 0)
	doctorNameMap := make(map[uint]string)
	counts := make(map[uint]map[string]int)
	rowTotals := make(map[uint]int)
	colTotals := make(map[string]int)
	grandTotal := 0

	for _, r := range rows {
		// MySQL with parseTime=True scans DATE columns as time.Time, which GORM
		// converts to a full datetime string. Truncate to just "YYYY-MM-DD".
		dateKey := r.AppointDate
		if len(dateKey) > 10 {
			dateKey = dateKey[:10]
		}
		canonicalID := resolveCanonical(r.DoctorID)
		if _, ok := doctorNameMap[canonicalID]; !ok {
			doctorOrder = append(doctorOrder, canonicalID)
			doctorNameMap[canonicalID] = r.DoctorName
			counts[canonicalID] = make(map[string]int)
		}
		counts[canonicalID][dateKey] += r.Count
		rowTotals[canonicalID] += r.Count
		colTotals[dateKey] += r.Count
		grandTotal += r.Count
	}

	doctors := make([]MatrixDoctor, 0, len(doctorOrder))
	for _, id := range doctorOrder {
		doctors = append(doctors, MatrixDoctor{DoctorID: id, DoctorName: doctorNameMap[id]})
	}

	return WeeklyMatrixResult{
		Doctors:    doctors,
		Days:       days,
		Counts:     counts,
		RowTotals:  rowTotals,
		ColTotals:  colTotals,
		GrandTotal: grandTotal,
	}, nil
}
