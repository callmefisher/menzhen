package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

// createTestRecord is a helper that creates a patient and a record, returning the record ID.
func createTestRecord(t *testing.T, env *testEnv, patientName string) (patientID, recordID float64) {
	t.Helper()
	patient := testutil.SeedTestPatient(t, env.DB, env.TenantID, env.User.ID, patientName)

	w := env.doRequest("POST", "/api/v1/records", map[string]interface{}{
		"patient_id": patient.ID,
		"diagnosis":  "test diagnosis",
		"visit_date": "2025-01-01",
	})
	assert.Equal(t, http.StatusCreated, w.Code)
	data := getData(w)
	return float64(patient.ID), data["id"].(float64)
}

func TestPrescriptionHandler_Create_Success(t *testing.T) {
	env := setupTestEnv(t)
	_, recordID := createTestRecord(t, env, "处方患者")

	w := env.doRequest("POST", "/api/v1/prescriptions", map[string]interface{}{
		"record_id":    recordID,
		"formula_name": "桂枝汤",
		"total_doses":  3,
		"items": []map[string]interface{}{
			{"herb_name": "黄芪", "dosage": "15g"},
			{"herb_name": "当归", "dosage": "10g"},
		},
	})

	assert.Equal(t, http.StatusCreated, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	data := getData(w)
	assert.NotNil(t, data)
	assert.NotZero(t, data["id"])
	assert.Equal(t, "桂枝汤", data["formula_name"])
}

func TestPrescriptionHandler_Create_MissingRecordID(t *testing.T) {
	env := setupTestEnv(t)

	// No record_id — should fail validation (binding:"required")
	w := env.doRequest("POST", "/api/v1/prescriptions", map[string]interface{}{
		"formula_name": "test",
		"items": []map[string]interface{}{
			{"herb_name": "黄芪", "dosage": "15g"},
		},
	})

	assert.Equal(t, http.StatusBadRequest, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(400), body["code"])
}

func TestPrescriptionHandler_Detail_Success(t *testing.T) {
	env := setupTestEnv(t)
	_, recordID := createTestRecord(t, env, "详情处方患者")

	// Create prescription
	w := env.doRequest("POST", "/api/v1/prescriptions", map[string]interface{}{
		"record_id":    recordID,
		"formula_name": "四物汤",
		"items": []map[string]interface{}{
			{"herb_name": "熟地", "dosage": "12g"},
		},
	})
	assert.Equal(t, http.StatusCreated, w.Code)
	createData := getData(w)
	prescriptionID := createData["id"]

	// Get detail
	w = env.doRequest("GET", fmt.Sprintf("/api/v1/prescriptions/%.0f", prescriptionID), nil)
	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	data := getData(w)
	assert.NotNil(t, data)
	assert.Equal(t, "四物汤", data["formula_name"])
}

func TestPrescriptionHandler_ListByRecord_Success(t *testing.T) {
	env := setupTestEnv(t)
	_, recordID := createTestRecord(t, env, "列表处方患者")

	// Create two prescriptions for the same record
	for i := 0; i < 2; i++ {
		w := env.doRequest("POST", "/api/v1/prescriptions", map[string]interface{}{
			"record_id":    recordID,
			"formula_name": fmt.Sprintf("方剂%d", i),
			"items": []map[string]interface{}{
				{"herb_name": "黄芪", "dosage": "15g"},
			},
		})
		assert.Equal(t, http.StatusCreated, w.Code)
	}

	// List prescriptions by record
	w := env.doRequest("GET", fmt.Sprintf("/api/v1/records/%.0f/prescriptions", recordID), nil)
	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	dataList := getDataList(w)
	assert.GreaterOrEqual(t, len(dataList), 2)
}
