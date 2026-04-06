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
			// If marshaling fails, store the error message instead of losing the log.
			b = []byte(`{"_marshal_error":"` + err.Error() + `"}`)
		}
		oldJSON = datatypes.JSON(b)
	}

	if newData != nil {
		b, err := json.Marshal(newData)
		if err != nil {
			b = []byte(`{"_marshal_error":"` + err.Error() + `"}`)
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
//
// Access modes:
//   - Regular user (tenantID > 0): sees only own tenant's logs.
//   - Power admin (tenantID == 0, managedGroups non-empty): sees logs for all tenants
//     in managed groups. Optionally filtered to a specific tenant via filterTenantID.
//   - Super admin (tenantID == 0, managedGroups empty): sees all tenants' logs.
//     Optionally filtered to a specific tenant via filterTenantID.
//
// Tenant info is preloaded when viewing multiple tenants (super/power admin).
// Results are ordered by created_at DESC.
func (s *OpLogService) QueryOpLogs(tenantID uint64, managedGroups []string, filterTenantID uint64, name string, startDate, endDate string, page, size int) ([]model.OpLog, int64, error) {
	var logs []model.OpLog
	var total int64

	query := s.DB.Model(&model.OpLog{})

	switch {
	case tenantID > 0:
		// Regular user: see only their own tenant's logs.
		query = query.Where("tenant_id = ?", tenantID)
	case len(managedGroups) > 0:
		// Power admin: see logs for tenants within managed groups.
		query = query.Where("tenant_id IN (?)",
			s.DB.Table("tenants").Select("id").Where("group_name IN ? AND group_name != ''", managedGroups)).
			Preload("Tenant")
		if filterTenantID > 0 {
			query = query.Where("tenant_id = ?", filterTenantID)
		}
	default:
		// Super admin: see all tenants' logs.
		query = query.Preload("Tenant")
		if filterTenantID > 0 {
			query = query.Where("tenant_id = ?", filterTenantID)
		}
	}

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

// DeleteOpLog deletes a single operation log by ID.
//
// Access modes (mirrors QueryOpLogs):
//   - Regular user (tenantID > 0): delete within own tenant only.
//   - Power admin (tenantID == 0, managedGroups non-empty): delete within managed-group tenants.
//   - Super admin (tenantID == 0, managedGroups empty): delete across all tenants.
func (s *OpLogService) DeleteOpLog(tenantID uint64, managedGroups []string, id uint64) error {
	q := s.DB.Where("id = ?", id)
	switch {
	case tenantID > 0:
		q = q.Where("tenant_id = ?", tenantID)
	case len(managedGroups) > 0:
		q = q.Where("tenant_id IN (?)",
			s.DB.Table("tenants").Select("id").Where("group_name IN ? AND group_name != ''", managedGroups))
	// tenantID == 0 and no managedGroups → super admin, no tenant filter
	}
	result := q.Delete(&model.OpLog{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// BatchDeleteOpLogs deletes multiple operation logs by IDs.
//
// Access modes mirror DeleteOpLog.
func (s *OpLogService) BatchDeleteOpLogs(tenantID uint64, managedGroups []string, ids []uint64) (int64, error) {
	q := s.DB.Where("id IN ?", ids)
	switch {
	case tenantID > 0:
		q = q.Where("tenant_id = ?", tenantID)
	case len(managedGroups) > 0:
		q = q.Where("tenant_id IN (?)",
			s.DB.Table("tenants").Select("id").Where("group_name IN ? AND group_name != ''", managedGroups))
	// tenantID == 0 and no managedGroups → super admin, no tenant filter
	}
	result := q.Delete(&model.OpLog{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
