package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
)

// RecordHandler handles medical record CRUD endpoints.
type RecordHandler struct {
	db          *gorm.DB
	minioClient *minio.Client
	minioBucket string
}

// NewRecordHandler creates a new RecordHandler.
func NewRecordHandler(db *gorm.DB, minioClient *minio.Client, bucket string) *RecordHandler {
	return &RecordHandler{db: db, minioClient: minioClient, minioBucket: bucket}
}

// newRecordService creates a RecordService with MinIO client configured.
func (h *RecordHandler) newRecordService() *service.RecordService {
	svc := service.NewRecordService(h.db)
	svc.SetMinIO(h.minioClient, h.minioBucket)
	return svc
}

// Create handles POST /api/v1/records.
func (h *RecordHandler) Create(c *gin.Context) {
	var req service.CreateRecordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)

	svc := h.newRecordService()
	record, err := svc.CreateRecord(tenantID, userID, &req)
	if err != nil {
		if errors.Is(err, service.ErrPatientInvalid) {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    400,
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to create record",
		})
		return
	}

	// Record operation log (best-effort).
	middleware.LogOperation(h.db, c, "create", "medical_record", record.ID, nil, record)

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    record,
	})
}

// List handles GET /api/v1/records.
func (h *RecordHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	name := c.Query("name")
	date := c.Query("date")
	patientID, _ := strconv.ParseUint(c.Query("patient_id"), 10, 64)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := h.newRecordService()
	records, total, err := svc.ListRecords(tenantID, name, date, patientID, page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list records",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  records,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// FindPage handles GET /api/v1/records/:id/page — returns which page a record is on.
func (h *RecordHandler) FindPage(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid record id"})
		return
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := h.newRecordService()
	page, err := svc.FindRecordPage(tenantID, id, size)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"page": 1}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"page": page}})
}

// Detail handles GET /api/v1/records/:id.
func (h *RecordHandler) Detail(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid record id",
		})
		return
	}

	svc := h.newRecordService()
	record, err := svc.GetRecord(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "record not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to get record",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    record,
	})
}

// Update handles PUT /api/v1/records/:id.
func (h *RecordHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid record id",
		})
		return
	}

	var req service.UpdateRecordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := h.newRecordService()
	oldRecord, newRecord, err := svc.UpdateRecord(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "record not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update record",
		})
		return
	}

	// Record operation log (best-effort).
	middleware.LogOperation(h.db, c, "update", "medical_record", id, oldRecord, newRecord)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    newRecord,
	})
}

// Delete handles DELETE /api/v1/records/:id.
func (h *RecordHandler) Delete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid record id",
		})
		return
	}

	svc := h.newRecordService()
	oldRecord, err := svc.DeleteRecord(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "record not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to delete record",
		})
		return
	}

	// Record operation log (best-effort).
	middleware.LogOperation(h.db, c, "delete", "medical_record", id, oldRecord, nil)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}
