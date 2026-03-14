package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrSolarTermNotFound = errors.New("solar term not found")

type SolarTermService struct {
	DB *gorm.DB
}

func NewSolarTermService(db *gorm.DB) *SolarTermService {
	return &SolarTermService{DB: db}
}

// List returns all 24 solar terms ordered by order_index ASC.
func (s *SolarTermService) List() ([]model.SolarTerm, error) {
	var terms []model.SolarTerm
	if err := s.DB.Order("order_index ASC").Find(&terms).Error; err != nil {
		return nil, err
	}
	return terms, nil
}

// GetByID returns a single solar term by ID.
func (s *SolarTermService) GetByID(id uint64) (*model.SolarTerm, error) {
	var term model.SolarTerm
	if err := s.DB.First(&term, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSolarTermNotFound
		}
		return nil, err
	}
	return &term, nil
}

// UpdateContent updates the content field of a solar term and returns the updated term.
func (s *SolarTermService) UpdateContent(id uint64, content string) (*model.SolarTerm, error) {
	var term model.SolarTerm
	if err := s.DB.First(&term, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSolarTermNotFound
		}
		return nil, err
	}
	if err := s.DB.Model(&term).Update("content", content).Error; err != nil {
		return nil, err
	}
	return &term, nil
}

// DeleteContent clears the content field to an empty string.
func (s *SolarTermService) DeleteContent(id uint64) error {
	var term model.SolarTerm
	if err := s.DB.First(&term, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSolarTermNotFound
		}
		return err
	}
	return s.DB.Model(&term).Update("content", "").Error
}
