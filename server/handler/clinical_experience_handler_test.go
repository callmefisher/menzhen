package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/stretchr/testify/assert"
)

func TestClinicalExpHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)

	items := []model.ClinicalExperience{
		{Source: "伤寒论", Category: "外感", Herbs: "麻黄", Formula: "麻黄汤", Experience: "太阳伤寒"},
		{Source: "金匮要略", Category: "内伤", Herbs: "黄芪", Formula: "黄芪建中汤", Experience: "虚劳"},
	}
	for i := range items {
		assert.NoError(t, env.DB.Create(&items[i]).Error)
	}

	w := env.doRequest("GET", "/api/v1/clinical-experiences?page=1&size=10", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	assert.Equal(t, float64(2), data["total"])

	list := data["list"].([]interface{})
	assert.Len(t, list, 2)
}

func TestClinicalExpHandler_Detail_Success(t *testing.T) {
	env := setupTestEnv(t)

	item := model.ClinicalExperience{
		Source: "伤寒论", Category: "外感", Herbs: "麻黄", Formula: "麻黄汤", Experience: "太阳伤寒",
	}
	assert.NoError(t, env.DB.Create(&item).Error)

	w := env.doRequest("GET", fmt.Sprintf("/api/v1/clinical-experiences/%d", item.ID), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	data := getData(w)
	assert.NotNil(t, data)
	assert.Equal(t, "伤寒论", data["source"])
	assert.Equal(t, "太阳伤寒", data["experience"])
}

func TestClinicalExpHandler_Detail_NotFound(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/clinical-experiences/99999", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestClinicalExpHandler_Create_Success(t *testing.T) {
	env := setupTestEnv(t)

	reqBody := map[string]interface{}{
		"source":     "温病条辨",
		"category":   "温病",
		"herbs":      "银花、连翘",
		"formula":    "银翘散",
		"experience": "风温初起，邪在卫分",
	}

	w := env.doRequest("POST", "/api/v1/clinical-experiences", reqBody)
	assert.Equal(t, http.StatusCreated, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	assert.Equal(t, "温病条辨", data["source"])
	assert.Equal(t, "银翘散", data["formula"])
}

func TestClinicalExpHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/clinical-experiences", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
