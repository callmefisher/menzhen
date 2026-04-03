package middleware_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func setupOverrideRouter(t *testing.T) (*gin.Engine, uint64, uint64, string, string) {
	t.Helper()
	db := testutil.SetupTestDB(t)

	tenant1 := testutil.SeedTestTenant(t, db, "诊所一", "clinic-1")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所二", "clinic-2")

	_, adminToken := testutil.SeedTestUser(t, db, tenant1.ID, "admin", "pass", nil)
	_, normalToken := testutil.SeedTestUser(t, db, tenant1.ID, "normaluser", "pass", nil)

	r := gin.New()
	r.GET("/api/test",
		middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.SuperAdminTenantOverrideMiddleware(db),
		func(c *gin.Context) {
			c.JSON(200, gin.H{"tenant_id": middleware.GetTenantID(c)})
		},
	)
	return r, tenant1.ID, tenant2.ID, adminToken, normalToken
}

// Admin with no tenant_id param — context remains the JWT tenant.
func TestSuperAdminTenantOverride_AdminNoParam(t *testing.T) {
	r, tenant1ID, _, adminToken, _ := setupOverrideRouter(t)

	req := httptest.NewRequest("GET", "/api/test", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, float64(tenant1ID), body["tenant_id"])
}

// Admin supplies valid tenant_id — context is overridden.
func TestSuperAdminTenantOverride_AdminValidTenant(t *testing.T) {
	r, _, tenant2ID, adminToken, _ := setupOverrideRouter(t)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/test?tenant_id=%d", tenant2ID), nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, float64(tenant2ID), body["tenant_id"])
}

// Normal user with tenant_id param — override is silently ignored.
func TestSuperAdminTenantOverride_NormalUserParamIgnored(t *testing.T) {
	r, tenant1ID, tenant2ID, _, normalToken := setupOverrideRouter(t)

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/test?tenant_id=%d", tenant2ID), nil)
	req.Header.Set("Authorization", "Bearer "+normalToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	// Normal user stays in their own tenant regardless of param
	assert.Equal(t, float64(tenant1ID), body["tenant_id"])
}

// Admin supplies tenant_id=0 — treated as absent, no override.
func TestSuperAdminTenantOverride_AdminZeroTenantID(t *testing.T) {
	r, tenant1ID, _, adminToken, _ := setupOverrideRouter(t)

	req := httptest.NewRequest("GET", "/api/test?tenant_id=0", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, float64(tenant1ID), body["tenant_id"])
}

// Admin supplies non-numeric tenant_id — treated as absent, no override.
func TestSuperAdminTenantOverride_AdminInvalidTenantID(t *testing.T) {
	r, tenant1ID, _, adminToken, _ := setupOverrideRouter(t)

	req := httptest.NewRequest("GET", "/api/test?tenant_id=abc", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, float64(tenant1ID), body["tenant_id"])
}

// Admin supplies tenant_id for a non-existent tenant — 404.
func TestSuperAdminTenantOverride_AdminNonExistentTenant(t *testing.T) {
	r, _, _, adminToken, _ := setupOverrideRouter(t)

	req := httptest.NewRequest("GET", "/api/test?tenant_id=99999", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, "诊所不存在", body["message"])
}
