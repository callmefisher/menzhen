package service_test

import (
	"encoding/json"
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"gorm.io/datatypes"
)

func setupHexagramService(t *testing.T) *service.HexagramService {
	db := testutil.SetupTestDB(t)
	return service.NewHexagramService(db)
}

func makeYaoTextsJSON(t *testing.T) datatypes.JSON {
	yao := []map[string]interface{}{
		{"position": 1, "name": "初九", "text": "潜龙勿用"},
		{"position": 2, "name": "九二", "text": "见龙在田"},
		{"position": 3, "name": "九三", "text": "君子终日乾乾"},
		{"position": 4, "name": "九四", "text": "或跃在渊"},
		{"position": 5, "name": "九五", "text": "飞龙在天"},
		{"position": 6, "name": "上九", "text": "亢龙有悔"},
	}
	b, err := json.Marshal(yao)
	assert.NoError(t, err)
	return datatypes.JSON(b)
}

func seedHexagrams(t *testing.T, svc *service.HexagramService) []model.Hexagram {
	hexagrams := []model.Hexagram{
		{Number: 1, Name: "乾", Symbol: "☰☰", UpperTrigram: "乾", LowerTrigram: "乾", Judgment: "元亨利贞", YaoTexts: makeYaoTextsJSON(t)},
		{Number: 2, Name: "坤", Symbol: "☷☷", UpperTrigram: "坤", LowerTrigram: "坤", Judgment: "元亨，利牝马之贞"},
		{Number: 3, Name: "屯", Symbol: "☵☳", UpperTrigram: "坎", LowerTrigram: "震", Judgment: "元亨利贞，勿用有攸往"},
		{Number: 4, Name: "蒙", Symbol: "☶☵", UpperTrigram: "艮", LowerTrigram: "坎", Judgment: "亨。匪我求童蒙"},
	}
	for i := range hexagrams {
		err := svc.DB.Create(&hexagrams[i]).Error
		assert.NoError(t, err)
	}
	return hexagrams
}

func TestHexagramService_Search_All(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)
	items, total, err := svc.Search("", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(4), total)
	assert.Len(t, items, 4)
}

func TestHexagramService_Search_ByName(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)
	items, total, err := svc.Search("乾", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, items, 1)
	assert.Equal(t, "乾", items[0].Name)
}

func TestHexagramService_Search_ByUpperTrigram(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)
	items, total, err := svc.Search("", "坎", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "屯", items[0].Name)
}

func TestHexagramService_Search_ByLowerTrigram(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)
	items, total, err := svc.Search("", "", "坎", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "蒙", items[0].Name)
}

func TestHexagramService_Search_Pagination(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)
	items, total, err := svc.Search("", "", "", 1, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(4), total)
	assert.Len(t, items, 2)
}

func TestHexagramService_GetByID_Success(t *testing.T) {
	svc := setupHexagramService(t)
	seeded := seedHexagrams(t, svc)
	h, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.Equal(t, "乾", h.Name)
	assert.Equal(t, 1, h.Number)
}

func TestHexagramService_GetByID_NotFound(t *testing.T) {
	svc := setupHexagramService(t)
	h, err := svc.GetByID(99999)
	assert.ErrorIs(t, err, service.ErrHexagramNotFound)
	assert.Nil(t, h)
}

func TestHexagramService_Create(t *testing.T) {
	svc := setupHexagramService(t)
	h := &model.Hexagram{
		Number: 5, Name: "需", Symbol: "☵☰",
		UpperTrigram: "坎", LowerTrigram: "乾",
		Judgment: "有孚，光亨，贞吉",
	}
	err := svc.Create(h)
	assert.NoError(t, err)
	assert.NotZero(t, h.ID)
	fetched, err := svc.GetByID(h.ID)
	assert.NoError(t, err)
	assert.Equal(t, "需", fetched.Name)
}

func TestHexagramService_Update(t *testing.T) {
	svc := setupHexagramService(t)
	seeded := seedHexagrams(t, svc)
	err := svc.Update(seeded[0].ID, map[string]interface{}{
		"description": "天行健，君子以自强不息",
	})
	assert.NoError(t, err)
	h, _ := svc.GetByID(seeded[0].ID)
	assert.Equal(t, "天行健，君子以自强不息", h.Description)
}

func TestHexagramService_Update_NotFound(t *testing.T) {
	svc := setupHexagramService(t)
	err := svc.Update(99999, map[string]interface{}{"description": "x"})
	assert.ErrorIs(t, err, service.ErrHexagramNotFound)
}

func TestHexagramService_Delete(t *testing.T) {
	svc := setupHexagramService(t)
	seeded := seedHexagrams(t, svc)
	err := svc.DeleteByID(seeded[0].ID)
	assert.NoError(t, err)
	_, err = svc.GetByID(seeded[0].ID)
	assert.ErrorIs(t, err, service.ErrHexagramNotFound)
}

func TestHexagramService_Delete_NotFound(t *testing.T) {
	svc := setupHexagramService(t)
	err := svc.DeleteByID(99999)
	assert.ErrorIs(t, err, service.ErrHexagramNotFound)
}

func TestHexagramService_ListTrigrams(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)
	trigrams, err := svc.ListTrigrams()
	assert.NoError(t, err)
	assert.Contains(t, trigrams, "乾")
	assert.Contains(t, trigrams, "坤")
}
