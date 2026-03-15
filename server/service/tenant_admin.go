package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

// globalAdminPermCodes are permission codes that cannot be assigned by tenant-scoped role management.
var globalAdminPermCodes = []string{"user:manage", "role:manage", "tenant:manage"}

// TenantUpdateUserRequest is the input for a tenant admin updating a user.
// Deliberately omits tenant_id — tenant ops cannot move users between tenants.
type TenantUpdateUserRequest struct {
	RealName *string `json:"real_name"`
	Phone    *string `json:"phone"`
	Status   *int8   `json:"status"`
	Notes    *string `json:"notes"`
}

// TenantCreateRoleRequest is the input for a tenant admin creating a role.
type TenantCreateRoleRequest struct {
	Name          string   `json:"name" binding:"required"`
	Description   string   `json:"description"`
	PermissionIDs []uint64 `json:"permission_ids"`
}

// TenantUpdateRoleRequest is the input for a tenant admin updating a role.
type TenantUpdateRoleRequest struct {
	Name          *string  `json:"name"`
	Description   *string  `json:"description"`
	PermissionIDs []uint64 `json:"permission_ids"`
}

// TenantAdminService handles tenant-scoped user and role management.
// All operations enforce strict tenant isolation via WHERE tenant_id = ?.
type TenantAdminService struct {
	db *gorm.DB
}

// NewTenantAdminService creates a new TenantAdminService.
func NewTenantAdminService(db *gorm.DB) *TenantAdminService {
	return &TenantAdminService{db: db}
}

// DB exposes the underlying *gorm.DB for test helpers.
func (s *TenantAdminService) DB() *gorm.DB {
	return s.db
}

// ListUsers returns a paginated list of users for the given tenant.
// Results preload Roles and are ordered by created_at DESC.
func (s *TenantAdminService) ListUsers(tenantID uint64, page, size int) ([]model.User, int64, error) {
	var users []model.User
	var total int64

	query := s.db.Model(&model.User{}).Where("tenant_id = ?", tenantID)

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Preload("Roles").
		Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

// UpdateUser updates profile fields for a user that belongs to the given tenant.
// Returns ErrUserNotFound if the user does not exist in this tenant (cross-tenant protection).
func (s *TenantAdminService) UpdateUser(tenantID, userID uint64, req *TenantUpdateUserRequest) (*model.User, error) {
	var user model.User
	if err := s.db.Where("tenant_id = ? AND id = ?", tenantID, userID).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}

	updates := make(map[string]interface{})
	if req.RealName != nil {
		updates["real_name"] = *req.RealName
	}
	if req.Phone != nil {
		updates["phone"] = *req.Phone
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.Notes != nil {
		updates["notes"] = *req.Notes
	}

	if len(updates) > 0 {
		if err := s.db.Model(&user).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	// Reload with roles.
	if err := s.db.Preload("Roles").First(&user, userID).Error; err != nil {
		return nil, err
	}

	return &user, nil
}

// DisableUser sets a user's status to 0 (disabled).
// Returns ErrUserNotFound if the user does not belong to this tenant.
func (s *TenantAdminService) DisableUser(tenantID, userID uint64) error {
	var user model.User
	if err := s.db.Where("tenant_id = ? AND id = ?", tenantID, userID).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	return s.db.Model(&user).Update("status", 0).Error
}

// AssignRoles replaces the roles for a user within the same tenant.
// Returns an error if the user or any of the roles do not belong to the tenant.
func (s *TenantAdminService) AssignRoles(tenantID, userID uint64, roleIDs []uint64) error {
	// Verify user belongs to this tenant.
	var user model.User
	if err := s.db.Where("tenant_id = ? AND id = ?", tenantID, userID).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	var roles []model.Role
	if len(roleIDs) > 0 {
		if err := s.db.Where("id IN ? AND tenant_id = ?", roleIDs, tenantID).Find(&roles).Error; err != nil {
			return err
		}
		if len(roles) != len(roleIDs) {
			return errors.New("one or more roles do not belong to this tenant")
		}
	}

	return s.db.Model(&user).Association("Roles").Replace(&roles)
}

// ListRoles returns all roles for the given tenant with preloaded Permissions.
func (s *TenantAdminService) ListRoles(tenantID uint64) ([]model.Role, error) {
	var roles []model.Role
	if err := s.db.Where("tenant_id = ?", tenantID).
		Preload("Permissions").
		Find(&roles).Error; err != nil {
		return nil, err
	}
	return roles, nil
}

// CreateRole creates a new role for the tenant and assigns the specified permissions,
// excluding any global admin permission codes (user:manage, role:manage, tenant:manage).
func (s *TenantAdminService) CreateRole(tenantID uint64, req *TenantCreateRoleRequest) (*model.Role, error) {
	role := model.Role{
		TenantID:    tenantID,
		Name:        req.Name,
		Description: req.Description,
	}

	if err := s.db.Create(&role).Error; err != nil {
		return nil, err
	}

	if len(req.PermissionIDs) > 0 {
		var permissions []model.Permission
		if err := s.db.
			Where("id IN ? AND code NOT IN ?", req.PermissionIDs, globalAdminPermCodes).
			Find(&permissions).Error; err != nil {
			return nil, err
		}
		if len(permissions) > 0 {
			if err := s.db.Model(&role).Association("Permissions").Replace(&permissions); err != nil {
				return nil, err
			}
		}
	}

	// Reload with permissions.
	if err := s.db.Preload("Permissions").First(&role, role.ID).Error; err != nil {
		return nil, err
	}

	return &role, nil
}

// UpdateRole updates an existing role that belongs to the tenant.
// Returns ErrRoleNotFound if the role does not exist in this tenant.
// Permissions are replaced but global admin codes are excluded.
func (s *TenantAdminService) UpdateRole(tenantID, roleID uint64, req *TenantUpdateRoleRequest) (*model.Role, error) {
	var role model.Role
	if err := s.db.Where("tenant_id = ? AND id = ?", tenantID, roleID).First(&role).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoleNotFound
		}
		return nil, err
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if len(updates) > 0 {
		if err := s.db.Model(&role).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	// Replace permissions if provided, filtering out global admin codes.
	if req.PermissionIDs != nil {
		var permissions []model.Permission
		if len(req.PermissionIDs) > 0 {
			if err := s.db.
				Where("id IN ? AND code NOT IN ?", req.PermissionIDs, globalAdminPermCodes).
				Find(&permissions).Error; err != nil {
				return nil, err
			}
		}
		if err := s.db.Model(&role).Association("Permissions").Replace(&permissions); err != nil {
			return nil, err
		}
	}

	// Reload with permissions.
	if err := s.db.Where("tenant_id = ?", tenantID).Preload("Permissions").First(&role, roleID).Error; err != nil {
		return nil, err
	}

	return &role, nil
}

// ListTenantPermissions returns all permissions excluding global admin codes.
func (s *TenantAdminService) ListTenantPermissions() ([]model.Permission, error) {
	var permissions []model.Permission
	if err := s.db.Where("code NOT IN ?", globalAdminPermCodes).Find(&permissions).Error; err != nil {
		return nil, err
	}
	return permissions, nil
}
