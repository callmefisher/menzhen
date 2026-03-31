package handler

import (
	"net/http"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// StatisticsHandler handles dashboard statistics API requests.
type StatisticsHandler struct {
	db  *gorm.DB
	svc *service.StatisticsService
}

// NewStatisticsHandler creates a new StatisticsHandler.
func NewStatisticsHandler(db *gorm.DB) *StatisticsHandler {
	return &StatisticsHandler{
		db:  db,
		svc: service.NewStatisticsService(db),
	}
}

// GetDashboard returns aggregated statistics for the given date range.
// Query params: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)
func (h *StatisticsHandler) GetDashboard(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	startStr := c.Query("start_date")
	endStr := c.Query("end_date")

	if startStr == "" || endStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "start_date and end_date are required"})
		return
	}

	startDate, err := time.ParseInLocation("2006-01-02", startStr, time.Local)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid start_date format, use YYYY-MM-DD"})
		return
	}
	endDate, err := time.ParseInLocation("2006-01-02", endStr, time.Local)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid end_date format, use YYYY-MM-DD"})
		return
	}

	if endDate.Before(startDate) {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "end_date must be after start_date"})
		return
	}

	result, err := h.svc.GetDashboard(tenantID, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get dashboard data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": result})
}

// RebuildStats recomputes all daily_stats rows for the current tenant.
func (h *StatisticsHandler) RebuildStats(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	if err := h.svc.RebuildAllDailyStats(tenantID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to rebuild statistics"})
		return
	}

	if err := h.svc.RebuildAllDailyStaffStats(tenantID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to rebuild staff statistics"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "statistics rebuilt successfully"})
}

// GetStaffRevenue returns per-user revenue stats for the given date range.
// Query params: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)
func (h *StatisticsHandler) GetStaffRevenue(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	startStr := c.Query("start_date")
	endStr := c.Query("end_date")

	if startStr == "" || endStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "start_date and end_date are required"})
		return
	}

	startDate, err := time.ParseInLocation("2006-01-02", startStr, time.Local)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid start_date format, use YYYY-MM-DD"})
		return
	}
	endDate, err := time.ParseInLocation("2006-01-02", endStr, time.Local)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid end_date format, use YYYY-MM-DD"})
		return
	}

	if endDate.Before(startDate) {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "end_date must be after start_date"})
		return
	}

	result, err := h.svc.GetStaffRevenue(tenantID, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get staff revenue data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": result})
}
