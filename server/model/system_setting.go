package model

// SystemSetting 系统级键值配置（不含租户隔离）
type SystemSetting struct {
	Key   string `gorm:"primaryKey" json:"key"`
	Value string `json:"value"`
}
