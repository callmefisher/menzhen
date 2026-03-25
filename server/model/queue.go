package model

import "time"

type QueueEntry struct {
	ID          uint       `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID    uint       `gorm:"column:tenant_id;not null;index:idx_queue_tenant_date_status,priority:1" json:"tenant_id"`
	PatientID   *uint      `gorm:"column:patient_id" json:"patient_id"`
	PatientName string     `gorm:"column:patient_name;type:varchar(50);not null" json:"patient_name"`
	DoctorID    uint       `gorm:"column:doctor_id;not null;index:idx_queue_tenant_doctor" json:"doctor_id"`
	DoctorName  string     `gorm:"column:doctor_name;type:varchar(50);not null" json:"doctor_name"`
	Room        string     `gorm:"column:room;type:varchar(50)" json:"room"`
	SeqNumber   int        `gorm:"column:seq_number;not null" json:"seq_number"`
	Status      string     `gorm:"column:status;type:varchar(20);not null;default:waiting;index:idx_queue_tenant_date_status,priority:3" json:"status"`
	BookedTime  string     `gorm:"column:booked_time;type:varchar(10)" json:"booked_time"`
	ArrivalTime *time.Time `gorm:"column:arrival_time" json:"arrival_time"`
	CalledAt    *time.Time `gorm:"column:called_at" json:"called_at"`
	CompletedAt *time.Time `gorm:"column:completed_at" json:"completed_at"`
	Source      string     `gorm:"column:source;type:varchar(20);not null;default:walk_in" json:"source"`
	QueueDate   string     `gorm:"column:queue_date;type:date;not null;index:idx_queue_tenant_date_status,priority:2" json:"queue_date"`
	CreatedAt   time.Time  `gorm:"autoCreateTime" json:"created_at"`
}

func (QueueEntry) TableName() string { return "queue_entries" }

type QueueSeq struct {
	ID        uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID  uint   `gorm:"column:tenant_id;not null;uniqueIndex:idx_qs_tenant_date" json:"tenant_id"`
	QueueDate string `gorm:"column:queue_date;type:date;not null;uniqueIndex:idx_qs_tenant_date" json:"queue_date"`
	LastSeq   int    `gorm:"column:last_seq;not null;default:0" json:"last_seq"`
}

func (QueueSeq) TableName() string { return "queue_seqs" }
