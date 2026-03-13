package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func TestPatientHandler_Create_Success(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("POST", "/api/v1/patients", map[string]interface{}{
		"name":   "张三",
		"gender": 1,
	})

	assert.Equal(t, http.StatusCreated, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := getData(w)
	assert.Equal(t, "张三", data["name"])
	assert.Equal(t, float64(1), data["gender"])
	assert.NotZero(t, data["id"])
}

func TestPatientHandler_Create_MissingParams(t *testing.T) {
	env := setupTestEnv(t)

	// Missing name
	w := env.doRequest("POST", "/api/v1/patients", map[string]interface{}{
		"gender": 1,
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Missing gender
	w = env.doRequest("POST", "/api/v1/patients", map[string]interface{}{
		"name": "李四",
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Invalid gender (must be 1 or 2)
	w = env.doRequest("POST", "/api/v1/patients", map[string]interface{}{
		"name":   "王五",
		"gender": 3,
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestPatientHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)

	// Create a few patients
	testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "患者A")
	testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "患者B")

	w := env.doRequest("GET", "/api/v1/patients", nil)

	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := getData(w)
	assert.NotNil(t, data["list"])
	assert.GreaterOrEqual(t, data["total"].(float64), float64(2))
}

func TestPatientHandler_List_Search(t *testing.T) {
	env := setupTestEnv(t)

	testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "张三丰")
	testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "李四")

	w := env.doRequest("GET", "/api/v1/patients?name=张", nil)

	assert.Equal(t, http.StatusOK, w.Code)

	data := getData(w)
	list := data["list"].([]interface{})
	assert.Equal(t, 1, len(list))

	first := list[0].(map[string]interface{})
	assert.Contains(t, first["name"], "张")
}

func TestPatientHandler_Detail_Success(t *testing.T) {
	env := setupTestEnv(t)

	patient := testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "赵六")

	w := env.doRequest("GET", fmt.Sprintf("/api/v1/patients/%d", patient.ID), nil)

	assert.Equal(t, http.StatusOK, w.Code)

	data := getData(w)
	assert.Equal(t, "赵六", data["name"])
	assert.Equal(t, float64(patient.ID), data["id"])
}

func TestPatientHandler_Detail_NotFound(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/patients/99999", nil)

	assert.Equal(t, http.StatusNotFound, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(404), body["code"])
}

func TestPatientHandler_Update_Success(t *testing.T) {
	env := setupTestEnv(t)

	patient := testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "原名")

	newName := "新名字"
	w := env.doRequest("PUT", fmt.Sprintf("/api/v1/patients/%d", patient.ID), map[string]interface{}{
		"name": newName,
	})

	assert.Equal(t, http.StatusOK, w.Code)

	data := getData(w)
	assert.Equal(t, newName, data["name"])
}

func TestPatientHandler_Delete_Success(t *testing.T) {
	env := setupTestEnv(t)

	patient := testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "待删除")

	w := env.doRequest("DELETE", fmt.Sprintf("/api/v1/patients/%d", patient.ID), nil)

	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	// Verify patient is gone
	w = env.doRequest("GET", fmt.Sprintf("/api/v1/patients/%d", patient.ID), nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestPatientHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/patients", nil)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestPatientHandler_NoPermission(t *testing.T) {
	env := setupTestEnv(t)

	// Create a user with no permissions (nil role)
	_, token2 := testutil.SeedTestUser(t, env.DB, env.TenantID, "noperm", "pass123", nil)

	// Build a custom request with the no-permission user's token
	req := httptest.NewRequest("GET", "/api/v1/patients", bytes.NewReader(nil))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token2)

	w := httptest.NewRecorder()
	env.Router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)

	var body map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &body)
	assert.NotEqual(t, float64(0), body["code"])
}
