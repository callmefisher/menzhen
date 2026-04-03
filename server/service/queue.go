package service

import (
	"errors"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrQueueEntryNotFound = errors.New("queue entry not found")
	ErrInvalidStatus      = errors.New("invalid queue status transition")
	ErrDuplicatePatient   = errors.New("该患者今日已在排队中，请勿重复取号")
)

type QueueService struct {
	DB *gorm.DB
}

func NewQueueService(db *gorm.DB) *QueueService {
	return &QueueService{DB: db}
}

func today() string {
	return time.Now().Format("2006-01-02")
}

// NextSeq atomically increments and returns the sequence number for today.
// Wraps UPSERT + SELECT in a transaction so both run on the same connection,
// avoiding the LAST_INSERT_ID auto-increment override on new-day INSERT.
func (s *QueueService) NextSeq(tenantID uint) (int, error) {
	return nextSeqOnConn(s.DB, tenantID)
}

// nextSeqOnConn executes the NextSeq UPSERT+SELECT on the given db handle (which
// may be a plain *gorm.DB or an in-progress transaction).  Using a nested
// s.DB.Transaction() inside an existing transaction creates a savepoint that can
// silently swallow the write on MySQL InnoDB, so callers inside a transaction
// must pass tx directly rather than wrapping QueueService.
func nextSeqOnConn(db *gorm.DB, tenantID uint) (int, error) {
	date := today()
	var seq int
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
			INSERT INTO queue_seqs (tenant_id, queue_date, last_seq)
			VALUES (?, ?, 1)
			ON DUPLICATE KEY UPDATE last_seq = last_seq + 1
		`, tenantID, date).Error; err != nil {
			return err
		}
		return tx.Raw(
			"SELECT last_seq FROM queue_seqs WHERE tenant_id = ? AND queue_date = ?",
			tenantID, date,
		).Scan(&seq).Error
	})
	return seq, err
}

// TakeNumberResult wraps the queue entry and optional auto-created patient.
type TakeNumberResult struct {
	Entry          *model.QueueEntry `json:"entry"`
	CreatedPatient *model.Patient    `json:"created_patient,omitempty"`
}

// TakeNumber creates a new waiting queue entry with an auto-generated sequence number.
// If the patient does not exist, auto-creates one with defaults.
// The entire operation runs inside a transaction for atomicity.
func (s *QueueService) TakeNumber(tenantID uint, patientName string, doctorID uint, doctorName, room string, userID uint64) (*TakeNumberResult, error) {
	var result TakeNumberResult

	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		// Check for duplicate: same patient name still active today
		var count int64
		if err := tx.Model(&model.QueueEntry{}).
			Where("tenant_id = ? AND queue_date = ? AND patient_name = ? AND status NOT IN (?, ?)",
				tenantID, today(), patientName, model.QueueStatusDone, model.QueueStatusMissed).
			Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrDuplicatePatient
		}

		// Auto-create patient if not exists
		var patient model.Patient
		err := tx.Where("tenant_id = ? AND name = ?", tenantID, patientName).First(&patient).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				patient = model.Patient{
					TenantID:  uint64(tenantID),
					Name:      patientName,
					Gender:    1, // 男
					Age:       0,
					Birthday:  nil,
					Weight:    0,
					CreatedBy: userID,
				}
				if createErr := tx.Create(&patient).Error; createErr != nil {
					return createErr
				}
				result.CreatedPatient = &patient
			} else {
				return err
			}
		}

		// Get next sequence number (uses raw SQL, operates outside tx scope but is atomic itself)
		seq, err := s.NextSeq(tenantID)
		if err != nil {
			return err
		}

		now := time.Now()
		patientID := uint(patient.ID)
		entry := &model.QueueEntry{
			TenantID:    tenantID,
			PatientID:   &patientID,
			PatientName: patientName,
			DoctorID:    doctorID,
			DoctorName:  doctorName,
			Room:        room,
			SeqNumber:   seq,
			Status:      model.QueueStatusWaiting,
			Source:      "walk_in",
			QueueDate:   today(),
			ArrivalTime: &now,
		}

		if err := tx.Create(entry).Error; err != nil {
			return err
		}
		result.Entry = entry
		return nil
	})

	if txErr != nil {
		return nil, txErr
	}
	return &result, nil
}

// ListToday returns today's queue entries for a tenant, optionally filtered by doctor.
// Results are ordered by seq_number ASC.
func (s *QueueService) ListToday(tenantID uint, doctorID *uint) ([]model.QueueEntry, error) {
	var entries []model.QueueEntry
	q := s.DB.Where("tenant_id = ? AND queue_date = ?", tenantID, today())
	if doctorID != nil {
		q = q.Where("doctor_id = ?", *doctorID)
	}
	err := q.Order("seq_number ASC").Find(&entries).Error
	return entries, err
}

// Call handles a manual call for a queue entry.
//   - Already seeing: re-call, no status change (statusChanged=false).
//   - Waiting + appointment source + checkin_status=pending: notify only, no status change (patient not yet checked in).
//   - Waiting + no one is seeing for this doctor: transition to seeing (statusChanged=true).
//   - Waiting + someone else is already seeing: notify only, no status change (statusChanged=false).
//
// Returns ErrInvalidStatus if the entry is done/missed.
func (s *QueueService) Call(tenantID, entryID uint) (entry *model.QueueEntry, statusChanged bool, err error) {
	var e model.QueueEntry
	if err := s.DB.Where("id = ? AND tenant_id = ? AND queue_date = ?", entryID, tenantID, today()).
		First(&e).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, ErrQueueEntryNotFound
		}
		return nil, false, err
	}

	// Already seeing — re-call, just broadcast notification
	if e.Status == model.QueueStatusSeeing {
		return &e, false, nil
	}

	if e.Status != model.QueueStatusWaiting {
		return nil, false, ErrInvalidStatus
	}

	// Appointment patient not yet checked in — display notification only, no status transition.
	if e.Source == "appointment" && e.CheckinStatus == model.CheckinStatusPending {
		return &e, false, nil
	}

	// Fetch seeing entries and classify inside a transaction to prevent TOCTOU:
	// two concurrent Call requests for the same doctor could both observe zero real
	// seeing entries and both transition to seeing, producing two simultaneous seeing rows.
	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		// Re-fetch target entry inside transaction for consistent snapshot.
		if err := tx.Where("id = ? AND tenant_id = ? AND queue_date = ?", entryID, tenantID, today()).
			First(&e).Error; err != nil {
			return err
		}
		// Re-check guards inside transaction (status may have changed between the outer
		// fetch and now under concurrent load).
		if e.Status == model.QueueStatusSeeing {
			return nil // re-call: statusChanged stays false
		}
		if e.Status != model.QueueStatusWaiting {
			return ErrInvalidStatus
		}
		if e.Source == "appointment" && e.CheckinStatus == model.CheckinStatusPending {
			return nil // unchecked appointment: notify only, no transition
		}

		// Check if anyone is already seeing for this doctor today.
		// Ghost seeing entries (unchecked appointments that ended up in seeing status due to
		// old code) must not block real patients — auto-move them to missed first.
		var seeingEntries []model.QueueEntry
		if err := tx.Where("tenant_id = ? AND queue_date = ? AND doctor_id = ? AND status = ?",
			tenantID, today(), e.DoctorID, model.QueueStatusSeeing).
			Find(&seeingEntries).Error; err != nil {
			return err
		}

		var realSeeing []model.QueueEntry
		var ghostSeeing []model.QueueEntry
		for _, se := range seeingEntries {
			if se.Source == "appointment" && se.CheckinStatus == model.CheckinStatusPending {
				ghostSeeing = append(ghostSeeing, se)
			} else {
				realSeeing = append(realSeeing, se)
			}
		}

		if len(realSeeing) > 0 {
			// A real patient is already being seen — notify only, no status change
			return nil
		}

		// Auto-move ghost seeing entries (unchecked appointments) to missed
		if len(ghostSeeing) > 0 {
			ghostIDs := make([]uint, 0, len(ghostSeeing))
			for _, g := range ghostSeeing {
				ghostIDs = append(ghostIDs, g.ID)
			}
			if err := tx.Model(&model.QueueEntry{}).
				Where("id IN ?", ghostIDs).
				Update("status", model.QueueStatusMissed).Error; err != nil {
				return err
			}
		}

		// No real patient seeing — transition this entry to seeing
		now := time.Now()
		if err := tx.Model(&e).Updates(map[string]interface{}{
			"status":    model.QueueStatusSeeing,
			"called_at": now,
		}).Error; err != nil {
			return err
		}
		e.Status = model.QueueStatusSeeing
		e.CalledAt = &now
		statusChanged = true
		return nil
	})
	if txErr != nil {
		if errors.Is(txErr, ErrInvalidStatus) {
			return nil, false, ErrInvalidStatus
		}
		return nil, false, txErr
	}
	return &e, statusChanged, nil
}

// Complete changes a seeing entry to done and sets CompletedAt.
// It also auto-calls the next waiting patient for the same doctor.
// Returns (completed, nextCalled, error). nextCalled may be nil if no waiting patient exists.
// The entire operation is wrapped in a transaction for atomicity.
func (s *QueueService) Complete(tenantID, entryID uint) (*model.QueueEntry, *model.QueueEntry, error) {
	var entry model.QueueEntry
	err := s.DB.Where("id = ? AND tenant_id = ? AND queue_date = ?", entryID, tenantID, today()).First(&entry).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrQueueEntryNotFound
		}
		return nil, nil, err
	}

	if entry.Status != model.QueueStatusSeeing {
		return nil, nil, ErrInvalidStatus
	}

	var nextPtr *model.QueueEntry

	txErr := s.DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		result := tx.Model(&entry).Updates(map[string]interface{}{
			"status":       model.QueueStatusDone,
			"completed_at": now,
		})
		if result.Error != nil {
			return result.Error
		}
		entry.Status = model.QueueStatusDone
		entry.CompletedAt = &now

		// Auto-call next waiting patient for the same doctor.
		// Skip appointment patients who have not yet checked in.
		var next model.QueueEntry
		err := tx.Where(
			"tenant_id = ? AND queue_date = ? AND doctor_id = ? AND status = ? AND NOT (source = 'appointment' AND checkin_status = ?)",
			tenantID, today(), entry.DoctorID, model.QueueStatusWaiting, model.CheckinStatusPending).
			Order("seq_number ASC").
			First(&next).Error

		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				// No next patient, that's fine
				return nil
			}
			return err
		}

		calledAt := time.Now()
		callResult := tx.Model(&next).Updates(map[string]interface{}{
			"status":    model.QueueStatusSeeing,
			"called_at": calledAt,
		})
		if callResult.Error != nil {
			return callResult.Error
		}
		next.Status = model.QueueStatusSeeing
		next.CalledAt = &calledAt
		nextPtr = &next
		return nil
	})

	if txErr != nil {
		return nil, nil, txErr
	}
	return &entry, nextPtr, nil
}

// Stats returns a count of today's entries grouped by status for a tenant.
func (s *QueueService) Stats(tenantID uint) (map[string]int64, error) {
	type row struct {
		Status string
		Count  int64
	}
	var rows []row
	err := s.DB.Model(&model.QueueEntry{}).
		Select("status, COUNT(*) AS count").
		Where("tenant_id = ? AND queue_date = ?", tenantID, today()).
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	stats := make(map[string]int64)
	for _, r := range rows {
		stats[r.Status] = r.Count
	}
	return stats, nil
}

// Clear deletes all today's queue entries for a tenant.
func (s *QueueService) Clear(tenantID uint) (int64, error) {
	result := s.DB.Unscoped().
		Where("tenant_id = ? AND queue_date = ?", tenantID, today()).
		Delete(&model.QueueEntry{})
	return result.RowsAffected, result.Error
}

// CrossDayCleanup deletes all queue entries with queue_date < today across all tenants.
// Operates in batches of 500 to avoid lock contention.
func (s *QueueService) CrossDayCleanup() (int64, error) {
	var total int64
	for {
		result := s.DB.Unscoped().
			Where("queue_date < ?", today()).
			Limit(500).
			Delete(&model.QueueEntry{})
		if result.Error != nil {
			return total, result.Error
		}
		total += result.RowsAffected
		if result.RowsAffected < 500 {
			break
		}
		time.Sleep(100 * time.Millisecond) // yield lock between batches
	}
	return total, nil
}
