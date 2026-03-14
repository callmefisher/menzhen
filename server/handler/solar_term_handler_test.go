package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/callmefisher/menzhen/server/database"
	"github.com/stretchr/testify/assert"
)

func TestSolarTermHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)
	database.Seed(env.DB)

	w := env.doRequest("GET", "/api/v1/solar-terms", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].([]interface{})
	assert.Len(t, data, 24)

	// Verify first item is 立春.
	first := data[0].(map[string]interface{})
	assert.Equal(t, "立春", first["name"])
	assert.Equal(t, "春", first["season"])
	assert.Equal(t, float64(1), first["order_index"])
}

func TestSolarTermHandler_Update_Success(t *testing.T) {
	env := setupTestEnv(t)
	database.Seed(env.DB)

	// Get the list to find an ID.
	w := env.doRequest("GET", "/api/v1/solar-terms", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	data := parseJSON(w)["data"].([]interface{})
	firstTerm := data[0].(map[string]interface{})
	id := firstTerm["id"].(float64)

	// Update content.
	reqBody := map[string]interface{}{
		"content": "立春养生：早睡早起，疏肝理气",
	}
	w = env.doRequest("PUT", fmt.Sprintf("/api/v1/solar-terms/%d", int(id)), reqBody)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	respData := body["data"].(map[string]interface{})
	assert.Equal(t, "立春养生：早睡早起，疏肝理气", respData["content"])
}

func TestSolarTermHandler_Update_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	database.Seed(env.DB)

	reqBody := map[string]interface{}{
		"content": "内容",
	}
	w := env.doRequest("PUT", "/api/v1/solar-terms/99999", reqBody)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestSolarTermHandler_DeleteContent_Success(t *testing.T) {
	env := setupTestEnv(t)
	database.Seed(env.DB)

	// Get an ID.
	w := env.doRequest("GET", "/api/v1/solar-terms", nil)
	data := parseJSON(w)["data"].([]interface{})
	firstTerm := data[0].(map[string]interface{})
	id := firstTerm["id"].(float64)

	// First set content.
	reqBody := map[string]interface{}{
		"content": "将要被清除的内容",
	}
	w = env.doRequest("PUT", fmt.Sprintf("/api/v1/solar-terms/%d", int(id)), reqBody)
	assert.Equal(t, http.StatusOK, w.Code)

	// Delete content.
	w = env.doRequest("DELETE", fmt.Sprintf("/api/v1/solar-terms/%d/content", int(id)), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	// Verify content is cleared by re-listing.
	w = env.doRequest("GET", "/api/v1/solar-terms", nil)
	data = parseJSON(w)["data"].([]interface{})
	for _, item := range data {
		term := item.(map[string]interface{})
		if term["id"].(float64) == id {
			assert.Equal(t, "", term["content"])
			break
		}
	}
}

func TestSolarTermHandler_DeleteContent_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	database.Seed(env.DB)

	w := env.doRequest("DELETE", "/api/v1/solar-terms/99999/content", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestSolarTermHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/solar-terms", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
