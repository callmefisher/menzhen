package service

import (
	"errors"
	"log"
	"strings"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/storage"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
)

var (
	ErrRecordNotFound  = errors.New("record not found")
	ErrPatientInvalid  = errors.New("patient not found or does not belong to this tenant")
)

// CreateRecordRequest is the input for creating a new medical record.
type CreateRecordRequest struct {
	PatientID         uint64              `json:"patient_id" binding:"required"`
	Diagnosis         string              `json:"diagnosis"`
	Treatment         string              `json:"treatment"`
	Notes             string              `json:"notes"`
	VisitDate         string              `json:"visit_date" binding:"required"` // YYYY-MM-DD
	ChiefComplaint    string              `json:"chief_complaint"`
	PulseID           *uint64             `json:"pulse_id"`
	PulseName         string              `json:"pulse_name"`
	TongueImage       string              `json:"tongue_image"`
	TongueDescription string              `json:"tongue_description"`
	TongueAnalysis    string              `json:"tongue_analysis"`
	Attachments       []AttachmentRequest `json:"attachments"`
}

// AttachmentRequest describes a file attachment for a medical record.
type AttachmentRequest struct {
	FileType string `json:"file_type" binding:"required"` // image/audio/video
	FileName string `json:"file_name" binding:"required"`
	FilePath string `json:"file_path" binding:"required"` // MinIO object key
	FileSize int64  `json:"file_size"`
}

// UpdateRecordRequest is the input for updating an existing medical record.
// Pointer fields distinguish between "not provided" and "zero value".
type UpdateRecordRequest struct {
	Diagnosis         *string             `json:"diagnosis"`
	Treatment         *string             `json:"treatment"`
	Notes             *string             `json:"notes"`
	VisitDate         *string             `json:"visit_date"`
	ChiefComplaint    *string             `json:"chief_complaint"`
	PulseID           *uint64             `json:"pulse_id"`
	PulseName         *string             `json:"pulse_name"`
	TongueImage       *string             `json:"tongue_image"`
	TongueDescription *string             `json:"tongue_description"`
	TongueAnalysis    *string             `json:"tongue_analysis"`
	Attachments       []AttachmentRequest `json:"attachments"` // replace all attachments if provided (non-nil slice)
}

// RecordListItem is a flattened view used for paginated listing.
type RecordListItem struct {
	ID             uint64    `json:"id"`
	PatientID      uint64    `json:"patient_id"`
	PatientName    string    `json:"patient_name"`
	PatientAge     int       `json:"patient_age"`
	Diagnosis      string    `json:"diagnosis"`
	ChiefComplaint string    `json:"chief_complaint"`
	PulseName      string    `json:"pulse_name"`
	VisitDate      string    `json:"visit_date"`
	CreatedAt      time.Time `json:"created_at"`
}

// RecordService handles medical-record-related business logic.
type RecordService struct {
	DB          *gorm.DB
	MinIOClient *minio.Client
	MinIOBucket string
}

// NewRecordService creates a new RecordService.
func NewRecordService(db *gorm.DB, minioClient ...*minio.Client) *RecordService {
	s := &RecordService{DB: db}
	if len(minioClient) > 0 {
		s.MinIOClient = minioClient[0]
	}
	return s
}

// SetMinIO sets the MinIO client and bucket for file cleanup operations.
func (s *RecordService) SetMinIO(client *minio.Client, bucket string) {
	s.MinIOClient = client
	s.MinIOBucket = bucket
}

// cleanupFiles deletes files from MinIO in the background. Best-effort: logs errors but does not fail.
func (s *RecordService) cleanupFiles(filePaths []string) {
	if s.MinIOClient == nil || s.MinIOBucket == "" || len(filePaths) == 0 {
		return
	}
	go func() {
		failed := storage.DeleteFiles(s.MinIOClient, s.MinIOBucket, filePaths)
		if len(failed) > 0 {
			log.Printf("[RecordService] failed to cleanup %d files: %v", len(failed), failed)
		}
	}()
}

// CreateRecord creates a new medical record, optionally with attachments.
func (s *RecordService) CreateRecord(tenantID, createdBy uint64, req *CreateRecordRequest) (*model.MedicalRecord, error) {
	// Verify the patient exists and belongs to the tenant.
	var patient model.Patient
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&patient, req.PatientID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPatientInvalid
		}
		return nil, err
	}

	// Parse visit date.
	visitDate, err := time.Parse("2006-01-02", req.VisitDate)
	if err != nil {
		return nil, errors.New("invalid visit_date format, expected YYYY-MM-DD")
	}

	record := model.MedicalRecord{
		PatientID:         req.PatientID,
		TenantID:          tenantID,
		Diagnosis:         req.Diagnosis,
		Treatment:         req.Treatment,
		Notes:             req.Notes,
		VisitDate:         visitDate,
		CreatedBy:         createdBy,
		ChiefComplaint:    req.ChiefComplaint,
		PulseID:           req.PulseID,
		PulseName:         req.PulseName,
		TongueImage:       req.TongueImage,
		TongueDescription: req.TongueDescription,
		TongueAnalysis:    req.TongueAnalysis,
	}

	// Use a transaction to create record and attachments atomically.
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&record).Error; err != nil {
			return err
		}

		if len(req.Attachments) > 0 {
			attachments := make([]model.RecordAttachment, 0, len(req.Attachments))
			for _, a := range req.Attachments {
				attachments = append(attachments, model.RecordAttachment{
					RecordID: record.ID,
					FileType: a.FileType,
					FileName: a.FileName,
					FilePath: a.FilePath,
					FileSize: a.FileSize,
				})
			}
			if err := tx.Create(&attachments).Error; err != nil {
				return err
			}
			record.Attachments = attachments
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Attach patient info for oplog display.
	record.Patient = patient

	return &record, nil
}

// GetRecord retrieves a medical record by ID within the given tenant scope.
// It preloads Attachments and Patient (basic info).
func (s *RecordService) GetRecord(tenantID uint64, id uint64) (*model.MedicalRecord, error) {
	var record model.MedicalRecord
	err := s.DB.
		Where("tenant_id = ?", tenantID).
		Preload("Attachments").
		Preload("Patient").
		Preload("Pulse").
		First(&record, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordNotFound
		}
		return nil, err
	}

	return &record, nil
}

// ListRecords returns a paginated list of medical records for the given tenant.
// Supports filtering by patient name and visit date.
func (s *RecordService) ListRecords(tenantID uint64, name, date string, patientID uint64, page, size int) ([]RecordListItem, int64, error) {
	var items []RecordListItem
	var total int64

	query := s.DB.Table("medical_records").
		Select("medical_records.id, medical_records.patient_id, patients.name AS patient_name, patients.age AS patient_age, medical_records.diagnosis, medical_records.chief_complaint, medical_records.pulse_name, DATE_FORMAT(medical_records.visit_date, '%Y-%m-%d') AS visit_date, medical_records.created_at").
		Joins("JOIN patients ON patients.id = medical_records.patient_id").
		Where("medical_records.tenant_id = ? AND medical_records.deleted_at IS NULL", tenantID)

	if patientID > 0 {
		query = query.Where("medical_records.patient_id = ?", patientID)
	}
	if name != "" {
		query = query.Where("patients.name LIKE ?", "%"+name+"%")
	}
	if date != "" {
		dates := strings.Split(date, ",")
		if len(dates) == 2 {
			query = query.Where("medical_records.visit_date BETWEEN ? AND ?", dates[0], dates[1])
		} else {
			query = query.Where("medical_records.visit_date = ?", date)
		}
	}

	// Get total count before pagination.
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Fetch paginated results (deterministic order: newest visit first, then highest id first).
	if err := query.Order("medical_records.visit_date DESC, medical_records.id DESC").
		Offset((page - 1) * size).
		Limit(size).
		Scan(&items).Error; err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

// FindRecordPage returns which page (1-based) a record appears on in the default listing order.
func (s *RecordService) FindRecordPage(tenantID, recordID uint64, size int) (int, error) {
	if size <= 0 {
		size = 20
	}
	// Count how many records come before this one in visit_date DESC, id DESC order.
	// Records with a later visit_date, or same date but higher ID, come first.
	var record model.MedicalRecord
	if err := s.DB.Select("visit_date").Where("id = ? AND tenant_id = ? AND deleted_at IS NULL", recordID, tenantID).First(&record).Error; err != nil {
		return 1, err
	}

	var position int64
	s.DB.Table("medical_records").
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Where("visit_date > ? OR (visit_date = ? AND id > ?)", record.VisitDate, record.VisitDate, recordID).
		Count(&position)

	page := int(position)/size + 1
	return page, nil
}
// before the update (for oplog old_data) and the updated record.
func (s *RecordService) UpdateRecord(tenantID uint64, id uint64, req *UpdateRecordRequest) (*model.MedicalRecord, *model.MedicalRecord, error) {
	var record model.MedicalRecord
	if err := s.DB.Where("tenant_id = ?", tenantID).Preload("Attachments").First(&record, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrRecordNotFound
		}
		return nil, nil, err
	}

	// Save a copy of the old data for oplog.
	oldRecord := record
	oldRecord.Attachments = make([]model.RecordAttachment, len(record.Attachments))
	copy(oldRecord.Attachments, record.Attachments)

	// Build update map from non-nil fields.
	updates := make(map[string]interface{})
	if req.Diagnosis != nil {
		updates["diagnosis"] = *req.Diagnosis
	}
	if req.Treatment != nil {
		updates["treatment"] = *req.Treatment
	}
	if req.Notes != nil {
		updates["notes"] = *req.Notes
	}
	if req.VisitDate != nil {
		visitDate, err := time.Parse("2006-01-02", *req.VisitDate)
		if err != nil {
			return nil, nil, errors.New("invalid visit_date format, expected YYYY-MM-DD")
		}
		updates["visit_date"] = visitDate
	}
	if req.ChiefComplaint != nil {
		updates["chief_complaint"] = *req.ChiefComplaint
	}
	if req.PulseID != nil {
		updates["pulse_id"] = *req.PulseID
	}
	if req.PulseName != nil {
		updates["pulse_name"] = *req.PulseName
	}
	if req.TongueImage != nil {
		updates["tongue_image"] = *req.TongueImage
	}
	if req.TongueDescription != nil {
		updates["tongue_description"] = *req.TongueDescription
	}
	if req.TongueAnalysis != nil {
		updates["tongue_analysis"] = *req.TongueAnalysis
	}

	// Collect old file paths that should be cleaned up after transaction.
	var filesToCleanup []string

	// If attachments are being replaced, collect old attachment file paths
	// that are not present in the new attachment list.
	if req.Attachments != nil {
		newPaths := make(map[string]bool, len(req.Attachments))
		for _, a := range req.Attachments {
			newPaths[a.FilePath] = true
		}
		for _, a := range record.Attachments {
			if !newPaths[a.FilePath] {
				filesToCleanup = append(filesToCleanup, a.FilePath)
			}
		}
	}

	// If tongue image is being changed, collect old tongue image path.
	if req.TongueImage != nil && record.TongueImage != "" && *req.TongueImage != record.TongueImage {
		filesToCleanup = append(filesToCleanup, record.TongueImage)
	}

	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if len(updates) > 0 {
			if err := tx.Model(&record).Updates(updates).Error; err != nil {
				return err
			}
		}

		// Replace all attachments if the slice is provided (non-nil).
		if req.Attachments != nil {
			// Delete existing attachments.
			if err := tx.Where("record_id = ?", id).Delete(&model.RecordAttachment{}).Error; err != nil {
				return err
			}

			// Create new attachments.
			if len(req.Attachments) > 0 {
				attachments := make([]model.RecordAttachment, 0, len(req.Attachments))
				for _, a := range req.Attachments {
					attachments = append(attachments, model.RecordAttachment{
						RecordID: id,
						FileType: a.FileType,
						FileName: a.FileName,
						FilePath: a.FilePath,
						FileSize: a.FileSize,
					})
				}
				if err := tx.Create(&attachments).Error; err != nil {
					return err
				}
			}
		}

		return nil
	})
	if err != nil {
		return nil, nil, err
	}

	// Clean up old files from MinIO after successful transaction.
	s.cleanupFiles(filesToCleanup)

	// Reload to get the updated record with attachments.
	if err := s.DB.Where("tenant_id = ?", tenantID).Preload("Attachments").Preload("Patient").First(&record, id).Error; err != nil {
		return nil, nil, err
	}

	return &oldRecord, &record, nil
}

// DeleteRecord soft-deletes a medical record and all associated data
// (attachments, prescriptions, prescription items, AI analyses).
// It returns the record data before deletion (for oplog old_data).
func (s *RecordService) DeleteRecord(tenantID uint64, id uint64) (*model.MedicalRecord, error) {
	var record model.MedicalRecord
	if err := s.DB.Where("tenant_id = ?", tenantID).
		Preload("Attachments").
		Preload("Prescriptions.Items").
		Preload("Patient").
		First(&record, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordNotFound
		}
		return nil, err
	}

	// Collect file paths to clean up after transaction.
	var filesToCleanup []string
	for _, a := range record.Attachments {
		filesToCleanup = append(filesToCleanup, a.FilePath)
	}
	if record.TongueImage != "" {
		filesToCleanup = append(filesToCleanup, record.TongueImage)
	}

	err := s.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Hard-delete prescription items (no soft delete) for all prescriptions of this record
		var prescriptionIDs []uint64
		for _, p := range record.Prescriptions {
			prescriptionIDs = append(prescriptionIDs, p.ID)
		}
		if len(prescriptionIDs) > 0 {
			if err := tx.Where("prescription_id IN ?", prescriptionIDs).
				Delete(&model.PrescriptionItem{}).Error; err != nil {
				return err
			}
		}

		// 2. Soft-delete prescriptions
		if len(record.Prescriptions) > 0 {
			if err := tx.Where("record_id = ? AND tenant_id = ?", id, tenantID).
				Delete(&model.Prescription{}).Error; err != nil {
				return err
			}
		}

		// 3. Hard-delete attachments (no soft delete)
		if err := tx.Where("record_id = ?", id).
			Delete(&model.RecordAttachment{}).Error; err != nil {
			return err
		}

		// 4. Soft-delete AI analysis
		if err := tx.Where("record_id = ? AND tenant_id = ?", id, tenantID).
			Delete(&model.AIAnalysis{}).Error; err != nil {
			return err
		}

		// 5. Soft-delete the record itself
		if err := tx.Delete(&record).Error; err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// Clean up files from MinIO after successful transaction.
	s.cleanupFiles(filesToCleanup)

	// Refresh daily stats: visit date (record/patient counts) and billing dates (revenue).
	statsSvc := NewStatisticsService(s.DB)
	_ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
	if err := statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, record.VisitDate); err != nil {
		log.Printf("RefreshDailyStaffStats failed for tenant=%d user=%d: %v", tenantID, record.CreatedBy, err)
	}
	// Also refresh any billing dates that differ from visit date.
	var billingDates []time.Time
	s.DB.Unscoped().Model(&model.Billing{}).
		Select("DATE(created_at) AS billing_date").
		Where("record_id = ? AND tenant_id = ?", id, tenantID).
		Group("DATE(created_at)").
		Pluck("billing_date", &billingDates)
	for _, bd := range billingDates {
		if !sameDay(bd, record.VisitDate) {
			_ = statsSvc.RefreshDailyStats(tenantID, bd)
			if err := statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, bd); err != nil {
				log.Printf("RefreshDailyStaffStats failed for tenant=%d user=%d: %v", tenantID, record.CreatedBy, err)
			}
		}
	}

	return &record, nil
}
