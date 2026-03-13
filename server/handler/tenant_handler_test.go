package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTenantHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/tenants?page=1&size=20", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	// At least the test-clinic tenant seeded by setupTestEnv
	assert.GreaterOrEqual(t, data["total"].(float64), float64(1))
}

func TestTenantHandler_Create_Success(t *testing.T) {
	env := setupTestEnv(t)

	reqBody := map[string]interface{}{
		"name": "新诊所",
		"code": "new-clinic-001",
	}

	w := env.doRequest("POST", "/api/v1/tenants", reqBody)
	assert.Equal(t, http.StatusCreated, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	assert.Equal(t, "新诊所", data["name"])
	assert.Equal(t, "new-clinic-001", data["code"])
}

func TestTenantHandler_Create_DuplicateCode(t *testing.T) {
	env := setupTestEnv(t)

	// "test-clinic" is already seeded by setupTestEnv
	reqBody := map[string]interface{}{
		"name": "重复诊所",
		"code": "test-clinic",
	}

	w := env.doRequest("POST", "/api/v1/tenants", reqBody)
	assert.Equal(t, http.StatusConflict, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(409), body["code"])
}

func TestTenantHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/tenants", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
