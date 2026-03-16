package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func setupPulseService(t *testing.T) *service.PulseService {
	db := testutil.SetupTestDB(t)
	return service.NewPulseService(db, nil)
}

func seedPulses(t *testing.T, svc *service.PulseService) []model.Pulse {
	pulses := []model.Pulse{
		{Name: "浮脉", Category: "表证类", Description: "轻取即得", ClinicalMeaning: "主表证", CommonConditions: "感冒"},
		{Name: "沉脉", Category: "里证类", Description: "重按始得", ClinicalMeaning: "主里证", CommonConditions: "内伤"},
		{Name: "紧脉", Category: "寒证类", Description: "脉来紧张有力", ClinicalMeaning: "主寒证、痛证", CommonConditions: "寒邪内侵"},
		{Name: "数脉", Category: "热证类", Description: "脉来急促", ClinicalMeaning: "主热证", CommonConditions: "发热"},
	}
	for i := range pulses {
		err := svc.DB.Create(&pulses[i]).Error
		assert.NoError(t, err)
	}
	return pulses
}

func TestPulseService_Search_Success(t *testing.T) {
	svc := setupPulseService(t)
	seedPulses(t, svc)

	pulses, total, err := svc.Search("", "", 1, 10, false)
	assert.NoError(t, err)
	assert.Equal(t, int64(4), total)
	assert.Len(t, pulses, 4)
}

func TestPulseService_Search_WithSuffix(t *testing.T) {
	svc := setupPulseService(t)
	seedPulses(t, svc)

	// Search "紧" should find "紧脉" due to suffix trimming logic
	pulses, total, err := svc.Search("紧", "", 1, 10, false)
	assert.NoError(t, err)
	assert.True(t, total >= 1)
	found := false
	for _, p := range pulses {
		if p.Name == "紧脉" {
			found = true
			break
		}
	}
	assert.True(t, found, "should find 紧脉 when searching 紧")
}

func TestPulseService_Search_ByCategory(t *testing.T) {
	svc := setupPulseService(t)
	seedPulses(t, svc)

	pulses, total, err := svc.Search("", "寒证类", 1, 10, false)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, pulses, 1)
	assert.Equal(t, "紧脉", pulses[0].Name)
}

func TestPulseService_GetByID_Success(t *testing.T) {
	svc := setupPulseService(t)
	seeded := seedPulses(t, svc)

	pulse, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.NotNil(t, pulse)
	assert.Equal(t, "浮脉", pulse.Name)
	assert.Equal(t, "表证类", pulse.Category)
}

func TestPulseService_GetByID_NotFound(t *testing.T) {
	svc := setupPulseService(t)

	pulse, err := svc.GetByID(99999)
	assert.ErrorIs(t, err, service.ErrPulseNotFound)
	assert.Nil(t, pulse)
}

func TestPulseService_Create(t *testing.T) {
	svc := setupPulseService(t)

	pulse := &model.Pulse{
		Name:             "滑脉",
		Category:         "实证类",
		Description:      "往来流利",
		ClinicalMeaning:  "主痰湿、食积",
		CommonConditions: "痰饮",
	}
	err := svc.Create(pulse)
	assert.NoError(t, err)
	assert.NotZero(t, pulse.ID)

	// Verify by fetching
	fetched, err := svc.GetByID(pulse.ID)
	assert.NoError(t, err)
	assert.Equal(t, "滑脉", fetched.Name)
}

func TestPulseService_Update(t *testing.T) {
	svc := setupPulseService(t)
	seeded := seedPulses(t, svc)

	err := svc.Update(seeded[0].ID, map[string]interface{}{
		"description":      "轻取即得，重按稍减",
		"clinical_meaning": "主表证、虚证",
	})
	assert.NoError(t, err)

	pulse, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.Equal(t, "轻取即得，重按稍减", pulse.Description)
	assert.Equal(t, "主表证、虚证", pulse.ClinicalMeaning)
}

func TestPulseService_Delete(t *testing.T) {
	svc := setupPulseService(t)
	seeded := seedPulses(t, svc)

	err := svc.DeleteByID(seeded[0].ID)
	assert.NoError(t, err)

	_, err = svc.GetByID(seeded[0].ID)
	assert.ErrorIs(t, err, service.ErrPulseNotFound)
}

func TestPulseService_ListCategories(t *testing.T) {
	svc := setupPulseService(t)
	seedPulses(t, svc)

	categories, err := svc.ListCategories()
	assert.NoError(t, err)
	assert.Len(t, categories, 4)
	assert.Contains(t, categories, "表证类")
	assert.Contains(t, categories, "里证类")
	assert.Contains(t, categories, "寒证类")
	assert.Contains(t, categories, "热证类")
}

func TestPulseService_Update_NotFound(t *testing.T) {
	svc := setupPulseService(t)

	err := svc.Update(99999, map[string]interface{}{
		"description": "不存在的脉象",
	})
	assert.ErrorIs(t, err, service.ErrPulseNotFound)
}

func TestPulseService_DeleteByID_NotFound(t *testing.T) {
	svc := setupPulseService(t)

	err := svc.DeleteByID(99999)
	assert.ErrorIs(t, err, service.ErrPulseNotFound)
}
