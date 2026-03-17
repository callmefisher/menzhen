package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAuthHandler_Login_Success(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("POST", "/api/v1/auth/login", map[string]interface{}{
		"username": "admin",
		"password": "admin123",
	})

	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := getData(w)
	assert.NotEmpty(t, data["token"])
	assert.NotNil(t, data["user"])
	assert.NotNil(t, data["permissions"])

	user := data["user"].(map[string]interface{})
	assert.Equal(t, "admin", user["username"])
}

func TestAuthHandler_Login_WrongPassword(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("POST", "/api/v1/auth/login", map[string]interface{}{
		"username": "admin",
		"password": "wrongpassword",
	})

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	body := parseJSON(w)
	assert.NotEqual(t, float64(0), body["code"])
}

func TestAuthHandler_Login_MissingParams(t *testing.T) {
	env := setupTestEnv(t)

	// Missing password
	w := env.doRequestNoAuth("POST", "/api/v1/auth/login", map[string]interface{}{
		"username": "admin",
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Missing username
	w = env.doRequestNoAuth("POST", "/api/v1/auth/login", map[string]interface{}{
		"password": "admin123",
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Empty body
	w = env.doRequestNoAuth("POST", "/api/v1/auth/login", map[string]interface{}{})
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAuthHandler_Register_Success(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("POST", "/api/v1/auth/register", map[string]interface{}{
		"tenant_code": "test-clinic",
		"username":    "newuser",
		"password":    "pass123456",
		"real_name":   "新用户",
	})

	assert.Equal(t, http.StatusCreated, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := getData(w)
	assert.Equal(t, "newuser", data["username"])
	assert.Equal(t, "新用户", data["real_name"])
}

func TestAuthHandler_Register_DuplicateUsername(t *testing.T) {
	env := setupTestEnv(t)

	// "admin" already exists from setupTestEnv
	w := env.doRequestNoAuth("POST", "/api/v1/auth/register", map[string]interface{}{
		"tenant_code": "test-clinic",
		"username":    "admin",
		"password":    "pass123456",
		"real_name":   "重复用户",
	})

	assert.Equal(t, http.StatusConflict, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(409), body["code"])
}

func TestAuthHandler_Register_InvalidTenantCode(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("POST", "/api/v1/auth/register", map[string]interface{}{
		"tenant_code": "nonexistent-clinic",
		"username":    "newuser2",
		"password":    "pass123456",
		"real_name":   "用户2",
	})

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAuthHandler_Register_MissingParams(t *testing.T) {
	env := setupTestEnv(t)

	// Missing username
	w := env.doRequestNoAuth("POST", "/api/v1/auth/register", map[string]interface{}{
		"tenant_code": "test-clinic",
		"password":    "pass123456",
		"real_name":   "用户",
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Missing password
	w = env.doRequestNoAuth("POST", "/api/v1/auth/register", map[string]interface{}{
		"tenant_code": "test-clinic",
		"username":    "user3",
		"real_name":   "用户",
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Password too short (min=6)
	w = env.doRequestNoAuth("POST", "/api/v1/auth/register", map[string]interface{}{
		"tenant_code": "test-clinic",
		"username":    "user4",
		"password":    "123",
		"real_name":   "用户",
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAuthHandler_Me_Success(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/auth/me", nil)

	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := getData(w)
	assert.NotNil(t, data["user"])
	assert.NotNil(t, data["permissions"])

	user := data["user"].(map[string]interface{})
	assert.Equal(t, "admin", user["username"])
}

func TestAuthHandler_Me_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/auth/me", nil)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthHandler_ChangePassword_Success(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("POST", "/api/v1/auth/change-password", map[string]interface{}{
		"old_password": "admin123",
		"new_password": "newpass123",
	})

	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	// Verify new password works by logging in
	w = env.doRequestNoAuth("POST", "/api/v1/auth/login", map[string]interface{}{
		"username": "admin",
		"password": "newpass123",
	})
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAuthHandler_ChangePassword_WrongOld(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("POST", "/api/v1/auth/change-password", map[string]interface{}{
		"old_password": "wrongold",
		"new_password": "newpass123",
	})

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAuthHandler_ChangePassword_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("POST", "/api/v1/auth/change-password", map[string]interface{}{
		"old_password": "admin123",
		"new_password": "newpass123",
	})

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthHandler_Logout_Success(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("POST", "/api/v1/auth/logout", nil)

	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
}

func TestAuthHandler_Login_TenantDisabled(t *testing.T) {
	env := setupTestEnv(t)

	// Disable the tenant.
	env.DB.Model(env.Tenant).Update("status", 0)

	w := env.doRequestNoAuth("POST", "/api/v1/auth/login", map[string]interface{}{
		"username": "admin",
		"password": "admin123",
	})

	assert.Equal(t, http.StatusForbidden, w.Code)

	body := parseJSON(w)
	assert.Equal(t, "tenant_disabled", body["message"])
}
