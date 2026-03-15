package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func TestCreateRole_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "create-role")

	svc := service.NewRoleService(db)
	role, err := svc.CreateRole(tenant.ID, &service.CreateRoleRequest{
		Name:        "医生",
		Description: "门诊医生角色",
	})

	assert.NoError(t, err)
	assert.NotZero(t, role.ID)
	assert.Equal(t, "医生", role.Name)
	assert.Equal(t, "门诊医生角色", role.Description)
	assert.Equal(t, tenant.ID, role.TenantID)
}

func TestCreateRole_WithPermissions(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "role-perms")
	p1 := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	p2 := testutil.SeedTestPermission(t, db, "record:read", "查看记录")

	svc := service.NewRoleService(db)
	role, err := svc.CreateRole(tenant.ID, &service.CreateRoleRequest{
		Name:          "医生",
		PermissionIDs: []uint64{p1.ID, p2.ID},
	})

	assert.NoError(t, err)
	assert.Len(t, role.Permissions, 2)

	// Verify permission codes and names are fully preloaded.
	codes := make(map[string]string)
	for _, p := range role.Permissions {
		assert.NotZero(t, p.ID, "permission ID should be non-zero (fully loaded)")
		codes[p.Code] = p.Name
	}
	assert.Contains(t, codes, "patient:read")
	assert.Contains(t, codes, "record:read")
	assert.Equal(t, "查看患者", codes["patient:read"])
	assert.Equal(t, "查看记录", codes["record:read"])
}

func TestListRoles_FilterByTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "list-role-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "list-role-b")

	svc := service.NewRoleService(db)
	_, err := svc.CreateRole(tenantA.ID, &service.CreateRoleRequest{Name: "A角色1"})
	assert.NoError(t, err)
	_, err = svc.CreateRole(tenantA.ID, &service.CreateRoleRequest{Name: "A角色2"})
	assert.NoError(t, err)
	_, err = svc.CreateRole(tenantB.ID, &service.CreateRoleRequest{Name: "B角色1"})
	assert.NoError(t, err)

	rolesA, err := svc.ListRoles(tenantA.ID)
	assert.NoError(t, err)
	assert.Len(t, rolesA, 2)

	rolesB, err := svc.ListRoles(tenantB.ID)
	assert.NoError(t, err)
	assert.Len(t, rolesB, 1)
}

func TestUpdateRole_ChangeName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "upd-role-name")

	svc := service.NewRoleService(db)
	role, err := svc.CreateRole(tenant.ID, &service.CreateRoleRequest{Name: "旧名"})
	assert.NoError(t, err)

	newName := "新名"
	updated, err := svc.UpdateRole(tenant.ID, role.ID, &service.UpdateRoleRequest{Name: &newName})
	assert.NoError(t, err)
	assert.Equal(t, "新名", updated.Name)
}

func TestUpdateRole_ChangePermissions(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "upd-role-perm")
	p1 := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	p2 := testutil.SeedTestPermission(t, db, "record:read", "查看记录")
	p3 := testutil.SeedTestPermission(t, db, "herb:read", "查询中药")

	svc := service.NewRoleService(db)
	role, err := svc.CreateRole(tenant.ID, &service.CreateRoleRequest{
		Name:          "医生",
		PermissionIDs: []uint64{p1.ID, p2.ID},
	})
	assert.NoError(t, err)
	assert.Len(t, role.Permissions, 2)

	// Replace permissions: remove p2, add p3.
	updated, err := svc.UpdateRole(tenant.ID, role.ID, &service.UpdateRoleRequest{
		PermissionIDs: []uint64{p1.ID, p3.ID},
	})
	assert.NoError(t, err)
	assert.Len(t, updated.Permissions, 2)

	codes := make(map[string]bool)
	for _, p := range updated.Permissions {
		codes[p.Code] = true
	}
	assert.True(t, codes["patient:read"])
	assert.True(t, codes["herb:read"])
	assert.False(t, codes["record:read"])
}

func TestUpdateRole_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "upd-role-nf")

	svc := service.NewRoleService(db)
	newName := "不存在"
	_, err := svc.UpdateRole(tenant.ID, 99999, &service.UpdateRoleRequest{Name: &newName})
	assert.ErrorIs(t, err, service.ErrRoleNotFound)
}

func TestDeleteRole_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "del-role")

	svc := service.NewRoleService(db)
	role, err := svc.CreateRole(tenant.ID, &service.CreateRoleRequest{Name: "待删除"})
	assert.NoError(t, err)

	err = svc.DeleteRole(tenant.ID, role.ID)
	assert.NoError(t, err)

	// Verify role is gone.
	roles, err := svc.ListRoles(tenant.ID)
	assert.NoError(t, err)
	assert.Empty(t, roles)
}

func TestDeleteRole_InUse(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "del-role-inuse")
	role := testutil.SeedTestRole(t, db, tenant.ID, "使用中")
	testutil.SeedTestUser(t, db, tenant.ID, "user1", "pass", role)

	svc := service.NewRoleService(db)
	err := svc.DeleteRole(tenant.ID, role.ID)
	assert.ErrorIs(t, err, service.ErrRoleInUse)
}

func TestDeleteRole_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "del-role-nf")

	svc := service.NewRoleService(db)
	err := svc.DeleteRole(tenant.ID, 99999)
	assert.ErrorIs(t, err, service.ErrRoleNotFound)
}

func TestListPermissions(t *testing.T) {
	db := testutil.SetupTestDB(t)

	svc := service.NewRoleService(db)

	// Initially empty.
	perms, err := svc.ListPermissions()
	assert.NoError(t, err)
	assert.Empty(t, perms)

	// Seed some permissions.
	testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	testutil.SeedTestPermission(t, db, "record:read", "查看记录")
	testutil.SeedTestPermission(t, db, "herb:read", "查询中药")

	perms, err = svc.ListPermissions()
	assert.NoError(t, err)
	assert.Len(t, perms, 3)
}
