package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func createTestHexagram(env *testEnv) float64 {
	body := map[string]interface{}{
		"number": 1, "name": "乾", "symbol": "☰☰",
		"upper_trigram": "乾", "lower_trigram": "乾", "judgment": "元亨利贞",
		"yao_texts": []map[string]interface{}{
			{"position": 1, "name": "初九", "text": "潜龙勿用"},
			{"position": 2, "name": "九二", "text": "见龙在田"},
			{"position": 3, "name": "九三", "text": "君子终日乾乾"},
			{"position": 4, "name": "九四", "text": "或跃在渊"},
			{"position": 5, "name": "九五", "text": "飞龙在天"},
			{"position": 6, "name": "上九", "text": "亢龙有悔"},
		},
	}
	w := env.doRequest("POST", "/api/v1/hexagrams", body)
	result := parseJSON(w)
	data := result["data"].(map[string]interface{})
	return data["id"].(float64)
}

func TestHexagramHandler_Create_Success(t *testing.T) {
	env := setupTestEnv(t)
	body := map[string]interface{}{
		"number": 1, "name": "乾", "symbol": "☰☰",
		"upper_trigram": "乾", "lower_trigram": "乾", "judgment": "元亨利贞",
	}
	w := env.doRequest("POST", "/api/v1/hexagrams", body)
	assert.Equal(t, http.StatusCreated, w.Code)
	result := parseJSON(w)
	assert.Equal(t, float64(0), result["code"])
	data := result["data"].(map[string]interface{})
	assert.Equal(t, "乾", data["name"])
}

func TestHexagramHandler_Create_MissingName(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("POST", "/api/v1/hexagrams", map[string]interface{}{"number": 1, "symbol": "☰☰"})
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHexagramHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)
	createTestHexagram(env)
	w := env.doRequest("GET", "/api/v1/hexagrams", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	data := parseJSON(w)["data"].(map[string]interface{})
	list := data["list"].([]interface{})
	assert.Len(t, list, 1)
}

func TestHexagramHandler_List_SearchByName(t *testing.T) {
	env := setupTestEnv(t)
	createTestHexagram(env)
	w := env.doRequest("GET", "/api/v1/hexagrams?name=乾", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	data := parseJSON(w)["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["total"])
}

func TestHexagramHandler_Detail_Success(t *testing.T) {
	env := setupTestEnv(t)
	id := createTestHexagram(env)
	w := env.doRequest("GET", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)), nil)
	assert.Equal(t, http.StatusOK, w.Code)
	data := parseJSON(w)["data"].(map[string]interface{})
	assert.Equal(t, "乾", data["name"])
	yao := data["yao_texts"].([]interface{})
	assert.Len(t, yao, 6)
}

func TestHexagramHandler_Detail_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("GET", "/api/v1/hexagrams/99999", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHexagramHandler_Update_Success(t *testing.T) {
	env := setupTestEnv(t)
	id := createTestHexagram(env)
	w := env.doRequest("PUT", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)),
		map[string]interface{}{"description": "天行健，君子以自强不息"})
	assert.Equal(t, http.StatusOK, w.Code)
	w = env.doRequest("GET", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)), nil)
	data := parseJSON(w)["data"].(map[string]interface{})
	assert.Equal(t, "天行健，君子以自强不息", data["description"])
}

func TestHexagramHandler_Update_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("PUT", "/api/v1/hexagrams/99999", map[string]interface{}{"description": "x"})
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHexagramHandler_Delete_Success(t *testing.T) {
	env := setupTestEnv(t)
	id := createTestHexagram(env)
	w := env.doRequest("DELETE", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)), nil)
	assert.Equal(t, http.StatusOK, w.Code)
	w = env.doRequest("GET", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)), nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHexagramHandler_Delete_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("DELETE", "/api/v1/hexagrams/99999", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHexagramHandler_Trigrams(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("GET", "/api/v1/hexagrams/trigrams", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	data := parseJSON(w)["data"].([]interface{})
	assert.Len(t, data, 8)
	assert.Contains(t, data, "乾")
}

func TestHexagramHandler_NoAuth(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequestNoAuth("GET", "/api/v1/hexagrams", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
