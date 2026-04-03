package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AdminStatisticsHandler handles cross-tenant statistics for superAdmin.
type AdminStatisticsHandler struct {
	db  *gorm.DB
	svc *service.AdminStatisticsService
}

// NewAdminStatisticsHandler creates a new AdminStatisticsHandler.
func NewAdminStatisticsHandler(db *gorm.DB) *AdminStatisticsHandler {
	return &AdminStatisticsHandler{db: db, svc: service.NewAdminStatisticsService(db)}
}

// GetGlobal handles GET /api/v1/admin/statistics/global
// Query params: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), page (default 1), size (default 50, max 200)
func (h *AdminStatisticsHandler) GetGlobal(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if !service.IsProtectedAdminAccount(h.db, userID) {
		c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "仅超级管理员可访问全局统计"})
		return
	}

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
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "end_date must not be before start_date"})
		return
	}

	page := 1
	if p, err := strconv.Atoi(c.DefaultQuery("page", "1")); err == nil && p > 0 {
		page = p
	}
	size := 50
	if s, err := strconv.Atoi(c.DefaultQuery("size", "50")); err == nil && s > 0 && s <= 200 {
		size = s
	}

	result, err := h.svc.GetGlobalStats(startDate, endDate, page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get global statistics"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": result})
}
