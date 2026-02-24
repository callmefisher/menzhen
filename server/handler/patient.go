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

// PatientHandler handles patient CRUD endpoints.
type PatientHandler struct {
	db *gorm.DB
}

// NewPatientHandler creates a new PatientHandler.
func NewPatientHandler(db *gorm.DB) *PatientHandler {
	return &PatientHandler{db: db}
}

// Create handles POST /api/v1/patients.
func (h *PatientHandler) Create(c *gin.Context) {
	var req service.CreatePatientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)

	svc := service.NewPatientService(h.db)
	patient, err := svc.CreatePatient(tenantID, userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to create patient",
		})
		return
	}

	// Record operation log (best-effort).
	middleware.LogOperation(h.db, c, "create", "patient", patient.ID, nil, patient)

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    patient,
	})
}

// List handles GET /api/v1/patients.
func (h *PatientHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	name := c.Query("name")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewPatientService(h.db)
	patients, total, err := svc.ListPatients(tenantID, name, page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list patients",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  patients,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// Detail handles GET /api/v1/patients/:id.
func (h *PatientHandler) Detail(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid patient id",
		})
		return
	}

	svc := service.NewPatientService(h.db)
	patient, err := svc.GetPatient(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrPatientNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "patient not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to get patient",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    patient,
	})
}

// Update handles PUT /api/v1/patients/:id.
func (h *PatientHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid patient id",
		})
		return
	}

	var req service.UpdatePatientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewPatientService(h.db)
	oldPatient, newPatient, err := svc.UpdatePatient(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrPatientNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "patient not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update patient",
		})
		return
	}

	// Record operation log (best-effort).
	middleware.LogOperation(h.db, c, "update", "patient", id, oldPatient, newPatient)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    newPatient,
	})
}

// Delete handles DELETE /api/v1/patients/:id.
func (h *PatientHandler) Delete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid patient id",
		})
		return
	}

	svc := service.NewPatientService(h.db)
	oldPatient, err := svc.DeletePatient(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrPatientNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "patient not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to delete patient",
		})
		return
	}

	// Record operation log (best-effort).
	middleware.LogOperation(h.db, c, "delete", "patient", id, oldPatient, nil)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}
