package model

import "time"

// AIAnalysis stores cached AI diagnosis analysis results.
// One record maps to at most one analysis (record_id has a unique index).
// LastAccessedAt is updated on every cache hit; records not accessed for 180 days are eligible for TTL cleanup.
type AIAnalysis struct {
	BaseModel
	RecordID       uint64     `gorm:"column:record_id;not null;uniqueIndex" json:"record_id"`
	TenantID       uint64     `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	Diagnosis      string     `gorm:"column:diagnosis;type:text" json:"diagnosis"`
	Analysis       string     `gorm:"column:analysis;type:longtext" json:"analysis"`
	LastAccessedAt *time.Time `gorm:"column:last_accessed_at" json:"last_accessed_at"`
}
