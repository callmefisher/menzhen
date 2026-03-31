package handler

import (
	"net/http"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetStaffRevenue_Success(t *testing.T) {
	env := setupTestEnv(t)

	day := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	require.NoError(t, env.DB.Create(&model.DailyStaffStats{
		TenantID:        env.TenantID,
		UserID:          env.User.ID,
		StatDate:        day,
		Revenue:         1200,
		ConsultationFee: 400,
		DrugFee:         800,
		RecordCount:     6,
	}).Error)

	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=2026-03-01&end_date=2026-03-01", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	require.NotNil(t, body)
	assert.Equal(t, float64(0), body["code"])

	data, ok := body["data"].(map[string]interface{})
	require.True(t, ok)

	summary, ok := data["summary"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 1200.0, summary["total_revenue"])
	assert.Equal(t, float64(6), summary["total_records"])
	assert.Equal(t, float64(1), summary["staff_count"])

	staff, ok := data["staff"].([]interface{})
	require.True(t, ok)
	require.Len(t, staff, 1)
	item := staff[0].(map[string]interface{})
	assert.Equal(t, 1200.0, item["revenue"])
	assert.Equal(t, 400.0, item["consultation_fee"])
	assert.Equal(t, 800.0, item["drug_fee"])
}

func TestGetStaffRevenue_MissingParams(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=2026-03-01", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	w = env.doRequest("GET", "/api/v1/statistics/staff?end_date=2026-03-05", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetStaffRevenue_InvalidDate(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=bad&end_date=2026-03-05", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetStaffRevenue_EndBeforeStart(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=2026-03-05&end_date=2026-03-01", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetStaffRevenue_NoAuth(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequestNoAuth("GET", "/api/v1/statistics/staff?start_date=2026-03-01&end_date=2026-03-05", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestGetStaffRevenue_Empty(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=2026-01-01&end_date=2026-01-31", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	require.NotNil(t, body)
	data, ok := body["data"].(map[string]interface{})
	require.True(t, ok)

	summary, ok := data["summary"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 0.0, summary["total_revenue"])
	assert.Equal(t, float64(0), summary["staff_count"])

	staff, ok := data["staff"].([]interface{})
	require.True(t, ok)
	assert.Empty(t, staff)
}
