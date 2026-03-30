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
// Returns false (fail-safe) on any DB error.
func IsProtectedAdminAccount(db *gorm.DB, userID uint64) bool {
	isAdmin, err := isAdminUser(db, userID)
	if err != nil || !isAdmin {
		return false
	}
	var user model.User
	if err := db.Select("username").First(&user, userID).Error; err != nil {
		return false
	}
	return user.Username == "admin"
}

// getAdminUserIDs returns all user IDs that have the "user:manage" permission.
// Returns an error if the DB query fails — callers must not silently ignore it.
func getAdminUserIDs(db *gorm.DB) ([]uint64, error) {
	var ids []uint64
	result := db.Raw(`
		SELECT DISTINCT ur.user_id
		FROM user_roles ur
		JOIN role_permissions rp ON rp.role_id = ur.role_id
		JOIN permissions p ON p.id = rp.permission_id
		WHERE p.code = ?
	`, "user:manage").Scan(&ids)
	return ids, result.Error
}

// isAdminUser checks whether the given user ID has "user:manage" permission.
func isAdminUser(db *gorm.DB, userID uint64) (bool, error) {
	ids, err := getAdminUserIDs(db)
	if err != nil {
		return false, err
	}
	for _, id := range ids {
		if id == userID {
			return true, nil
		}
	}
	return false, nil
}

// applyAdminExclusion filters admin users out of a query for non-admin callers.
// If the current user is themselves an admin, no exclusion is applied (admins see all).
// Returns an error if admin IDs cannot be fetched from the DB.
func applyAdminExclusion(db *gorm.DB, query *gorm.DB, currentUserID uint64) (*gorm.DB, error) {
	adminIDs, err := getAdminUserIDs(db)
	if err != nil {
		return nil, err
	}
	for _, id := range adminIDs {
		if id == currentUserID {
			return query, nil // caller is admin — show everyone
		}
	}
	// Caller is not admin — hide all admin users
	if len(adminIDs) > 0 {
		query = query.Where("id NOT IN ?", adminIDs)
	}
	return query, nil
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
// Admin users (user:manage) are hidden from non-admin callers.
func (s *UserService) ListUsers(page, size int, currentUserID uint64) ([]model.User, int64, error) {
	query, err := applyAdminExclusion(s.DB, s.DB.Model(&model.User{}), currentUserID)
	if err != nil {
		return nil, 0, err
	}

	var users []model.User
	var total int64

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

// ListUsersByTenant returns a paginated list of users within a specific tenant.
// Admin users (user:manage) are hidden from non-admin callers.
func (s *UserService) ListUsersByTenant(tenantID uint64, page, size int, currentUserID uint64) ([]model.User, int64, error) {
	base := s.DB.Model(&model.User{}).Where("tenant_id = ?", tenantID)
	query, err := applyAdminExclusion(s.DB, base, currentUserID)
	if err != nil {
		return nil, 0, err
	}

	var users []model.User
	var total int64

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at DESC").
		Offset((page-1)*size).Limit(size).
		Preload("Roles").Preload("Tenant").
		Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

// UpdateUser updates an existing user's profile fields (real_name, phone, status).
// When tenantID is 0, the update is cross-tenant (for super admin).
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
// When tenantID is 0, the operation is cross-tenant (for super admin).
// The admin check runs inside the transaction to prevent a TOCTOU race.
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

	// Admin check and deletion run inside a single transaction to prevent TOCTOU.
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		isAdmin, err := isAdminUser(tx, id)
		if err != nil {
			return err
		}
		if isAdmin {
			return ErrProtectedUser
		}
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
// When tenantID is 0, the operation is cross-tenant (for super admin).
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
