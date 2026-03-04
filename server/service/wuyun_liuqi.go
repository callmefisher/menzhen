package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrWuyunLiuqiNotFound = errors.New("wuyun liuqi not found")

// WuyunLiuqiService handles CRUD and AI queries for Five Phases and Six Qi data.
type WuyunLiuqiService struct {
	DB       *gorm.DB
	DeepSeek *DeepSeekService
}

func NewWuyunLiuqiService(db *gorm.DB, ds *DeepSeekService) *WuyunLiuqiService {
	return &WuyunLiuqiService{DB: db, DeepSeek: ds}
}

// GetByYear returns cached data for the year, or nil if not found.
func (s *WuyunLiuqiService) GetByYear(year int) (*model.WuyunLiuqi, error) {
	var record model.WuyunLiuqi
	if err := s.DB.Where("year = ?", year).First(&record).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &record, nil
}

// GetByID returns a record by primary key.
func (s *WuyunLiuqiService) GetByID(id uint64) (*model.WuyunLiuqi, error) {
	var record model.WuyunLiuqi
	if err := s.DB.First(&record, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrWuyunLiuqiNotFound
		}
		return nil, err
	}
	return &record, nil
}

// SaveFromAI saves or updates an AI-generated result for a year.
func (s *WuyunLiuqiService) SaveFromAI(year int, content string, userID uint64) (*model.WuyunLiuqi, error) {
	var existing model.WuyunLiuqi
	if err := s.DB.Where("year = ?", year).First(&existing).Error; err == nil {
		// Update existing
		s.DB.Model(&existing).Updates(map[string]interface{}{
			"content":    content,
			"source":     "ai",
			"updated_by": userID,
		})
		existing.Content = content
		existing.Source = "ai"
		return &existing, nil
	}

	record := model.WuyunLiuqi{
		Year:      year,
		Content:   content,
		Source:    "ai",
		UpdatedBy: userID,
	}
	if err := s.DB.Create(&record).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

// Update updates a record's content (manual edit).
func (s *WuyunLiuqiService) Update(id uint64, content string, userID uint64) error {
	var record model.WuyunLiuqi
	if err := s.DB.First(&record, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrWuyunLiuqiNotFound
		}
		return err
	}
	return s.DB.Model(&record).Updates(map[string]interface{}{
		"content":    content,
		"source":     "manual",
		"updated_by": userID,
	}).Error
}

// Delete deletes a record by ID.
func (s *WuyunLiuqiService) Delete(id uint64) error {
	result := s.DB.Delete(&model.WuyunLiuqi{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrWuyunLiuqiNotFound
	}
	return nil
}
