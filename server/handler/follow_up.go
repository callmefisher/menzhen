package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// FollowUpHandler handles follow-up CRUD endpoints.
type FollowUpHandler struct {
	db *gorm.DB
}

// NewFollowUpHandler creates a new FollowUpHandler.
func NewFollowUpHandler(db *gorm.DB) *FollowUpHandler {
	return &FollowUpHandler{db: db}
}

// List handles GET /api/v1/follow-ups.
func (h *FollowUpHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	patientName := c.Query("patient_name")
	patientIDStr := c.Query("patient_id")
	recordIDStr := c.Query("record_id")
	status := c.Query("status")
	isRecoveredStr := c.Query("is_recovered")
	if isRecoveredStr != "" && isRecoveredStr != "true" && isRecoveredStr != "false" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid is_recovered, must be true or false"})
		return
	}
	plannedFrom := c.Query("planned_date_from")
	plannedTo := c.Query("planned_date_to")

	var patientID uint64
	if patientIDStr != "" {
		var err error
		patientID, err = strconv.ParseUint(patientIDStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": "invalid patient_id",
			})
			return
		}
	}
	var recordID uint64
	if recordIDStr != "" {
		var err error
		recordID, err = strconv.ParseUint(recordIDStr, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": "invalid record_id",
			})
			return
		}
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	sortOrder := c.DefaultQuery("sort_order", "asc")
	if sortOrder != "asc" && sortOrder != "desc" {
		sortOrder = "asc"
	}

	svc := service.NewFollowUpService(h.db)
	items, total, err := svc.List(tenantID, patientID, recordID, patientName, status, isRecoveredStr, plannedFrom, plannedTo, page, size, sortOrder)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list follow-ups",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  items,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// Create handles POST /api/v1/follow-ups.
func (h *FollowUpHandler) Create(c *gin.Context) {
	var req service.CreateFollowUpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)

	svc := service.NewFollowUpService(h.db)
	followUp, err := svc.Create(tenantID, userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to create follow-up: " + err.Error(),
		})
		return
	}

	middleware.LogOperation(h.db, c, "create", "follow_up", followUp.ID, nil, followUp)

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    followUp,
	})
}

// Detail handles GET /api/v1/follow-ups/:id.
// Computes overdue virtual status before returning.
func (h *FollowUpHandler) Detail(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid follow-up id",
		})
		return
	}

	svc := service.NewFollowUpService(h.db)
	followUp, err := svc.GetByID(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrFollowUpNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "follow-up not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to get follow-up",
		})
		return
	}

	// Compute overdue virtual status
	status := followUp.Status
	today := time.Now().Format("2006-01-02")
	plannedStr := followUp.PlannedDate.Format("2006-01-02")
	if status == "pending" && plannedStr < today {
		status = "overdue"
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"id":           followUp.ID,
			"tenant_id":    followUp.TenantID,
			"patient_id":   followUp.PatientID,
			"record_id":    followUp.RecordID,
			"planned_date": plannedStr,
			"actual_date":  followUp.ActualDate,
			"status":       status,
			"method":       followUp.Method,
			"content":      followUp.Content,
			"is_recovered": followUp.IsRecovered,
			"created_by":   followUp.CreatedBy,
			"created_at":   followUp.CreatedAt,
			"updated_at":   followUp.UpdatedAt,
		},
	})
}

// Update handles PUT /api/v1/follow-ups/:id.
func (h *FollowUpHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid follow-up id",
		})
		return
	}

	var req service.UpdateFollowUpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewFollowUpService(h.db)
	oldFollowUp, newFollowUp, err := svc.Update(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrFollowUpNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "follow-up not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update follow-up: " + err.Error(),
		})
		return
	}

	middleware.LogOperation(h.db, c, "update", "follow_up", id, oldFollowUp, newFollowUp)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    newFollowUp,
	})
}

// Delete handles DELETE /api/v1/follow-ups/:id.
func (h *FollowUpHandler) Delete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid follow-up id",
		})
		return
	}

	svc := service.NewFollowUpService(h.db)
	oldFollowUp, err := svc.Delete(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrFollowUpNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "follow-up not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to delete follow-up",
		})
		return
	}

	middleware.LogOperation(h.db, c, "delete", "follow_up", id, oldFollowUp, nil)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}

// Stats handles GET /api/v1/follow-ups/stats.
func (h *FollowUpHandler) Stats(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	svc := service.NewFollowUpService(h.db)
	stats, err := svc.Stats(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to get follow-up stats",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    stats,
	})
}
