package model

// SystemSetting 系统级键值配置（不含租户隔离）
type SystemSetting struct {
	Key   string `gorm:"primaryKey;type:varchar(100);not null" json:"key"`
	Value string `gorm:"type:text;not null"                   json:"value"`
}

func (SystemSetting) TableName() string { return "system_settings" }
