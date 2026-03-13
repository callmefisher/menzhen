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

func TestRBAC_HasPermission_Allowed(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test Clinic", "test-clinic")
	perm := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, db, tenant.ID, "doctor", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", role)

	r := gin.New()
	r.GET("/test", middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.RequirePermission(db, "patient:read"),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRBAC_NoPermission_Forbidden(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test Clinic", "test-clinic")
	role := testutil.SeedTestRole(t, db, tenant.ID, "viewer") // no permissions
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "viewer", "pass", role)

	r := gin.New()
	r.GET("/test", middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.RequirePermission(db, "patient:read"),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
	var body map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &body)
	assert.Contains(t, body, "required_permissions")
}

func TestRBAC_MultiplePerms_AnyOneSuffices(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test Clinic", "test-clinic")
	perm := testutil.SeedTestPermission(t, db, "record:read", "查看记录")
	role := testutil.SeedTestRole(t, db, tenant.ID, "nurse", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "nurse", "pass", role)

	r := gin.New()
	r.GET("/test", middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.RequirePermission(db, "patient:read", "record:read"), // OR logic
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRBAC_NoUserID_Unauthorized(t *testing.T) {
	db := testutil.SetupTestDB(t)

	r := gin.New()
	// Skip AuthMiddleware — no user_id in context
	r.GET("/test", middleware.RequirePermission(db, "patient:read"),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRBAC_MultiplePerms_NoneMatch_Forbidden(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test Clinic", "test-clinic")
	perm := testutil.SeedTestPermission(t, db, "herb:read", "查询中药")
	role := testutil.SeedTestRole(t, db, tenant.ID, "herbalist", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "herb", "pass", role)

	r := gin.New()
	r.GET("/test", middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.RequirePermission(db, "patient:read", "record:read"),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}
