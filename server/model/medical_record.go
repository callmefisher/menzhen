package model

import "time"

// MedicalRecord represents a diagnosis/treatment record. Uses BaseModel for soft delete support.
type MedicalRecord struct {
	BaseModel
	PatientID uint64    `gorm:"column:patient_id;not null;index" json:"patient_id"`
	TenantID  uint64    `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	Diagnosis string    `gorm:"column:diagnosis;type:text" json:"diagnosis"`
	Treatment string    `gorm:"column:treatment;type:text" json:"treatment"`
	Notes     string    `gorm:"column:notes;type:text" json:"notes"`
	VisitDate time.Time `gorm:"column:visit_date;type:date;not null" json:"visit_date"`
	CreatedBy uint64    `gorm:"column:created_by;not null" json:"created_by"`

	// Associations
	Patient     Patient            `gorm:"foreignKey:PatientID" json:"patient,omitempty"`
	Tenant      Tenant             `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	Creator     User               `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
	Attachments []RecordAttachment `gorm:"foreignKey:RecordID" json:"attachments,omitempty"`
}

func (MedicalRecord) TableName() string {
	return "medical_records"
}
