package model

import "time"

// Pulse represents a traditional Chinese medicine pulse type (global, no tenant_id).
type Pulse struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	Name             string    `gorm:"column:name;type:varchar(50);uniqueIndex;not null" json:"name"`
	Category         string    `gorm:"column:category;type:varchar(50);index" json:"category"`
	Description      string    `gorm:"column:description;type:text" json:"description"`
	ClinicalMeaning  string    `gorm:"column:clinical_meaning;type:text" json:"clinical_meaning"`
	CommonConditions string    `gorm:"column:common_conditions;type:text" json:"common_conditions"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (Pulse) TableName() string {
	return "pulses"
}
