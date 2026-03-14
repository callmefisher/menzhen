package model

// InventoryDrug represents a drug in the clinic's inventory (tenant-scoped).
type InventoryDrug struct {
	BaseModel
	TenantID       uint64   `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	Name           string   `gorm:"column:name;type:varchar(100);not null" json:"name"`
	Category       string   `gorm:"column:category;type:varchar(10);not null;index;comment:herb=本草,patent=成药" json:"category"`
	Stock          float64  `gorm:"column:stock;type:decimal(10,2);not null;default:0" json:"stock"`
	PurchasePrice  float64  `gorm:"column:purchase_price;type:decimal(10,2);not null;default:0" json:"purchase_price"`
	SellingPrice   float64  `gorm:"column:selling_price;type:decimal(10,2);not null;default:0" json:"selling_price"`
	AlertThreshold *float64 `gorm:"column:alert_threshold;type:decimal(10,2)" json:"alert_threshold"`
	Remark         string   `gorm:"column:remark;type:text" json:"remark"`
	ShelfNo        string   `gorm:"column:shelf_no;type:varchar(20);not null;default:'H1'" json:"shelf_no"`
}

func (InventoryDrug) TableName() string {
	return "inventory_drugs"
}
