package model

import "time"

// MeridianResource stores supplementary material (video, source text) for a meridian.
// Each meridian has at most one resource row, keyed by meridian_id (e.g. "LU", "ST").
type MeridianResource struct {
	ID         uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	MeridianID string    `gorm:"column:meridian_id;type:varchar(10);uniqueIndex;not null" json:"meridian_id"`
	VideoURL   string    `gorm:"column:video_url;type:text" json:"video_url"`
	SourceText string    `gorm:"column:source_text;type:text" json:"source_text"`
	UpdatedBy  uint64    `gorm:"column:updated_by" json:"updated_by"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (MeridianResource) TableName() string {
	return "meridian_resources"
}
