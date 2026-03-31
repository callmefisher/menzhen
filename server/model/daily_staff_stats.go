package model

import "time"

// DailyStaffStats stores per-user per-day billing aggregations.
// Unique index (tenant_id, user_id, stat_date) enables efficient UPSERT and date-range scans.
// Max rows per tenant: doctors_count × active_days (e.g. 10 × 3650 = 36 500 rows — never near 10M).
type DailyStaffStats struct {
	ID              uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID        uint64    `gorm:"uniqueIndex:idx_staff_tenant_user_date;not null;index:idx_staff_tenant_date" json:"tenant_id"`
	UserID          uint64    `gorm:"uniqueIndex:idx_staff_tenant_user_date;not null" json:"user_id"`
	StatDate        time.Time `gorm:"uniqueIndex:idx_staff_tenant_user_date;type:date;not null;index:idx_staff_tenant_date" json:"stat_date"`
	Revenue         float64   `gorm:"type:decimal(12,2);default:0" json:"revenue"`
	ConsultationFee float64   `gorm:"type:decimal(12,2);default:0" json:"consultation_fee"`
	DrugFee         float64   `gorm:"type:decimal(12,2);default:0" json:"drug_fee"`
	RecordCount     int       `gorm:"default:0" json:"record_count"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
