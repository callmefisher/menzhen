package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupTenantAdminRouter creates a Gin engine for tenant admin tests with the
// same route layout that will be used in production.
func setupTenantAdminRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewTenantAdminHandler(db)
	auth := r.Group("/api/v1")
	auth.Use(middleware.AuthMiddleware(testutil.TestJWTSecret))
	{
		tenant := auth.Group("/tenant")
		{
			users := tenant.Group("/users")
			users.Use(middleware.RequirePermission(db, "tenant:user:manage", "user:manage"))
			{
				users.GET("", h.ListUsers)
				users.PUT("/:id", h.UpdateUser)
				users.DELETE("/:id", h.DeleteUser)
				users.POST("/:id/roles", h.AssignRoles)
			}
			roles := tenant.Group("/roles")
			roles.Use(middleware.RequirePermission(db, "tenant:role:manage", "role:manage"))
			{
				roles.GET("", h.ListRoles)
				roles.POST("", h.CreateRole)
				roles.PUT("/:id", h.UpdateRole)
			}
			tenant.GET("/permissions",
				middleware.RequirePermission(db, "tenant:role:manage", "role:manage"),
				h.ListTenantPermissions)
		}
	}
	return r
}

// doTenantRequest is a helper to send HTTP requests against the tenant admin router.
func doTenantRequest(r *gin.Engine, method, path string, token string, body interface{}) *httptest.ResponseRecorder {
	var b []byte
	if body != nil {
		b, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// TestTenantAdminHandler_ListUsers_TenantIsolation verifies that a tenant:user:manage
// user only sees users belonging to their own tenant.
func TestTenantAdminHandler_ListUsers_TenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	perms := testutil.SeedAllPermissions(t, db)

	// Tenant 1 — ops user with tenant:user:manage
	tenant1 := testutil.SeedTestTenant(t, db, "诊所1", "clinic1")
	opsRole := testutil.SeedTestRole(t, db, tenant1.ID, "诊所管理员", perms["tenant:user:manage"])
	opsUser, opsToken := testutil.SeedTestUser(t, db, tenant1.ID, "ops1", "pass", opsRole)
	// Another regular user in tenant 1
	_, _ = testutil.SeedTestUser(t, db, tenant1.ID, "staff1", "pass", nil)
	_ = opsUser

	// Tenant 2 — should be invisible
	tenant2 := testutil.SeedTestTenant(t, db, "诊所2", "clinic2")
	_, _ = testutil.SeedTestUser(t, db, tenant2.ID, "other1", "pass", nil)

	r := setupTenantAdminRouter(db)
	w := doTenantRequest(r, "GET", "/api/v1/tenant/users", opsToken, nil)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	data := resp["data"].(map[string]interface{})
	list := data["list"].([]interface{})

	// Should contain only tenant1 users (opsUser + staff1 = 2).
	assert.Equal(t, float64(2), data["total"])
	assert.Len(t, list, 2)
}

// TestTenantAdminHandler_NoPermission_Returns403 verifies that a user with no
// tenant:user:manage or user:manage permission cannot access the tenant users API.
func TestTenantAdminHandler_NoPermission_Returns403(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.SeedAllPermissions(t, db)

	tenant := testutil.SeedTestTenant(t, db, "诊所X", "clinicX")
	// Create a user with NO relevant permissions
	noPermRole := testutil.SeedTestRole(t, db, tenant.ID, "普通员工")
	_, noPermToken := testutil.SeedTestUser(t, db, tenant.ID, "noperm", "pass", noPermRole)

	r := setupTenantAdminRouter(db)
	w := doTenantRequest(r, "GET", "/api/v1/tenant/users", noPermToken, nil)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

// TestTenantAdminHandler_GlobalAdmin_CanAccessTenantAPI verifies that a user with
// the global user:manage permission can also access the tenant-scoped user API.
func TestTenantAdminHandler_GlobalAdmin_CanAccessTenantAPI(t *testing.T) {
	db := testutil.SetupTestDB(t)
	perms := testutil.SeedAllPermissions(t, db)

	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinicA")
	adminRole := testutil.SeedTestRole(t, db, tenant.ID, "超级管理员", perms["user:manage"])
	_, adminToken := testutil.SeedTestUser(t, db, tenant.ID, "superadmin", "pass", adminRole)

	r := setupTenantAdminRouter(db)
	w := doTenantRequest(r, "GET", "/api/v1/tenant/users", adminToken, nil)

	// Global admin can access the tenant API.
	assert.Equal(t, http.StatusOK, w.Code)
}

// TestTenantAdminHandler_ListTenantPermissions_ExcludesGlobal verifies that the
// tenant permissions list does not include user:manage, role:manage, or tenant:manage.
func TestTenantAdminHandler_ListTenantPermissions_ExcludesGlobal(t *testing.T) {
	db := testutil.SetupTestDB(t)
	perms := testutil.SeedAllPermissions(t, db)

	tenant := testutil.SeedTestTenant(t, db, "诊所B", "clinicB")
	roleManagerRole := testutil.SeedTestRole(t, db, tenant.ID, "角色管理员", perms["tenant:role:manage"])
	_, roleToken := testutil.SeedTestUser(t, db, tenant.ID, "rolemgr", "pass", roleManagerRole)

	r := setupTenantAdminRouter(db)
	w := doTenantRequest(r, "GET", "/api/v1/tenant/permissions", roleToken, nil)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	list := resp["data"].([]interface{})

	// Verify global admin codes are absent.
	globalCodes := map[string]bool{
		"user:manage":   true,
		"role:manage":   true,
		"tenant:manage": true,
	}
	for _, item := range list {
		perm := item.(map[string]interface{})
		code := perm["code"].(string)
		assert.False(t, globalCodes[code], "global permission %q should not be in tenant permissions list", code)
	}
	// Ensure the list is non-empty (other permissions should be present).
	assert.NotEmpty(t, list)
}

// TestTenantAdminHandler_UpdateUser_CrossTenant_Fails verifies that a tenant ops user
// in tenant1 cannot update a user in tenant2 (expects 404, not 200).
func TestTenantAdminHandler_UpdateUser_CrossTenant_Fails(t *testing.T) {
	db := testutil.SetupTestDB(t)
	perms := testutil.SeedAllPermissions(t, db)

	// Tenant 1 — ops user
	tenant1 := testutil.SeedTestTenant(t, db, "诊所C", "clinicC")
	opsRole := testutil.SeedTestRole(t, db, tenant1.ID, "诊所管理员C", perms["tenant:user:manage"])
	_, opsToken := testutil.SeedTestUser(t, db, tenant1.ID, "opsC", "pass", opsRole)

	// Tenant 2 — victim user
	tenant2 := testutil.SeedTestTenant(t, db, "诊所D", "clinicD")
	victim, _ := testutil.SeedTestUser(t, db, tenant2.ID, "victimD", "pass", nil)

	r := setupTenantAdminRouter(db)

	// Ops in tenant1 tries to update victim in tenant2.
	updateBody := map[string]interface{}{"real_name": "hacked"}
	w := doTenantRequest(r, "PUT", fmt.Sprintf("/api/v1/tenant/users/%d", victim.ID), opsToken, updateBody)

	// Cross-tenant update must be rejected with 404 (user not visible to this tenant).
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// TestTenantAdminHandler_ListRoles returns all roles for the requester's tenant.
func TestTenantAdminHandler_ListRoles(t *testing.T) {
	db := testutil.SetupTestDB(t)
	perms := testutil.SeedAllPermissions(t, db)

	tenant := testutil.SeedTestTenant(t, db, "诊所E", "clinicE")
	roleManagerRole := testutil.SeedTestRole(t, db, tenant.ID, "角色管理员E", perms["tenant:role:manage"])
	_, roleToken := testutil.SeedTestUser(t, db, tenant.ID, "rolemgrE", "pass", roleManagerRole)

	// Seed an extra role in this tenant.
	testutil.SeedTestRole(t, db, tenant.ID, "额外角色")

	r := setupTenantAdminRouter(db)
	w := doTenantRequest(r, "GET", "/api/v1/tenant/roles", roleToken, nil)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	list := resp["data"].([]interface{})
	// At least 2 roles (角色管理员E + 额外角色).
	assert.GreaterOrEqual(t, len(list), 2)
}

// TestTenantAdminHandler_CreateRole creates a new role via POST /tenant/roles.
func TestTenantAdminHandler_CreateRole(t *testing.T) {
	db := testutil.SetupTestDB(t)
	perms := testutil.SeedAllPermissions(t, db)

	tenant := testutil.SeedTestTenant(t, db, "诊所F", "clinicF")
	roleManagerRole := testutil.SeedTestRole(t, db, tenant.ID, "角色管理员F", perms["tenant:role:manage"])
	_, roleToken := testutil.SeedTestUser(t, db, tenant.ID, "rolemgrF", "pass", roleManagerRole)

	r := setupTenantAdminRouter(db)
	body := map[string]interface{}{
		"name":        "新角色",
		"description": "描述",
	}
	w := doTenantRequest(r, "POST", "/api/v1/tenant/roles", roleToken, body)

	assert.Equal(t, http.StatusCreated, w.Code)
	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	data := resp["data"].(map[string]interface{})
	assert.Equal(t, "新角色", data["name"])
}

// TestTenantAdminHandler_AssignRoles assigns roles to a user via POST /tenant/users/:id/roles.
func TestTenantAdminHandler_AssignRoles(t *testing.T) {
	db := testutil.SetupTestDB(t)
	perms := testutil.SeedAllPermissions(t, db)

	tenant := testutil.SeedTestTenant(t, db, "诊所G", "clinicG")
	opsRole := testutil.SeedTestRole(t, db, tenant.ID, "诊所管理员G", perms["tenant:user:manage"])
	_, opsToken := testutil.SeedTestUser(t, db, tenant.ID, "opsG", "pass", opsRole)

	// Create a target user in same tenant
	targetRole := testutil.SeedTestRole(t, db, tenant.ID, "目标角色G")
	targetUser, _ := testutil.SeedTestUser(t, db, tenant.ID, "targetG", "pass", nil)

	r := setupTenantAdminRouter(db)
	body := map[string]interface{}{
		"role_ids": []uint64{targetRole.ID},
	}
	w := doTenantRequest(r, "POST", fmt.Sprintf("/api/v1/tenant/users/%d/roles", targetUser.ID), opsToken, body)

	assert.Equal(t, http.StatusOK, w.Code)
}
