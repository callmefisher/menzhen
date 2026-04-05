package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrTenantNotFound  = errors.New("tenant not found")
	ErrTenantCodeExist = errors.New("tenant code already exists")
	ErrTenantNameExist = errors.New("tenant name already exists")
	ErrTenantHasAdmin  = errors.New("tenant has admin")
)

// tenantAdminUsernames returns the usernames of admin users in the given tenant.
func tenantAdminUsernames(db *gorm.DB, tenantID uint64) []string {
	var usernames []string
	db.Raw(`
		SELECT DISTINCT u.username
		FROM users u
		JOIN user_roles ur ON ur.user_id = u.id
		JOIN role_permissions rp ON rp.role_id = ur.role_id
		JOIN permissions p ON p.id = rp.permission_id
		WHERE u.tenant_id = ? AND p.code = ?
	`, tenantID, "user:manage").Scan(&usernames)
	return usernames
}

// checkTenantHasAdmin returns a descriptive error if the tenant has admin users, nil otherwise.
func checkTenantHasAdmin(db *gorm.DB, tenantID uint64) error {
	names := tenantAdminUsernames(db, tenantID)
	if len(names) == 0 {
		return nil
	}
	return fmt.Errorf("%w: 关联管理员账号 [%s]", ErrTenantHasAdmin, strings.Join(names, ", "))
}

// CreateTenantRequest is the input for creating a new tenant.
type CreateTenantRequest struct {
	Name      string `json:"name" binding:"required"`
	Code      string `json:"code" binding:"required"`
	GroupName string `json:"group_name" binding:"max=100"`
}

// UpdateTenantRequest is the input for updating a tenant.
type UpdateTenantRequest struct {
	Name      *string `json:"name"`
	Code      *string `json:"code"`
	Status    *int8   `json:"status"`
	GroupName *string `json:"group_name" binding:"omitempty,max=100"`
}

// TenantService handles tenant-related business logic.
type TenantService struct {
	DB *gorm.DB
}

// NewTenantService creates a new TenantService.
func NewTenantService(db *gorm.DB) *TenantService {
	return &TenantService{DB: db}
}

// TenantSearchItem is a lightweight tenant representation for filter dropdowns.
type TenantSearchItem struct {
	ID        uint64 `json:"id"`
	Name      string `json:"name"`
	Code      string `json:"code"`
	GroupName string `json:"group_name"`
}

// SearchAccessibleTenants searches tenants by name keyword, returning at most size results.
// If groupNames is non-empty, only tenants in those groups are searched (power admin).
// If groupNames is empty, all tenants are searched (super admin).
func (s *TenantService) SearchAccessibleTenants(keyword string, groupNames []string, size int) ([]TenantSearchItem, error) {
	var items []TenantSearchItem
	query := s.DB.Table("tenants").Select("id, name, code, group_name")
	if len(groupNames) > 0 {
		query = query.Where("group_name IN ?", groupNames)
	}
	if keyword != "" {
		query = query.Where("name LIKE ?", "%"+keyword+"%")
	}
	if err := query.Order("name").Limit(size).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

// ListTenants returns a paginated list of all tenants.
func (s *TenantService) ListTenants(page, size int) ([]model.Tenant, int64, error) {
	var tenants []model.Tenant
	var total int64

	query := s.DB.Model(&model.Tenant{})

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&tenants).Error; err != nil {
		return nil, 0, err
	}

	return tenants, total, nil
}

// CreateTenant creates a new tenant.
func (s *TenantService) CreateTenant(req *CreateTenantRequest) (*model.Tenant, error) {
	// Check for duplicate code.
	var existing model.Tenant
	if err := s.DB.Where("code = ?", req.Code).First(&existing).Error; err == nil {
		return nil, ErrTenantCodeExist
	}

	// Check for duplicate name.
	if err := s.DB.Where("name = ?", req.Name).First(&existing).Error; err == nil {
		return nil, ErrTenantNameExist
	}

	groupName := req.GroupName
	if groupName == "" {
		groupName = "default"
	}
	tenant := model.Tenant{
		Name:      req.Name,
		Code:      req.Code,
		Status:    1,
		GroupName: groupName,
	}

	if err := s.DB.Create(&tenant).Error; err != nil {
		return nil, err
	}

	return &tenant, nil
}

// GetTenant retrieves a tenant by ID.
func (s *TenantService) GetTenant(id uint64) (*model.Tenant, error) {
	var tenant model.Tenant
	if err := s.DB.First(&tenant, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTenantNotFound
		}
		return nil, err
	}
	return &tenant, nil
}

// UpdateTenant updates an existing tenant.
func (s *TenantService) UpdateTenant(id uint64, req *UpdateTenantRequest) (*model.Tenant, error) {
	var tenant model.Tenant
	if err := s.DB.First(&tenant, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTenantNotFound
		}
		return nil, err
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		// Check duplicate name if changing.
		var existing model.Tenant
		if err := s.DB.Where("name = ? AND id != ?", *req.Name, id).First(&existing).Error; err == nil {
			return nil, ErrTenantNameExist
		}
		updates["name"] = *req.Name
	}
	if req.Code != nil {
		// Check duplicate code if changing.
		var existing model.Tenant
		if err := s.DB.Where("code = ? AND id != ?", *req.Code, id).First(&existing).Error; err == nil {
			return nil, ErrTenantCodeExist
		}
		updates["code"] = *req.Code
	}
	if req.Status != nil {
		// Prevent disabling tenant that has admin users.
		if *req.Status == 0 {
			if err := checkTenantHasAdmin(s.DB, id); err != nil {
				return nil, err
			}
		}
		updates["status"] = *req.Status
	}
	if req.GroupName != nil {
		if *req.GroupName == "" {
			updates["group_name"] = "default"
		} else {
			updates["group_name"] = *req.GroupName
		}
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&tenant).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	if err := s.DB.First(&tenant, id).Error; err != nil {
		return nil, err
	}

	return &tenant, nil
}

// DeleteTenant deletes a tenant by ID.
// Returns ErrTenantHasAdmin if the tenant has admin users.
func (s *TenantService) DeleteTenant(id uint64) error {
	var tenant model.Tenant
	if err := s.DB.First(&tenant, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrTenantNotFound
		}
		return err
	}

	// Prevent deleting tenant that has admin users.
	if err := checkTenantHasAdmin(s.DB, id); err != nil {
		return err
	}

	if err := s.DB.Delete(&tenant).Error; err != nil {
		return err
	}

	return nil
}
