package model

import "time"

type DailyStats struct {
	ID                    uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID              uint64    `gorm:"uniqueIndex:idx_tenant_date;not null" json:"tenant_id"`
	StatDate              time.Time `gorm:"uniqueIndex:idx_tenant_date;type:date;not null" json:"stat_date"`
	Revenue               float64   `gorm:"type:decimal(12,2);default:0" json:"revenue"`
	ConsultationFee       float64   `gorm:"type:decimal(12,2);default:0" json:"consultation_fee"`
	DrugFee               float64   `gorm:"type:decimal(12,2);default:0" json:"drug_fee"`
	RecordCount           int       `gorm:"default:0" json:"record_count"`
	NewPatientCount       int       `gorm:"default:0" json:"new_patient_count"`
	ReturningPatientCount int       `gorm:"default:0" json:"returning_patient_count"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}
