package model

import "time"

// Tenant represents a clinic or organization in the multi-tenant system.
type Tenant struct {
	ID           uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	Name         string    `gorm:"column:name;type:varchar(100);not null" json:"name"`
	Code         string    `gorm:"column:code;type:varchar(50);uniqueIndex;not null" json:"code"`
	Status       int8      `gorm:"column:status;type:tinyint;default:1;not null;comment:1=enabled 0=disabled" json:"status"`
	QueueEnabled         *bool `gorm:"column:queue_enabled;default:true" json:"queue_enabled"`
	CallDisplayDuration  *int  `gorm:"column:call_display_duration;default:10" json:"call_display_duration"`
	CreatedAt    time.Time `json:"created_at"`

	// Associations
	Users []User `gorm:"foreignKey:TenantID" json:"users,omitempty"`
	Roles []Role `gorm:"foreignKey:TenantID" json:"roles,omitempty"`
}

func (Tenant) TableName() string {
	return "tenants"
}
