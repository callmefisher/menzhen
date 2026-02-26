package model

import "time"

// Herb represents a traditional Chinese medicine herb (global, no tenant_id).
type Herb struct {
	ID          uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	Name        string    `gorm:"column:name;type:varchar(100);uniqueIndex;not null" json:"name"`
	Alias       string    `gorm:"column:alias;type:varchar(500)" json:"alias"`
	Category    string    `gorm:"column:category;type:varchar(50);index" json:"category"`
	Properties  string    `gorm:"column:properties;type:varchar(200)" json:"properties"`
	Effects     string    `gorm:"column:effects;type:text" json:"effects"`
	Indications string    `gorm:"column:indications;type:text" json:"indications"`
	Origin      string    `gorm:"column:origin;type:varchar(200)" json:"origin"`
	Source      string    `gorm:"column:source;type:varchar(20);default:manual" json:"source"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (Herb) TableName() string {
	return "herbs"
}
