package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInventoryDrugNotFound = errors.New("inventory drug not found")
	ErrStockInsufficient     = errors.New("stock insufficient for stock-out")
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
	ShelfNo        string   `json:"shelf_no"`
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
	ShelfNo        *string  `json:"shelf_no"`
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

// FindDrugPage returns which page a drug appears on (created_at DESC order).
func (s *InventoryDrugService) FindDrugPage(tenantID, drugID uint64, size int) (int, error) {
	if size <= 0 {
		size = 20
	}
	var drug model.InventoryDrug
	if err := s.DB.Select("created_at").Where("id = ? AND tenant_id = ?", drugID, tenantID).First(&drug).Error; err != nil {
		return 1, err
	}

	var position int64
	s.DB.Table("inventory_drugs").
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Where("created_at > ? OR (created_at = ? AND id > ?)", drug.CreatedAt, drug.CreatedAt, drugID).
		Count(&position)

	page := int(position)/size + 1
	return page, nil
}

// Create creates a new inventory drug record.
// If a soft-deleted record with the same tenant_id+name exists, it is restored
// and updated with the new data instead of inserting a duplicate.
func (s *InventoryDrugService) Create(tenantID uint64, req *CreateInventoryDrugRequest) (*model.InventoryDrug, error) {
	// Check for soft-deleted record with same name (Unscoped bypasses deleted_at filter)
	var existing model.InventoryDrug
	err := s.DB.Unscoped().
		Where("tenant_id = ? AND name = ? AND deleted_at IS NOT NULL", tenantID, req.Name).
		First(&existing).Error
	if err == nil {
		// Restore the soft-deleted record with new data
		updates := map[string]interface{}{
			"deleted_at":      nil,
			"category":        req.Category,
			"stock":           req.Stock,
			"purchase_price":  req.PurchasePrice,
			"selling_price":   req.SellingPrice,
			"alert_threshold": req.AlertThreshold,
			"remark":          req.Remark,
			"shelf_no":        req.ShelfNo,
		}
		if err := s.DB.Unscoped().Model(&existing).Updates(updates).Error; err != nil {
			return nil, err
		}
		// Reload to get full updated record
		if err := s.DB.First(&existing, existing.ID).Error; err != nil {
			return nil, err
		}
		return &existing, nil
	}

	drug := model.InventoryDrug{
		TenantID:       tenantID,
		Name:           req.Name,
		Category:       req.Category,
		Stock:          req.Stock,
		PurchasePrice:  req.PurchasePrice,
		SellingPrice:   req.SellingPrice,
		AlertThreshold: req.AlertThreshold,
		Remark:         req.Remark,
		ShelfNo:        req.ShelfNo,
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
	if req.ShelfNo != nil {
		updates["shelf_no"] = *req.ShelfNo
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

// StockInItem represents a single item in a batch stock-in request.
type StockInItem struct {
	Name          string  `json:"name" binding:"required"`
	Quantity      float64 `json:"quantity" binding:"required,gt=0"`
	PurchasePrice float64 `json:"purchase_price"`
	SellingPrice  float64 `json:"selling_price"`
	ShelfNo       string  `json:"shelf_no"`
}

// BatchStockInRequest is the input for batch stocking in drugs.
type BatchStockInRequest struct {
	Items          []StockInItem `json:"items" binding:"required,min=1"`
	AlertThreshold *float64      `json:"alert_threshold"`
}

// BatchStockInResult holds the result of a batch stock-in operation.
type BatchStockInResult struct {
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Total   int      `json:"total"`
	DrugIDs []uint64 `json:"drug_ids"`
}

// BatchStockIn adds stock to existing drugs or creates new ones.
// Soft-deleted drugs with matching names are restored instead of creating duplicates.
func (s *InventoryDrugService) BatchStockIn(tenantID uint64, req *BatchStockInRequest) (*BatchStockInResult, error) {
	result := &BatchStockInResult{Total: len(req.Items)}

	// 1. Collect all drug names and batch query existing drugs (including soft-deleted).
	names := make([]string, 0, len(req.Items))
	for _, item := range req.Items {
		names = append(names, item.Name)
	}

	var existingDrugs []model.InventoryDrug
	if len(names) > 0 {
		if err := s.DB.Where("tenant_id = ? AND name IN ?", tenantID, names).Find(&existingDrugs).Error; err != nil {
			return nil, err
		}
	}
	drugMap := make(map[string]*model.InventoryDrug, len(existingDrugs))
	for i := range existingDrugs {
		drugMap[existingDrugs[i].Name] = &existingDrugs[i]
	}

	// Also query soft-deleted drugs for restore
	var softDeletedDrugs []model.InventoryDrug
	if len(names) > 0 {
		if err := s.DB.Unscoped().
			Where("tenant_id = ? AND name IN ? AND deleted_at IS NOT NULL", tenantID, names).
			Find(&softDeletedDrugs).Error; err != nil {
			return nil, err
		}
	}
	softDeletedMap := make(map[string]*model.InventoryDrug, len(softDeletedDrugs))
	for i := range softDeletedDrugs {
		softDeletedMap[softDeletedDrugs[i].Name] = &softDeletedDrugs[i]
	}

	// 2. Classify items into create vs update vs restore.
	var newDrugs []model.InventoryDrug
	for _, item := range req.Items {
		if drug, exists := drugMap[item.Name]; exists {
			// Update existing drug: add stock, update prices.
			updates := map[string]interface{}{
				"stock": gorm.Expr("stock + ?", item.Quantity),
			}
			if item.PurchasePrice > 0 {
				updates["purchase_price"] = item.PurchasePrice
			}
			if item.SellingPrice > 0 {
				updates["selling_price"] = item.SellingPrice
			}
			if item.ShelfNo != "" {
				updates["shelf_no"] = item.ShelfNo
			}
			if err := s.DB.Model(drug).Updates(updates).Error; err != nil {
				return nil, err
			}
			result.Updated++
			result.DrugIDs = append(result.DrugIDs, uint64(drug.ID))
		} else if sd, ok := softDeletedMap[item.Name]; ok {
			// Restore soft-deleted drug with new data
			updates := map[string]interface{}{
				"deleted_at":     nil,
				"stock":          item.Quantity,
				"purchase_price": item.PurchasePrice,
				"selling_price":  item.SellingPrice,
			}
			if req.AlertThreshold != nil {
				updates["alert_threshold"] = req.AlertThreshold
			}
			if item.ShelfNo != "" {
				updates["shelf_no"] = item.ShelfNo
			}
			if err := s.DB.Unscoped().Model(sd).Updates(updates).Error; err != nil {
				return nil, err
			}
			result.Created++
			result.DrugIDs = append(result.DrugIDs, uint64(sd.ID))
		} else {
			newDrugs = append(newDrugs, model.InventoryDrug{
				TenantID:       tenantID,
				Name:           item.Name,
				Category:       "herb",
				Stock:          item.Quantity,
				PurchasePrice:  item.PurchasePrice,
				SellingPrice:   item.SellingPrice,
				AlertThreshold: req.AlertThreshold,
				ShelfNo:        item.ShelfNo,
			})
		}
	}

	// 3. Batch create new drugs.
	if len(newDrugs) > 0 {
		if err := s.DB.Create(&newDrugs).Error; err != nil {
			return nil, err
		}
		result.Created += len(newDrugs)
		for i := range newDrugs {
			result.DrugIDs = append(result.DrugIDs, uint64(newDrugs[i].ID))
		}
	}

	return result, nil
}

// StockOutRequest is the input for single drug stock-out (deducts from existing stock).
type StockOutRequest struct {
	Quantity float64 `json:"quantity" binding:"required,gt=0"`
	Reason   string  `json:"reason"`
}

// StockOut deducts quantity from an existing drug's stock.
// Uses transaction with row-level locking to prevent race conditions.
// Returns error if quantity exceeds current stock.
func (s *InventoryDrugService) StockOut(tenantID, id uint64, req *StockOutRequest) (StockInDrugResult, error) {
	var oldDrug model.InventoryDrug
	var newDrug model.InventoryDrug

	err := s.DB.Transaction(func(tx *gorm.DB) error {
		// Lock the row with FOR UPDATE to prevent concurrent reads.
		var drug model.InventoryDrug
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("tenant_id = ? AND id = ?", tenantID, id).
			First(&drug).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInventoryDrugNotFound
			}
			return err
		}

		if req.Quantity > drug.Stock {
			return ErrStockInsufficient
		}

		oldDrug = drug

		if err := tx.Model(&drug).Update("stock", gorm.Expr("stock - ?", req.Quantity)).Error; err != nil {
			return err
		}

		// Reload to get the updated record.
		if err := tx.Where("tenant_id = ? AND id = ?", tenantID, id).First(&newDrug).Error; err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		return StockInDrugResult{}, err
	}
	return StockInDrugResult{OldDrug: &oldDrug, NewDrug: &newDrug}, nil
}

// BatchStockOutItem represents a single item in a batch stock-out request.
type BatchStockOutItem struct {
	Name     string  `json:"name" binding:"required"`
	Quantity float64 `json:"quantity" binding:"required,gt=0"`
}

// BatchStockOutRequest is the input for batch stocking out drugs.
type BatchStockOutRequest struct {
	Items  []BatchStockOutItem `json:"items" binding:"required,min=1"`
	Reason string              `json:"reason"`
}

// BatchStockOutError describes a single item that failed stock-out.
type BatchStockOutError struct {
	Name    string  `json:"name"`
	Reason  string  `json:"reason"`
	Need    float64 `json:"need"`
	Current float64 `json:"current"`
}

// BatchStockOutResult holds the result of a batch stock-out operation.
type BatchStockOutResult struct {
	Succeeded int                  `json:"succeeded"`
	Failed    int                  `json:"failed"`
	Total     int                  `json:"total"`
	DrugIDs   []uint64             `json:"drug_ids"`
	Errors    []BatchStockOutError `json:"errors"`
}

// BatchStockOut deducts stock from multiple drugs by name.
// Uses transaction with row-level locking. Merges duplicate names.
// Items with insufficient stock or not found are recorded in Errors.
// DB errors on individual items are also recorded as errors (not fatal).
func (s *InventoryDrugService) BatchStockOut(tenantID uint64, req *BatchStockOutRequest) (*BatchStockOutResult, error) {
	// Merge duplicate names: sum quantities.
	merged := make(map[string]float64)
	order := make([]string, 0) // preserve order
	for _, item := range req.Items {
		if _, seen := merged[item.Name]; !seen {
			order = append(order, item.Name)
		}
		merged[item.Name] += item.Quantity
	}

	result := &BatchStockOutResult{Total: len(merged)}

	err := s.DB.Transaction(func(tx *gorm.DB) error {
		// Lock all matching rows with FOR UPDATE.
		var existingDrugs []model.InventoryDrug
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("tenant_id = ? AND name IN ?", tenantID, order).
			Find(&existingDrugs).Error; err != nil {
			return err
		}
		drugMap := make(map[string]*model.InventoryDrug, len(existingDrugs))
		for i := range existingDrugs {
			drugMap[existingDrugs[i].Name] = &existingDrugs[i]
		}

		for _, name := range order {
			qty := merged[name]
			drug, exists := drugMap[name]
			if !exists {
				result.Failed++
				result.Errors = append(result.Errors, BatchStockOutError{
					Name:   name,
					Reason: "not_found",
					Need:   qty,
				})
				continue
			}
			if qty > drug.Stock {
				result.Failed++
				result.Errors = append(result.Errors, BatchStockOutError{
					Name:    name,
					Reason:  "insufficient",
					Need:    qty,
					Current: drug.Stock,
				})
				continue
			}
			if err := tx.Model(drug).Update("stock", gorm.Expr("stock - ?", qty)).Error; err != nil {
				// Record DB error as item failure instead of aborting the entire transaction.
				result.Failed++
				result.Errors = append(result.Errors, BatchStockOutError{
					Name:    name,
					Reason:  "db_error",
					Need:    qty,
					Current: drug.Stock,
				})
				continue
			}
			result.Succeeded++
			result.DrugIDs = append(result.DrugIDs, uint64(drug.ID))
		}
		return nil
	})

	if err != nil {
		return nil, err
	}
	return result, nil
}

// StockInRequest is the input for single drug stock-in (adds to existing stock).
type StockInRequest struct {
	Quantity       float64  `json:"quantity" binding:"required,gt=0"`
	PurchasePrice  float64  `json:"purchase_price"`
	SellingPrice   float64  `json:"selling_price"`
	AlertThreshold *float64 `json:"alert_threshold"`
	ShelfNo        *string  `json:"shelf_no"`
}

// StockInDrugResult holds old and new drug data for oplog.
type StockInDrugResult struct {
	OldDrug *model.InventoryDrug
	NewDrug *model.InventoryDrug
}

// StockIn adds quantity to an existing drug's stock.
func (s *InventoryDrugService) StockIn(tenantID, id uint64, req *StockInRequest) (StockInDrugResult, error) {
	var drug model.InventoryDrug
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&drug, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return StockInDrugResult{}, ErrInventoryDrugNotFound
		}
		return StockInDrugResult{}, err
	}

	oldDrug := drug

	updates := map[string]interface{}{
		"stock": gorm.Expr("stock + ?", req.Quantity),
	}
	if req.PurchasePrice > 0 {
		updates["purchase_price"] = req.PurchasePrice
	}
	if req.SellingPrice > 0 {
		updates["selling_price"] = req.SellingPrice
	}
	if req.AlertThreshold != nil {
		if *req.AlertThreshold < 0 {
			updates["alert_threshold"] = nil
		} else {
			updates["alert_threshold"] = *req.AlertThreshold
		}
	}
	if req.ShelfNo != nil {
		updates["shelf_no"] = *req.ShelfNo
	}

	if err := s.DB.Model(&drug).Updates(updates).Error; err != nil {
		return StockInDrugResult{}, err
	}

	// Reload
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&drug, id).Error; err != nil {
		return StockInDrugResult{}, err
	}

	return StockInDrugResult{OldDrug: &oldDrug, NewDrug: &drug}, nil
}
