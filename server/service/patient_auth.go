package service

import (
	"errors"
	"strings"

	"github.com/callmefisher/menzhen/server/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrPatientLoginDisabled    = errors.New("patient login disabled")
	ErrPatientRegisterDisabled = errors.New("patient register disabled")
	ErrPatientWrongCredentials = errors.New("invalid phone or name")
)

// PatientAuthService handles patient portal authentication.
type PatientAuthService struct {
	db *gorm.DB
}

// NewPatientAuthService creates a new PatientAuthService.
func NewPatientAuthService(db *gorm.DB) *PatientAuthService {
	return &PatientAuthService{db: db}
}

// Login authenticates a patient or registers a new one.
// The password is transparently set to last4(phone) — never exposed to the user.
// On new registration, auto-links to existing patient record by phone, or creates one.
func (s *PatientAuthService) Login(tenantID uint64, phone, name string) (*model.PatientUser, error) {
	phone = strings.TrimSpace(phone)
	name = strings.TrimSpace(name)

	// Load portal config; if absent, defaults to all-enabled.
	cfg := model.PatientPortalConfig{
		LoginEnabled:    true,
		RegisterEnabled: true,
	}
	s.db.Where("tenant_id = ?", tenantID).First(&cfg)

	if !cfg.LoginEnabled {
		return nil, ErrPatientLoginDisabled
	}

	password := last4digits(phone)

	var pu model.PatientUser
	err := s.db.Where("tenant_id = ? AND phone = ?", tenantID, phone).First(&pu).Error
	if err == nil {
		// Existing user — verify name matches.
		if pu.Name != name {
			return nil, ErrPatientWrongCredentials
		}
		if bcryptErr := bcrypt.CompareHashAndPassword([]byte(pu.PasswordHash), []byte(password)); bcryptErr != nil {
			return nil, ErrPatientWrongCredentials
		}
		return &pu, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// New user — check register switch.
	if !cfg.RegisterEnabled {
		return nil, ErrPatientRegisterDisabled
	}

	hash, hashErr := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if hashErr != nil {
		return nil, hashErr
	}

	pu = model.PatientUser{
		TenantID:     tenantID,
		Phone:        phone,
		Name:         name,
		PasswordHash: string(hash),
	}

	if txErr := s.db.Transaction(func(tx *gorm.DB) error {
		// Auto-link to existing patient record by phone match.
		var patient model.Patient
		if tx.Where("tenant_id = ? AND phone = ?", tenantID, phone).First(&patient).Error == nil {
			pu.PatientID = &patient.ID
		} else {
			// Auto-create a new patient record.
			newPatient := model.Patient{
				TenantID:  tenantID,
				Name:      name,
				Phone:     phone,
				Gender:    0,
				CreatedBy: 0, // 0 = system-created via patient self-registration
			}
			if err := tx.Create(&newPatient).Error; err != nil {
				return err
			}
			pu.PatientID = &newPatient.ID
		}
		return tx.Create(&pu).Error
	}); txErr != nil {
		return nil, txErr
	}
	return &pu, nil
}

// GetPortalConfig returns the portal config for a tenant.
// Returns all-enabled defaults when no config row exists.
func (s *PatientAuthService) GetPortalConfig(tenantID uint64) model.PatientPortalConfig {
	cfg := model.PatientPortalConfig{
		TenantID:           tenantID,
		LoginEnabled:       true,
		RegisterEnabled:    true,
		AppointmentEnabled: true,
		QueueEnabled:       true,
		RecordsEnabled:     true,
	}
	s.db.Where("tenant_id = ?", tenantID).First(&cfg)
	return cfg
}

// SavePortalConfig upserts the portal config for a tenant.
func (s *PatientAuthService) SavePortalConfig(cfg model.PatientPortalConfig) error {
	return s.db.Save(&cfg).Error
}

// last4digits returns the last 4 characters of a phone number.
func last4digits(phone string) string {
	if len(phone) >= 4 {
		return phone[len(phone)-4:]
	}
	return phone
}
