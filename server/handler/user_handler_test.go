package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func TestUserHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/users?page=1&size=20", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	// At least the admin user seeded by setupTestEnv
	assert.GreaterOrEqual(t, data["total"].(float64), float64(1))
}

func TestUserHandler_Update_Success(t *testing.T) {
	env := setupTestEnv(t)

	// Create a second user to update
	role := testutil.SeedTestRole(t, env.DB, env.TenantID, "viewer")
	user2, _ := testutil.SeedTestUser(t, env.DB, env.TenantID, "testuser2", "pass123", role)

	reqBody := map[string]interface{}{
		"real_name": "新名字",
	}

	w := env.doRequest("PUT", fmt.Sprintf("/api/v1/users/%d", user2.ID), reqBody)
	assert.Equal(t, http.StatusOK, w.Code)

	data := getData(w)
	assert.NotNil(t, data)
	assert.Equal(t, "新名字", data["real_name"])
}

func TestUserHandler_Delete_Success(t *testing.T) {
	env := setupTestEnv(t)

	// Create a user to delete (disable)
	role := testutil.SeedTestRole(t, env.DB, env.TenantID, "temp-role")
	user2, _ := testutil.SeedTestUser(t, env.DB, env.TenantID, "toDelete", "pass123", role)

	w := env.doRequest("DELETE", fmt.Sprintf("/api/v1/users/%d", user2.ID), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
}

func TestUserHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/users", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
