package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrRoleNotFound = errors.New("role not found")
)

// CreateRoleRequest is the input for creating a new role.
type CreateRoleRequest struct {
	Name          string   `json:"name" binding:"required"`
	Description   string   `json:"description"`
	PermissionIDs []uint64 `json:"permission_ids"`
}

// UpdateRoleRequest is the input for updating an existing role.
// Pointer fields distinguish between "not provided" and "zero value".
type UpdateRoleRequest struct {
	Name          *string  `json:"name"`
	Description   *string  `json:"description"`
	PermissionIDs []uint64 `json:"permission_ids"`
}

// RoleService handles role-related business logic.
type RoleService struct {
	DB *gorm.DB
}

// NewRoleService creates a new RoleService.
func NewRoleService(db *gorm.DB) *RoleService {
	return &RoleService{DB: db}
}

// ListRoles returns all roles for the given tenant with preloaded Permissions.
func (s *RoleService) ListRoles(tenantID uint64) ([]model.Role, error) {
	var roles []model.Role
	if err := s.DB.Where("tenant_id = ?", tenantID).
		Preload("Permissions").
		Find(&roles).Error; err != nil {
		return nil, err
	}
	return roles, nil
}

// CreateRole creates a new role and assigns the specified permissions.
func (s *RoleService) CreateRole(tenantID uint64, req *CreateRoleRequest) (*model.Role, error) {
	role := model.Role{
		TenantID:    tenantID,
		Name:        req.Name,
		Description: req.Description,
	}

	if err := s.DB.Create(&role).Error; err != nil {
		return nil, err
	}

	// Assign permissions if any IDs are provided.
	if len(req.PermissionIDs) > 0 {
		var permissions []model.Permission
		if err := s.DB.Where("id IN ?", req.PermissionIDs).Find(&permissions).Error; err != nil {
			return nil, err
		}
		if err := s.DB.Model(&role).Association("Permissions").Replace(&permissions); err != nil {
			return nil, err
		}
	}

	// Reload with permissions.
	if err := s.DB.Preload("Permissions").First(&role, role.ID).Error; err != nil {
		return nil, err
	}

	return &role, nil
}

// UpdateRole updates an existing role's name/description and optionally replaces its permissions.
func (s *RoleService) UpdateRole(tenantID, id uint64, req *UpdateRoleRequest) (*model.Role, error) {
	var role model.Role
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&role, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoleNotFound
		}
		return nil, err
	}

	// Build update map from non-nil fields.
	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&role).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	// Replace permissions if provided (even if empty slice, to allow clearing permissions).
	if req.PermissionIDs != nil {
		var permissions []model.Permission
		if len(req.PermissionIDs) > 0 {
			if err := s.DB.Where("id IN ?", req.PermissionIDs).Find(&permissions).Error; err != nil {
				return nil, err
			}
		}
		if err := s.DB.Model(&role).Association("Permissions").Replace(&permissions); err != nil {
			return nil, err
		}
	}

	// Reload with permissions.
	if err := s.DB.Where("tenant_id = ?", tenantID).Preload("Permissions").First(&role, id).Error; err != nil {
		return nil, err
	}

	return &role, nil
}

// ListPermissions returns all available permissions in the system.
func (s *RoleService) ListPermissions() ([]model.Permission, error) {
	var permissions []model.Permission
	if err := s.DB.Find(&permissions).Error; err != nil {
		return nil, err
	}
	return permissions, nil
}
