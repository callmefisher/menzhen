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

	// New fields: chief complaint, pulse, tongue
	ChiefComplaint    string  `gorm:"column:chief_complaint;type:text" json:"chief_complaint"`
	PulseID           *uint64 `gorm:"column:pulse_id;index" json:"pulse_id"`
	PulseName         string  `gorm:"column:pulse_name;type:varchar(100)" json:"pulse_name"`
	TongueImage       string  `gorm:"column:tongue_image;type:varchar(500)" json:"tongue_image"`
	TongueDescription string  `gorm:"column:tongue_description;type:text" json:"tongue_description"`
	TongueAnalysis    string  `gorm:"column:tongue_analysis;type:text" json:"tongue_analysis"`

	// Associations
	Patient       Patient            `gorm:"foreignKey:PatientID" json:"patient,omitempty"`
	Pulse         *Pulse             `gorm:"foreignKey:PulseID" json:"pulse,omitempty"`
	Tenant        Tenant             `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	Creator       User               `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
	Attachments   []RecordAttachment `gorm:"foreignKey:RecordID" json:"attachments,omitempty"`
	Prescriptions []Prescription     `gorm:"foreignKey:RecordID" json:"prescriptions,omitempty"`
}

func (MedicalRecord) TableName() string {
	return "medical_records"
}
