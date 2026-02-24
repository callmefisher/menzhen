package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrPrescriptionNotFound = errors.New("prescription not found")
	ErrRecordInvalid        = errors.New("record not found or does not belong to this tenant")
)

// PrescriptionItemRequest represents a single herb item in a prescription request.
type PrescriptionItemRequest struct {
	HerbName  string `json:"herb_name" binding:"required"`
	Dosage    string `json:"dosage"`
	SortOrder int    `json:"sort_order"`
	Notes     string `json:"notes"`
}

// CreatePrescriptionRequest is the input for creating a new prescription.
type CreatePrescriptionRequest struct {
	RecordID    uint64                    `json:"record_id" binding:"required"`
	FormulaName string                    `json:"formula_name"`
	TotalDoses  int                       `json:"total_doses"`
	Notes       string                    `json:"notes"`
	Items       []PrescriptionItemRequest `json:"items" binding:"required,min=1"`
}

// UpdatePrescriptionRequest is the input for updating a prescription.
type UpdatePrescriptionRequest struct {
	FormulaName *string                    `json:"formula_name"`
	TotalDoses  *int                       `json:"total_doses"`
	Notes       *string                    `json:"notes"`
	Items       []PrescriptionItemRequest  `json:"items"`
}

// PrescriptionService handles prescription-related business logic.
type PrescriptionService struct {
	DB *gorm.DB
}

// NewPrescriptionService creates a new PrescriptionService.
func NewPrescriptionService(db *gorm.DB) *PrescriptionService {
	return &PrescriptionService{DB: db}
}

// Create creates a new prescription with items in a transaction.
func (s *PrescriptionService) Create(tenantID, createdBy uint64, req *CreatePrescriptionRequest) (*model.Prescription, error) {
	// Verify the record exists and belongs to the tenant.
	var record model.MedicalRecord
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&record, req.RecordID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRecordInvalid
		}
		return nil, err
	}

	totalDoses := req.TotalDoses
	if totalDoses <= 0 {
		totalDoses = 7
	}

	prescription := model.Prescription{
		RecordID:    req.RecordID,
		TenantID:    tenantID,
		FormulaName: req.FormulaName,
		TotalDoses:  totalDoses,
		Notes:       req.Notes,
		CreatedBy:   createdBy,
	}

	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&prescription).Error; err != nil {
			return err
		}

		items := make([]model.PrescriptionItem, 0, len(req.Items))
		for _, item := range req.Items {
			items = append(items, model.PrescriptionItem{
				PrescriptionID: prescription.ID,
				HerbName:       item.HerbName,
				Dosage:         item.Dosage,
				SortOrder:      item.SortOrder,
				Notes:          item.Notes,
			})
		}
		if err := tx.Create(&items).Error; err != nil {
			return err
		}
		prescription.Items = items
		return nil
	})

	if err != nil {
		return nil, err
	}

	return &prescription, nil
}

// Get retrieves a prescription by ID within the tenant scope.
func (s *PrescriptionService) Get(tenantID, id uint64) (*model.Prescription, error) {
	var prescription model.Prescription
	err := s.DB.
		Where("tenant_id = ?", tenantID).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC")
		}).
		Preload("Creator").
		First(&prescription, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPrescriptionNotFound
		}
		return nil, err
	}
	return &prescription, nil
}

// ListByRecord returns all prescriptions for a specific medical record.
func (s *PrescriptionService) ListByRecord(tenantID, recordID uint64) ([]model.Prescription, error) {
	var prescriptions []model.Prescription
	err := s.DB.
		Where("tenant_id = ? AND record_id = ?", tenantID, recordID).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC")
		}).
		Preload("Creator").
		Order("created_at DESC").
		Find(&prescriptions).Error
	if err != nil {
		return nil, err
	}
	return prescriptions, nil
}

// Update updates an existing prescription. Returns old and new versions for oplog.
func (s *PrescriptionService) Update(tenantID, id uint64, req *UpdatePrescriptionRequest) (*model.Prescription, *model.Prescription, error) {
	var prescription model.Prescription
	if err := s.DB.Where("tenant_id = ?", tenantID).Preload("Items").First(&prescription, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrPrescriptionNotFound
		}
		return nil, nil, err
	}

	oldPrescription := prescription
	oldPrescription.Items = make([]model.PrescriptionItem, len(prescription.Items))
	copy(oldPrescription.Items, prescription.Items)

	updates := make(map[string]interface{})
	if req.FormulaName != nil {
		updates["formula_name"] = *req.FormulaName
	}
	if req.TotalDoses != nil {
		updates["total_doses"] = *req.TotalDoses
	}
	if req.Notes != nil {
		updates["notes"] = *req.Notes
	}

	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if len(updates) > 0 {
			if err := tx.Model(&prescription).Updates(updates).Error; err != nil {
				return err
			}
		}

		// Replace items if provided
		if req.Items != nil {
			if err := tx.Where("prescription_id = ?", id).Delete(&model.PrescriptionItem{}).Error; err != nil {
				return err
			}

			if len(req.Items) > 0 {
				items := make([]model.PrescriptionItem, 0, len(req.Items))
				for _, item := range req.Items {
					items = append(items, model.PrescriptionItem{
						PrescriptionID: id,
						HerbName:       item.HerbName,
						Dosage:         item.Dosage,
						SortOrder:      item.SortOrder,
						Notes:          item.Notes,
					})
				}
				if err := tx.Create(&items).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}

	// Reload
	if err := s.DB.Where("tenant_id = ?", tenantID).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("sort_order ASC")
		}).
		Preload("Creator").
		First(&prescription, id).Error; err != nil {
		return nil, nil, err
	}

	return &oldPrescription, &prescription, nil
}

// Delete soft-deletes a prescription. Returns old data for oplog.
func (s *PrescriptionService) Delete(tenantID, id uint64) (*model.Prescription, error) {
	var prescription model.Prescription
	if err := s.DB.Where("tenant_id = ?", tenantID).Preload("Items").First(&prescription, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPrescriptionNotFound
		}
		return nil, err
	}

	if err := s.DB.Delete(&prescription).Error; err != nil {
		return nil, err
	}

	return &prescription, nil
}
