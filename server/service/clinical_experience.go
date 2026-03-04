package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrClinicalExperienceNotFound = errors.New("clinical experience not found")

type ClinicalExperienceService struct {
	DB *gorm.DB
}

func NewClinicalExperienceService(db *gorm.DB) *ClinicalExperienceService {
	return &ClinicalExperienceService{DB: db}
}

func (s *ClinicalExperienceService) Search(keyword, category string, page, size int) ([]model.ClinicalExperience, int64, error) {
	var items []model.ClinicalExperience
	var total int64

	query := s.DB.Model(&model.ClinicalExperience{})
	if keyword != "" {
		query = query.Where("source LIKE ? OR herbs LIKE ? OR formula LIKE ? OR experience LIKE ?",
			"%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
	}
	if category != "" {
		query = query.Where("category = ?", category)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *ClinicalExperienceService) ListCategories() ([]string, error) {
	var categories []string
	err := s.DB.Model(&model.ClinicalExperience{}).
		Where("category != ''").
		Distinct("category").
		Order("category").
		Pluck("category", &categories).Error
	return categories, err
}

func (s *ClinicalExperienceService) GetByID(id uint64) (*model.ClinicalExperience, error) {
	var item model.ClinicalExperience
	if err := s.DB.First(&item, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrClinicalExperienceNotFound
		}
		return nil, err
	}
	return &item, nil
}

func (s *ClinicalExperienceService) Create(item *model.ClinicalExperience) error {
	return s.DB.Create(item).Error
}

func (s *ClinicalExperienceService) Update(id uint64, updates map[string]interface{}) error {
	var item model.ClinicalExperience
	if err := s.DB.First(&item, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrClinicalExperienceNotFound
		}
		return err
	}
	if len(updates) == 0 {
		return nil
	}
	return s.DB.Model(&item).Updates(updates).Error
}

func (s *ClinicalExperienceService) DeleteByID(id uint64) error {
	result := s.DB.Delete(&model.ClinicalExperience{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrClinicalExperienceNotFound
	}
	return nil
}
