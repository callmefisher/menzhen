package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// TenantHandler handles tenant management endpoints.
type TenantHandler struct {
	db *gorm.DB
}

// NewTenantHandler creates a new TenantHandler.
func NewTenantHandler(db *gorm.DB) *TenantHandler {
	return &TenantHandler{db: db}
}

// List handles GET /api/v1/tenants.
func (h *TenantHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewTenantService(h.db)
	tenants, total, err := svc.ListTenants(page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list tenants",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  tenants,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// Create handles POST /api/v1/tenants.
func (h *TenantHandler) Create(c *gin.Context) {
	var req service.CreateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewTenantService(h.db)
	tenant, err := svc.CreateTenant(&req)
	if err != nil {
		if errors.Is(err, service.ErrTenantCodeExist) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": "tenant code already exists",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to create tenant",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    tenant,
	})
}

// Update handles PUT /api/v1/tenants/:id.
func (h *TenantHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid tenant id",
		})
		return
	}

	var req service.UpdateTenantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewTenantService(h.db)
	tenant, err := svc.UpdateTenant(id, &req)
	if err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "tenant not found",
			})
			return
		}
		if errors.Is(err, service.ErrTenantCodeExist) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    409,
				"message": "tenant code already exists",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update tenant",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    tenant,
	})
}

// Delete handles DELETE /api/v1/tenants/:id.
func (h *TenantHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid tenant id",
		})
		return
	}

	svc := service.NewTenantService(h.db)
	if err := svc.DeleteTenant(id); err != nil {
		if errors.Is(err, service.ErrTenantNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "tenant not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to delete tenant",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}
