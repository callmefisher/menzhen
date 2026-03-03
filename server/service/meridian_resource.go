package service

import (
	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

// MeridianResourceService handles CRUD operations for meridian resources.
type MeridianResourceService struct {
	DB *gorm.DB
}

// NewMeridianResourceService creates a new MeridianResourceService.
func NewMeridianResourceService(db *gorm.DB) *MeridianResourceService {
	return &MeridianResourceService{DB: db}
}

// GetByMeridianID returns the resource for the given meridian, or nil if none exists.
func (s *MeridianResourceService) GetByMeridianID(meridianID string) (*model.MeridianResource, error) {
	var res model.MeridianResource
	err := s.DB.Where("meridian_id = ?", meridianID).First(&res).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	return &res, err
}

// Upsert creates or updates a meridian resource row.
func (s *MeridianResourceService) Upsert(meridianID string, videoURL string, sourceText string, userID uint64) (*model.MeridianResource, error) {
	var res model.MeridianResource
	err := s.DB.Where("meridian_id = ?", meridianID).First(&res).Error

	if err == gorm.ErrRecordNotFound {
		res = model.MeridianResource{
			MeridianID: meridianID,
			VideoURL:   videoURL,
			SourceText: sourceText,
			UpdatedBy:  userID,
		}
		if err := s.DB.Create(&res).Error; err != nil {
			return nil, err
		}
		return &res, nil
	}
	if err != nil {
		return nil, err
	}

	res.VideoURL = videoURL
	res.SourceText = sourceText
	res.UpdatedBy = userID
	if err := s.DB.Save(&res).Error; err != nil {
		return nil, err
	}
	return &res, nil
}
