package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrInventoryDrugNotFound = errors.New("inventory drug not found")
)

// CreateInventoryDrugRequest is the input for creating a new inventory drug.
type CreateInventoryDrugRequest struct {
	Name           string   `json:"name" binding:"required"`
	Category       string   `json:"category" binding:"required,oneof=herb patent"`
	Stock          float64  `json:"stock"`
	PurchasePrice  float64  `json:"purchase_price"`
	SellingPrice   float64  `json:"selling_price"`
	AlertThreshold *float64 `json:"alert_threshold"`
	Remark         string   `json:"remark"`
}

// UpdateInventoryDrugRequest is the input for updating an existing inventory drug.
// All fields are pointers so that we can distinguish between "not provided" and "zero value".
type UpdateInventoryDrugRequest struct {
	Name           *string  `json:"name"`
	Category       *string  `json:"category"`
	Stock          *float64 `json:"stock"`
	PurchasePrice  *float64 `json:"purchase_price"`
	SellingPrice   *float64 `json:"selling_price"`
	AlertThreshold *float64 `json:"alert_threshold"`
	Remark         *string  `json:"remark"`
}

// InventoryDrugService handles inventory drug business logic.
type InventoryDrugService struct {
	DB *gorm.DB
}

// NewInventoryDrugService creates a new InventoryDrugService.
func NewInventoryDrugService(db *gorm.DB) *InventoryDrugService {
	return &InventoryDrugService{DB: db}
}

// List returns a paginated list of inventory drugs for the given tenant.
// Optionally filters by name (LIKE match) and category (exact match). Results are ordered by created_at DESC.
func (s *InventoryDrugService) List(tenantID uint64, name, category string, page, size int) ([]model.InventoryDrug, int64, error) {
	var drugs []model.InventoryDrug
	var total int64

	query := s.DB.Model(&model.InventoryDrug{}).Where("tenant_id = ?", tenantID)

	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}
	if category != "" {
		query = query.Where("category = ?", category)
	}

	// Get total count before pagination.
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Fetch paginated results.
	if err := query.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&drugs).Error; err != nil {
		return nil, 0, err
	}

	return drugs, total, nil
}

// Create creates a new inventory drug record.
func (s *InventoryDrugService) Create(tenantID uint64, req *CreateInventoryDrugRequest) (*model.InventoryDrug, error) {
	drug := model.InventoryDrug{
		TenantID:       tenantID,
		Name:           req.Name,
		Category:       req.Category,
		Stock:          req.Stock,
		PurchasePrice:  req.PurchasePrice,
		SellingPrice:   req.SellingPrice,
		AlertThreshold: req.AlertThreshold,
		Remark:         req.Remark,
	}

	if err := s.DB.Create(&drug).Error; err != nil {
		return nil, err
	}

	return &drug, nil
}

// Update updates an existing inventory drug. It returns the drug data before
// the update (for oplog old_data) and the updated drug.
// For AlertThreshold: if value < 0, set to nil (clear custom threshold); otherwise set the value.
func (s *InventoryDrugService) Update(tenantID, id uint64, req *UpdateInventoryDrugRequest) (*model.InventoryDrug, *model.InventoryDrug, error) {
	var drug model.InventoryDrug
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&drug, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrInventoryDrugNotFound
		}
		return nil, nil, err
	}

	// Save a copy of the old data for oplog.
	oldDrug := drug

	// Build update map from non-nil fields.
	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Category != nil {
		updates["category"] = *req.Category
	}
	if req.Stock != nil {
		updates["stock"] = *req.Stock
	}
	if req.PurchasePrice != nil {
		updates["purchase_price"] = *req.PurchasePrice
	}
	if req.SellingPrice != nil {
		updates["selling_price"] = *req.SellingPrice
	}
	if req.AlertThreshold != nil {
		if *req.AlertThreshold < 0 {
			updates["alert_threshold"] = nil
		} else {
			updates["alert_threshold"] = *req.AlertThreshold
		}
	}
	if req.Remark != nil {
		updates["remark"] = *req.Remark
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&drug).Updates(updates).Error; err != nil {
			return nil, nil, err
		}
	}

	// Reload to get the updated record.
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&drug, id).Error; err != nil {
		return nil, nil, err
	}

	return &oldDrug, &drug, nil
}

// Delete soft-deletes an inventory drug. It returns the drug data before
// deletion (for oplog old_data).
func (s *InventoryDrugService) Delete(tenantID, id uint64) (*model.InventoryDrug, error) {
	var drug model.InventoryDrug
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&drug, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInventoryDrugNotFound
		}
		return nil, err
	}

	if err := s.DB.Delete(&drug).Error; err != nil {
		return nil, err
	}

	return &drug, nil
}
