package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
)

const testSecret = "test-secret-key"

func init() {
	gin.SetMode(gin.TestMode)
}

func setupAuthRouter() *gin.Engine {
	r := gin.New()
	r.GET("/protected", AuthMiddleware(testSecret), func(c *gin.Context) {
		c.JSON(200, gin.H{
			"user_id":   GetUserID(c),
			"tenant_id": GetTenantID(c),
			"username":  GetUsername(c),
		})
	})
	return r
}

func TestAuthMiddleware_ValidToken(t *testing.T) {
	token, err := GenerateToken(1, 10, "testuser", testSecret)
	assert.NoError(t, err)

	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAuthMiddleware_NoToken(t *testing.T) {
	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_InvalidFormat(t *testing.T) {
	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "InvalidFormat")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_EmptyBearerToken(t *testing.T) {
	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer ")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_ExpiredToken(t *testing.T) {
	claims := Claims{
		UserID:   1,
		TenantID: 10,
		Username: "testuser",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString([]byte(testSecret))

	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_WrongSecret(t *testing.T) {
	token, _ := GenerateToken(1, 10, "testuser", "wrong-secret")

	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_MalformedJWT(t *testing.T) {
	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer not.a.valid.jwt")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestGenerateToken_Success(t *testing.T) {
	token, err := GenerateToken(42, 100, "admin", testSecret)
	assert.NoError(t, err)
	assert.NotEmpty(t, token)
}

func TestGenerateToken_ClaimsRoundTrip(t *testing.T) {
	token, err := GenerateToken(42, 100, "admin", testSecret)
	assert.NoError(t, err)

	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(testSecret), nil
	})
	assert.NoError(t, err)
	assert.True(t, parsed.Valid)
	assert.Equal(t, uint64(42), claims.UserID)
	assert.Equal(t, uint64(100), claims.TenantID)
	assert.Equal(t, "admin", claims.Username)
}

func TestGetUserID_NoContext(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	assert.Equal(t, uint64(0), GetUserID(c))
}

func TestGetTenantID_NoContext(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	assert.Equal(t, uint64(0), GetTenantID(c))
}

func TestGetUsername_NoContext(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	assert.Equal(t, "", GetUsername(c))
}

func TestContextHelpers_WithValues(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(CtxKeyUserID, uint64(42))
	c.Set(CtxKeyTenantID, uint64(100))
	c.Set(CtxKeyUsername, "admin")

	assert.Equal(t, uint64(42), GetUserID(c))
	assert.Equal(t, uint64(100), GetTenantID(c))
	assert.Equal(t, "admin", GetUsername(c))
}
