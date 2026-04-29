package model

import (
	"time"

	"gorm.io/gorm"
)

type License struct {
	ID          uint64         `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID    uint64         `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	SiteID      string         `gorm:"column:site_id;type:varchar(100);not null" json:"site_id"`
	MachineID   string         `gorm:"column:machine_id;type:varchar(100);not null" json:"machine_id"`
	Method      string         `gorm:"column:method;type:varchar(20);not null" json:"method"`
	Duration    int            `gorm:"column:duration;not null" json:"duration"`
	AuthDate    *time.Time     `gorm:"column:auth_date" json:"auth_date"`
	ExpiryDate  *time.Time     `gorm:"column:expiry_date" json:"expiry_date"`
	Features    string         `gorm:"column:features;type:varchar(200)" json:"features"`
	Amount      float64        `gorm:"column:amount;type:decimal(10,2);default:0" json:"amount"`
	JWTToken    string         `gorm:"column:jwt_token;type:text" json:"jwt_token"`
	Status      string         `gorm:"column:status;type:varchar(20);not null;default:'active'" json:"status"`
	Remark      string         `gorm:"column:remark;type:varchar(500)" json:"remark"`
	CreatedBy   string         `gorm:"column:created_by;type:varchar(50)" json:"created_by"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (License) TableName() string { return "licenses" }

type MachineIdentity struct {
	ID        uint64         `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID string         `gorm:"column:machine_id;type:varchar(100);uniqueIndex;not null" json:"machine_id"`
	SiteID    string         `gorm:"column:site_id;type:varchar(100)" json:"site_id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (MachineIdentity) TableName() string { return "machine_identities" }
