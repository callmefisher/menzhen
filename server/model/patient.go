package model

// Patient represents a patient record. Uses BaseModel for soft delete support.
type Patient struct {
	BaseModel
	TenantID  uint64  `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	Name      string  `gorm:"column:name;type:varchar(50);not null" json:"name"`
	Gender    int8    `gorm:"column:gender;type:tinyint;not null;comment:1=male 2=female" json:"gender"`
	Age       int     `gorm:"column:age;type:int" json:"age"`
	Weight    float64 `gorm:"column:weight;type:decimal(5,1)" json:"weight"`
	Phone     string  `gorm:"column:phone;type:varchar(20)" json:"phone"`
	IDCard    string  `gorm:"column:id_card;type:varchar(20)" json:"id_card"`
	CreatedBy uint64  `gorm:"column:created_by;not null" json:"created_by"`

	// Associations
	Tenant         Tenant          `gorm:"foreignKey:TenantID" json:"tenant,omitempty"`
	Creator        User            `gorm:"foreignKey:CreatedBy" json:"creator,omitempty"`
	MedicalRecords []MedicalRecord `gorm:"foreignKey:PatientID" json:"medical_records,omitempty"`
}

func (Patient) TableName() string {
	return "patients"
}
