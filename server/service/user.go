package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

// ErrUserNotFound is declared in auth.go and reused here.

// UpdateUserRequest is the input for updating an existing user.
// All fields are pointers so that we can distinguish between "not provided" and "zero value".
type UpdateUserRequest struct {
	RealName *string `json:"real_name"`
	Phone    *string `json:"phone"`
	Status   *int8   `json:"status"`
}

// AssignRolesRequest is the input for assigning roles to a user.
type AssignRolesRequest struct {
	RoleIDs []uint64 `json:"role_ids" binding:"required"`
}

// UserService handles user-related business logic.
type UserService struct {
	DB *gorm.DB
}

// NewUserService creates a new UserService.
func NewUserService(db *gorm.DB) *UserService {
	return &UserService{DB: db}
}

// ListUsers returns a paginated list of users for the given tenant.
// Results include preloaded Roles and are ordered by created_at DESC.
func (s *UserService) ListUsers(tenantID uint64, page, size int) ([]model.User, int64, error) {
	var users []model.User
	var total int64

	query := s.DB.Model(&model.User{}).Where("tenant_id = ?", tenantID)

	// Get total count before pagination.
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Fetch paginated results with preloaded Roles.
	if err := query.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Preload("Roles").
		Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

// UpdateUser updates an existing user's profile fields (real_name, phone, status).
func (s *UserService) UpdateUser(tenantID, id uint64, req *UpdateUserRequest) (*model.User, error) {
	var user model.User
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&user, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}

	// Build update map from non-nil fields.
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

	if len(updates) > 0 {
		if err := s.DB.Model(&user).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	// Reload to get the updated record with roles.
	if err := s.DB.Where("tenant_id = ?", tenantID).Preload("Roles").First(&user, id).Error; err != nil {
		return nil, err
	}

	return &user, nil
}

// DeleteUser disables a user by setting status to 0 (soft disable, not actual delete).
func (s *UserService) DeleteUser(tenantID, id uint64) error {
	var user model.User
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&user, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	// Set status to 0 (disabled).
	if err := s.DB.Model(&user).Update("status", 0).Error; err != nil {
		return err
	}

	return nil
}

// AssignRoles replaces a user's roles with the given role IDs.
// It verifies that all specified roles belong to the same tenant.
func (s *UserService) AssignRoles(tenantID, userID uint64, roleIDs []uint64) error {
	// Verify user exists in tenant.
	var user model.User
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	// Verify all roles belong to the tenant.
	var roles []model.Role
	if len(roleIDs) > 0 {
		if err := s.DB.Where("id IN ? AND tenant_id = ?", roleIDs, tenantID).Find(&roles).Error; err != nil {
			return err
		}
		if len(roles) != len(roleIDs) {
			return errors.New("one or more roles do not belong to this tenant")
		}
	}

	// Replace user's roles using GORM Association mode.
	if err := s.DB.Model(&user).Association("Roles").Replace(&roles); err != nil {
		return err
	}

	return nil
}
