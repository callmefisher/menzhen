package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupTenantAdminTestDB creates a shared DB, service, and two tenants.
func setupTenantAdminTestDB(t *testing.T) (*service.TenantAdminService, *gorm.DB, *model.Tenant, *model.Tenant) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantAdminService(db)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	return svc, db, tenant1, tenant2
}

func TestTenantAdminService_ListUsers(t *testing.T) {
	svc, db, t1, t2 := setupTenantAdminTestDB(t)

	role1 := testutil.SeedTestRole(t, db, t1.ID, "医生")
	role2 := testutil.SeedTestRole(t, db, t2.ID, "护士")

	testutil.SeedTestUser(t, db, t1.ID, "user1a", "pass", role1)
	testutil.SeedTestUser(t, db, t1.ID, "user2a", "pass", role1)
	testutil.SeedTestUser(t, db, t2.ID, "user1b", "pass", role2)

	users1, total1, err := svc.ListUsers(t1.ID, 1, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total1)
	assert.Len(t, users1, 2)
	for _, u := range users1 {
		assert.Equal(t, t1.ID, u.TenantID)
	}

	users2, total2, err := svc.ListUsers(t2.ID, 1, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total2)
	assert.Len(t, users2, 1)
	assert.Equal(t, t2.ID, users2[0].TenantID)
}

func TestTenantAdminService_UpdateUser_SameTenant(t *testing.T) {
	svc, db, t1, _ := setupTenantAdminTestDB(t)

	role := testutil.SeedTestRole(t, db, t1.ID, "医生")
	user, _ := testutil.SeedTestUser(t, db, t1.ID, "doctor1", "pass", role)

	newName := "张三"
	newPhone := "13800138000"
	updated, err := svc.UpdateUser(t1.ID, user.ID, &service.TenantUpdateUserRequest{
		RealName: &newName,
		Phone:    &newPhone,
	})

	require.NoError(t, err)
	assert.Equal(t, "张三", updated.RealName)
	assert.Equal(t, "13800138000", updated.Phone)
	assert.Equal(t, t1.ID, updated.TenantID)
}

func TestTenantAdminService_UpdateUser_CrossTenant_Fails(t *testing.T) {
	svc, db, t1, t2 := setupTenantAdminTestDB(t)

	role2 := testutil.SeedTestRole(t, db, t2.ID, "护士")
	user2, _ := testutil.SeedTestUser(t, db, t2.ID, "nurse1", "pass", role2)

	// Tenant1 tries to update tenant2's user — must fail.
	newName := "黑客"
	_, err := svc.UpdateUser(t1.ID, user2.ID, &service.TenantUpdateUserRequest{
		RealName: &newName,
	})

	assert.ErrorIs(t, err, service.ErrUserNotFound)
}

func TestTenantAdminService_DeleteUser_CrossTenant_Fails(t *testing.T) {
	svc, db, t1, t2 := setupTenantAdminTestDB(t)

	role2 := testutil.SeedTestRole(t, db, t2.ID, "护士")
	user2, _ := testutil.SeedTestUser(t, db, t2.ID, "nurse2", "pass", role2)

	// Tenant1 tries to disable tenant2's user — must fail.
	err := svc.DisableUser(t1.ID, user2.ID)
	assert.ErrorIs(t, err, service.ErrUserNotFound)
}

func TestTenantAdminService_AssignRoles_CrossTenant_Fails(t *testing.T) {
	svc, db, t1, t2 := setupTenantAdminTestDB(t)

	role1 := testutil.SeedTestRole(t, db, t1.ID, "医生")
	role2 := testutil.SeedTestRole(t, db, t2.ID, "护士")
	user1, _ := testutil.SeedTestUser(t, db, t1.ID, "doc1", "pass", role1)

	// Assigning a role from tenant2 to a user in tenant1 — must fail.
	err := svc.AssignRoles(t1.ID, user1.ID, []uint64{role2.ID})
	assert.Error(t, err)
}

func TestTenantAdminService_ListRoles_TenantIsolation(t *testing.T) {
	svc, db, t1, t2 := setupTenantAdminTestDB(t)

	testutil.SeedTestRole(t, db, t1.ID, "医生A")
	testutil.SeedTestRole(t, db, t1.ID, "护士A")
	testutil.SeedTestRole(t, db, t2.ID, "医生B")

	roles1, err := svc.ListRoles(t1.ID)
	require.NoError(t, err)
	assert.Len(t, roles1, 2)
	for _, r := range roles1 {
		assert.Equal(t, t1.ID, r.TenantID)
	}

	roles2, err := svc.ListRoles(t2.ID)
	require.NoError(t, err)
	assert.Len(t, roles2, 1)
	assert.Equal(t, t2.ID, roles2[0].TenantID)
}

func TestTenantAdminService_CreateRole(t *testing.T) {
	svc, db, t1, _ := setupTenantAdminTestDB(t)

	// Seed all permissions including global admin ones.
	perms := testutil.SeedAllPermissions(t, db)

	patientReadID := perms["patient:read"].ID
	userManageID := perms["user:manage"].ID
	roleManageID := perms["role:manage"].ID
	tenantManageID := perms["tenant:manage"].ID

	// Try creating a role with a mix of normal + global admin permission IDs.
	role, err := svc.CreateRole(t1.ID, &service.TenantCreateRoleRequest{
		Name:        "医生",
		Description: "门诊医生",
		PermissionIDs: []uint64{
			patientReadID, userManageID, roleManageID, tenantManageID,
		},
	})

	require.NoError(t, err)
	assert.Equal(t, t1.ID, role.TenantID)
	assert.Equal(t, "医生", role.Name)

	// Global admin permission codes must be excluded from the role.
	for _, p := range role.Permissions {
		assert.NotEqual(t, "user:manage", p.Code, "user:manage must be excluded")
		assert.NotEqual(t, "role:manage", p.Code, "role:manage must be excluded")
		assert.NotEqual(t, "tenant:manage", p.Code, "tenant:manage must be excluded")
	}
	// Normal permission must be included.
	codes := make(map[string]bool)
	for _, p := range role.Permissions {
		codes[p.Code] = true
	}
	assert.True(t, codes["patient:read"], "patient:read should be assigned")
}

func TestTenantAdminService_UpdateRole_CrossTenant_Fails(t *testing.T) {
	svc, db, t1, t2 := setupTenantAdminTestDB(t)

	role2 := testutil.SeedTestRole(t, db, t2.ID, "护士")

	// Tenant1 tries to update tenant2's role — must fail.
	newName := "黑客角色"
	_, err := svc.UpdateRole(t1.ID, role2.ID, &service.TenantUpdateRoleRequest{
		Name: &newName,
	})

	assert.ErrorIs(t, err, service.ErrRoleNotFound)
}

func TestTenantAdminService_ListTenantPermissions_ExcludesGlobal(t *testing.T) {
	svc, db, _, _ := setupTenantAdminTestDB(t)

	// Seed all permissions including global admin codes.
	testutil.SeedAllPermissions(t, db)

	perms, err := svc.ListTenantPermissions()
	require.NoError(t, err)

	// None of the global admin permission codes should appear.
	for _, p := range perms {
		assert.NotEqual(t, "user:manage", p.Code)
		assert.NotEqual(t, "role:manage", p.Code)
		assert.NotEqual(t, "tenant:manage", p.Code)
	}
	// Should still have some permissions.
	assert.NotEmpty(t, perms)
}
