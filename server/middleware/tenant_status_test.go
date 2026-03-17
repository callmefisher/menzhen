package middleware_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestTenantStatusMiddleware_Enabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "ts-enabled")
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "user1", "pass", nil)

	r := gin.New()
	r.GET("/test",
		middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.TenantStatusMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestTenantStatusMiddleware_Disabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所B", "ts-disabled")
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "user2", "pass", nil)

	// Disable the tenant.
	db.Model(tenant).Update("status", 0)

	r := gin.New()
	r.GET("/test",
		middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.TenantStatusMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)

	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, "tenant_disabled", body["message"])
}

func TestTenantStatusMiddleware_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)

	r := gin.New()
	r.GET("/test",
		func(c *gin.Context) {
			// Simulate AuthMiddleware setting a non-existent tenant_id.
			c.Set("tenant_id", uint64(99999))
			c.Next()
		},
		middleware.TenantStatusMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)

	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, "tenant_disabled", body["message"])
}

func TestTenantStatusMiddleware_ZeroTenantID(t *testing.T) {
	db := testutil.SetupTestDB(t)

	r := gin.New()
	// No AuthMiddleware → no tenant_id in context → should pass through.
	r.GET("/test",
		middleware.TenantStatusMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
