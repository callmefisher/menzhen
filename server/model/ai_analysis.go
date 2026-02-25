package model

// AIAnalysis stores cached AI diagnosis analysis results.
// One record maps to at most one analysis (record_id has a unique index).
type AIAnalysis struct {
	BaseModel
	RecordID  uint64 `gorm:"column:record_id;not null;uniqueIndex" json:"record_id"`
	TenantID  uint64 `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	Diagnosis string `gorm:"column:diagnosis;type:text" json:"diagnosis"`
	Analysis  string `gorm:"column:analysis;type:longtext" json:"analysis"`
}
