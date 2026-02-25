package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrUserDisabled       = errors.New("user account is disabled")
	ErrUsernameExists     = errors.New("该用户名已被注册")
	ErrUserNotFound       = errors.New("user not found")
	ErrWrongOldPassword   = errors.New("旧密码错误")
)

// AuthService handles authentication-related business logic.
type AuthService struct {
	DB *gorm.DB
}

// NewAuthService creates a new AuthService.
func NewAuthService(db *gorm.DB) *AuthService {
	return &AuthService{DB: db}
}

// Login verifies the username and password and returns the user if valid.
func (s *AuthService) Login(username, password string) (*model.User, error) {
	var user model.User
	err := s.DB.Where("username = ?", username).First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}

	// Check that the user is active (status = 1).
	if user.Status != 1 {
		return nil, ErrUserDisabled
	}

	// Compare password with stored hash.
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return &user, nil
}

// Register creates a new user within the specified tenant.
func (s *AuthService) Register(tenantID uint64, username, password, realName, phone string) (*model.User, error) {
	// Check username uniqueness globally (login uses username without tenant context).
	var count int64
	s.DB.Model(&model.User{}).
		Where("username = ?", username).
		Count(&count)
	if count > 0 {
		return nil, ErrUsernameExists
	}

	// Hash the password.
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := model.User{
		TenantID:     tenantID,
		Username:     username,
		PasswordHash: string(hash),
		RealName:     realName,
		Phone:        phone,
		Status:       1,
	}

	if err := s.DB.Create(&user).Error; err != nil {
		return nil, err
	}

	return &user, nil
}

// GetCurrentUser retrieves a user by ID with their roles and permissions preloaded.
// It returns the user, a list of permission codes, and any error.
func (s *AuthService) GetCurrentUser(userID uint64) (*model.User, []string, error) {
	var user model.User
	err := s.DB.
		Preload("Roles.Permissions").
		First(&user, userID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrUserNotFound
		}
		return nil, nil, err
	}

	// Collect unique permission codes.
	seen := make(map[string]struct{})
	var permissions []string
	for _, role := range user.Roles {
		for _, perm := range role.Permissions {
			if _, ok := seen[perm.Code]; !ok {
				seen[perm.Code] = struct{}{}
				permissions = append(permissions, perm.Code)
			}
		}
	}

	return &user, permissions, nil
}

// ChangePassword verifies the old password and updates to the new one.
func (s *AuthService) ChangePassword(userID uint64, oldPassword, newPassword string) error {
	var user model.User
	if err := s.DB.First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	// Verify old password.
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); err != nil {
		return ErrWrongOldPassword
	}

	// Hash new password.
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	return s.DB.Model(&user).Update("password_hash", string(hash)).Error
}
