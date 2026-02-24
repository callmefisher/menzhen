package service

import (
	"errors"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrRecordNotFound  = errors.New("record not found")
	ErrPatientInvalid  = errors.New("patient not found or does not belong to this tenant")
)

// CreateRecordRequest is the input for creating a new medical record.
type CreateRecordRequest struct {
	PatientID   uint64              `json:"patient_id" binding:"required"`
	Diagnosis   string              `json:"diagnosis"`
	Treatment   string              `json:"treatment"`
	Notes       string              `json:"notes"`
	VisitDate   string              `json:"visit_date" binding:"required"` // YYYY-MM-DD
	Attachments []AttachmentRequest `json:"attachments"`
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
	Diagnosis   *string             `json:"diagnosis"`
	Treatment   *string             `json:"treatment"`
	Notes       *string             `json:"notes"`
	VisitDate   *string             `json:"visit_date"`
	Attachments []AttachmentRequest `json:"attachments"` // replace all attachments if provided (non-nil slice)
}

// RecordListItem is a flattened view used for paginated listing.
type RecordListItem struct {
	ID          uint64    `json:"id"`
	PatientID   uint64    `json:"patient_id"`
	PatientName string    `json:"patient_name"`
	PatientAge  int       `json:"patient_age"`
	Diagnosis   string    `json:"diagnosis"`
	VisitDate   string    `json:"visit_date"`
	CreatedAt   time.Time `json:"created_at"`
}

// RecordService handles medical-record-related business logic.
type RecordService struct {
	DB *gorm.DB
}

// NewRecordService creates a new RecordService.
func NewRecordService(db *gorm.DB) *RecordService {
	return &RecordService{DB: db}
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
		PatientID: req.PatientID,
		TenantID:  tenantID,
		Diagnosis: req.Diagnosis,
		Treatment: req.Treatment,
		Notes:     req.Notes,
		VisitDate: visitDate,
		CreatedBy: createdBy,
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
func (s *RecordService) ListRecords(tenantID uint64, name, date string, page, size int) ([]RecordListItem, int64, error) {
	var items []RecordListItem
	var total int64

	query := s.DB.Table("medical_records").
		Select("medical_records.id, medical_records.patient_id, patients.name AS patient_name, patients.age AS patient_age, medical_records.diagnosis, DATE_FORMAT(medical_records.visit_date, '%Y-%m-%d') AS visit_date, medical_records.created_at").
		Joins("JOIN patients ON patients.id = medical_records.patient_id").
		Where("medical_records.tenant_id = ? AND medical_records.deleted_at IS NULL", tenantID)

	if name != "" {
		query = query.Where("patients.name LIKE ?", "%"+name+"%")
	}
	if date != "" {
		query = query.Where("medical_records.visit_date = ?", date)
	}

	// Get total count before pagination.
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Fetch paginated results.
	if err := query.Order("medical_records.visit_date DESC").
		Offset((page - 1) * size).
		Limit(size).
		Scan(&items).Error; err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

// UpdateRecord updates an existing medical record. It returns the record data
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

	// Reload to get the updated record with attachments.
	if err := s.DB.Where("tenant_id = ?", tenantID).Preload("Attachments").Preload("Patient").First(&record, id).Error; err != nil {
		return nil, nil, err
	}

	return &oldRecord, &record, nil
}

// DeleteRecord soft-deletes a medical record. It returns the record data before
// deletion (for oplog old_data).
func (s *RecordService) DeleteRecord(tenantID uint64, id uint64) (*model.MedicalRecord, error) {
	var record model.MedicalRecord
	if err := s.DB.Where("tenant_id = ?", tenantID).Preload("Attachments").First(&record, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordNotFound
		}
		return nil, err
	}

	if err := s.DB.Delete(&record).Error; err != nil {
		return nil, err
	}

	return &record, nil
}
