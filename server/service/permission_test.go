package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func TestGetUserPermissions_WithPermissions(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")

	perm1 := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	perm2 := testutil.SeedTestPermission(t, db, "patient:create", "创建患者")
	perm3 := testutil.SeedTestPermission(t, db, "record:read", "查看诊疗记录")
	role := testutil.SeedTestRole(t, db, tenant.ID, "医生", perm1, perm2, perm3)
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", role)

	svc := service.NewPermissionService(db)
	codes, err := svc.GetUserPermissions(user.ID)

	assert.NoError(t, err)
	assert.Len(t, codes, 3)
	assert.Contains(t, codes, "patient:read")
	assert.Contains(t, codes, "patient:create")
	assert.Contains(t, codes, "record:read")
}

func TestGetUserPermissions_NoRoles(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	// User with no role assigned.
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "norole", "pass123", nil)

	svc := service.NewPermissionService(db)
	codes, err := svc.GetUserPermissions(user.ID)

	assert.NoError(t, err)
	assert.Empty(t, codes)
}

func TestHasPermission_True(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")

	perm := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, db, tenant.ID, "医生", perm)
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", role)

	svc := service.NewPermissionService(db)
	has, err := svc.HasPermission(user.ID, "patient:read")

	assert.NoError(t, err)
	assert.True(t, has)
}

func TestHasPermission_False(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")

	perm := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, db, tenant.ID, "医生", perm)
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", role)

	svc := service.NewPermissionService(db)
	has, err := svc.HasPermission(user.ID, "patient:delete")

	assert.NoError(t, err)
	assert.False(t, has)
}

func TestHasPermission_UserNotExist(t *testing.T) {
	db := testutil.SetupTestDB(t)

	svc := service.NewPermissionService(db)
	has, err := svc.HasPermission(99999, "patient:read")

	assert.NoError(t, err)
	assert.False(t, has)
}
