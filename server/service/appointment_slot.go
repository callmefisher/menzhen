package service

import (
	"errors"
	"fmt"
	"regexp"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrSlotConfigNotFound = errors.New("time slot config not found")
	ErrInvalidTimeFormat  = errors.New("时间格式无效，请使用 HH:MM 格式")
	ErrSlotEndBeforeStart = errors.New("结束时间必须晚于开始时间")
	ErrSlotOverlap        = errors.New("时间段与已有配置重叠")
)

var timeRe = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

type SlotConfigService struct {
	DB *gorm.DB
}

func NewSlotConfigService(db *gorm.DB) *SlotConfigService {
	return &SlotConfigService{DB: db}
}

type UpsertSlotInput struct {
	DoctorID  uint
	SlotStart string
	SlotEnd   string
	MaxCount  int
}

func validateSlotTime(start, end string) error {
	if !timeRe.MatchString(start) || !timeRe.MatchString(end) {
		return ErrInvalidTimeFormat
	}
	if start >= end {
		return ErrSlotEndBeforeStart
	}
	return nil
}

func (s *SlotConfigService) List(tenantID uint, doctorID *uint) ([]model.AppointmentSlotConfig, error) {
	q := s.DB.Where("tenant_id = ?", tenantID)
	if doctorID != nil {
		q = q.Where("doctor_id = ?", *doctorID)
	}
	var list []model.AppointmentSlotConfig
	if err := q.Order("doctor_id ASC, slot_start ASC").Find(&list).Error; err != nil {
		return nil, fmt.Errorf("list slot configs: %w", err)
	}
	return list, nil
}

func (s *SlotConfigService) checkOverlap(tenantID, doctorID uint, start, end string, excludeID *uint) error {
	q := s.DB.Model(&model.AppointmentSlotConfig{}).
		Where("tenant_id = ? AND doctor_id = ? AND slot_start < ? AND slot_end > ?",
			tenantID, doctorID, end, start)
	if excludeID != nil {
		q = q.Where("id != ?", *excludeID)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return fmt.Errorf("check slot overlap: %w", err)
	}
	if count > 0 {
		return ErrSlotOverlap
	}
	return nil
}

func (s *SlotConfigService) Create(tenantID uint, in UpsertSlotInput) (*model.AppointmentSlotConfig, error) {
	if err := validateSlotTime(in.SlotStart, in.SlotEnd); err != nil {
		return nil, err
	}
	if err := s.checkOverlap(tenantID, in.DoctorID, in.SlotStart, in.SlotEnd, nil); err != nil {
		return nil, err
	}
	if in.MaxCount <= 0 {
		in.MaxCount = 1
	}
	cfg := &model.AppointmentSlotConfig{
		TenantID:  tenantID,
		DoctorID:  in.DoctorID,
		SlotStart: in.SlotStart,
		SlotEnd:   in.SlotEnd,
		MaxCount:  in.MaxCount,
	}
	if err := s.DB.Create(cfg).Error; err != nil {
		return nil, fmt.Errorf("create slot config: %w", err)
	}
	return cfg, nil
}

func (s *SlotConfigService) Update(tenantID, id uint, in UpsertSlotInput) (*model.AppointmentSlotConfig, error) {
	if err := validateSlotTime(in.SlotStart, in.SlotEnd); err != nil {
		return nil, err
	}
	if in.MaxCount <= 0 {
		in.MaxCount = 1
	}
	var cfg model.AppointmentSlotConfig
	if err := s.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&cfg).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSlotConfigNotFound
		}
		return nil, fmt.Errorf("load slot config: %w", err)
	}
	if err := s.checkOverlap(tenantID, cfg.DoctorID, in.SlotStart, in.SlotEnd, &id); err != nil {
		return nil, err
	}
	if err := s.DB.Model(&cfg).Updates(map[string]interface{}{
		"slot_start": in.SlotStart,
		"slot_end":   in.SlotEnd,
		"max_count":  in.MaxCount,
	}).Error; err != nil {
		return nil, fmt.Errorf("update slot config: %w", err)
	}
	return &cfg, nil
}

func (s *SlotConfigService) Delete(tenantID, id uint) error {
	result := s.DB.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&model.AppointmentSlotConfig{})
	if result.Error != nil {
		return fmt.Errorf("delete slot config: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrSlotConfigNotFound
	}
	return nil
}
