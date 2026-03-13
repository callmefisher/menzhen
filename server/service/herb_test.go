package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func setupHerbService(t *testing.T) (*service.HerbService, func()) {
	db := testutil.SetupTestDB(t)
	svc := service.NewHerbService(db, nil)
	return svc, func() {}
}

func seedHerbs(t *testing.T, svc *service.HerbService) []model.Herb {
	herbs := []model.Herb{
		{Name: "黄芪", Category: "补气", Properties: "甘，微温", Effects: "补气升阳", Indications: "气虚乏力"},
		{Name: "当归", Category: "补血", Properties: "甘辛温", Effects: "补血活血", Indications: "血虚"},
		{Name: "人参", Category: "补气", Properties: "甘微苦微温", Effects: "大补元气", Indications: "气虚欲脱"},
		{Name: "白术", Category: "补气", Properties: "苦甘温", Effects: "健脾益气", Indications: "脾虚食少"},
		{Name: "熟地黄", Category: "补血", Properties: "甘微温", Effects: "滋阴补血", Indications: "血虚萎黄"},
	}
	for i := range herbs {
		err := svc.DB.Create(&herbs[i]).Error
		assert.NoError(t, err)
	}
	return herbs
}

func TestHerbService_Search_Success(t *testing.T) {
	svc, _ := setupHerbService(t)
	seedHerbs(t, svc)

	herbs, total, err := svc.Search("", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, herbs, 5)
}

func TestHerbService_Search_ByCategory(t *testing.T) {
	svc, _ := setupHerbService(t)
	seedHerbs(t, svc)

	herbs, total, err := svc.Search("", "补气", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(3), total)
	assert.Len(t, herbs, 3)
	for _, h := range herbs {
		assert.Equal(t, "补气", h.Category)
	}
}

func TestHerbService_Search_ByName(t *testing.T) {
	svc, _ := setupHerbService(t)
	seedHerbs(t, svc)

	herbs, total, err := svc.Search("黄芪", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, herbs, 1)
	assert.Equal(t, "黄芪", herbs[0].Name)
}

func TestHerbService_Search_Empty(t *testing.T) {
	svc, _ := setupHerbService(t)
	seedHerbs(t, svc)

	herbs, total, err := svc.Search("不存在的药材", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, herbs, 0)
}

func TestHerbService_Search_Pagination(t *testing.T) {
	svc, _ := setupHerbService(t)
	seedHerbs(t, svc)

	herbs, total, err := svc.Search("", "", 1, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, herbs, 2)

	herbs2, total2, err := svc.Search("", "", 2, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total2)
	assert.Len(t, herbs2, 2)
	assert.NotEqual(t, herbs[0].ID, herbs2[0].ID)
}

func TestHerbService_GetByID_Success(t *testing.T) {
	svc, _ := setupHerbService(t)
	seeded := seedHerbs(t, svc)

	herb, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.NotNil(t, herb)
	assert.Equal(t, "黄芪", herb.Name)
	assert.Equal(t, "补气", herb.Category)
}

func TestHerbService_GetByID_NotFound(t *testing.T) {
	svc, _ := setupHerbService(t)

	herb, err := svc.GetByID(99999)
	assert.ErrorIs(t, err, service.ErrHerbNotFound)
	assert.Nil(t, herb)
}

func TestHerbService_ListCategories(t *testing.T) {
	svc, _ := setupHerbService(t)
	seedHerbs(t, svc)

	categories, err := svc.ListCategories()
	assert.NoError(t, err)
	assert.Contains(t, categories, "补气")
	assert.Contains(t, categories, "补血")
	assert.Len(t, categories, 2)
}

func TestHerbService_DeleteByID_Success(t *testing.T) {
	svc, _ := setupHerbService(t)
	seeded := seedHerbs(t, svc)

	err := svc.DeleteByID(seeded[0].ID)
	assert.NoError(t, err)

	// Verify deleted
	_, err = svc.GetByID(seeded[0].ID)
	assert.ErrorIs(t, err, service.ErrHerbNotFound)
}

func TestHerbService_DeleteByID_NotFound(t *testing.T) {
	svc, _ := setupHerbService(t)

	err := svc.DeleteByID(99999)
	assert.ErrorIs(t, err, service.ErrHerbNotFound)
}

func TestHerbService_Update_Success(t *testing.T) {
	svc, _ := setupHerbService(t)
	seeded := seedHerbs(t, svc)

	err := svc.Update(seeded[0].ID, map[string]interface{}{
		"effects": "补气升阳、固表止汗",
		"alias":   "绵芪",
	})
	assert.NoError(t, err)

	herb, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.Equal(t, "补气升阳、固表止汗", herb.Effects)
	assert.Equal(t, "绵芪", herb.Alias)
}

func TestHerbService_Update_NotFound(t *testing.T) {
	svc, _ := setupHerbService(t)

	err := svc.Update(99999, map[string]interface{}{"effects": "test"})
	assert.ErrorIs(t, err, service.ErrHerbNotFound)
}
