package model

import "time"

// PrescriptionNotification is created when a doctor charges and dispatches stock,
// notifying pharmacy staff to dispense the prescription.
// Records are retained for only 1 day (hourly cleanup job).
// No soft delete: ephemeral 24h data; hard-delete in cleanup avoids unique index conflicts.
type PrescriptionNotification struct {
	ID             uint64     `gorm:"primaryKey;autoIncrement" json:"id"`
	CreatedAt      time.Time  `gorm:"index:idx_pn_tenant_status_created,priority:3" json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	TenantID       uint64     `gorm:"column:tenant_id;not null;index:idx_pn_tenant_status_created,priority:1" json:"tenant_id"`
	PrescriptionID uint64     `gorm:"column:prescription_id;not null;uniqueIndex:idx_pn_tenant_prescription" json:"prescription_id"`
	RecordID       uint64     `gorm:"column:record_id;not null" json:"record_id"`
	PatientName    string     `gorm:"column:patient_name;type:varchar(50);not null" json:"patient_name"`
	DoctorName     string     `gorm:"column:doctor_name;type:varchar(50);not null" json:"doctor_name"`
	FormulaName    string     `gorm:"column:formula_name;type:varchar(100)" json:"formula_name"`
	TotalDoses     int        `gorm:"column:total_doses;not null;default:7" json:"total_doses"`
	HerbCount      int        `gorm:"column:herb_count;not null;default:0" json:"herb_count"`
	PatentCount    int        `gorm:"column:patent_count;not null;default:0" json:"patent_count"`
	Notes          string     `gorm:"column:notes;type:varchar(500)" json:"notes"`
	Status         string     `gorm:"column:status;type:varchar(10);not null;default:'pending';index:idx_pn_tenant_status_created,priority:2" json:"status"`
	DoneAt         *time.Time `gorm:"column:done_at" json:"done_at"`
	CreatedBy      uint64     `gorm:"column:created_by;not null" json:"created_by"`
}

func (PrescriptionNotification) TableName() string {
	return "prescription_notifications"
}
