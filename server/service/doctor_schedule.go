package service

import (
	"errors"
	"fmt"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrInvalidRange    = errors.New("range_start 必须 >= 1，且 range_end >= range_start")
	ErrInvalidWeekdays = errors.New("weekdays 必须在 0–127 之间")
)

type UpsertScheduleInput struct {
	Weekdays   uint8 `json:"weekdays"`
	RangeStart int   `json:"range_start"`
	RangeEnd   int   `json:"range_end"`
}

type DoctorScheduleService struct {
	DB *gorm.DB
}

func NewDoctorScheduleService(db *gorm.DB) *DoctorScheduleService {
	return &DoctorScheduleService{DB: db}
}

// defaultSchedule returns an in-memory default config (not persisted).
func defaultSchedule(tenantID, doctorID uint) *model.DoctorScheduleConfig {
	return &model.DoctorScheduleConfig{
		TenantID:   tenantID,
		DoctorID:   doctorID,
		Weekdays:   0b0111110, // Mon–Fri (bits 1-5)
		RangeStart: 1,
		RangeEnd:   30,
	}
}

// Get returns the doctor's schedule config. If not configured, returns default (not persisted, ID=0).
func (s *DoctorScheduleService) Get(tenantID, doctorID uint) (*model.DoctorScheduleConfig, error) {
	var cfg model.DoctorScheduleConfig
	err := s.DB.Where("tenant_id = ? AND doctor_id = ?", tenantID, doctorID).First(&cfg).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return defaultSchedule(tenantID, doctorID), nil
		}
		return nil, fmt.Errorf("get doctor schedule: %w", err)
	}
	return &cfg, nil
}

// Upsert creates or updates the doctor's schedule config.
func (s *DoctorScheduleService) Upsert(tenantID, doctorID uint, in UpsertScheduleInput) (*model.DoctorScheduleConfig, error) {
	if in.Weekdays > 127 {
		return nil, ErrInvalidWeekdays
	}
	if in.RangeStart < 1 || in.RangeEnd < in.RangeStart || in.RangeEnd > 365 {
		return nil, ErrInvalidRange
	}

	var cfg model.DoctorScheduleConfig
	result := s.DB.Where("tenant_id = ? AND doctor_id = ?", tenantID, doctorID).First(&cfg)
	if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("lookup doctor schedule: %w", result.Error)
	}

	cfg.TenantID = tenantID
	cfg.DoctorID = doctorID
	cfg.Weekdays = in.Weekdays
	cfg.RangeStart = in.RangeStart
	cfg.RangeEnd = in.RangeEnd

	if cfg.ID == 0 {
		if err := s.DB.Create(&cfg).Error; err != nil {
			return nil, fmt.Errorf("create doctor schedule: %w", err)
		}
	} else {
		if err := s.DB.Model(&cfg).Updates(map[string]interface{}{
			"weekdays":    in.Weekdays,
			"range_start": in.RangeStart,
			"range_end":   in.RangeEnd,
		}).Error; err != nil {
			return nil, fmt.Errorf("update doctor schedule: %w", err)
		}
	}
	return &cfg, nil
}
