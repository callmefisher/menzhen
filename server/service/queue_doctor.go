package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrQueueDoctorNotFound  = errors.New("queue doctor not found")
	ErrQueueDoctorDuplicate = errors.New("该医生已在接诊列表中，请勿重复添加")
)

// SortOrder is used for batch sort update.
type SortOrder struct {
	ID        uint `json:"id"`
	SortOrder int  `json:"sort_order"`
}

// QueueDoctorService manages the per-tenant list of doctors that can receive queue patients.
type QueueDoctorService struct {
	DB *gorm.DB
}

// NewQueueDoctorService creates a new QueueDoctorService.
func NewQueueDoctorService(db *gorm.DB) *QueueDoctorService {
	return &QueueDoctorService{DB: db}
}

// List returns all doctors for a tenant ordered by sort_order ASC.
func (s *QueueDoctorService) List(tenantID uint) ([]model.QueueDoctor, error) {
	var docs []model.QueueDoctor
	err := s.DB.Where("tenant_id = ?", tenantID).Order("sort_order ASC, id ASC").Find(&docs).Error
	return docs, err
}

// ListEnabled returns only enabled doctors for a tenant, ordered by sort_order ASC.
func (s *QueueDoctorService) ListEnabled(tenantID uint) ([]model.QueueDoctor, error) {
	var docs []model.QueueDoctor
	err := s.DB.Where("tenant_id = ? AND enabled = ?", tenantID, true).Order("sort_order ASC, id ASC").Find(&docs).Error
	return docs, err
}

// Create adds a new doctor to the tenant's queue list.
// Duplicate (same tenant_id + user_id) is rejected.
// sort_order is auto-assigned as max(sort_order)+1 within the tenant.
func (s *QueueDoctorService) Create(doc *model.QueueDoctor) error {
	// Duplicate check
	var count int64
	s.DB.Model(&model.QueueDoctor{}).
		Where("tenant_id = ? AND user_id = ?", doc.TenantID, doc.UserID).
		Count(&count)
	if count > 0 {
		return ErrQueueDoctorDuplicate
	}

	// Auto sort_order: max existing + 1
	var maxOrder int
	s.DB.Model(&model.QueueDoctor{}).
		Where("tenant_id = ?", doc.TenantID).
		Select("COALESCE(MAX(sort_order), 0)").
		Scan(&maxOrder)
	doc.SortOrder = maxOrder + 1

	return s.DB.Create(doc).Error
}

// Update edits the room and enabled status of a doctor entry belonging to the tenant.
// Returns ErrQueueDoctorNotFound when no matching record exists.
func (s *QueueDoctorService) Update(tenantID, id uint, room string, enabled bool) (*model.QueueDoctor, error) {
	var doc model.QueueDoctor
	err := s.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&doc).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrQueueDoctorNotFound
		}
		return nil, err
	}

	if err := s.DB.Model(&doc).Updates(map[string]interface{}{
		"room":    room,
		"enabled": enabled,
	}).Error; err != nil {
		return nil, err
	}

	doc.Room = room
	doc.Enabled = enabled
	return &doc, nil
}

// Delete removes a doctor entry belonging to the tenant.
// Returns ErrQueueDoctorNotFound when no matching record exists.
func (s *QueueDoctorService) Delete(tenantID, id uint) error {
	result := s.DB.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&model.QueueDoctor{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrQueueDoctorNotFound
	}
	return nil
}

// UpdateSort performs a batch update of sort_order values within a transaction.
// Only records belonging to tenantID are updated.
func (s *QueueDoctorService) UpdateSort(tenantID uint, orders []SortOrder) error {
	return s.DB.Transaction(func(tx *gorm.DB) error {
		for _, o := range orders {
			result := tx.Model(&model.QueueDoctor{}).
				Where("id = ? AND tenant_id = ?", o.ID, tenantID).
				Update("sort_order", o.SortOrder)
			if result.Error != nil {
				return result.Error
			}
		}
		return nil
	})
}

// GetQueueEnabled returns whether the queue feature is enabled for the tenant.
// Defaults to true when the field is NULL (e.g. old rows before migration).
func (s *QueueDoctorService) GetQueueEnabled(tenantID uint) (bool, error) {
	var tenant model.Tenant
	err := s.DB.Select("id, queue_enabled").First(&tenant, tenantID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, ErrTenantNotFound
		}
		return false, err
	}
	if tenant.QueueEnabled == nil {
		return true, nil // default true
	}
	return *tenant.QueueEnabled, nil
}

// SetQueueEnabled updates the queue_enabled toggle for the tenant.
func (s *QueueDoctorService) SetQueueEnabled(tenantID uint, enabled bool) error {
	result := s.DB.Model(&model.Tenant{}).Where("id = ?", tenantID).Update("queue_enabled", enabled)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrTenantNotFound
	}
	return nil
}
