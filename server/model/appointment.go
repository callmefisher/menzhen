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
	TenantID  uint   `gorm:"column:tenant_id;not null;uniqueIndex:idx_slot_config" json:"tenant_id"`
	DoctorID  uint   `gorm:"column:doctor_id;not null;uniqueIndex:idx_slot_config" json:"doctor_id"`
	SlotStart string `gorm:"column:slot_start;type:varchar(5);not null;uniqueIndex:idx_slot_config" json:"slot_start"`
	SlotEnd   string `gorm:"column:slot_end;type:varchar(5);not null" json:"slot_end"`
	MaxCount  int    `gorm:"column:max_count;not null;default:1" json:"max_count"`
}

func (AppointmentSlotConfig) TableName() string { return "appointment_slot_configs" }

// DoctorScheduleConfig 医生出诊规则：出诊星期（bitmask）+ 可预约日期范围。
// weekdays=0 表示未配置，所有星期均可。
// bit0=周日, bit1=周一, bit2=周二, bit3=周三, bit4=周四, bit5=周五, bit6=周六
type DoctorScheduleConfig struct {
	ID         uint  `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID   uint  `gorm:"column:tenant_id;not null;uniqueIndex:uk_doctor_schedule" json:"tenant_id"`
	DoctorID   uint  `gorm:"column:doctor_id;not null;uniqueIndex:uk_doctor_schedule" json:"doctor_id"`
	Weekdays   uint8 `gorm:"column:weekdays;not null;default:0" json:"weekdays"`
	RangeStart int   `gorm:"column:range_start;not null;default:1" json:"range_start"`
	RangeEnd   int   `gorm:"column:range_end;not null;default:30" json:"range_end"`
}

func (DoctorScheduleConfig) TableName() string { return "doctor_schedule_configs" }
