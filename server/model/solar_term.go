package model

import "time"

// SolarTerm represents one of the 24 solar terms in the Chinese calendar.
// Global data (no tenant_id).
type SolarTerm struct {
	ID         uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	Name       string    `gorm:"column:name;type:varchar(20);not null;uniqueIndex" json:"name"`
	Season     string    `gorm:"column:season;type:varchar(10);not null" json:"season"`
	OrderIndex int       `gorm:"column:order_index;not null" json:"order_index"`
	Month      int       `gorm:"column:month;not null" json:"month"`
	Day        int       `gorm:"column:day;not null" json:"day"`
	EndMonth   int       `gorm:"column:end_month;not null" json:"end_month"`
	EndDay     int       `gorm:"column:end_day;not null" json:"end_day"`
	Content    string    `gorm:"column:content;type:longtext" json:"content"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (SolarTerm) TableName() string {
	return "solar_terms"
}
