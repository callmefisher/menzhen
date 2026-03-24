package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/ws"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PrescriptionNotificationHandler struct {
	db *gorm.DB
}

func NewPrescriptionNotificationHandler(db *gorm.DB) *PrescriptionNotificationHandler {
	return &PrescriptionNotificationHandler{db: db}
}

func (h *PrescriptionNotificationHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	status := c.Query("status")

	svc := service.NewPrescriptionNotificationService(h.db)
	list, err := svc.ListByTenant(tenantID, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to list notifications"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": list})
}

func (h *PrescriptionNotificationHandler) Detail(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid id"})
		return
	}

	svc := service.NewPrescriptionNotificationService(h.db)
	detail, err := svc.GetDetail(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrNotificationNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "notification not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get detail"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": detail})
}

func (h *PrescriptionNotificationHandler) MarkDone(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid id"})
		return
	}

	svc := service.NewPrescriptionNotificationService(h.db)
	if err := svc.MarkDone(tenantID, id); err != nil {
		if errors.Is(err, service.ErrNotificationNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "notification not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to mark done"})
		return
	}

	// Broadcast rx_done via WebSocket
	ws.DefaultHub.Broadcast(tenantID, ws.Message{
		Type:    "rx_done",
		Payload: gin.H{"id": id},
	})

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success"})
}

func (h *PrescriptionNotificationHandler) BatchDone(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	svc := service.NewPrescriptionNotificationService(h.db)
	affected, err := svc.BatchMarkDone(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to batch mark done"})
		return
	}

	// Broadcast rx_done with batch flag
	ws.DefaultHub.Broadcast(tenantID, ws.Message{
		Type:    "rx_done",
		Payload: gin.H{"batch": true, "affected": affected},
	})

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": gin.H{"affected": affected}})
}

func (h *PrescriptionNotificationHandler) PendingCount(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	svc := service.NewPrescriptionNotificationService(h.db)
	count, err := svc.PendingCount(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get count"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": gin.H{"count": count}})
}
