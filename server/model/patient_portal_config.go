// server/model/patient_portal_config.go
package model

// PatientPortalConfig 存储每个租户的患者端功能开关。
// 每租户一行（TenantID 为主键），行不存在时默认全部开启。
type PatientPortalConfig struct {
	TenantID           uint64 `gorm:"primaryKey" json:"tenant_id"`
	LoginEnabled       bool   `gorm:"column:login_enabled;not null;default:true" json:"login_enabled"`
	RegisterEnabled    bool   `gorm:"column:register_enabled;not null;default:true" json:"register_enabled"`
	AppointmentEnabled bool   `gorm:"column:appointment_enabled;not null;default:true" json:"appointment_enabled"`
	QueueEnabled       bool   `gorm:"column:queue_enabled;not null;default:true" json:"queue_enabled"`
	RecordsEnabled     bool   `gorm:"column:records_enabled;not null;default:true" json:"records_enabled"`
}

func (PatientPortalConfig) TableName() string { return "patient_portal_configs" }
