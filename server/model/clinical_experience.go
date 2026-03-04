package model

import "time"

// ClinicalExperience represents a clinical experience record (global, no tenant_id).
type ClinicalExperience struct {
	ID         uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	Source     string    `gorm:"column:source;type:varchar(255)" json:"source"`
	Category   string    `gorm:"column:category;type:varchar(100);index" json:"category"`
	Herbs      string    `gorm:"column:herbs;type:text" json:"herbs"`
	Formula    string    `gorm:"column:formula;type:text" json:"formula"`
	Experience string    `gorm:"column:experience;type:text" json:"experience"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (ClinicalExperience) TableName() string {
	return "clinical_experiences"
}
