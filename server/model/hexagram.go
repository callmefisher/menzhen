package model

import (
	"time"

	"gorm.io/datatypes"
)

// Hexagram represents an I Ching hexagram (global data, no tenant_id).
type Hexagram struct {
	ID               uint64         `gorm:"primaryKey;autoIncrement" json:"id"`
	Number           int            `gorm:"column:number;uniqueIndex;not null" json:"number"`
	Name             string         `gorm:"column:name;type:varchar(20);uniqueIndex;not null" json:"name"`
	Symbol           string         `gorm:"column:symbol;type:varchar(20);not null" json:"symbol"`
	UpperTrigram     string         `gorm:"column:upper_trigram;type:varchar(10);index" json:"upper_trigram"`
	LowerTrigram     string         `gorm:"column:lower_trigram;type:varchar(10);index" json:"lower_trigram"`
	Judgment         string         `gorm:"column:judgment;type:text" json:"judgment"`
	YaoTexts         datatypes.JSON `gorm:"column:yao_texts;type:json" json:"yao_texts"`
	Commentary       string         `gorm:"column:commentary;type:text" json:"commentary"`
	TcmApplication   string         `gorm:"column:tcm_application;type:text" json:"tcm_application"`
	RelatedHexagrams datatypes.JSON `gorm:"column:related_hexagrams;type:json" json:"related_hexagrams"`
	Description      string         `gorm:"column:description;type:text" json:"description"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

func (Hexagram) TableName() string {
	return "hexagrams"
}
