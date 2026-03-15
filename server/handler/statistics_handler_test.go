package handler

import (
	"net/http"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetDashboard_Success(t *testing.T) {
	env := setupTestEnv(t)

	// Seed daily_stats rows for the query range.
	for i := 1; i <= 3; i++ {
		require.NoError(t, env.DB.Create(&model.DailyStats{
			TenantID:              env.TenantID,
			StatDate:              time.Date(2026, 3, i, 0, 0, 0, 0, time.Local),
			Revenue:               float64(i * 200),
			ConsultationFee:       float64(i * 50),
			DrugFee:               float64(i * 150),
			RecordCount:           i * 2,
			NewPatientCount:       1,
			ReturningPatientCount: i - 1,
		}).Error)
	}

	w := env.doRequest("GET", "/api/v1/statistics/dashboard?start_date=2026-03-01&end_date=2026-03-03", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	require.NotNil(t, body)
	assert.Equal(t, float64(0), body["code"])

	data, ok := body["data"].(map[string]interface{})
	require.True(t, ok)

	summary, ok := data["summary"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 1200.0, summary["total_revenue"])  // 200+400+600
	assert.Equal(t, float64(12), summary["total_records"]) // 2+4+6

	trend, ok := data["daily_trend"].([]interface{})
	require.True(t, ok)
	assert.Len(t, trend, 3)
}

func TestGetDashboard_MissingParams(t *testing.T) {
	env := setupTestEnv(t)

	// Missing end_date
	w := env.doRequest("GET", "/api/v1/statistics/dashboard?start_date=2026-03-01", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Missing start_date
	w = env.doRequest("GET", "/api/v1/statistics/dashboard?end_date=2026-03-05", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Both missing
	w = env.doRequest("GET", "/api/v1/statistics/dashboard", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetDashboard_InvalidDateFormat(t *testing.T) {
	env := setupTestEnv(t)

	// Invalid start_date format
	w := env.doRequest("GET", "/api/v1/statistics/dashboard?start_date=2026/03/01&end_date=2026-03-05", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Invalid end_date format
	w = env.doRequest("GET", "/api/v1/statistics/dashboard?start_date=2026-03-01&end_date=20260305", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetDashboard_NoAuth(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequestNoAuth("GET", "/api/v1/statistics/dashboard?start_date=2026-03-01&end_date=2026-03-05", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestGetDashboard_EmptyResult(t *testing.T) {
	env := setupTestEnv(t)

	// No data in DB for this range
	w := env.doRequest("GET", "/api/v1/statistics/dashboard?start_date=2026-01-01&end_date=2026-01-31", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	require.NotNil(t, body)
	data, ok := body["data"].(map[string]interface{})
	require.True(t, ok)

	summary, ok := data["summary"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 0.0, summary["total_revenue"])

	trend, ok := data["daily_trend"].([]interface{})
	require.True(t, ok)
	assert.Len(t, trend, 0)
}
