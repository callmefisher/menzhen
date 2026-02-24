package model

import (
	"time"

	"gorm.io/datatypes"
)

// OpLog represents an operation audit log entry.
// Does NOT use soft delete.
type OpLog struct {
	ID           uint64         `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID     uint64         `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	UserID       uint64         `gorm:"column:user_id;not null;index" json:"user_id"`
	UserName     string         `gorm:"column:user_name;type:varchar(50);not null;comment:redundant for display" json:"user_name"`
	Action       string         `gorm:"column:action;type:varchar(20);not null;comment:create/update/delete" json:"action"`
	ResourceType string         `gorm:"column:resource_type;type:varchar(50);not null;comment:patient/record/attachment" json:"resource_type"`
	ResourceID   uint64         `gorm:"column:resource_id;type:bigint;not null" json:"resource_id"`
	OldData      datatypes.JSON `gorm:"column:old_data;type:json" json:"old_data"`
	NewData      datatypes.JSON `gorm:"column:new_data;type:json" json:"new_data"`
	CreatedAt    time.Time      `json:"created_at"`

	// Associations
	Tenant Tenant `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	User   User   `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (OpLog) TableName() string {
	return "op_logs"
}
