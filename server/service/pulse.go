package service

import (
	"errors"
	"log"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrPulseNotFound = errors.New("pulse not found")

type PulseService struct {
	DB       *gorm.DB
	DeepSeek *DeepSeekService
}

func NewPulseService(db *gorm.DB, ds *DeepSeekService) *PulseService {
	return &PulseService{DB: db, DeepSeek: ds}
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

	// If name search yielded no results and no category filter, try DeepSeek
	if total == 0 && name != "" && category == "" && s.DeepSeek != nil && s.DeepSeek.IsEnabled() {
		pulse, err := s.queryAndSaveFromAI(name)
		if err != nil {
			log.Printf("DeepSeek pulse query failed for %q: %v", name, err)
			return pulses, 0, nil
		}
		return []model.Pulse{*pulse}, 1, nil
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

func isValidPulseResult(result *PulseAIResult) bool {
	return result.Description != "" || result.ClinicalMeaning != ""
}

func (s *PulseService) queryAndSaveFromAI(name string) (*model.Pulse, error) {
	result, err := s.DeepSeek.QueryPulse(name)
	if err != nil {
		return nil, err
	}

	pulse := model.Pulse{
		Name:             result.Name,
		Category:         result.Category,
		Description:      result.Description,
		ClinicalMeaning:  result.ClinicalMeaning,
		CommonConditions: result.CommonConditions,
	}

	if !isValidPulseResult(result) {
		log.Printf("AI pulse result for %q is invalid, skipping save", name)
		return &pulse, nil
	}

	if err := s.DB.Create(&pulse).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			var existing model.Pulse
			if err := s.DB.Where("name = ?", result.Name).First(&existing).Error; err == nil {
				return &existing, nil
			}
		}
		log.Printf("Failed to save AI pulse result: %v", err)
		return &pulse, nil
	}

	return &pulse, nil
}
