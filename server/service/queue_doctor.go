package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrQueueDoctorNotFound        = errors.New("queue doctor not found")
	ErrQueueDoctorDuplicate       = errors.New("该医生已在接诊列表中，请勿重复添加")
	ErrCallDurationOutOfRange     = errors.New("叫号显示时长必须在 3～60 秒之间")
	ErrSlotMinutesOutOfRange      = errors.New("时间粒度必须为 5、10、15、30 或 60 分钟")
	ErrMaxPerSlotOutOfRange       = errors.New("每时段最大预约数必须在 1～100 之间")
	ErrAdvanceDaysOutOfRange      = errors.New("可提前预约天数必须在 1～30 之间")
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
	return s.DB.Transaction(func(tx *gorm.DB) error {
		// Duplicate check
		var count int64
		if err := tx.Model(&model.QueueDoctor{}).
			Where("tenant_id = ? AND user_id = ?", doc.TenantID, doc.UserID).
			Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrQueueDoctorDuplicate
		}

		// Auto sort_order: max existing + 1
		var maxOrder int
		if err := tx.Model(&model.QueueDoctor{}).
			Where("tenant_id = ?", doc.TenantID).
			Select("COALESCE(MAX(sort_order), 0)").
			Scan(&maxOrder).Error; err != nil {
			return err
		}
		doc.SortOrder = maxOrder + 1

		return tx.Create(doc).Error
	})
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

// GetCallDisplayDuration returns the call overlay display duration in seconds for the tenant.
// Defaults to 10 when the column is NULL.
func (s *QueueDoctorService) GetCallDisplayDuration(tenantID uint) (int, error) {
	var tenant model.Tenant
	err := s.DB.Select("id, call_display_duration").First(&tenant, tenantID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, ErrTenantNotFound
		}
		return 0, err
	}
	if tenant.CallDisplayDuration == nil {
		return 6, nil
	}
	return *tenant.CallDisplayDuration, nil
}

// SetCallDisplayDuration updates the call overlay display duration for the tenant.
// Valid range is 3–60 seconds.
func (s *QueueDoctorService) SetCallDisplayDuration(tenantID uint, seconds int) error {
	if seconds < 3 || seconds > 60 {
		return ErrCallDurationOutOfRange
	}
	result := s.DB.Model(&model.Tenant{}).Where("id = ?", tenantID).Update("call_display_duration", seconds)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrTenantNotFound
	}
	return nil
}

// GetShowArrivalTime returns whether arrival time badges are shown for the tenant.
// Defaults to true when the field is NULL.
func (s *QueueDoctorService) GetShowArrivalTime(tenantID uint) (bool, error) {
	var tenant model.Tenant
	err := s.DB.Select("id, show_arrival_time").First(&tenant, tenantID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, ErrTenantNotFound
		}
		return false, err
	}
	if tenant.ShowArrivalTime == nil {
		return true, nil // default true
	}
	return *tenant.ShowArrivalTime, nil
}

// SetShowArrivalTime updates the show_arrival_time toggle for the tenant.
func (s *QueueDoctorService) SetShowArrivalTime(tenantID uint, show bool) error {
	result := s.DB.Model(&model.Tenant{}).Where("id = ?", tenantID).Update("show_arrival_time", show)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrTenantNotFound
	}
	return nil
}

// GetAppointmentEnabled returns whether the appointment feature is enabled for the tenant.
// Defaults to true when the field is NULL.
func (s *QueueDoctorService) GetAppointmentEnabled(tenantID uint) (bool, error) {
	var tenant model.Tenant
	err := s.DB.Select("id, appointment_enabled").First(&tenant, tenantID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, ErrTenantNotFound
		}
		return false, err
	}
	if tenant.AppointmentEnabled == nil {
		return true, nil // default true
	}
	return *tenant.AppointmentEnabled, nil
}

// SetAppointmentEnabled updates the appointment_enabled toggle for the tenant.
func (s *QueueDoctorService) SetAppointmentEnabled(tenantID uint, enabled bool) error {
	result := s.DB.Model(&model.Tenant{}).Where("id = ?", tenantID).Update("appointment_enabled", enabled)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrTenantNotFound
	}
	return nil
}

// GetCallSoundEnabled returns whether call sound broadcast is enabled for the tenant.
// Defaults to true when the field is NULL.
func (s *QueueDoctorService) GetCallSoundEnabled(tenantID uint) (bool, error) {
	var tenant model.Tenant
	err := s.DB.Select("id, call_sound_enabled").First(&tenant, tenantID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, ErrTenantNotFound
		}
		return false, err
	}
	if tenant.CallSoundEnabled == nil {
		return true, nil // default true
	}
	return *tenant.CallSoundEnabled, nil
}

// SetCallSoundEnabled updates the call_sound_enabled toggle for the tenant.
func (s *QueueDoctorService) SetCallSoundEnabled(tenantID uint, enabled bool) error {
	result := s.DB.Model(&model.Tenant{}).Where("id = ?", tenantID).Update("call_sound_enabled", enabled)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrTenantNotFound
	}
	return nil
}

// AppointmentConfig holds the global appointment parameters for a tenant.
type AppointmentConfig struct {
	SlotMinutes  int `json:"slot_minutes"`
	MaxPerSlot   int `json:"max_appt_per_slot"`
	AdvanceDays  int `json:"advance_days"`
}

// GetAppointmentConfig returns the global appointment parameters for the tenant.
// Falls back to defaults when fields are NULL.
func (s *QueueDoctorService) GetAppointmentConfig(tenantID uint) (AppointmentConfig, error) {
	var tenant model.Tenant
	err := s.DB.Select("id, appointment_slot_minutes, appointment_max_per_slot, appointment_advance_days").
		First(&tenant, tenantID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return AppointmentConfig{}, ErrTenantNotFound
		}
		return AppointmentConfig{}, err
	}
	cfg := AppointmentConfig{
		SlotMinutes: 30,
		MaxPerSlot:  1,
		AdvanceDays: 30,
	}
	if tenant.AppointmentSlotMinutes != nil {
		cfg.SlotMinutes = *tenant.AppointmentSlotMinutes
	}
	if tenant.AppointmentMaxPerSlot != nil {
		cfg.MaxPerSlot = *tenant.AppointmentMaxPerSlot
	}
	if tenant.AppointmentAdvanceDays != nil {
		cfg.AdvanceDays = *tenant.AppointmentAdvanceDays
	}
	return cfg, nil
}

// SetAppointmentConfig updates the global appointment parameters for the tenant.
func (s *QueueDoctorService) SetAppointmentConfig(tenantID uint, cfg AppointmentConfig) error {
	validSlots := map[int]bool{5: true, 10: true, 15: true, 30: true, 60: true}
	if !validSlots[cfg.SlotMinutes] {
		return ErrSlotMinutesOutOfRange
	}
	if cfg.MaxPerSlot < 1 || cfg.MaxPerSlot > 100 {
		return ErrMaxPerSlotOutOfRange
	}
	if cfg.AdvanceDays < 1 || cfg.AdvanceDays > 30 {
		return ErrAdvanceDaysOutOfRange
	}
	result := s.DB.Model(&model.Tenant{}).Where("id = ?", tenantID).Updates(map[string]interface{}{
		"appointment_slot_minutes":  cfg.SlotMinutes,
		"appointment_max_per_slot":  cfg.MaxPerSlot,
		"appointment_advance_days":  cfg.AdvanceDays,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrTenantNotFound
	}
	return nil
}
