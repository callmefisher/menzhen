package model

import "time"

// Tenant represents a clinic or organization in the multi-tenant system.
type Tenant struct {
	ID           uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	Name         string    `gorm:"column:name;type:varchar(100);not null" json:"name"`
	Code         string    `gorm:"column:code;type:varchar(50);uniqueIndex;not null" json:"code"`
	Status       int8      `gorm:"column:status;type:tinyint;default:1;not null;comment:1=enabled 0=disabled" json:"status"`
	QueueEnabled              *bool `gorm:"column:queue_enabled;default:true" json:"queue_enabled"`
	CallDisplayDuration       *int  `gorm:"column:call_display_duration;default:10" json:"call_display_duration"`
	ShowArrivalTime           *bool `gorm:"column:show_arrival_time;default:true" json:"show_arrival_time"`
	AppointmentEnabled        *bool `gorm:"column:appointment_enabled;default:true" json:"appointment_enabled"`
	CallSoundEnabled          *bool `gorm:"column:call_sound_enabled;default:true" json:"call_sound_enabled"`
	AppointmentSlotMinutes    *int  `gorm:"column:appointment_slot_minutes;default:30" json:"appointment_slot_minutes"`
	AppointmentMaxPerSlot     *int  `gorm:"column:appointment_max_per_slot;default:10" json:"appointment_max_per_slot"`
	AppointmentAdvanceDays    *int  `gorm:"column:appointment_advance_days;default:7" json:"appointment_advance_days"`
	CreatedAt    time.Time `json:"created_at"`

	// Associations
	Users []User `gorm:"foreignKey:TenantID" json:"users,omitempty"`
	Roles []Role `gorm:"foreignKey:TenantID" json:"roles,omitempty"`
}

func (Tenant) TableName() string {
	return "tenants"
}
