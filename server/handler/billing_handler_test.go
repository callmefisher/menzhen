package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupBillingHandlerTest(t *testing.T) (*testEnv, uint64) {
	t.Helper()
	env := setupTestEnv(t)

	patient := model.Patient{
		TenantID: env.TenantID, Name: "测试患者", Gender: 1, Age: 30, CreatedBy: env.User.ID,
	}
	require.NoError(t, env.DB.Create(&patient).Error)

	record := model.MedicalRecord{
		TenantID: env.TenantID, PatientID: patient.ID, CreatedBy: env.User.ID, VisitDate: time.Now(),
	}
	require.NoError(t, env.DB.Create(&record).Error)

	prescription := model.Prescription{
		RecordID: record.ID, TenantID: env.TenantID, FormulaName: "桂枝汤",
		TotalDoses: 5, CreatedBy: env.User.ID,
	}
	require.NoError(t, env.DB.Create(&prescription).Error)

	items := []model.PrescriptionItem{
		{PrescriptionID: prescription.ID, HerbName: "桂枝", Dosage: "9g", Category: "herb"},
		{PrescriptionID: prescription.ID, HerbName: "白芍", Dosage: "9g", Category: "herb"},
	}
	for _, item := range items {
		require.NoError(t, env.DB.Create(&item).Error)
	}

	drugs := []model.InventoryDrug{
		// Herb prices in 元/500g. Per gram: 80/500=0.16, 100/500=0.2
		{TenantID: env.TenantID, Name: "桂枝", Category: "herb", Stock: 500, SellingPrice: 80},
		{TenantID: env.TenantID, Name: "白芍", Category: "herb", Stock: 500, SellingPrice: 100},
	}
	for _, drug := range drugs {
		require.NoError(t, env.DB.Create(&drug).Error)
	}

	return env, prescription.ID
}

func TestBillingGetDetail(t *testing.T) {
	env, prescriptionID := setupBillingHandlerTest(t)

	w := env.doRequest("GET", fmt.Sprintf("/api/v1/prescriptions/%d/billing", prescriptionID), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	data := getData(w)
	require.NotNil(t, data)
	assert.Equal(t, "桂枝汤", data["formula_name"])
	assert.Equal(t, float64(5), data["total_doses"])

	items := data["items"].([]interface{})
	assert.Len(t, items, 2)

	// 桂枝: 9 × (80/500) × 5 = 9 × 0.16 × 5 = 7.2
	// 白芍: 9 × (100/500) × 5 = 9 × 0.2 × 5 = 9.0
	assert.InDelta(t, 16.2, data["drug_cost_total"], 0.01)
	assert.InDelta(t, 116.2, data["total_amount"], 0.01) // 16.2 + 100
}

func TestBillingGetDetail_NotFound(t *testing.T) {
	env, _ := setupBillingHandlerTest(t)
	w := env.doRequest("GET", "/api/v1/prescriptions/99999/billing", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestBillingGetDetail_NoAuth(t *testing.T) {
	env, prescriptionID := setupBillingHandlerTest(t)
	w := env.doRequestNoAuth("GET", fmt.Sprintf("/api/v1/prescriptions/%d/billing", prescriptionID), nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestBillingCreate(t *testing.T) {
	env, prescriptionID := setupBillingHandlerTest(t)

	body := map[string]interface{}{
		"consultation_fee": 120,
		"actual_paid":      200,
	}
	w := env.doRequest("POST", fmt.Sprintf("/api/v1/prescriptions/%d/billing", prescriptionID), body)
	assert.Equal(t, http.StatusCreated, w.Code)

	data := getData(w)
	require.NotNil(t, data)
	assert.InDelta(t, 120, data["consultation_fee"], 0.01)
	assert.InDelta(t, 200, data["actual_paid"], 0.01)
	assert.False(t, data["stock_deducted"].(bool))
}

func TestBillingDeductStock(t *testing.T) {
	env, prescriptionID := setupBillingHandlerTest(t)

	body := map[string]interface{}{
		"consultation_fee": 100,
		"actual_paid":      181,
	}
	w := env.doRequest("POST", fmt.Sprintf("/api/v1/prescriptions/%d/billing/deduct-stock", prescriptionID), body)
	assert.Equal(t, http.StatusOK, w.Code)

	data := getData(w)
	require.NotNil(t, data)
	assert.True(t, data["stock_deducted"].(bool))

	// Verify stock deducted.
	var guizhi model.InventoryDrug
	require.NoError(t, env.DB.Where("tenant_id = ? AND name = ?", env.TenantID, "桂枝").First(&guizhi).Error)
	assert.InDelta(t, 455, guizhi.Stock, 0.01) // 500 - (9 × 5)
}

func TestBillingDeductStock_Duplicate(t *testing.T) {
	env, prescriptionID := setupBillingHandlerTest(t)

	body := map[string]interface{}{
		"consultation_fee": 100,
		"actual_paid":      181,
	}
	w := env.doRequest("POST", fmt.Sprintf("/api/v1/prescriptions/%d/billing/deduct-stock", prescriptionID), body)
	assert.Equal(t, http.StatusOK, w.Code)

	w2 := env.doRequest("POST", fmt.Sprintf("/api/v1/prescriptions/%d/billing/deduct-stock", prescriptionID), body)
	assert.Equal(t, http.StatusConflict, w2.Code)
}

func TestBillingListByRecord(t *testing.T) {
	env, prescriptionID := setupBillingHandlerTest(t)

	// Get record ID from prescription.
	var presc model.Prescription
	require.NoError(t, env.DB.First(&presc, prescriptionID).Error)

	// Create a billing first.
	body := map[string]interface{}{"consultation_fee": 100, "actual_paid": 200}
	env.doRequest("POST", fmt.Sprintf("/api/v1/prescriptions/%d/billing", prescriptionID), body)

	w := env.doRequest("GET", fmt.Sprintf("/api/v1/records/%d/billings", presc.RecordID), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	list := getDataList(w)
	assert.Len(t, list, 1)
}
