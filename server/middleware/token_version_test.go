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

func TestTokenVersionMiddleware_Match(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "tv-match")
	// User's token_version defaults to 0, JWT also has 0 → should pass.
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "user1", "pass", nil)

	r := gin.New()
	r.GET("/test",
		middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.TokenVersionMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestTokenVersionMiddleware_Mismatch(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "tv-mismatch")
	user, token := testutil.SeedTestUser(t, db, tenant.ID, "user2", "pass", nil)

	// Bump token_version in DB to 1 — JWT still has 0.
	db.Model(&user).Update("token_version", 1)

	r := gin.New()
	r.GET("/test",
		middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.TokenVersionMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusConflict, w.Code)

	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, "token_refresh_required", body["message"])
}

func TestTokenVersionMiddleware_NoUserID(t *testing.T) {
	db := testutil.SetupTestDB(t)

	r := gin.New()
	// No AuthMiddleware → no user_id in context → middleware should pass through.
	r.GET("/test",
		middleware.TokenVersionMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
