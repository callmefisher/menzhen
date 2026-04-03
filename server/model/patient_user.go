// server/model/patient_user.go
package model

import "time"

// PatientUser 是患者端门户账号，独立于诊所员工的 User 模型。
// password = bcrypt(last4(phone))，前端永不展示密码字段。
type PatientUser struct {
	ID           uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID     uint64    `gorm:"column:tenant_id;not null;index;uniqueIndex:idx_pu_tenant_phone" json:"tenant_id"`
	Phone        string    `gorm:"column:phone;type:varchar(20);not null;uniqueIndex:idx_pu_tenant_phone" json:"phone"`
	Name         string    `gorm:"column:name;type:varchar(50);not null" json:"name"`
	PasswordHash string    `gorm:"column:password_hash;type:varchar(255);not null" json:"-"`
	PatientID    *uint64   `gorm:"column:patient_id;index" json:"patient_id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (PatientUser) TableName() string { return "patient_users" }
