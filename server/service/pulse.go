package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrPulseNotFound = errors.New("pulse not found")

type PulseService struct {
	DB *gorm.DB
}

func NewPulseService(db *gorm.DB) *PulseService {
	return &PulseService{DB: db}
}

func (s *PulseService) Search(name, category string, page, size int) ([]model.Pulse, int64, error) {
	var pulses []model.Pulse
	var total int64

	query := s.DB.Model(&model.Pulse{})
	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}
	if category != "" {
		query = query.Where("category = ?", category)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("id ASC").Offset((page - 1) * size).Limit(size).Find(&pulses).Error; err != nil {
		return nil, 0, err
	}
	return pulses, total, nil
}

func (s *PulseService) ListCategories() ([]string, error) {
	var categories []string
	err := s.DB.Model(&model.Pulse{}).
		Where("category != ''").
		Distinct("category").
		Order("category").
		Pluck("category", &categories).Error
	return categories, err
}

func (s *PulseService) GetByID(id uint64) (*model.Pulse, error) {
	var pulse model.Pulse
	if err := s.DB.First(&pulse, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPulseNotFound
		}
		return nil, err
	}
	return &pulse, nil
}

func (s *PulseService) Create(pulse *model.Pulse) error {
	return s.DB.Create(pulse).Error
}

func (s *PulseService) Update(id uint64, updates map[string]interface{}) error {
	var pulse model.Pulse
	if err := s.DB.First(&pulse, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPulseNotFound
		}
		return err
	}
	if len(updates) == 0 {
		return nil
	}
	return s.DB.Model(&pulse).Updates(updates).Error
}

func (s *PulseService) DeleteByID(id uint64) error {
	result := s.DB.Delete(&model.Pulse{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrPulseNotFound
	}
	return nil
}
