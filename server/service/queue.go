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
// Uses LAST_INSERT_ID() to avoid TOCTOU race conditions — each connection
// gets its own LAST_INSERT_ID value, so concurrent calls never collide.
func (s *QueueService) NextSeq(tenantID uint) (int, error) {
	date := today()
	err := s.DB.Exec(
		`INSERT INTO queue_seqs (tenant_id, queue_date, last_seq)
		 VALUES (?, ?, LAST_INSERT_ID(1))
		 ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)`,
		tenantID, date,
	).Error
	if err != nil {
		return 0, err
	}

	var seq int
	err = s.DB.Raw("SELECT LAST_INSERT_ID()").Scan(&seq).Error
	if err != nil {
		return 0, err
	}
	return seq, nil
}

// TakeNumber creates a new waiting queue entry with an auto-generated sequence number.
func (s *QueueService) TakeNumber(tenantID uint, patientName string, doctorID uint, doctorName, room string) (*model.QueueEntry, error) {
	seq, err := s.NextSeq(tenantID)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	entry := &model.QueueEntry{
		TenantID:    tenantID,
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

	if err := s.DB.Create(entry).Error; err != nil {
		return nil, err
	}
	return entry, nil
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

// Call changes a waiting entry to seeing and sets CalledAt.
// Returns ErrInvalidStatus if the entry is not in waiting status.
func (s *QueueService) Call(tenantID, entryID uint) (*model.QueueEntry, error) {
	var entry model.QueueEntry
	err := s.DB.Where("id = ? AND tenant_id = ? AND queue_date = ?", entryID, tenantID, today()).First(&entry).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrQueueEntryNotFound
		}
		return nil, err
	}

	if entry.Status != model.QueueStatusWaiting {
		return nil, ErrInvalidStatus
	}

	now := time.Now()
	result := s.DB.Model(&entry).Updates(map[string]interface{}{
		"status":    model.QueueStatusSeeing,
		"called_at": now,
	})
	if result.Error != nil {
		return nil, result.Error
	}

	entry.Status = model.QueueStatusSeeing
	entry.CalledAt = &now
	return &entry, nil
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

		// Auto-call next waiting patient for the same doctor
		var next model.QueueEntry
		err := tx.Where("tenant_id = ? AND queue_date = ? AND doctor_id = ? AND status = ?",
			tenantID, today(), entry.DoctorID, model.QueueStatusWaiting).
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
