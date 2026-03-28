package model

import "time"

// QueueDoctor 接诊医生配置（租户级别）
type QueueDoctor struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID  uint      `gorm:"column:tenant_id;not null;uniqueIndex:idx_qd_tenant_user" json:"tenant_id"`
	UserID    uint      `gorm:"column:user_id;not null;uniqueIndex:idx_qd_tenant_user" json:"user_id"`
	Room      string    `gorm:"column:room;type:varchar(50);not null" json:"room"`
	SortOrder int       `gorm:"column:sort_order;not null;default:0" json:"sort_order"`
	Enabled   bool      `gorm:"column:enabled;not null;default:true;index:idx_qd_tenant_enabled" json:"enabled"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Join fields (populated by handler, not stored)
	UserName string `gorm:"-" json:"user_name,omitempty"`
}

func (QueueDoctor) TableName() string { return "queue_doctors" }
