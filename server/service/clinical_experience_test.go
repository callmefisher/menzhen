package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func setupClinicalExperienceService(t *testing.T) *service.ClinicalExperienceService {
	db := testutil.SetupTestDB(t)
	return service.NewClinicalExperienceService(db)
}

func seedClinicalExperiences(t *testing.T, svc *service.ClinicalExperienceService) []model.ClinicalExperience {
	items := []model.ClinicalExperience{
		{Source: "伤寒论", Category: "经方", Herbs: "麻黄、桂枝", Formula: "麻黄汤", Experience: "治太阳伤寒表实证"},
		{Source: "金匮要略", Category: "经方", Herbs: "当归、芍药", Formula: "当归芍药散", Experience: "治妇人腹痛"},
		{Source: "温病条辨", Category: "时方", Herbs: "银花、连翘", Formula: "银翘散", Experience: "治温病初起"},
		{Source: "景岳全书", Category: "补益", Herbs: "黄芪、人参", Formula: "补中益气汤", Experience: "治气虚下陷"},
	}
	for i := range items {
		err := svc.DB.Create(&items[i]).Error
		assert.NoError(t, err)
	}
	return items
}

func TestClinicalExperienceService_Search_Success(t *testing.T) {
	svc := setupClinicalExperienceService(t)
	seedClinicalExperiences(t, svc)

	items, total, err := svc.Search("", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(4), total)
	assert.Len(t, items, 4)
}

func TestClinicalExperienceService_Search_ByKeyword(t *testing.T) {
	svc := setupClinicalExperienceService(t)
	seedClinicalExperiences(t, svc)

	// Search by herb name
	items, total, err := svc.Search("黄芪", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, items, 1)
	assert.Contains(t, items[0].Herbs, "黄芪")

	// Search by source
	items, total, err = svc.Search("伤寒论", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "伤寒论", items[0].Source)

	// Search by formula
	items, total, err = svc.Search("银翘散", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "银翘散", items[0].Formula)

	// Search by experience
	items, total, err = svc.Search("气虚", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Contains(t, items[0].Experience, "气虚")
}

func TestClinicalExperienceService_Search_ByCategory(t *testing.T) {
	svc := setupClinicalExperienceService(t)
	seedClinicalExperiences(t, svc)

	items, total, err := svc.Search("", "经方", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, items, 2)
	for _, item := range items {
		assert.Equal(t, "经方", item.Category)
	}
}

func TestClinicalExperienceService_Search_Empty(t *testing.T) {
	svc := setupClinicalExperienceService(t)
	seedClinicalExperiences(t, svc)

	items, total, err := svc.Search("不存在的内容", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, items, 0)
}

func TestClinicalExperienceService_GetByID_Success(t *testing.T) {
	svc := setupClinicalExperienceService(t)
	seeded := seedClinicalExperiences(t, svc)

	item, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.NotNil(t, item)
	assert.Equal(t, "伤寒论", item.Source)
	assert.Equal(t, "经方", item.Category)
	assert.Equal(t, "麻黄汤", item.Formula)
}

func TestClinicalExperienceService_GetByID_NotFound(t *testing.T) {
	svc := setupClinicalExperienceService(t)

	item, err := svc.GetByID(99999)
	assert.ErrorIs(t, err, service.ErrClinicalExperienceNotFound)
	assert.Nil(t, item)
}

func TestClinicalExperienceService_Create(t *testing.T) {
	svc := setupClinicalExperienceService(t)

	item := &model.ClinicalExperience{
		Source:     "本草纲目",
		Category:   "本草",
		Herbs:      "大黄",
		Formula:    "",
		Experience: "泻下通便",
	}
	err := svc.Create(item)
	assert.NoError(t, err)
	assert.NotZero(t, item.ID)

	fetched, err := svc.GetByID(item.ID)
	assert.NoError(t, err)
	assert.Equal(t, "本草纲目", fetched.Source)
}

func TestClinicalExperienceService_Update(t *testing.T) {
	svc := setupClinicalExperienceService(t)
	seeded := seedClinicalExperiences(t, svc)

	err := svc.Update(seeded[0].ID, map[string]interface{}{
		"experience": "治太阳伤寒表实证，恶寒发热无汗",
		"herbs":      "麻黄、桂枝、杏仁、甘草",
	})
	assert.NoError(t, err)

	item, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.Equal(t, "治太阳伤寒表实证，恶寒发热无汗", item.Experience)
	assert.Contains(t, item.Herbs, "杏仁")
}

func TestClinicalExperienceService_Update_NotFound(t *testing.T) {
	svc := setupClinicalExperienceService(t)

	err := svc.Update(99999, map[string]interface{}{"experience": "test"})
	assert.ErrorIs(t, err, service.ErrClinicalExperienceNotFound)
}

func TestClinicalExperienceService_Delete(t *testing.T) {
	svc := setupClinicalExperienceService(t)
	seeded := seedClinicalExperiences(t, svc)

	err := svc.DeleteByID(seeded[0].ID)
	assert.NoError(t, err)

	_, err = svc.GetByID(seeded[0].ID)
	assert.ErrorIs(t, err, service.ErrClinicalExperienceNotFound)
}

func TestClinicalExperienceService_Delete_NotFound(t *testing.T) {
	svc := setupClinicalExperienceService(t)

	err := svc.DeleteByID(99999)
	assert.ErrorIs(t, err, service.ErrClinicalExperienceNotFound)
}

func TestClinicalExperienceService_ListCategories(t *testing.T) {
	svc := setupClinicalExperienceService(t)
	seedClinicalExperiences(t, svc)

	categories, err := svc.ListCategories()
	assert.NoError(t, err)
	assert.Len(t, categories, 3)
	assert.Contains(t, categories, "经方")
	assert.Contains(t, categories, "时方")
	assert.Contains(t, categories, "补益")
}
