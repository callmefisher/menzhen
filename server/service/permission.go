package service

import (
	"gorm.io/gorm"
)

// PermissionService handles permission-related queries.
type PermissionService struct {
	DB *gorm.DB
}

// NewPermissionService creates a new PermissionService.
func NewPermissionService(db *gorm.DB) *PermissionService {
	return &PermissionService{DB: db}
}

// GetUserPermissions returns a deduplicated list of permission code strings
// for the given user. It uses a single JOIN query across user_roles,
// role_permissions, and permissions tables to avoid N+1 queries.
func (s *PermissionService) GetUserPermissions(userID uint64) ([]string, error) {
	var codes []string
	err := s.DB.
		Table("permissions").
		Select("DISTINCT permissions.code").
		Joins("JOIN role_permissions ON role_permissions.permission_id = permissions.id").
		Joins("JOIN user_roles ON user_roles.role_id = role_permissions.role_id").
		Where("user_roles.user_id = ?", userID).
		Pluck("permissions.code", &codes).Error
	if err != nil {
		return nil, err
	}
	return codes, nil
}

// HasPermission checks whether the given user has the specified permission code.
// It uses a single SQL query with JOINs across user_roles, role_permissions,
// and permissions tables, returning true if a matching permission exists.
func (s *PermissionService) HasPermission(userID uint64, permCode string) (bool, error) {
	var count int64
	err := s.DB.
		Table("permissions").
		Joins("JOIN role_permissions ON role_permissions.permission_id = permissions.id").
		Joins("JOIN user_roles ON user_roles.role_id = role_permissions.role_id").
		Where("user_roles.user_id = ? AND permissions.code = ?", userID, permCode).
		Limit(1).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
