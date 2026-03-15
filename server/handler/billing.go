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

// BillingHandler handles billing endpoints.
type BillingHandler struct {
	db *gorm.DB
}

// NewBillingHandler creates a new BillingHandler.
func NewBillingHandler(db *gorm.DB) *BillingHandler {
	return &BillingHandler{db: db}
}

// GetDetail handles GET /api/v1/prescriptions/:id/billing.
func (h *BillingHandler) GetDetail(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	prescriptionID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid prescription id"})
		return
	}

	svc := service.NewBillingService(h.db)
	detail, err := svc.GetBillingDetail(tenantID, prescriptionID)
	if err != nil {
		if errors.Is(err, service.ErrPrescriptionNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "prescription not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get billing detail"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": detail})
}

// Create handles POST /api/v1/prescriptions/:id/billing.
func (h *BillingHandler) Create(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)
	prescriptionID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid prescription id"})
		return
	}

	var req service.CreateBillingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid request: " + err.Error()})
		return
	}

	svc := service.NewBillingService(h.db)
	billing, err := svc.CreateBilling(tenantID, userID, prescriptionID, &req)
	if err != nil {
		if errors.Is(err, service.ErrPrescriptionNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "prescription not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to create billing"})
		return
	}

	middleware.LogOperation(h.db, c, "create", "billing", billing.ID, nil, billing)
	c.JSON(http.StatusCreated, gin.H{"code": 0, "message": "success", "data": billing})
}

// DeductStock handles POST /api/v1/prescriptions/:id/billing/deduct-stock.
func (h *BillingHandler) DeductStock(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)
	prescriptionID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid prescription id"})
		return
	}

	var req service.CreateBillingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid request: " + err.Error()})
		return
	}

	svc := service.NewBillingService(h.db)
	billing, err := svc.DeductStockAndBill(tenantID, userID, prescriptionID, &req)
	if err != nil {
		if errors.Is(err, service.ErrPrescriptionNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "prescription not found"})
			return
		}
		if errors.Is(err, service.ErrStockAlreadyDeducted) {
			c.JSON(http.StatusConflict, gin.H{"code": 409, "message": "stock already deducted"})
			return
		}
		if errors.Is(err, service.ErrInsufficientStock) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to deduct stock"})
		return
	}

	middleware.LogOperation(h.db, c, "deduct_stock", "billing", billing.ID, nil, billing)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": billing})
}

// GetRecordBillingDetail handles GET /api/v1/records/:id/billing-detail.
func (h *BillingHandler) GetRecordBillingDetail(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	recordID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid record id"})
		return
	}

	svc := service.NewBillingService(h.db)
	detail, err := svc.GetRecordBillingDetail(tenantID, recordID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get billing detail"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": detail})
}

// CreateRecordBilling handles POST /api/v1/records/:id/billing.
func (h *BillingHandler) CreateRecordBilling(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)
	recordID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid record id"})
		return
	}

	var req service.CreateBillingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid request: " + err.Error()})
		return
	}

	svc := service.NewBillingService(h.db)
	billing, err := svc.CreateRecordBilling(tenantID, userID, recordID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to create billing"})
		return
	}

	middleware.LogOperation(h.db, c, "create", "billing", billing.ID, nil, billing)
	c.JSON(http.StatusCreated, gin.H{"code": 0, "message": "success", "data": billing})
}

// ListByRecord handles GET /api/v1/records/:id/billings.
func (h *BillingHandler) ListByRecord(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	recordID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid record id"})
		return
	}

	svc := service.NewBillingService(h.db)
	billings, err := svc.ListBillingsByRecord(tenantID, recordID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to list billings"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": billings})
}
