package model

import "time"

const (
	AppointmentStatusPending   = "pending"   // 已预约，未入队
	AppointmentStatusQueued    = "queued"    // 已自动入队
	AppointmentStatusCancelled = "cancelled"
	AppointmentStatusNoShow    = "no_show"

	CheckinStatusPending = "pending" // 未签到
	CheckinStatusDone    = "done"    // 已签到
)

// Appointment 代表一条预约记录（预约时段当天0点自动入队）。
type Appointment struct {
	ID           uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID     uint      `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	PatientID    *uint     `gorm:"column:patient_id" json:"patient_id"`
	PatientName  string    `gorm:"column:patient_name;type:varchar(50);not null" json:"patient_name"`
	DoctorID     uint      `gorm:"column:doctor_id;not null" json:"doctor_id"`
	DoctorName   string    `gorm:"column:doctor_name;type:varchar(50);not null" json:"doctor_name"`
	Room         string    `gorm:"column:room;type:varchar(50)" json:"room"`
	AppointDate  string    `gorm:"column:appoint_date;type:date;not null;index" json:"appoint_date"`
	SlotStart    string    `gorm:"column:slot_start;type:varchar(5);not null" json:"slot_start"` // "08:30"
	SlotEnd      string    `gorm:"column:slot_end;type:varchar(5);not null" json:"slot_end"`
	Status       string    `gorm:"column:status;type:varchar(20);not null;default:pending" json:"status"`
	QueueEntryID *uint     `gorm:"column:queue_entry_id" json:"queue_entry_id,omitempty"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Appointment) TableName() string { return "appointments" }

// AppointmentSlotConfig 定义某医生某时段的可预约容量。
type AppointmentSlotConfig struct {
	ID        uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID  uint   `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	DoctorID  uint   `gorm:"column:doctor_id;not null" json:"doctor_id"`
	SlotStart string `gorm:"column:slot_start;type:varchar(5);not null" json:"slot_start"`
	SlotEnd   string `gorm:"column:slot_end;type:varchar(5);not null" json:"slot_end"`
	MaxCount  int    `gorm:"column:max_count;not null;default:10" json:"max_count"`
}

func (AppointmentSlotConfig) TableName() string { return "appointment_slot_configs" }
