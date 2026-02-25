package service

import (
	"errors"
	"log"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrHerbNotFound = errors.New("herb not found")

// HerbService handles herb-related business logic.
type HerbService struct {
	DB       *gorm.DB
	DeepSeek *DeepSeekService
}

// NewHerbService creates a new HerbService.
func NewHerbService(db *gorm.DB, ds *DeepSeekService) *HerbService {
	return &HerbService{DB: db, DeepSeek: ds}
}

// Search searches herbs by name and/or category with pagination.
// If name search yields no DB results and DeepSeek is enabled, queries AI as fallback.
func (s *HerbService) Search(name, category string, page, size int) ([]model.Herb, int64, error) {
	var herbs []model.Herb
	var total int64

	query := s.DB.Model(&model.Herb{})

	if name != "" {
		query = query.Where("name LIKE ? OR alias LIKE ?", "%"+name+"%", "%"+name+"%")
	}
	if category != "" {
		query = query.Where("category = ?", category)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("id ASC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&herbs).Error; err != nil {
		return nil, 0, err
	}

	// If name search yielded no results and no category filter, try DeepSeek
	if total == 0 && name != "" && category == "" && s.DeepSeek != nil && s.DeepSeek.IsEnabled() {
		herb, err := s.queryAndSaveFromAI(name)
		if err != nil {
			log.Printf("DeepSeek herb query failed for %q: %v", name, err)
			return herbs, 0, nil
		}
		return []model.Herb{*herb}, 1, nil
	}

	return herbs, total, nil
}

// GetByID retrieves a single herb by ID.
func (s *HerbService) GetByID(id uint64) (*model.Herb, error) {
	var herb model.Herb
	if err := s.DB.First(&herb, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrHerbNotFound
		}
		return nil, err
	}
	return &herb, nil
}

// isValidHerbResult checks whether the AI result contains meaningful herb data.
// A valid herb must have at least effects or indications.
func isValidHerbResult(result *HerbAIResult) bool {
	return result.Effects != "" || result.Indications != ""
}

// DeleteByID deletes a herb by ID.
func (s *HerbService) DeleteByID(id uint64) error {
	result := s.DB.Delete(&model.Herb{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrHerbNotFound
	}
	return nil
}

// queryAndSaveFromAI queries DeepSeek for herb info. Only saves valid results to DB.
func (s *HerbService) queryAndSaveFromAI(name string) (*model.Herb, error) {
	result, err := s.DeepSeek.QueryHerb(name)
	if err != nil {
		return nil, err
	}

	herb := model.Herb{
		Name:        result.Name,
		Alias:       result.Alias,
		Category:    result.Category,
		Properties:  result.Properties,
		Effects:     result.Effects,
		Indications: result.Indications,
		Source:      "deepseek",
	}

	// Only save valid results (with meaningful herb data) to the database
	if !isValidHerbResult(result) {
		log.Printf("AI herb result for %q is invalid (no effects/indications), skipping save", name)
		return &herb, nil
	}

	if err := s.DB.Create(&herb).Error; err != nil {
		// If duplicate (race condition), fetch existing
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			var existing model.Herb
			if err := s.DB.Where("name = ?", result.Name).First(&existing).Error; err == nil {
				return &existing, nil
			}
		}
		log.Printf("Failed to save AI herb result: %v", err)
		// Return the herb data even if save failed
		return &herb, nil
	}

	return &herb, nil
}
