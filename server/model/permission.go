package model

// Permission represents a system-level permission.
type Permission struct {
	ID          uint64 `gorm:"primaryKey;autoIncrement" json:"id"`
	Code        string `gorm:"column:code;type:varchar(50);uniqueIndex;not null" json:"code"`
	Name        string `gorm:"column:name;type:varchar(50);not null" json:"name"`
	Description string `gorm:"column:description;type:varchar(200)" json:"description"`

	// Associations
	Roles []Role `gorm:"many2many:role_permissions" json:"roles,omitempty"`
}

func (Permission) TableName() string {
	return "permissions"
}

// RolePermission is the join table between roles and permissions.
type RolePermission struct {
	RoleID       uint64 `gorm:"primaryKey;column:role_id" json:"role_id"`
	PermissionID uint64 `gorm:"primaryKey;column:permission_id" json:"permission_id"`
}

func (RolePermission) TableName() string {
	return "role_permissions"
}
