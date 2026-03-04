package model

import "time"

// WuyunLiuqi stores cached Five Phases and Six Qi analysis for a given year.
// Global data (no tenant_id), one row per year.
type WuyunLiuqi struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	Year      int       `gorm:"column:year;uniqueIndex;not null" json:"year"`
	Content   string    `gorm:"column:content;type:longtext" json:"content"`
	Source    string    `gorm:"column:source;type:varchar(20);default:ai" json:"source"` // "ai" or "manual"
	UpdatedBy uint64    `gorm:"column:updated_by" json:"updated_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (WuyunLiuqi) TableName() string {
	return "wuyun_liuqi"
}
