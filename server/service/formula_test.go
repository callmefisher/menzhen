package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func setupFormulaService(t *testing.T) *service.FormulaService {
	db := testutil.SetupTestDB(t)
	return service.NewFormulaService(db, nil)
}

func seedFormulas(t *testing.T, svc *service.FormulaService) []model.Formula {
	formulas := []model.Formula{
		{
			Name:    "小青龙汤",
			Effects: "解表散寒、温肺化饮",
			Composition: model.FormulaComposition{
				{HerbName: "麻黄", DefaultDosage: "9g"},
				{HerbName: "桂枝", DefaultDosage: "9g"},
			},
			Notes: "外寒里饮证常用方",
		},
		{
			Name:    "四物汤",
			Effects: "补血调经",
			Composition: model.FormulaComposition{
				{HerbName: "当归", DefaultDosage: "12g"},
				{HerbName: "熟地黄", DefaultDosage: "15g"},
			},
		},
		{
			Name:    "六味地黄丸",
			Effects: "滋阴补肾",
			Composition: model.FormulaComposition{
				{HerbName: "熟地黄", DefaultDosage: "24g"},
				{HerbName: "山药", DefaultDosage: "12g"},
			},
		},
	}
	for i := range formulas {
		err := svc.DB.Create(&formulas[i]).Error
		assert.NoError(t, err)
	}
	return formulas
}

func TestFormulaService_Search_Success(t *testing.T) {
	svc := setupFormulaService(t)
	seedFormulas(t, svc)

	formulas, total, err := svc.Search("", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(3), total)
	assert.Len(t, formulas, 3)
}

func TestFormulaService_Search_ByName(t *testing.T) {
	svc := setupFormulaService(t)
	seedFormulas(t, svc)

	formulas, total, err := svc.Search("青龙", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, formulas, 1)
	assert.Equal(t, "小青龙汤", formulas[0].Name)
}

func TestFormulaService_Search_Empty(t *testing.T) {
	svc := setupFormulaService(t)
	seedFormulas(t, svc)

	formulas, total, err := svc.Search("不存在的方剂", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, formulas, 0)
}

func TestFormulaService_GetByID_Success(t *testing.T) {
	svc := setupFormulaService(t)
	seeded := seedFormulas(t, svc)

	formula, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.NotNil(t, formula)
	assert.Equal(t, "小青龙汤", formula.Name)
	assert.Len(t, formula.Composition, 2)
	assert.Equal(t, "麻黄", formula.Composition[0].HerbName)
}

func TestFormulaService_GetByID_NotFound(t *testing.T) {
	svc := setupFormulaService(t)

	formula, err := svc.GetByID(99999)
	assert.ErrorIs(t, err, service.ErrFormulaNotFound)
	assert.Nil(t, formula)
}

func TestFormulaService_DeleteByID_Success(t *testing.T) {
	svc := setupFormulaService(t)
	seeded := seedFormulas(t, svc)

	err := svc.DeleteByID(seeded[0].ID)
	assert.NoError(t, err)

	_, err = svc.GetByID(seeded[0].ID)
	assert.ErrorIs(t, err, service.ErrFormulaNotFound)
}

func TestFormulaService_UpdateComposition(t *testing.T) {
	svc := setupFormulaService(t)
	seeded := seedFormulas(t, svc)

	newComp := model.FormulaComposition{
		{HerbName: "麻黄", DefaultDosage: "6g"},
		{HerbName: "桂枝", DefaultDosage: "6g"},
		{HerbName: "白芍", DefaultDosage: "9g"},
	}

	err := svc.UpdateComposition(seeded[0].ID, newComp)
	assert.NoError(t, err)

	formula, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.Len(t, formula.Composition, 3)
	assert.Equal(t, "6g", formula.Composition[0].DefaultDosage)
	assert.Equal(t, "白芍", formula.Composition[2].HerbName)
}

func TestFormulaService_UpdateName(t *testing.T) {
	svc := setupFormulaService(t)
	seeded := seedFormulas(t, svc)

	err := svc.UpdateName(seeded[0].ID, "大青龙汤")
	assert.NoError(t, err)

	formula, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.Equal(t, "大青龙汤", formula.Name)
}

func TestFormulaService_UpdateNotes(t *testing.T) {
	svc := setupFormulaService(t)
	seeded := seedFormulas(t, svc)

	err := svc.UpdateNotes(seeded[0].ID, "适用于风寒表证")
	assert.NoError(t, err)

	formula, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.Equal(t, "适用于风寒表证", formula.Notes)
}

func TestFormulaService_UpdateComposition_NotFound(t *testing.T) {
	svc := setupFormulaService(t)

	newComp := model.FormulaComposition{
		{HerbName: "麻黄", DefaultDosage: "6g"},
	}
	err := svc.UpdateComposition(99999, newComp)
	assert.ErrorIs(t, err, service.ErrFormulaNotFound)
}

func TestFormulaService_UpdateName_NotFound(t *testing.T) {
	svc := setupFormulaService(t)

	err := svc.UpdateName(99999, "不存在的方剂")
	assert.ErrorIs(t, err, service.ErrFormulaNotFound)
}

func TestFormulaService_UpdateNotes_NotFound(t *testing.T) {
	svc := setupFormulaService(t)

	err := svc.UpdateNotes(99999, "不存在的方剂备注")
	assert.ErrorIs(t, err, service.ErrFormulaNotFound)
}

func TestFormulaService_DeleteByID_NotFound(t *testing.T) {
	svc := setupFormulaService(t)

	err := svc.DeleteByID(99999)
	assert.ErrorIs(t, err, service.ErrFormulaNotFound)
}
