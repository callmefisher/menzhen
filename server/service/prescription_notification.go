package service

import (
	"errors"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrNotificationNotFound = errors.New("notification not found")
	ErrAlreadyDone          = errors.New("already marked as done")
)

type PrescriptionNotificationService struct {
	DB *gorm.DB
}

func NewPrescriptionNotificationService(db *gorm.DB) *PrescriptionNotificationService {
	return &PrescriptionNotificationService{DB: db}
}

// Create creates a notification (called after stock deduction)
func (s *PrescriptionNotificationService) Create(n *model.PrescriptionNotification) error {
	return s.DB.Create(n).Error
}

// ListByTenant returns notifications for a tenant (uses covering index)
func (s *PrescriptionNotificationService) ListByTenant(tenantID uint64, status string) ([]model.PrescriptionNotification, error) {
	var list []model.PrescriptionNotification
	q := s.DB.Where("tenant_id = ?", tenantID)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	// 24h data is small, full list avoids pagination complexity
	err := q.Order("created_at DESC").Limit(200).Find(&list).Error
	return list, err
}

// PendingCount returns count of pending notifications (for red badge, uses covering index)
func (s *PrescriptionNotificationService) PendingCount(tenantID uint64) (int64, error) {
	var count int64
	err := s.DB.Model(&model.PrescriptionNotification{}).
		Where("tenant_id = ? AND status = 'pending'", tenantID).
		Count(&count).Error
	return count, err
}

// MarkDone marks a single notification as done
func (s *PrescriptionNotificationService) MarkDone(tenantID, id, userID uint64, userName string) error {
	now := time.Now()
	result := s.DB.Model(&model.PrescriptionNotification{}).
		Where("id = ? AND tenant_id = ? AND status = 'pending'", id, tenantID).
		Updates(map[string]interface{}{"status": "done", "done_at": now, "done_by": userID, "done_by_name": userName})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotificationNotFound
	}
	return nil
}

// BatchMarkDone marks all pending notifications as done for a tenant
func (s *PrescriptionNotificationService) BatchMarkDone(tenantID, userID uint64, userName string) (int64, error) {
	now := time.Now()
	result := s.DB.Model(&model.PrescriptionNotification{}).
		Where("tenant_id = ? AND status = 'pending'", tenantID).
		Updates(map[string]interface{}{"status": "done", "done_at": now, "done_by": userID, "done_by_name": userName})
	return result.RowsAffected, result.Error
}

// DispenseDetailItem represents a single herb/patent in dispense detail
type DispenseDetailItem struct {
	ShelfNo  string `json:"shelf_no"`
	HerbName string `json:"herb_name"`
	Dosage   string `json:"dosage"`
	Notes    string `json:"notes"`
	Category string `json:"category"`
}

// DispenseDetail is the full dispense card data
type DispenseDetail struct {
	Notification model.PrescriptionNotification `json:"notification"`
	Herbs        []DispenseDetailItem           `json:"herbs"`
	Patents      []DispenseDetailItem           `json:"patents"`
}

// GetDetail returns the full dispense detail (notification + items with shelf numbers)
// Uses WHERE IN to batch-fetch shelf numbers, avoiding N+1 queries
func (s *PrescriptionNotificationService) GetDetail(tenantID, id uint64) (*DispenseDetail, error) {
	var n model.PrescriptionNotification
	if err := s.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&n).Error; err != nil {
		return nil, ErrNotificationNotFound
	}

	// Get prescription items
	var items []model.PrescriptionItem
	s.DB.Where("prescription_id = ?", n.PrescriptionID).Order("sort_order ASC").Limit(100).Find(&items)

	if len(items) == 0 {
		return &DispenseDetail{Notification: n}, nil
	}

	// Batch fetch shelf numbers (WHERE IN avoids N+1)
	names := make([]string, len(items))
	for i, it := range items {
		names[i] = it.HerbName
	}
	type shelfRow struct {
		Name    string
		ShelfNo string
	}
	var shelves []shelfRow
	s.DB.Model(&model.InventoryDrug{}).
		Select("name, shelf_no").
		Where("tenant_id = ? AND name IN ?", tenantID, names).
		Find(&shelves)

	shelfMap := make(map[string]string, len(shelves))
	for _, r := range shelves {
		shelfMap[r.Name] = r.ShelfNo
	}

	detail := &DispenseDetail{Notification: n}
	for _, it := range items {
		d := DispenseDetailItem{
			ShelfNo:  shelfMap[it.HerbName],
			HerbName: it.HerbName,
			Dosage:   it.Dosage,
			Notes:    it.Notes,
			Category: it.Category,
		}
		if it.Category == "patent" {
			detail.Patents = append(detail.Patents, d)
		} else {
			detail.Herbs = append(detail.Herbs, d)
		}
	}
	return detail, nil
}

// Cleanup deletes records older than 24h in batches to avoid lock contention on large tables
func (s *PrescriptionNotificationService) Cleanup() (int64, error) {
	cutoff := time.Now().Add(-24 * time.Hour)
	var total int64
	for {
		result := s.DB.Unscoped().
			Where("created_at < ?", cutoff).
			Limit(500).
			Delete(&model.PrescriptionNotification{})
		if result.Error != nil {
			return total, result.Error
		}
		total += result.RowsAffected
		if result.RowsAffected < 500 {
			break
		}
		time.Sleep(100 * time.Millisecond) // yield lock
	}
	return total, nil
}
