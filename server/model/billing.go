package model

// Billing represents a billing record (tenant-scoped).
// PrescriptionID=0 means record-level billing (consultation fee only).
// Only stores actual payment info — drug prices are calculated in real-time from inventory.
type Billing struct {
	BaseModel
	PrescriptionID  uint64  `gorm:"column:prescription_id;not null;uniqueIndex:idx_billing_unique" json:"prescription_id"`
	RecordID        uint64  `gorm:"column:record_id;not null;index;uniqueIndex:idx_billing_unique" json:"record_id"`
	TenantID        uint64  `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	ConsultationFee float64 `gorm:"column:consultation_fee;type:decimal(10,2);not null;default:100" json:"consultation_fee"`
	ActualPaid      float64 `gorm:"column:actual_paid;type:decimal(10,2);not null;default:0" json:"actual_paid"`
	StockDeducted   bool    `gorm:"column:stock_deducted;not null;default:false" json:"stock_deducted"`
	CreatedBy       uint64  `gorm:"column:created_by;not null" json:"created_by"`

	// Associations (no FK on PrescriptionID — it can be 0 for record-level billing)
	Tenant  Tenant `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	Creator User   `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
}

func (Billing) TableName() string {
	return "billings"
}
