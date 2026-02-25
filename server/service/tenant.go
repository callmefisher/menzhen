package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrTenantNotFound  = errors.New("tenant not found")
	ErrTenantCodeExist = errors.New("tenant code already exists")
)

// CreateTenantRequest is the input for creating a new tenant.
type CreateTenantRequest struct {
	Name string `json:"name" binding:"required"`
	Code string `json:"code" binding:"required"`
}

// UpdateTenantRequest is the input for updating a tenant.
type UpdateTenantRequest struct {
	Name   *string `json:"name"`
	Code   *string `json:"code"`
	Status *int8   `json:"status"`
}

// TenantService handles tenant-related business logic.
type TenantService struct {
	DB *gorm.DB
}

// NewTenantService creates a new TenantService.
func NewTenantService(db *gorm.DB) *TenantService {
	return &TenantService{DB: db}
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

	tenant := model.Tenant{
		Name:   req.Name,
		Code:   req.Code,
		Status: 1,
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
		updates["status"] = *req.Status
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
func (s *TenantService) DeleteTenant(id uint64) error {
	var tenant model.Tenant
	if err := s.DB.First(&tenant, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrTenantNotFound
		}
		return err
	}

	if err := s.DB.Delete(&tenant).Error; err != nil {
		return err
	}

	return nil
}
