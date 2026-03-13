package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func TestRecordHandler_Create_Success(t *testing.T) {
	env := setupTestEnv(t)
	patient := testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "测试患者")

	w := env.doRequest("POST", "/api/v1/records", map[string]interface{}{
		"patient_id": patient.ID,
		"diagnosis":  "风寒感冒",
		"treatment":  "桂枝汤加减",
		"visit_date": "2025-01-01",
	})

	assert.Equal(t, http.StatusCreated, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	data := getData(w)
	assert.NotNil(t, data)
	assert.NotZero(t, data["id"])
	assert.Equal(t, "风寒感冒", data["diagnosis"])
}

func TestRecordHandler_Create_MissingParams(t *testing.T) {
	env := setupTestEnv(t)

	// Missing patient_id and visit_date (both required)
	w := env.doRequest("POST", "/api/v1/records", map[string]interface{}{
		"diagnosis": "test",
	})

	assert.Equal(t, http.StatusBadRequest, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(400), body["code"])
}

func TestRecordHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)
	patient := testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "列表患者")

	// Create two records
	for i := 0; i < 2; i++ {
		w := env.doRequest("POST", "/api/v1/records", map[string]interface{}{
			"patient_id": patient.ID,
			"diagnosis":  fmt.Sprintf("诊断%d", i),
			"visit_date": "2025-01-01",
		})
		assert.Equal(t, http.StatusCreated, w.Code)
	}

	// List records
	w := env.doRequest("GET", "/api/v1/records?page=1&size=10", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := getData(w)
	assert.NotNil(t, data)
	total, ok := data["total"].(float64)
	assert.True(t, ok)
	assert.GreaterOrEqual(t, total, float64(2))
}

func TestRecordHandler_Detail_Success(t *testing.T) {
	env := setupTestEnv(t)
	patient := testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "详情患者")

	// Create a record
	w := env.doRequest("POST", "/api/v1/records", map[string]interface{}{
		"patient_id": patient.ID,
		"diagnosis":  "详情测试",
		"treatment":  "针灸治疗",
		"visit_date": "2025-01-01",
	})
	assert.Equal(t, http.StatusCreated, w.Code)
	createData := getData(w)
	recordID := createData["id"]

	// Get detail
	w = env.doRequest("GET", fmt.Sprintf("/api/v1/records/%.0f", recordID), nil)
	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	data := getData(w)
	assert.Equal(t, "详情测试", data["diagnosis"])
}

func TestRecordHandler_Detail_NotFound(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/records/99999", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(404), body["code"])
}

func TestRecordHandler_Update_Success(t *testing.T) {
	env := setupTestEnv(t)
	patient := testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "更新患者")

	// Create a record
	w := env.doRequest("POST", "/api/v1/records", map[string]interface{}{
		"patient_id": patient.ID,
		"diagnosis":  "原始诊断",
		"visit_date": "2025-01-01",
	})
	assert.Equal(t, http.StatusCreated, w.Code)
	createData := getData(w)
	recordID := createData["id"]

	// Update the record
	newDiagnosis := "更新后的诊断"
	w = env.doRequest("PUT", fmt.Sprintf("/api/v1/records/%.0f", recordID), map[string]interface{}{
		"diagnosis": newDiagnosis,
	})
	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	data := getData(w)
	assert.Equal(t, newDiagnosis, data["diagnosis"])
}

func TestRecordHandler_Delete_Success(t *testing.T) {
	env := setupTestEnv(t)
	patient := testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, "删除患者")

	// Create a record
	w := env.doRequest("POST", "/api/v1/records", map[string]interface{}{
		"patient_id": patient.ID,
		"diagnosis":  "待删除",
		"visit_date": "2025-01-01",
	})
	assert.Equal(t, http.StatusCreated, w.Code)
	createData := getData(w)
	recordID := createData["id"]

	// Delete the record
	w = env.doRequest("DELETE", fmt.Sprintf("/api/v1/records/%.0f", recordID), nil)
	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	// Verify it's gone
	w = env.doRequest("GET", fmt.Sprintf("/api/v1/records/%.0f", recordID), nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestRecordHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/records", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
