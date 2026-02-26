package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// FormulaCompositionItem represents a single herb in a formula's composition.
type FormulaCompositionItem struct {
	HerbName      string `json:"herb_name"`
	DefaultDosage string `json:"default_dosage"`
}

// FormulaComposition is a JSON-serializable slice of FormulaCompositionItem.
type FormulaComposition []FormulaCompositionItem

// Value implements driver.Valuer for GORM JSON storage.
func (fc FormulaComposition) Value() (driver.Value, error) {
	if fc == nil {
		return "[]", nil
	}
	b, err := json.Marshal(fc)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

// Scan implements sql.Scanner for GORM JSON storage.
func (fc *FormulaComposition) Scan(value interface{}) error {
	if value == nil {
		*fc = FormulaComposition{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case string:
		bytes = []byte(v)
	case []byte:
		bytes = v
	default:
		return errors.New("unsupported type for FormulaComposition")
	}
	return json.Unmarshal(bytes, fc)
}

// Formula represents a traditional Chinese medicine formula (global, no tenant_id).
type Formula struct {
	ID          uint64             `gorm:"primaryKey;autoIncrement" json:"id"`
	Name        string             `gorm:"column:name;type:varchar(100);uniqueIndex;not null" json:"name"`
	Effects     string             `gorm:"column:effects;type:text" json:"effects"`
	Indications string             `gorm:"column:indications;type:text" json:"indications"`
	Composition FormulaComposition `gorm:"column:composition;type:json" json:"composition"`
	Notes       string             `gorm:"column:notes;type:text" json:"notes"`
	Source      string             `gorm:"column:source;type:varchar(20);default:manual" json:"source"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
}

func (Formula) TableName() string {
	return "formulas"
}
