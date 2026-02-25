package service

import (
	"errors"
	"log"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrFormulaNotFound = errors.New("formula not found")

// FormulaService handles formula-related business logic.
type FormulaService struct {
	DB       *gorm.DB
	DeepSeek *DeepSeekService
}

// NewFormulaService creates a new FormulaService.
func NewFormulaService(db *gorm.DB, ds *DeepSeekService) *FormulaService {
	return &FormulaService{DB: db, DeepSeek: ds}
}

// Search searches formulas by name with pagination.
// If name search yields no DB results and DeepSeek is enabled, queries AI as fallback.
func (s *FormulaService) Search(name string, page, size int) ([]model.Formula, int64, error) {
	var formulas []model.Formula
	var total int64

	query := s.DB.Model(&model.Formula{})

	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("id ASC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&formulas).Error; err != nil {
		return nil, 0, err
	}

	// If name search yielded no results, try DeepSeek
	if total == 0 && name != "" && s.DeepSeek != nil && s.DeepSeek.IsEnabled() {
		formula, err := s.queryAndSaveFromAI(name)
		if err != nil {
			log.Printf("DeepSeek formula query failed for %q: %v", name, err)
			return formulas, 0, nil
		}
		return []model.Formula{*formula}, 1, nil
	}

	return formulas, total, nil
}

// GetByID retrieves a single formula by ID.
func (s *FormulaService) GetByID(id uint64) (*model.Formula, error) {
	var formula model.Formula
	if err := s.DB.First(&formula, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrFormulaNotFound
		}
		return nil, err
	}
	return &formula, nil
}

// DeleteByID deletes a formula by ID.
func (s *FormulaService) DeleteByID(id uint64) error {
	result := s.DB.Delete(&model.Formula{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrFormulaNotFound
	}
	return nil
}

// UpdateComposition updates the composition of a formula by ID.
func (s *FormulaService) UpdateComposition(id uint64, composition model.FormulaComposition) error {
	var formula model.Formula
	if err := s.DB.First(&formula, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrFormulaNotFound
		}
		return err
	}
	return s.DB.Model(&formula).Update("composition", composition).Error
}

// isValidFormulaResult checks whether the AI result contains a valid formula.
// A valid formula must have at least one composition item (herb).
func isValidFormulaResult(result *FormulaAIResult) bool {
	return len(result.Composition) > 0
}

// queryAndSaveFromAI queries DeepSeek for formula info. Only saves valid results to DB.
func (s *FormulaService) queryAndSaveFromAI(name string) (*model.Formula, error) {
	result, err := s.DeepSeek.QueryFormula(name)
	if err != nil {
		return nil, err
	}

	composition := make(model.FormulaComposition, 0, len(result.Composition))
	for _, c := range result.Composition {
		composition = append(composition, model.FormulaCompositionItem{
			HerbName:      c.HerbName,
			DefaultDosage: c.DefaultDosage,
		})
	}

	formula := model.Formula{
		Name:        result.Name,
		Effects:     result.Effects,
		Indications: result.Indications,
		Composition: composition,
		Source:      "deepseek",
	}

	// Only save valid results (with herb composition) to the database
	if !isValidFormulaResult(result) {
		log.Printf("AI formula result for %q is invalid (no composition), skipping save", name)
		return &formula, nil
	}

	if err := s.DB.Create(&formula).Error; err != nil {
		// If duplicate (race condition), fetch existing
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			var existing model.Formula
			if err := s.DB.Where("name = ?", result.Name).First(&existing).Error; err == nil {
				return &existing, nil
			}
		}
		log.Printf("Failed to save AI formula result: %v", err)
		return &formula, nil
	}

	return &formula, nil
}
