package model

// UserManagedGroup records which tenant groups a powerAdmin user is authorized to manage.
// One row per (user, group) pair.
type UserManagedGroup struct {
	ID        uint64 `gorm:"primaryKey;autoIncrement" json:"id"`
	UserID    uint64 `gorm:"column:user_id;not null;index;uniqueIndex:idx_user_group" json:"user_id"`
	GroupName string `gorm:"column:group_name;type:varchar(100);not null;uniqueIndex:idx_user_group" json:"group_name"`
}

func (UserManagedGroup) TableName() string {
	return "user_managed_groups"
}
