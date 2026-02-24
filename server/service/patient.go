package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrPatientNotFound = errors.New("patient not found")
)

// CreatePatientRequest is the input for creating a new patient.
type CreatePatientRequest struct {
	Name   string  `json:"name" binding:"required"`
	Gender int8    `json:"gender" binding:"required,oneof=1 2"`
	Age    int     `json:"age" binding:"required,min=0"`
	Weight float64 `json:"weight"`
	Phone  string  `json:"phone"`
	IDCard string  `json:"id_card"`
}

// UpdatePatientRequest is the input for updating an existing patient.
// All fields are pointers so that we can distinguish between "not provided" and "zero value".
type UpdatePatientRequest struct {
	Name   *string  `json:"name"`
	Gender *int8    `json:"gender"`
	Age    *int     `json:"age"`
	Weight *float64 `json:"weight"`
	Phone  *string  `json:"phone"`
	IDCard *string  `json:"id_card"`
}

// PatientService handles patient-related business logic.
type PatientService struct {
	DB *gorm.DB
}

// NewPatientService creates a new PatientService.
func NewPatientService(db *gorm.DB) *PatientService {
	return &PatientService{DB: db}
}

// CreatePatient creates a new patient record.
func (s *PatientService) CreatePatient(tenantID, createdBy uint64, req *CreatePatientRequest) (*model.Patient, error) {
	patient := model.Patient{
		TenantID:  tenantID,
		Name:      req.Name,
		Gender:    req.Gender,
		Age:       req.Age,
		Weight:    req.Weight,
		Phone:     req.Phone,
		IDCard:    req.IDCard,
		CreatedBy: createdBy,
	}

	if err := s.DB.Create(&patient).Error; err != nil {
		return nil, err
	}

	return &patient, nil
}

// GetPatient retrieves a patient by ID within the given tenant scope.
// It preloads MedicalRecords (ordered by visit_date DESC) and their Attachments.
func (s *PatientService) GetPatient(tenantID uint64, id uint64) (*model.Patient, error) {
	var patient model.Patient
	err := s.DB.
		Where("tenant_id = ?", tenantID).
		Preload("MedicalRecords", func(db *gorm.DB) *gorm.DB {
			return db.Order("visit_date DESC")
		}).
		Preload("MedicalRecords.Attachments").
		First(&patient, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPatientNotFound
		}
		return nil, err
	}

	return &patient, nil
}

// ListPatients returns a paginated list of patients for the given tenant.
// Optionally filters by name (LIKE match). Results are ordered by created_at DESC.
func (s *PatientService) ListPatients(tenantID uint64, name string, page, size int) ([]model.Patient, int64, error) {
	var patients []model.Patient
	var total int64

	query := s.DB.Model(&model.Patient{}).Where("tenant_id = ?", tenantID)

	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}

	// Get total count before pagination.
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Fetch paginated results.
	if err := query.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&patients).Error; err != nil {
		return nil, 0, err
	}

	return patients, total, nil
}

// UpdatePatient updates an existing patient. It returns the patient data before
// the update (for oplog old_data) and the updated patient.
func (s *PatientService) UpdatePatient(tenantID uint64, id uint64, req *UpdatePatientRequest) (*model.Patient, *model.Patient, error) {
	var patient model.Patient
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&patient, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrPatientNotFound
		}
		return nil, nil, err
	}

	// Save a copy of the old data for oplog.
	oldPatient := patient

	// Build update map from non-nil fields.
	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Gender != nil {
		updates["gender"] = *req.Gender
	}
	if req.Age != nil {
		updates["age"] = *req.Age
	}
	if req.Weight != nil {
		updates["weight"] = *req.Weight
	}
	if req.Phone != nil {
		updates["phone"] = *req.Phone
	}
	if req.IDCard != nil {
		updates["id_card"] = *req.IDCard
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&patient).Updates(updates).Error; err != nil {
			return nil, nil, err
		}
	}

	// Reload to get the updated record.
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&patient, id).Error; err != nil {
		return nil, nil, err
	}

	return &oldPatient, &patient, nil
}

// DeletePatient soft-deletes a patient. It returns the patient data before
// deletion (for oplog old_data).
func (s *PatientService) DeletePatient(tenantID uint64, id uint64) (*model.Patient, error) {
	var patient model.Patient
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&patient, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPatientNotFound
		}
		return nil, err
	}

	if err := s.DB.Delete(&patient).Error; err != nil {
		return nil, err
	}

	return &patient, nil
}
