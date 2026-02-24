package model

// Role represents a role within a tenant for RBAC.
type Role struct {
	ID          uint64 `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID    uint64 `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	Name        string `gorm:"column:name;type:varchar(50);not null" json:"name"`
	Description string `gorm:"column:description;type:varchar(200)" json:"description"`

	// Associations
	Tenant      Tenant       `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	Permissions []Permission `gorm:"many2many:role_permissions" json:"permissions,omitempty"`
	Users       []User       `gorm:"many2many:user_roles" json:"users,omitempty"`
}

func (Role) TableName() string {
	return "roles"
}
