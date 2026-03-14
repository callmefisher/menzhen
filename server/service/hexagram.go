package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrHexagramNotFound = errors.New("hexagram not found")

type HexagramService struct {
	DB *gorm.DB
}

func NewHexagramService(db *gorm.DB) *HexagramService {
	return &HexagramService{DB: db}
}

func (s *HexagramService) Search(name, upperTrigram, lowerTrigram string, page, size int) ([]model.Hexagram, int64, error) {
	var items []model.Hexagram
	var total int64

	query := s.DB.Model(&model.Hexagram{})
	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}
	if upperTrigram != "" {
		query = query.Where("upper_trigram = ?", upperTrigram)
	}
	if lowerTrigram != "" {
		query = query.Where("lower_trigram = ?", lowerTrigram)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("number ASC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *HexagramService) ListTrigrams() ([]string, error) {
	return []string{"乾", "坤", "震", "巽", "坎", "离", "艮", "兑"}, nil
}

func (s *HexagramService) GetByID(id uint64) (*model.Hexagram, error) {
	var h model.Hexagram
	if err := s.DB.First(&h, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrHexagramNotFound
		}
		return nil, err
	}
	return &h, nil
}

func (s *HexagramService) Create(h *model.Hexagram) error {
	return s.DB.Create(h).Error
}

func (s *HexagramService) Update(id uint64, updates map[string]interface{}) error {
	var h model.Hexagram
	if err := s.DB.First(&h, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrHexagramNotFound
		}
		return err
	}
	if len(updates) == 0 {
		return nil
	}
	return s.DB.Model(&h).Updates(updates).Error
}

func (s *HexagramService) DeleteByID(id uint64) error {
	var h model.Hexagram
	if err := s.DB.First(&h, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrHexagramNotFound
		}
		return err
	}
	return s.DB.Delete(&h).Error
}
