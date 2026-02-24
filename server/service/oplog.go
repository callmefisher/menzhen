package service

import (
	"encoding/json"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// OpLogService handles operation log recording and querying.
type OpLogService struct {
	DB *gorm.DB
}

// NewOpLogService creates a new OpLogService.
func NewOpLogService(db *gorm.DB) *OpLogService {
	return &OpLogService{DB: db}
}

// CreateOpLog records an operation log entry.
func (s *OpLogService) CreateOpLog(tenantID, userID uint64, userName, action, resourceType string, resourceID uint64, oldData, newData interface{}) error {
	var oldJSON, newJSON datatypes.JSON

	if oldData != nil {
		b, err := json.Marshal(oldData)
		if err != nil {
			return err
		}
		oldJSON = datatypes.JSON(b)
	}

	if newData != nil {
		b, err := json.Marshal(newData)
		if err != nil {
			return err
		}
		newJSON = datatypes.JSON(b)
	}

	log := model.OpLog{
		TenantID:     tenantID,
		UserID:       userID,
		UserName:     userName,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		OldData:      oldJSON,
		NewData:      newJSON,
	}

	return s.DB.Create(&log).Error
}

// QueryOpLogs queries operation logs with filtering and pagination.
// It filters by tenant_id, optional user_name (LIKE), and optional date range.
// Results are ordered by created_at DESC.
func (s *OpLogService) QueryOpLogs(tenantID uint64, name string, startDate, endDate string, page, size int) ([]model.OpLog, int64, error) {
	var logs []model.OpLog
	var total int64

	query := s.DB.Model(&model.OpLog{}).Where("tenant_id = ?", tenantID)

	if name != "" {
		query = query.Where("user_name LIKE ?", "%"+name+"%")
	}
	if startDate != "" {
		query = query.Where("created_at >= ?", startDate)
	}
	if endDate != "" {
		query = query.Where("created_at <= ?", endDate+" 23:59:59")
	}

	// Get total count before pagination.
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Fetch paginated results.
	if err := query.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&logs).Error; err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}
