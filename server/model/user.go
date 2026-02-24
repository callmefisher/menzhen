package model

import "time"

// User represents a system user belonging to a tenant.
type User struct {
	ID           uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID     uint64    `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	Username     string    `gorm:"column:username;type:varchar(50);not null" json:"username"`
	PasswordHash string    `gorm:"column:password_hash;type:varchar(255);not null" json:"-"`
	RealName     string    `gorm:"column:real_name;type:varchar(50);not null" json:"real_name"`
	Phone        string    `gorm:"column:phone;type:varchar(20)" json:"phone"`
	Status       int8      `gorm:"column:status;type:tinyint;default:1;not null;comment:1=enabled 0=disabled" json:"status"`
	CreatedAt    time.Time `json:"created_at"`

	// Associations
	Tenant Tenant `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	Roles  []Role `gorm:"many2many:user_roles" json:"roles,omitempty"`
}

func (User) TableName() string {
	return "users"
}

// UserRole is the join table between users and roles.
type UserRole struct {
	UserID uint64 `gorm:"primaryKey;column:user_id" json:"user_id"`
	RoleID uint64 `gorm:"primaryKey;column:role_id" json:"role_id"`
}

func (UserRole) TableName() string {
	return "user_roles"
}
