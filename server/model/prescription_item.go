package model

import "time"

// PrescriptionItem represents a single herb line in a prescription.
type PrescriptionItem struct {
	ID             uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	PrescriptionID uint64    `gorm:"column:prescription_id;not null;index" json:"prescription_id"`
	HerbName       string    `gorm:"column:herb_name;type:varchar(100);not null" json:"herb_name"`
	Dosage         string    `gorm:"column:dosage;type:varchar(50)" json:"dosage"`
	SortOrder      int       `gorm:"column:sort_order;default:0" json:"sort_order"`
	Notes          string    `gorm:"column:notes;type:varchar(200)" json:"notes"`
	CreatedAt      time.Time `json:"created_at"`
}

func (PrescriptionItem) TableName() string {
	return "prescription_items"
}
