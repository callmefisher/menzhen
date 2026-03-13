package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestInventoryHandler_Create_Success(t *testing.T) {
	env := setupTestEnv(t)

	reqBody := map[string]interface{}{
		"name":     "黄芪饮片",
		"category": "herb",
		"stock":    100,
	}

	w := env.doRequest("POST", "/api/v1/inventory/drugs", reqBody)
	assert.Equal(t, http.StatusCreated, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	assert.Equal(t, "黄芪饮片", data["name"])
	assert.Equal(t, "herb", data["category"])
	assert.Equal(t, float64(100), data["stock"])
}

func TestInventoryHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)

	// Create a drug first so list is non-empty
	createBody := map[string]interface{}{
		"name":     "当归片",
		"category": "herb",
		"stock":    50,
	}
	w := env.doRequest("POST", "/api/v1/inventory/drugs", createBody)
	assert.Equal(t, http.StatusCreated, w.Code)

	w = env.doRequest("GET", "/api/v1/inventory/drugs?page=1&size=20", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	assert.GreaterOrEqual(t, data["total"].(float64), float64(1))

	list := data["list"].([]interface{})
	assert.GreaterOrEqual(t, len(list), 1)
}

func TestInventoryHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/inventory/drugs", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)

	w = env.doRequestNoAuth("POST", "/api/v1/inventory/drugs", map[string]interface{}{
		"name":     "test",
		"category": "herb",
		"stock":    1,
	})
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
