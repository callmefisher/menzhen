package model

// Prescription represents a TCM prescription tied to a medical record (tenant-scoped).
type Prescription struct {
	BaseModel
	RecordID    uint64 `gorm:"column:record_id;not null;index" json:"record_id"`
	TenantID    uint64 `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	FormulaName string `gorm:"column:formula_name;type:varchar(100)" json:"formula_name"`
	TotalDoses  int    `gorm:"column:total_doses;default:7" json:"total_doses"`
	Notes       string `gorm:"column:notes;type:text" json:"notes"`
	CreatedBy   uint64 `gorm:"column:created_by;not null" json:"created_by"`

	// Associations
	Record  MedicalRecord    `gorm:"foreignKey:RecordID" json:"record,omitempty"`
	Tenant  Tenant           `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	Creator User             `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
	Items   []PrescriptionItem `gorm:"foreignKey:PrescriptionID" json:"items,omitempty"`
}

func (Prescription) TableName() string {
	return "prescriptions"
}
