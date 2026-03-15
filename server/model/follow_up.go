package model

import "time"

// FollowUp represents a patient follow-up record (tenant-scoped).
type FollowUp struct {
	BaseModel
	TenantID    uint64     `gorm:"column:tenant_id;not null;index;index:idx_tenant_status_planned,priority:1" json:"tenant_id"`
	PatientID   uint64     `gorm:"column:patient_id;not null;index" json:"patient_id"`
	RecordID    uint64     `gorm:"column:record_id;not null;index" json:"record_id"`
	IsRecovered bool       `gorm:"column:is_recovered;default:false" json:"is_recovered"`
	PlannedDate time.Time  `gorm:"column:planned_date;type:date;not null;index:idx_tenant_status_planned,priority:3" json:"planned_date"`
	ActualDate  *time.Time `gorm:"column:actual_date;type:date" json:"actual_date"`
	Status      string     `gorm:"column:status;type:varchar(20);not null;default:'pending';index:idx_tenant_status_planned,priority:2" json:"status"`
	Method      string     `gorm:"column:method;type:varchar(50);not null" json:"method"`
	Content     string     `gorm:"column:content;type:text" json:"content"`
	CreatedBy   uint64     `gorm:"column:created_by;not null" json:"created_by"`

	// Associations
	Patient Patient `gorm:"foreignKey:PatientID" json:"patient,omitempty"`
}

func (FollowUp) TableName() string {
	return "follow_ups"
}
