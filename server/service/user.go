package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// ErrUserNotFound is declared in auth.go and reused here.

// ErrProtectedUser is returned when trying to modify a user with system admin privileges.
var ErrProtectedUser = errors.New("cannot modify a system admin user")

// IsProtectedAdminAccount checks if a user is the protected "admin" account
// (has user:manage permission AND username is "admin").
func IsProtectedAdminAccount(db *gorm.DB, userID uint64) bool {
	if !isAdminUser(db, userID) {
		return false
	}
	var user model.User
	if err := db.Select("username").First(&user, userID).Error; err != nil {
		return false
	}
	return user.Username == "admin"
}

// getAdminUserIDs returns all user IDs that have the "user:manage" permission.
func getAdminUserIDs(db *gorm.DB) []uint64 {
	var ids []uint64
	db.Raw(`
		SELECT DISTINCT ur.user_id
		FROM user_roles ur
		JOIN role_permissions rp ON rp.role_id = ur.role_id
		JOIN permissions p ON p.id = rp.permission_id
		WHERE p.code = ?
	`, "user:manage").Scan(&ids)
	return ids
}

// isAdminUser checks whether the given user ID has "user:manage" permission.
func isAdminUser(db *gorm.DB, userID uint64) bool {
	for _, id := range getAdminUserIDs(db) {
		if id == userID {
			return true
		}
	}
	return false
}

// UpdateUserRequest is the input for updating an existing user.
// All fields are pointers so that we can distinguish between "not provided" and "zero value".
type UpdateUserRequest struct {
	RealName *string `json:"real_name"`
	Phone    *string `json:"phone"`
	Status   *int8   `json:"status"`
	TenantID *uint64 `json:"tenant_id"`
	Notes    *string `json:"notes"`
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

// ListUsers returns a paginated list of all users across tenants.
// Results include preloaded Roles and Tenant, ordered by created_at DESC.
// Users who have the "user:manage" permission are hidden from others
// (only visible to themselves).
func (s *UserService) ListUsers(page, size int, currentUserID uint64) ([]model.User, int64, error) {
	adminUserIDs := getAdminUserIDs(s.DB)
	isCurrentAdmin := false
	for _, id := range adminUserIDs {
		if id == currentUserID {
			isCurrentAdmin = true
			break
		}
	}

	// If current user is admin, show all users.
	// If current user is not admin, hide other admin users (only show themselves if they are admin).
	var excludeIDs []uint64
	if !isCurrentAdmin {
		for _, id := range adminUserIDs {
			if id != currentUserID {
				excludeIDs = append(excludeIDs, id)
			}
		}
	}

	var users []model.User
	var total int64

	query := s.DB.Model(&model.User{})
	if len(excludeIDs) > 0 {
		query = query.Where("id NOT IN ?", excludeIDs)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Preload("Roles").
		Preload("Tenant").
		Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

// UpdateUser updates an existing user's profile fields (real_name, phone, status).
// When tenantID is 0, the update is cross-tenant (for admins with user:manage).
func (s *UserService) UpdateUser(tenantID, id uint64, req *UpdateUserRequest) (*model.User, error) {
	var user model.User
	query := s.DB
	if tenantID > 0 {
		query = query.Where("tenant_id = ?", tenantID)
	}
	if err := query.First(&user, id).Error; err != nil {
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
	if req.TenantID != nil {
		updates["tenant_id"] = *req.TenantID
		// Bump token_version so the user's current JWT becomes stale.
		updates["token_version"] = gorm.Expr("token_version + 1")
	}
	if req.Notes != nil {
		updates["notes"] = *req.Notes
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&user).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	// Reload to get the updated record with roles and tenant.
	if err := s.DB.Preload("Roles").Preload("Tenant").First(&user, id).Error; err != nil {
		return nil, err
	}

	return &user, nil
}

// DeleteUser removes a user from the database.
// When tenantID is 0, the operation is cross-tenant.
// It also clears the user's role associations.
// Returns the deleted user info for audit logging.
func (s *UserService) DeleteUser(tenantID, id uint64) (*model.User, error) {
	var user model.User
	query := s.DB
	if tenantID > 0 {
		query = query.Where("tenant_id = ?", tenantID)
	}
	if err := query.First(&user, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}

	// Prevent deleting admin users.
	if isAdminUser(s.DB, id) {
		return nil, ErrProtectedUser
	}

	// Use transaction to ensure atomicity of role cleanup + user deletion.
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&user).Association("Roles").Clear(); err != nil {
			return err
		}
		return tx.Delete(&user).Error
	})
	if err != nil {
		return nil, err
	}

	return &user, nil
}

// AssignRoles replaces a user's roles with the given role IDs.
// It verifies that all specified roles belong to the user's tenant.
func (s *UserService) AssignRoles(tenantID, userID uint64, roleIDs []uint64) error {
	// Verify user exists.
	var user model.User
	if err := s.DB.First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	// Use the user's own tenant for role verification.
	userTenantID := user.TenantID

	// Verify all roles belong to the user's tenant.
	var roles []model.Role
	if len(roleIDs) > 0 {
		if err := s.DB.Where("id IN ? AND tenant_id = ?", roleIDs, userTenantID).Find(&roles).Error; err != nil {
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

// ResetPassword sets a new password for a user.
// When tenantID is 0, the operation is cross-tenant (for admins with user:manage).
// Bumps token_version to invalidate existing sessions.
func (s *UserService) ResetPassword(tenantID, userID uint64, newPassword string) error {
	var user model.User
	query := s.DB
	if tenantID > 0 {
		query = query.Where("tenant_id = ?", tenantID)
	}
	if err := query.First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	return s.DB.Model(&user).Updates(map[string]interface{}{
		"password_hash": string(hash),
		"token_version": gorm.Expr("token_version + 1"),
	}).Error
}
