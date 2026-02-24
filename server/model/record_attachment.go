package model

import "time"

// RecordAttachment represents a file attached to a medical record.
// Does NOT use soft delete.
type RecordAttachment struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	RecordID  uint64    `gorm:"column:record_id;not null;index" json:"record_id"`
	FileType  string    `gorm:"column:file_type;type:varchar(20);not null;comment:image/audio/video" json:"file_type"`
	FileName  string    `gorm:"column:file_name;type:varchar(255);not null" json:"file_name"`
	FilePath  string    `gorm:"column:file_path;type:varchar(500);not null;comment:MinIO object key" json:"file_path"`
	FileSize  int64     `gorm:"column:file_size;type:bigint" json:"file_size"`
	CreatedAt time.Time `json:"created_at"`

	// Associations
	Record MedicalRecord `gorm:"foreignKey:RecordID" json:"record,omitempty"`
}

func (RecordAttachment) TableName() string {
	return "record_attachments"
}
