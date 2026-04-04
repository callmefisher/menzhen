package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
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
	// Dashboard always fills every date in the range with zero values.
	assert.Len(t, trend, 31)
}

// TestGetDashboard_SuperAdmin_TenantOverride verifies that superAdmin can pass ?tenant_id=X
// and receive statistics for that specific tenant rather than their own.
func TestGetDashboard_SuperAdmin_TenantOverride(t *testing.T) {
	env := setupTestEnv(t)

	// Seed a second tenant with its own daily stats.
	otherTenant := testutil.SeedTestTenant(t, env.DB, "外部诊所", "other-clinic")
	otherRevenue := 9999.0
	require.NoError(t, env.DB.Create(&model.DailyStats{
		TenantID:  otherTenant.ID,
		StatDate:  time.Date(2026, 3, 10, 0, 0, 0, 0, time.Local),
		Revenue:   otherRevenue,
		RecordCount: 10,
	}).Error)

	// Seed unrelated stats for the admin's own tenant to ensure isolation.
	require.NoError(t, env.DB.Create(&model.DailyStats{
		TenantID:  env.TenantID,
		StatDate:  time.Date(2026, 3, 10, 0, 0, 0, 0, time.Local),
		Revenue:   100.0,
		RecordCount: 1,
	}).Error)

	path := fmt.Sprintf("/api/v1/statistics/dashboard?start_date=2026-03-01&end_date=2026-03-31&tenant_id=%d", otherTenant.ID)
	w := env.doRequest("GET", path, nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	require.NotNil(t, body)
	assert.Equal(t, float64(0), body["code"])

	data, ok := body["data"].(map[string]interface{})
	require.True(t, ok)
	summary, ok := data["summary"].(map[string]interface{})
	require.True(t, ok)
	// Should see the other tenant's revenue, not the admin tenant's.
	assert.Equal(t, otherRevenue, summary["total_revenue"])
}

// TestGetDashboard_RegularUser_TenantOverrideIgnored verifies that a regular (non-superAdmin)
// user passing ?tenant_id=X still receives their own tenant's data.
func TestGetDashboard_RegularUser_TenantOverrideIgnored(t *testing.T) {
	db := testutil.SetupTestDB(t)

	// Create the regular user's tenant with stats.
	ownTenant := testutil.SeedTestTenant(t, db, "自己的诊所", "own-clinic")
	ownRevenue := 5555.0
	require.NoError(t, db.Create(&model.DailyStats{
		TenantID:  ownTenant.ID,
		StatDate:  time.Date(2026, 3, 15, 0, 0, 0, 0, time.Local),
		Revenue:   ownRevenue,
		RecordCount: 5,
	}).Error)

	// Create a second tenant with different stats.
	otherTenant := testutil.SeedTestTenant(t, db, "他人诊所", "other-clinic2")
	require.NoError(t, db.Create(&model.DailyStats{
		TenantID:  otherTenant.ID,
		StatDate:  time.Date(2026, 3, 15, 0, 0, 0, 0, time.Local),
		Revenue:   8888.0,
		RecordCount: 8,
	}).Error)

	// Create a regular user (username != "admin") for ownTenant.
	statsReadPerm := testutil.SeedTestPermission(t, db, "statistics:read", "统计查看")
	role := testutil.SeedTestRole(t, db, ownTenant.ID, "staff", statsReadPerm)
	regularUser, token := testutil.SeedTestUser(t, db, ownTenant.ID, "regularstaff", "pass123", role)
	_ = regularUser

	router := setupTestRouter(db)
	env := &testEnv{
		DB:       db,
		Router:   router,
		Tenant:   ownTenant,
		Token:    token,
		TenantID: ownTenant.ID,
	}

	// Regular user tries to override tenant_id; should be ignored.
	path := fmt.Sprintf("/api/v1/statistics/dashboard?start_date=2026-03-01&end_date=2026-03-31&tenant_id=%d", otherTenant.ID)
	w := env.doRequest("GET", path, nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	require.NotNil(t, body)
	assert.Equal(t, float64(0), body["code"])

	data, ok := body["data"].(map[string]interface{})
	require.True(t, ok)
	summary, ok := data["summary"].(map[string]interface{})
	require.True(t, ok)
	// Should see own tenant's revenue, override ignored.
	assert.Equal(t, ownRevenue, summary["total_revenue"])
}
