package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// InventoryDrugHandler handles inventory drug CRUD endpoints.
type InventoryDrugHandler struct {
	db *gorm.DB
}

// NewInventoryDrugHandler creates a new InventoryDrugHandler.
func NewInventoryDrugHandler(db *gorm.DB) *InventoryDrugHandler {
	return &InventoryDrugHandler{db: db}
}

// List handles GET /api/v1/inventory/drugs.
func (h *InventoryDrugHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	name := c.Query("name")
	category := c.Query("category")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewInventoryDrugService(h.db)
	drugs, total, err := svc.List(tenantID, name, category, page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list inventory drugs",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  drugs,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// Create handles POST /api/v1/inventory/drugs.
func (h *InventoryDrugHandler) Create(c *gin.Context) {
	var req service.CreateInventoryDrugRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	tenantID := middleware.GetTenantID(c)

	svc := service.NewInventoryDrugService(h.db)
	drug, err := svc.Create(tenantID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to create inventory drug",
		})
		return
	}

	// Record operation log (best-effort).
	middleware.LogOperation(h.db, c, "create", "inventory_drug", drug.ID, nil, drug)

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    drug,
	})
}

// Update handles PUT /api/v1/inventory/drugs/:id.
func (h *InventoryDrugHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid inventory drug id",
		})
		return
	}

	var req service.UpdateInventoryDrugRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewInventoryDrugService(h.db)
	oldDrug, newDrug, err := svc.Update(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrInventoryDrugNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "inventory drug not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update inventory drug",
		})
		return
	}

	// Record operation log (best-effort).
	middleware.LogOperation(h.db, c, "update", "inventory_drug", id, oldDrug, newDrug)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    newDrug,
	})
}

// Delete handles DELETE /api/v1/inventory/drugs/:id.
func (h *InventoryDrugHandler) Delete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid inventory drug id",
		})
		return
	}

	svc := service.NewInventoryDrugService(h.db)
	oldDrug, err := svc.Delete(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrInventoryDrugNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "inventory drug not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to delete inventory drug",
		})
		return
	}

	// Record operation log (best-effort).
	middleware.LogOperation(h.db, c, "delete", "inventory_drug", id, oldDrug, nil)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}

// BatchStockIn handles POST /api/v1/inventory/drugs/batch-stock-in.
func (h *InventoryDrugHandler) BatchStockIn(c *gin.Context) {
	var req service.BatchStockInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	tenantID := middleware.GetTenantID(c)
	svc := service.NewInventoryDrugService(h.db)
	result, err := svc.BatchStockIn(tenantID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "batch stock-in failed",
		})
		return
	}

	// Record operation log with full item details.
	logData := map[string]interface{}{
		"items":   req.Items,
		"created": result.Created,
		"updated": result.Updated,
		"total":   result.Total,
	}
	if req.AlertThreshold != nil {
		logData["alert_threshold"] = *req.AlertThreshold
	}
	middleware.LogOperation(h.db, c, "batch_stock_in", "inventory_drug", 0, nil, logData)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    result,
	})
}

// StockIn handles POST /api/v1/inventory/drugs/:id/stock-in.
func (h *InventoryDrugHandler) StockIn(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid inventory drug id",
		})
		return
	}

	var req service.StockInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewInventoryDrugService(h.db)

	// Find the drug first
	var drug service.StockInDrugResult
	drug, err = svc.StockIn(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrInventoryDrugNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "inventory drug not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "stock-in failed",
		})
		return
	}

	middleware.LogOperation(h.db, c, "stock_in", "inventory_drug", id, drug.OldDrug, drug.NewDrug)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    drug.NewDrug,
	})
}
