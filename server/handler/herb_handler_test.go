package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/stretchr/testify/assert"
)

func TestHerbHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)

	// Seed herbs
	herbs := []model.Herb{
		{Name: "黄芪", Category: "补气", Effects: "补气升阳", Indications: "气虚乏力"},
		{Name: "当归", Category: "补血", Effects: "补血活血", Indications: "血虚萎黄"},
		{Name: "人参", Category: "补气", Effects: "大补元气", Indications: "气虚欲脱"},
	}
	for i := range herbs {
		assert.NoError(t, env.DB.Create(&herbs[i]).Error)
	}

	w := env.doRequest("GET", "/api/v1/herbs?page=1&size=10", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	assert.Equal(t, float64(3), data["total"])

	list := data["list"].([]interface{})
	assert.Len(t, list, 3)
}

func TestHerbHandler_List_FilterByCategory(t *testing.T) {
	env := setupTestEnv(t)

	herbs := []model.Herb{
		{Name: "黄芪", Category: "补气", Effects: "补气升阳", Indications: "气虚乏力"},
		{Name: "当归", Category: "补血", Effects: "补血活血", Indications: "血虚萎黄"},
	}
	for i := range herbs {
		assert.NoError(t, env.DB.Create(&herbs[i]).Error)
	}

	w := env.doRequest("GET", "/api/v1/herbs?category=补气", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	data := body["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["total"])
}

func TestHerbHandler_Detail_Success(t *testing.T) {
	env := setupTestEnv(t)

	herb := model.Herb{Name: "黄芪", Category: "补气", Effects: "补气升阳", Indications: "气虚乏力"}
	assert.NoError(t, env.DB.Create(&herb).Error)

	w := env.doRequest("GET", fmt.Sprintf("/api/v1/herbs/%d", herb.ID), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	data := getData(w)
	assert.NotNil(t, data)
	assert.Equal(t, "黄芪", data["name"])
}

func TestHerbHandler_Detail_NotFound(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/herbs/99999", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHerbHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/herbs", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
