# Tenant Operations (Clinic-scoped User/Role Management) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tenant:user:manage` and `tenant:role:manage` permissions with tenant-isolated API endpoints, enabling a "诊所运营" role to manage users/roles within their own clinic only.

**Architecture:** New tenant-scoped API endpoints (`/api/v1/tenant/*`) coexist with existing global management endpoints. Backend enforces strict `tenant_id` filtering on every query. Frontend switches between global and tenant APIs based on the user's permission level.

**Tech Stack:** Go + Gin + GORM (backend), React + TypeScript + Ant Design (frontend), Vitest + Testing Library (frontend tests), Go test + testify (backend tests)

**Spec:** `docs/plans/2026-03-14-tenant-operations-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `server/service/tenant_admin.go` | Tenant-scoped user/role business logic |
| `server/service/tenant_admin_test.go` | Service layer tests |
| `server/handler/tenant_admin.go` | HTTP handlers for `/api/v1/tenant/*` endpoints |
| `server/handler/tenant_admin_test.go` | Handler layer tests (integration) |
| `web/src/api/tenant-admin.ts` | Frontend API functions for tenant endpoints |
| `web/src/api/__tests__/tenant-admin.test.ts` | API layer tests |

### Modified Files
| File | Change |
|------|--------|
| `server/database/seed.go` | Add 2 permission codes + "诊所运营" role |
| `server/testutil/testutil.go` | Add new permission codes to `SeedAllPermissions` |
| `server/router/router.go` | Register tenant admin routes |
| `web/src/components/Layout.tsx` | Update menu logic for new permissions |
| `web/src/pages/settings/UserList.tsx` | Support tenant mode (different API + hide tenant column) |
| `web/src/pages/settings/RoleList.tsx` | Support tenant mode (different API + filtered permissions) |

---

## Chunk 1: Backend Service Layer

### Task 1: Seed new permissions

**Files:**
- Modify: `server/database/seed.go:32-55`
- Modify: `server/testutil/testutil.go:211-232`

- [ ] **Step 1: Add permission codes to seed.go**

In `seedPermissions()`, add after `billing:read` (line 54):

```go
{Code: "tenant:user:manage", Name: "诊所用户管理", Description: "管理本诊所用户"},
{Code: "tenant:role:manage", Name: "诊所角色管理", Description: "管理本诊所角色"},
```

- [ ] **Step 2: Update testutil SeedAllPermissions**

In `testutil.go` `SeedAllPermissions`, add to the `codes` slice:

```go
{"tenant:user:manage", "诊所用户管理"}, {"tenant:role:manage", "诊所角色管理"},
```

- [ ] **Step 3: Add seedClinicOpsRole function to seed.go**

Add after `seedAdminUser`:

```go
// seedClinicOpsRole creates the "诊所运营" role with tenant-scoped management permissions.
func seedClinicOpsRole(db *gorm.DB, tenantID uint64) {
	var role model.Role
	result := db.Where("name = ? AND tenant_id = ?", "诊所运营", tenantID).First(&role)
	if result.Error == nil {
		log.Println("Clinic ops role already exists, skipping")
		return
	}

	var perms []model.Permission
	if err := db.Where("code IN ?", []string{"tenant:user:manage", "tenant:role:manage"}).Find(&perms).Error; err != nil {
		log.Printf("Warning: failed to fetch tenant permissions for clinic ops role: %v", err)
		return
	}
	if len(perms) != 2 {
		log.Println("Warning: tenant permissions not yet seeded, skipping clinic ops role")
		return
	}

	role = model.Role{
		TenantID:    tenantID,
		Name:        "诊所运营",
		Description: "诊所运营管理，可管理本诊所的用户和角色",
		Permissions: perms,
	}
	if err := db.Create(&role).Error; err != nil {
		log.Printf("Warning: failed to seed clinic ops role: %v", err)
	}
	log.Println("Clinic ops role seeded successfully")
}
```

Call it in `Seed()` after `seedAdminUser`:

```go
seedClinicOpsRole(db, tenant.ID)
```

- [ ] **Step 4: Verify backend builds**

Run: `cd server && go build ./...`
Expected: Success

- [ ] **Step 5: Commit**

```bash
git add server/database/seed.go server/testutil/testutil.go
git commit -m "feat: add tenant:user:manage and tenant:role:manage permissions"
```

---

### Task 2: Tenant admin service

**Files:**
- Create: `server/service/tenant_admin.go`

- [ ] **Step 1: Write failing tests**

Create `server/service/tenant_admin_test.go`:

```go
package service

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupTenantAdminTestDB(t *testing.T) (*TenantAdminService, *model.Tenant, *model.Tenant) {
	db := testutil.SetupTestDB(t)
	svc := NewTenantAdminService(db)

	// Create two tenants for isolation tests
	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")

	return svc, tenant1, tenant2
}

func TestTenantAdminService_ListUsers(t *testing.T) {
	svc, tenant1, tenant2 := setupTenantAdminTestDB(t)

	// Create users in different tenants
	perm := testutil.SeedTestPermission(t, svc.DB, "patient:read", "查看患者")
	role1 := testutil.SeedTestRole(t, svc.DB, tenant1.ID, "医生", perm)
	role2 := testutil.SeedTestRole(t, svc.DB, tenant2.ID, "医生", perm)
	testutil.SeedTestUser(t, svc.DB, tenant1.ID, "user1", "pass", role1)
	testutil.SeedTestUser(t, svc.DB, tenant1.ID, "user2", "pass", role1)
	testutil.SeedTestUser(t, svc.DB, tenant2.ID, "user3", "pass", role2)

	// Tenant 1 should only see 2 users
	users, total, err := svc.ListUsers(tenant1.ID, 1, 20)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, users, 2)

	// Tenant 2 should only see 1 user
	users, total, err = svc.ListUsers(tenant2.ID, 1, 20)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, users, 1)
}

func TestTenantAdminService_UpdateUser_SameTenant(t *testing.T) {
	svc, tenant1, _ := setupTenantAdminTestDB(t)

	perm := testutil.SeedTestPermission(t, svc.DB, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, svc.DB, tenant1.ID, "医生", perm)
	user, _ := testutil.SeedTestUser(t, svc.DB, tenant1.ID, "user1", "pass", role)

	newName := "张三"
	updated, err := svc.UpdateUser(tenant1.ID, user.ID, &TenantUpdateUserRequest{
		RealName: &newName,
	})
	require.NoError(t, err)
	assert.Equal(t, "张三", updated.RealName)
}

func TestTenantAdminService_UpdateUser_CrossTenant_Fails(t *testing.T) {
	svc, tenant1, tenant2 := setupTenantAdminTestDB(t)

	perm := testutil.SeedTestPermission(t, svc.DB, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, svc.DB, tenant1.ID, "医生", perm)
	user, _ := testutil.SeedTestUser(t, svc.DB, tenant1.ID, "user1", "pass", role)

	newName := "非法修改"
	_, err := svc.UpdateUser(tenant2.ID, user.ID, &TenantUpdateUserRequest{
		RealName: &newName,
	})
	assert.ErrorIs(t, err, ErrUserNotFound)
}

func TestTenantAdminService_DeleteUser_CrossTenant_Fails(t *testing.T) {
	svc, tenant1, tenant2 := setupTenantAdminTestDB(t)

	perm := testutil.SeedTestPermission(t, svc.DB, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, svc.DB, tenant1.ID, "医生", perm)
	user, _ := testutil.SeedTestUser(t, svc.DB, tenant1.ID, "user1", "pass", role)

	err := svc.DisableUser(tenant2.ID, user.ID)
	assert.ErrorIs(t, err, ErrUserNotFound)
}

func TestTenantAdminService_AssignRoles_CrossTenant_Fails(t *testing.T) {
	svc, tenant1, tenant2 := setupTenantAdminTestDB(t)

	perm := testutil.SeedTestPermission(t, svc.DB, "patient:read", "查看患者")
	role1 := testutil.SeedTestRole(t, svc.DB, tenant1.ID, "医生", perm)
	role2 := testutil.SeedTestRole(t, svc.DB, tenant2.ID, "护士", perm)
	user, _ := testutil.SeedTestUser(t, svc.DB, tenant1.ID, "user1", "pass", role1)

	// Assigning tenant2's role to tenant1's user should fail
	err := svc.AssignRoles(tenant1.ID, user.ID, []uint64{role2.ID})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "do not belong to this tenant")
}

func TestTenantAdminService_ListRoles_TenantIsolation(t *testing.T) {
	svc, tenant1, tenant2 := setupTenantAdminTestDB(t)

	perm := testutil.SeedTestPermission(t, svc.DB, "patient:read", "查看患者")
	testutil.SeedTestRole(t, svc.DB, tenant1.ID, "医生", perm)
	testutil.SeedTestRole(t, svc.DB, tenant1.ID, "护士", perm)
	testutil.SeedTestRole(t, svc.DB, tenant2.ID, "管理员", perm)

	roles, err := svc.ListRoles(tenant1.ID)
	require.NoError(t, err)
	assert.Len(t, roles, 2)

	roles, err = svc.ListRoles(tenant2.ID)
	require.NoError(t, err)
	assert.Len(t, roles, 1)
}

func TestTenantAdminService_CreateRole(t *testing.T) {
	svc, tenant1, _ := setupTenantAdminTestDB(t)

	perm := testutil.SeedTestPermission(t, svc.DB, "patient:read", "查看患者")
	role, err := svc.CreateRole(tenant1.ID, &TenantCreateRoleRequest{
		Name:          "新角色",
		Description:   "测试角色",
		PermissionIDs: []uint64{perm.ID},
	})
	require.NoError(t, err)
	assert.Equal(t, "新角色", role.Name)
	assert.Equal(t, tenant1.ID, role.TenantID)
	assert.Len(t, role.Permissions, 1)
}

func TestTenantAdminService_UpdateRole_CrossTenant_Fails(t *testing.T) {
	svc, tenant1, tenant2 := setupTenantAdminTestDB(t)

	perm := testutil.SeedTestPermission(t, svc.DB, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, svc.DB, tenant1.ID, "医生", perm)

	newName := "非法修改"
	_, err := svc.UpdateRole(tenant2.ID, role.ID, &TenantUpdateRoleRequest{
		Name: &newName,
	})
	assert.ErrorIs(t, err, ErrRoleNotFound)
}

func TestTenantAdminService_ListTenantPermissions_ExcludesGlobal(t *testing.T) {
	svc, _, _ := setupTenantAdminTestDB(t)

	// Seed all permissions including global ones
	testutil.SeedAllPermissions(t, svc.DB)

	perms, err := svc.ListTenantPermissions()
	require.NoError(t, err)

	// Should not contain global admin permissions
	for _, p := range perms {
		assert.NotEqual(t, "user:manage", p.Code)
		assert.NotEqual(t, "role:manage", p.Code)
		assert.NotEqual(t, "tenant:manage", p.Code)
	}
	// Should still have other permissions
	assert.True(t, len(perms) > 0)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./service/ -run TestTenantAdmin -v`
Expected: FAIL — `NewTenantAdminService` not defined

- [ ] **Step 3: Implement tenant admin service**

Create `server/service/tenant_admin.go`:

```go
package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

// globalAdminPermCodes are permission codes that cannot be assigned by tenant-scoped role management.
var globalAdminPermCodes = []string{"user:manage", "role:manage", "tenant:manage"}

// TenantUpdateUserRequest is the input for updating a user within a tenant.
// Does NOT include tenant_id — tenant ops cannot move users between tenants.
type TenantUpdateUserRequest struct {
	RealName *string `json:"real_name"`
	Phone    *string `json:"phone"`
	Status   *int8   `json:"status"`
	Notes    *string `json:"notes"`
}

// TenantCreateRoleRequest is the input for creating a role within a tenant.
type TenantCreateRoleRequest struct {
	Name          string   `json:"name" binding:"required"`
	Description   string   `json:"description"`
	PermissionIDs []uint64 `json:"permission_ids"`
}

// TenantUpdateRoleRequest is the input for updating a role within a tenant.
type TenantUpdateRoleRequest struct {
	Name          *string  `json:"name"`
	Description   *string  `json:"description"`
	PermissionIDs []uint64 `json:"permission_ids"`
}

// TenantAdminService handles tenant-scoped user and role management.
type TenantAdminService struct {
	DB *gorm.DB
}

// NewTenantAdminService creates a new TenantAdminService.
func NewTenantAdminService(db *gorm.DB) *TenantAdminService {
	return &TenantAdminService{DB: db}
}

// ListUsers returns a paginated list of users belonging to the given tenant.
func (s *TenantAdminService) ListUsers(tenantID uint64, page, size int) ([]model.User, int64, error) {
	var users []model.User
	var total int64

	query := s.DB.Model(&model.User{}).Where("tenant_id = ?", tenantID)

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at DESC").
		Offset((page - 1) * size).
		Limit(size).
		Preload("Roles").
		Find(&users).Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

// UpdateUser updates a user within the same tenant. Returns ErrUserNotFound for cross-tenant access.
func (s *TenantAdminService) UpdateUser(tenantID, userID uint64, req *TenantUpdateUserRequest) (*model.User, error) {
	var user model.User
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}

	updates := make(map[string]interface{})
	if req.RealName != nil {
		updates["real_name"] = *req.RealName
	}
	if req.Phone != nil {
		updates["phone"] = *req.Phone
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.Notes != nil {
		updates["notes"] = *req.Notes
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&user).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	if err := s.DB.Preload("Roles").Where("tenant_id = ?", tenantID).First(&user, userID).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// DisableUser sets a user's status to 0 within the same tenant.
func (s *TenantAdminService) DisableUser(tenantID, userID uint64) error {
	var user model.User
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}
	return s.DB.Model(&user).Update("status", 0).Error
}

// AssignRoles replaces a user's roles within the same tenant.
// Validates both user and roles belong to the same tenant.
func (s *TenantAdminService) AssignRoles(tenantID, userID uint64, roleIDs []uint64) error {
	var user model.User
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&user, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	var roles []model.Role
	if len(roleIDs) > 0 {
		if err := s.DB.Where("id IN ? AND tenant_id = ?", roleIDs, tenantID).Find(&roles).Error; err != nil {
			return err
		}
		if len(roles) != len(roleIDs) {
			return errors.New("one or more roles do not belong to this tenant")
		}
	}

	return s.DB.Model(&user).Association("Roles").Replace(&roles)
}

// ListRoles returns all roles for the given tenant.
func (s *TenantAdminService) ListRoles(tenantID uint64) ([]model.Role, error) {
	var roles []model.Role
	if err := s.DB.Where("tenant_id = ?", tenantID).
		Preload("Permissions").
		Find(&roles).Error; err != nil {
		return nil, err
	}
	return roles, nil
}

// CreateRole creates a new role within the given tenant.
// Validates that no global admin permissions are included.
func (s *TenantAdminService) CreateRole(tenantID uint64, req *TenantCreateRoleRequest) (*model.Role, error) {
	role := model.Role{
		TenantID:    tenantID,
		Name:        req.Name,
		Description: req.Description,
	}

	if err := s.DB.Create(&role).Error; err != nil {
		return nil, err
	}

	if len(req.PermissionIDs) > 0 {
		var permissions []model.Permission
		// Exclude global admin permissions to prevent privilege escalation
		if err := s.DB.Where("id IN ? AND code NOT IN ?", req.PermissionIDs, globalAdminPermCodes).
			Find(&permissions).Error; err != nil {
			return nil, err
		}
		if err := s.DB.Model(&role).Association("Permissions").Replace(&permissions); err != nil {
			return nil, err
		}
	}

	if err := s.DB.Preload("Permissions").First(&role, role.ID).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

// UpdateRole updates an existing role within the same tenant.
func (s *TenantAdminService) UpdateRole(tenantID, roleID uint64, req *TenantUpdateRoleRequest) (*model.Role, error) {
	var role model.Role
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&role, roleID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoleNotFound
		}
		return nil, err
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&role).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	// Replace permissions if provided; exclude global admin permissions to prevent privilege escalation
	if req.PermissionIDs != nil {
		var permissions []model.Permission
		if len(req.PermissionIDs) > 0 {
			if err := s.DB.Where("id IN ? AND code NOT IN ?", req.PermissionIDs, globalAdminPermCodes).
				Find(&permissions).Error; err != nil {
				return nil, err
			}
		}
		if err := s.DB.Model(&role).Association("Permissions").Replace(&permissions); err != nil {
			return nil, err
		}
	}

	if err := s.DB.Where("tenant_id = ?", tenantID).Preload("Permissions").First(&role, roleID).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

// ListTenantPermissions returns all permissions except global admin ones.
func (s *TenantAdminService) ListTenantPermissions() ([]model.Permission, error) {
	var permissions []model.Permission
	if err := s.DB.Where("code NOT IN ?", globalAdminPermCodes).Find(&permissions).Error; err != nil {
		return nil, err
	}
	return permissions, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./service/ -run TestTenantAdmin -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/service/tenant_admin.go server/service/tenant_admin_test.go
git commit -m "feat: add tenant admin service with tenant-isolated user/role management"
```

---

## Chunk 2: Backend Handler & Router

### Task 3: Tenant admin handler

**Files:**
- Create: `server/handler/tenant_admin.go`

- [ ] **Step 1: Write failing tests**

Create `server/handler/tenant_admin_test.go`:

```go
package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

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
				users.DELETE("/:id", h.DisableUser)
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

func TestTenantAdminHandler_ListUsers_TenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	r := setupTenantAdminRouter(db)

	perms := testutil.SeedAllPermissions(t, db)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")

	tenantUserPerm := testutil.SeedTestPermission(t, db, "tenant:user:manage", "诊所用户管理")
	role1 := testutil.SeedTestRole(t, db, tenant1.ID, "运营", tenantUserPerm)
	role2 := testutil.SeedTestRole(t, db, tenant2.ID, "医生", perms["patient:read"])

	_, token1 := testutil.SeedTestUser(t, db, tenant1.ID, "ops1", "pass", role1)
	testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", role1)
	testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", role2)

	// Tenant 1 ops should only see tenant 1 users
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenant/users?page=1&size=20", nil)
	req.Header.Set("Authorization", "Bearer "+token1)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	data := body["data"].(map[string]interface{})
	assert.Equal(t, float64(2), data["total"])
}

func TestTenantAdminHandler_NoPermission_Returns403(t *testing.T) {
	db := testutil.SetupTestDB(t)
	r := setupTenantAdminRouter(db)

	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	perm := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, db, tenant.ID, "医生", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", role)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenant/users", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestTenantAdminHandler_GlobalAdmin_CanAccessTenantAPI(t *testing.T) {
	db := testutil.SetupTestDB(t)
	r := setupTenantAdminRouter(db)

	_, _, adminToken := testutil.SeedAdminUser(t, db)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenant/users?page=1&size=20", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestTenantAdminHandler_ListTenantPermissions_ExcludesGlobal(t *testing.T) {
	db := testutil.SetupTestDB(t)
	r := setupTenantAdminRouter(db)

	perms := testutil.SeedAllPermissions(t, db)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantRolePerm := testutil.SeedTestPermission(t, db, "tenant:role:manage", "诊所角色管理")
	role := testutil.SeedTestRole(t, db, tenant.ID, "运营", tenantRolePerm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "ops", "pass", role)

	_ = perms // ensure all permissions exist

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenant/permissions", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	data := body["data"].([]interface{})

	for _, item := range data {
		perm := item.(map[string]interface{})
		code := perm["code"].(string)
		assert.NotEqual(t, "user:manage", code)
		assert.NotEqual(t, "role:manage", code)
		assert.NotEqual(t, "tenant:manage", code)
	}
}

func TestTenantAdminHandler_UpdateUser_CrossTenant_Fails(t *testing.T) {
	db := testutil.SetupTestDB(t)
	r := setupTenantAdminRouter(db)

	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")

	tenantUserPerm := testutil.SeedTestPermission(t, db, "tenant:user:manage", "诊所用户管理")
	role1 := testutil.SeedTestRole(t, db, tenant1.ID, "运营", tenantUserPerm)
	perm := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	role2 := testutil.SeedTestRole(t, db, tenant2.ID, "医生", perm)

	_, token1 := testutil.SeedTestUser(t, db, tenant1.ID, "ops1", "pass", role1)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", role2)

	// Tenant 1 ops trying to update tenant 2 user — should fail
	body, _ := json.Marshal(map[string]interface{}{"real_name": "hacked"})
	req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/v1/tenant/users/%d", user2.ID), bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token1)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

// Helper: use fmt.Sprintf for ID-to-string conversion (consistent with codebase pattern).
// In the test file, add "fmt" to imports and use fmt.Sprintf("%d", user2.ID) directly.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./handler/ -run TestTenantAdmin -v`
Expected: FAIL — `NewTenantAdminHandler` not defined

- [ ] **Step 3: Implement tenant admin handler**

Create `server/handler/tenant_admin.go`:

```go
package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// TenantAdminHandler handles tenant-scoped user and role management.
type TenantAdminHandler struct {
	db *gorm.DB
}

// NewTenantAdminHandler creates a new TenantAdminHandler.
func NewTenantAdminHandler(db *gorm.DB) *TenantAdminHandler {
	return &TenantAdminHandler{db: db}
}

// ListUsers handles GET /api/v1/tenant/users.
func (h *TenantAdminHandler) ListUsers(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewTenantAdminService(h.db)
	users, total, err := svc.ListUsers(tenantID, page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to list users"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  users,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// UpdateUser handles PUT /api/v1/tenant/users/:id.
func (h *TenantAdminHandler) UpdateUser(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid user id"})
		return
	}

	var req service.TenantUpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid request: " + err.Error()})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	user, err := svc.UpdateUser(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "user not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to update user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": user})
}

// DisableUser handles DELETE /api/v1/tenant/users/:id.
func (h *TenantAdminHandler) DisableUser(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid user id"})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	if err := svc.DisableUser(tenantID, id); err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "user not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to disable user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success"})
}

// AssignRoles handles POST /api/v1/tenant/users/:id/roles.
// Note: Reuses service.AssignRolesRequest from existing user.go (same {role_ids: []} shape).
func (h *TenantAdminHandler) AssignRoles(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid user id"})
		return
	}

	var req service.AssignRolesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid request: " + err.Error()})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	if err := svc.AssignRoles(tenantID, id, req.RoleIDs); err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "user not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success"})
}

// ListRoles handles GET /api/v1/tenant/roles.
func (h *TenantAdminHandler) ListRoles(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	svc := service.NewTenantAdminService(h.db)
	roles, err := svc.ListRoles(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to list roles"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": roles})
}

// CreateRole handles POST /api/v1/tenant/roles.
func (h *TenantAdminHandler) CreateRole(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	var req service.TenantCreateRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid request: " + err.Error()})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	role, err := svc.CreateRole(tenantID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to create role"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"code": 0, "message": "success", "data": role})
}

// UpdateRole handles PUT /api/v1/tenant/roles/:id.
func (h *TenantAdminHandler) UpdateRole(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid role id"})
		return
	}

	var req service.TenantUpdateRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid request: " + err.Error()})
		return
	}

	svc := service.NewTenantAdminService(h.db)
	role, err := svc.UpdateRole(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrRoleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "role not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to update role"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": role})
}

// ListTenantPermissions handles GET /api/v1/tenant/permissions.
func (h *TenantAdminHandler) ListTenantPermissions(c *gin.Context) {
	svc := service.NewTenantAdminService(h.db)
	permissions, err := svc.ListTenantPermissions()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to list permissions"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": permissions})
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./handler/ -run TestTenantAdmin -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/handler/tenant_admin.go server/handler/tenant_admin_test.go
git commit -m "feat: add tenant admin handler with tenant isolation"
```

---

### Task 4: Register routes

**Files:**
- Modify: `server/router/router.go`

- [ ] **Step 1: Add tenant admin handler initialization**

After `billingHandler` creation (line 53 area), add:

```go
tenantAdminHandler := handler.NewTenantAdminHandler(db)
```

- [ ] **Step 2: Add tenant admin routes**

After the existing tenant management routes block (after line 148), add:

```go
// Tenant-scoped admin routes (for clinic operators).
tenantAdmin := authenticated.Group("/tenant")
{
	tenantUsers := tenantAdmin.Group("/users")
	tenantUsers.Use(middleware.RequirePermission(db, "tenant:user:manage", "user:manage"))
	{
		tenantUsers.GET("", tenantAdminHandler.ListUsers)
		tenantUsers.PUT("/:id", tenantAdminHandler.UpdateUser)
		tenantUsers.DELETE("/:id", tenantAdminHandler.DisableUser)
		tenantUsers.POST("/:id/roles", tenantAdminHandler.AssignRoles)
	}
	tenantRoles := tenantAdmin.Group("/roles")
	tenantRoles.Use(middleware.RequirePermission(db, "tenant:role:manage", "role:manage"))
	{
		tenantRoles.GET("", tenantAdminHandler.ListRoles)
		tenantRoles.POST("", tenantAdminHandler.CreateRole)
		tenantRoles.PUT("/:id", tenantAdminHandler.UpdateRole)
	}
	tenantAdmin.GET("/permissions",
		middleware.RequirePermission(db, "tenant:role:manage", "role:manage"),
		tenantAdminHandler.ListTenantPermissions)
}
```

- [ ] **Step 3: Verify backend builds**

Run: `cd server && go build ./...`
Expected: Success

- [ ] **Step 4: Run all backend tests**

Run: `cd server && go test ./...`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/router/router.go
git commit -m "feat: register tenant admin API routes"
```

---

## Chunk 3: Frontend Changes

### Task 5: Frontend API layer

**Files:**
- Create: `web/src/api/tenant-admin.ts`
- Create: `web/src/api/__tests__/tenant-admin.test.ts`

- [ ] **Step 1: Create tenant admin API functions**

Create `web/src/api/tenant-admin.ts`:

```typescript
import request from '../utils/request';

export function listTenantUsers(params: { page?: number; size?: number }) {
  return request.get('/tenant/users', { params });
}

export function updateTenantUser(id: number, data: { real_name?: string; phone?: string; status?: number; notes?: string }) {
  return request.put(`/tenant/users/${id}`, data);
}

export function deleteTenantUser(id: number) {
  return request.delete(`/tenant/users/${id}`);
}

export function assignTenantUserRoles(userId: number, roleIds: number[]) {
  return request.post(`/tenant/users/${userId}/roles`, { role_ids: roleIds });
}

export function listTenantRoles() {
  return request.get('/tenant/roles');
}

export function createTenantRole(data: { name: string; description?: string; permission_ids?: number[] }) {
  return request.post('/tenant/roles', data);
}

export function updateTenantRole(id: number, data: { name?: string; description?: string; permission_ids?: number[] }) {
  return request.put(`/tenant/roles/${id}`, data);
}

export function listTenantPermissions() {
  return request.get('/tenant/permissions');
}
```

- [ ] **Step 2: Write API tests**

Create `web/src/api/__tests__/tenant-admin.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listTenantUsers,
  updateTenantUser,
  deleteTenantUser,
  assignTenantUserRoles,
  listTenantRoles,
  createTenantRole,
  updateTenantRole,
  listTenantPermissions,
} from '../tenant-admin';
import request from '../../utils/request';

vi.mock('../../utils/request');
const mockRequest = vi.mocked(request);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tenant-admin API', () => {
  it('listTenantUsers calls GET /tenant/users', async () => {
    mockRequest.get.mockResolvedValue({ data: { list: [], total: 0 } });
    await listTenantUsers({ page: 1, size: 20 });
    expect(mockRequest.get).toHaveBeenCalledWith('/tenant/users', { params: { page: 1, size: 20 } });
  });

  it('updateTenantUser calls PUT /tenant/users/:id', async () => {
    mockRequest.put.mockResolvedValue({ data: {} });
    await updateTenantUser(1, { real_name: '张三' });
    expect(mockRequest.put).toHaveBeenCalledWith('/tenant/users/1', { real_name: '张三' });
  });

  it('deleteTenantUser calls DELETE /tenant/users/:id', async () => {
    mockRequest.delete.mockResolvedValue({});
    await deleteTenantUser(1);
    expect(mockRequest.delete).toHaveBeenCalledWith('/tenant/users/1');
  });

  it('assignTenantUserRoles calls POST /tenant/users/:id/roles', async () => {
    mockRequest.post.mockResolvedValue({});
    await assignTenantUserRoles(1, [2, 3]);
    expect(mockRequest.post).toHaveBeenCalledWith('/tenant/users/1/roles', { role_ids: [2, 3] });
  });

  it('listTenantRoles calls GET /tenant/roles', async () => {
    mockRequest.get.mockResolvedValue({ data: [] });
    await listTenantRoles();
    expect(mockRequest.get).toHaveBeenCalledWith('/tenant/roles');
  });

  it('createTenantRole calls POST /tenant/roles', async () => {
    mockRequest.post.mockResolvedValue({ data: {} });
    await createTenantRole({ name: '测试角色', permission_ids: [1] });
    expect(mockRequest.post).toHaveBeenCalledWith('/tenant/roles', { name: '测试角色', permission_ids: [1] });
  });

  it('updateTenantRole calls PUT /tenant/roles/:id', async () => {
    mockRequest.put.mockResolvedValue({ data: {} });
    await updateTenantRole(1, { name: '新名称' });
    expect(mockRequest.put).toHaveBeenCalledWith('/tenant/roles/1', { name: '新名称' });
  });

  it('listTenantPermissions calls GET /tenant/permissions', async () => {
    mockRequest.get.mockResolvedValue({ data: [] });
    await listTenantPermissions();
    expect(mockRequest.get).toHaveBeenCalledWith('/tenant/permissions');
  });
});
```

- [ ] **Step 3: Run frontend tests**

Run: `cd web && npx vitest run src/api/__tests__/tenant-admin.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/api/tenant-admin.ts web/src/api/__tests__/tenant-admin.test.ts
git commit -m "feat: add tenant admin frontend API layer"
```

---

### Task 6: Update Layout menu

**Files:**
- Modify: `web/src/components/Layout.tsx:210-243`

- [ ] **Step 1: Update menu permission logic**

Replace lines 210-243 in `Layout.tsx`:

```typescript
const canManageUsers = hasPermission('user:manage') || hasPermission('tenant:user:manage');
const canManageRoles = hasPermission('role:manage') || hasPermission('tenant:role:manage');
const canManageTenants = hasPermission('tenant:manage');

if (canManageUsers || canManageRoles || canManageTenants) {
  const settingsChildren: MenuItem[] = [];
  if (canManageUsers) {
    settingsChildren.push({
      key: '/settings/users',
      icon: <TeamOutlined />,
      label: '用户管理',
    });
  }
  if (canManageRoles) {
    settingsChildren.push({
      key: '/settings/roles',
      icon: <SafetyOutlined />,
      label: '角色管理',
    });
  }
  if (canManageTenants) {
    settingsChildren.push({
      key: '/settings/tenants',
      icon: <BankOutlined />,
      label: '诊所管理',
    });
  }
  items.push({
    key: '/settings',
    icon: <SettingOutlined />,
    label: '系统设置',
    children: settingsChildren,
  });
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd web && npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Layout.tsx
git commit -m "feat: update menu to show settings for tenant:*:manage permissions"
```

---

### Task 7: Update UserList page for tenant mode

**Files:**
- Modify: `web/src/pages/settings/UserList.tsx`

- [ ] **Step 1: Add tenant mode support**

The key changes to `UserList.tsx`:

1. Import `useAuth` and tenant admin API functions
2. Detect `isGlobalAdmin` vs tenant-only mode
3. Switch API calls based on mode
4. Hide "所属诊所" column and tenant selector in edit modal for tenant mode

At the top, update imports:

```typescript
import { useAuth } from '../../store/auth';
import { listTenantUsers, updateTenantUser, assignTenantUserRoles } from '../../api/tenant-admin';
import { listTenantRoles } from '../../api/tenant-admin';
```

Inside the component, add:

```typescript
const { hasPermission } = useAuth();
const isGlobalAdmin = hasPermission('user:manage');
```

In `fetchData`, switch API:

```typescript
const res = isGlobalAdmin
  ? await listUsers({ page: query.page, size: query.size })
  : await listTenantUsers({ page: query.page, size: query.size });
```

In `handleEditSubmit`, switch API:

```typescript
isGlobalAdmin
  ? await updateUser(editingUser!.id, { real_name: values.real_name, phone: values.phone, status: values.status, tenant_id: values.tenant_id, notes: values.notes })
  : await updateTenantUser(editingUser!.id, { real_name: values.real_name, phone: values.phone, status: values.status, notes: values.notes });
```

In `handleToggleStatus`, switch API:

```typescript
isGlobalAdmin
  ? await updateUser(record.id, { status: newStatus })
  : await updateTenantUser(record.id, { status: newStatus });
```

In `handleOpenRoleModal`, switch API for listing roles:

```typescript
const res = isGlobalAdmin ? await listRoles() : await listTenantRoles();
```

In `handleRoleSubmit`, switch API:

```typescript
isGlobalAdmin
  ? await assignRoles(roleTargetUser.id, selectedRoleIds)
  : await assignTenantUserRoles(roleTargetUser.id, selectedRoleIds);
```

In `columns`, conditionally include the "所属诊所" column:

```typescript
// Only show tenant column for global admin
...(isGlobalAdmin ? [{
  title: '所属诊所',
  key: 'tenant',
  width: 120,
  render: (_: unknown, record: UserItem) => record.tenant?.name || '-',
}] : []),
```

In the edit modal, conditionally show the tenant selector:

```typescript
{isGlobalAdmin && (
  <Form.Item name="tenant_id" label="所属诊所">
    <Select ... />
  </Form.Item>
)}
```

Also conditionally load tenants in `handleEdit`:

```typescript
if (isGlobalAdmin) {
  try {
    const res = await listTenants({ page: 1, size: 100 });
    // ...
  } catch { /* */ }
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd web && npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/settings/UserList.tsx
git commit -m "feat: UserList supports tenant mode with API switching"
```

---

### Task 8: Update RoleList page for tenant mode

**Files:**
- Modify: `web/src/pages/settings/RoleList.tsx`

- [ ] **Step 1: Add tenant mode support**

Key changes to `RoleList.tsx`:

1. Import `useAuth` and tenant admin API functions
2. Detect `isGlobalAdmin` vs tenant-only mode
3. Switch API calls
4. Add `billing:create`, `billing:read`, `tenant:user:manage`, `tenant:role:manage` to PERMISSION_GROUPS

Update imports:

```typescript
import { useAuth } from '../../store/auth';
import { listTenantRoles, createTenantRole, updateTenantRole, listTenantPermissions } from '../../api/tenant-admin';
```

Add inside component:

```typescript
const { hasPermission } = useAuth();
const isGlobalAdmin = hasPermission('role:manage');
```

Update PERMISSION_GROUPS to add new groups (add after 系统管理):

```typescript
{
  label: '收费管理',
  codes: ['billing:create', 'billing:read'],
},
{
  label: '诊所运营',
  codes: ['tenant:user:manage', 'tenant:role:manage'],
},
```

In `fetchData`, switch API:

```typescript
const res = isGlobalAdmin ? await listRoles() : await listTenantRoles();
```

In `fetchPermissions`, switch API:

```typescript
const res = isGlobalAdmin ? await listPermissions() : await listTenantPermissions();
```

In `handleSubmit`, switch API:

```typescript
if (editingRole) {
  isGlobalAdmin
    ? await updateRole(editingRole.id, { ... })
    : await updateTenantRole(editingRole.id, { ... });
} else {
  isGlobalAdmin
    ? await createRole({ ... })
    : await createTenantRole({ ... });
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd web && npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/settings/RoleList.tsx
git commit -m "feat: RoleList supports tenant mode with filtered permissions"
```

---

## Chunk 4: Final Verification & Docs

### Task 9: Full test suite and build verification

- [ ] **Step 1: Run all backend tests**

Run: `cd server && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 2: Run all frontend tests**

Run: `cd web && npm run test`
Expected: ALL PASS

- [ ] **Step 3: Build frontend**

Run: `cd web && npm run build`
Expected: Success

- [ ] **Step 4: Build backend**

Run: `cd server && go build ./...`
Expected: Success

---

### Task 10: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/codebase.md`

- [ ] **Step 1: Update CLAUDE.md permission codes**

Add `tenant:user:manage`, `tenant:role:manage` to the permission codes list.

- [ ] **Step 2: Update docs/codebase.md**

Add:
- New permission codes
- New API endpoints under tenant admin
- New "诊所运营" role description
- Updated file list with new service/handler files

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/codebase.md
git commit -m "docs: add tenant operations feature to codebase docs"
```

---

### Task 11: Deploy to Docker

- [ ] **Step 1: Build and deploy frontend**

```bash
cd web && npm run build
docker cp web/dist/. menzhen-web-1:/usr/share/nginx/html/
docker exec menzhen-nginx-1 nginx -s reload
```

- [ ] **Step 2: Rebuild and restart backend**

```bash
docker compose build server
docker compose up -d server
```

- [ ] **Step 3: Verify seed runs**

Check docker logs for the new seed output:
```bash
docker logs menzhen-server-1 2>&1 | tail -5
```
Expected: "Clinic ops role seeded successfully" or "Clinic ops role already exists, skipping"
