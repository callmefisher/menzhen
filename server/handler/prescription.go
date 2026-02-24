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

// PrescriptionHandler handles prescription CRUD endpoints.
type PrescriptionHandler struct {
	db *gorm.DB
}

// NewPrescriptionHandler creates a new PrescriptionHandler.
func NewPrescriptionHandler(db *gorm.DB) *PrescriptionHandler {
	return &PrescriptionHandler{db: db}
}

// Create handles POST /api/v1/prescriptions.
func (h *PrescriptionHandler) Create(c *gin.Context) {
	var req service.CreatePrescriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)

	svc := service.NewPrescriptionService(h.db)
	prescription, err := svc.Create(tenantID, userID, &req)
	if err != nil {
		if errors.Is(err, service.ErrRecordInvalid) {
			Error(c, http.StatusBadRequest, err.Error())
			return
		}
		Error(c, http.StatusInternalServerError, "failed to create prescription")
		return
	}

	middleware.LogOperation(h.db, c, "create", "prescription", prescription.ID, nil, prescription)

	Created(c, prescription)
}

// Detail handles GET /api/v1/prescriptions/:id.
func (h *PrescriptionHandler) Detail(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid prescription id")
		return
	}

	svc := service.NewPrescriptionService(h.db)
	prescription, err := svc.Get(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrPrescriptionNotFound) {
			Error(c, http.StatusNotFound, "prescription not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get prescription")
		return
	}

	Success(c, prescription)
}

// ListByRecord handles GET /api/v1/records/:id/prescriptions.
func (h *PrescriptionHandler) ListByRecord(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	recordID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid record id")
		return
	}

	svc := service.NewPrescriptionService(h.db)
	prescriptions, err := svc.ListByRecord(tenantID, recordID)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to list prescriptions")
		return
	}

	Success(c, prescriptions)
}

// Update handles PUT /api/v1/prescriptions/:id.
func (h *PrescriptionHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid prescription id")
		return
	}

	var req service.UpdatePrescriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	svc := service.NewPrescriptionService(h.db)
	oldPrescription, newPrescription, err := svc.Update(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrPrescriptionNotFound) {
			Error(c, http.StatusNotFound, "prescription not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update prescription")
		return
	}

	middleware.LogOperation(h.db, c, "update", "prescription", id, oldPrescription, newPrescription)

	Success(c, newPrescription)
}

// Delete handles DELETE /api/v1/prescriptions/:id.
func (h *PrescriptionHandler) Delete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid prescription id")
		return
	}

	svc := service.NewPrescriptionService(h.db)
	oldPrescription, err := svc.Delete(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrPrescriptionNotFound) {
			Error(c, http.StatusNotFound, "prescription not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to delete prescription")
		return
	}

	middleware.LogOperation(h.db, c, "delete", "prescription", id, oldPrescription, nil)

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success"})
}
