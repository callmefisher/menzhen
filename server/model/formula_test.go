package model

import (
	"encoding/json"
	"testing"
)

func TestFormulaComposition_Value(t *testing.T) {
	comp := FormulaComposition{
		{HerbName: "麻黄", DefaultDosage: "9g"},
		{HerbName: "桂枝", DefaultDosage: "9g"},
	}

	val, err := comp.Value()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	str, ok := val.(string)
	if !ok {
		t.Fatal("expected string value")
	}

	var items []FormulaCompositionItem
	if err := json.Unmarshal([]byte(str), &items); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if len(items) != 2 {
		t.Errorf("expected 2 items, got %d", len(items))
	}
	if items[0].HerbName != "麻黄" {
		t.Errorf("expected 麻黄, got %s", items[0].HerbName)
	}
}

func TestFormulaComposition_Value_Nil(t *testing.T) {
	var comp FormulaComposition

	val, err := comp.Value()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	str, ok := val.(string)
	if !ok {
		t.Fatal("expected string value")
	}

	if str != "[]" {
		t.Errorf("expected [], got %s", str)
	}
}

func TestFormulaComposition_Scan_String(t *testing.T) {
	var comp FormulaComposition
	input := `[{"herb_name":"黄芪","default_dosage":"15g"}]`

	err := comp.Scan(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(comp) != 1 {
		t.Fatalf("expected 1 item, got %d", len(comp))
	}
	if comp[0].HerbName != "黄芪" {
		t.Errorf("expected 黄芪, got %s", comp[0].HerbName)
	}
	if comp[0].DefaultDosage != "15g" {
		t.Errorf("expected 15g, got %s", comp[0].DefaultDosage)
	}
}

func TestFormulaComposition_Scan_Bytes(t *testing.T) {
	var comp FormulaComposition
	input := []byte(`[{"herb_name":"当归","default_dosage":"12g"}]`)

	err := comp.Scan(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(comp) != 1 {
		t.Fatalf("expected 1 item, got %d", len(comp))
	}
	if comp[0].HerbName != "当归" {
		t.Errorf("expected 当归, got %s", comp[0].HerbName)
	}
}

func TestFormulaComposition_Scan_Nil(t *testing.T) {
	var comp FormulaComposition

	err := comp.Scan(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(comp) != 0 {
		t.Errorf("expected empty composition, got %d items", len(comp))
	}
}

func TestFormulaComposition_Scan_InvalidType(t *testing.T) {
	var comp FormulaComposition

	err := comp.Scan(12345)
	if err == nil {
		t.Error("expected error for invalid type")
	}
}
