package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
)

func TestListUsers_WithPreloads(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "list-users")
	perm := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, db, tenant.ID, "医生", perm)
	testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", role)
	testutil.SeedTestUser(t, db, tenant.ID, "doctor2", "pass123", role)

	svc := service.NewUserService(db)
	users, total, err := svc.ListUsers(1, 10, 0)

	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, users, 2)

	// Verify preloads: each user should have Roles and Tenant loaded.
	for _, u := range users {
		assert.NotEmpty(t, u.Roles, "Roles should be preloaded")
		assert.NotZero(t, u.Tenant.ID, "Tenant should be preloaded")
		assert.Equal(t, tenant.ID, u.Tenant.ID)
	}
}

func TestUpdateUser_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "upd-user")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "testuser", "pass123", nil)

	svc := service.NewUserService(db)
	newName := "张三"
	newPhone := "13800138000"
	updated, err := svc.UpdateUser(tenant.ID, user.ID, &service.UpdateUserRequest{
		RealName: &newName,
		Phone:    &newPhone,
	})

	assert.NoError(t, err)
	assert.Equal(t, "张三", updated.RealName)
	assert.Equal(t, "13800138000", updated.Phone)
}

func TestUpdateUser_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "upd-user-nf")

	svc := service.NewUserService(db)
	newName := "不存在"
	_, err := svc.UpdateUser(tenant.ID, 99999, &service.UpdateUserRequest{RealName: &newName})
	assert.ErrorIs(t, err, service.ErrUserNotFound)
}

func TestDeleteUser_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "del-user")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "tobedeleted", "pass123", nil)

	svc := service.NewUserService(db)
	deletedUser, err := svc.DeleteUser(tenant.ID, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, user.Username, deletedUser.Username)

	// Verify record is actually deleted (hard delete).
	var found model.User
	err = db.First(&found, user.ID).Error
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

func TestDeleteUser_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "del-user-nf")

	svc := service.NewUserService(db)
	_, err := svc.DeleteUser(tenant.ID, 99999)
	assert.ErrorIs(t, err, service.ErrUserNotFound)
}

func TestAssignRoles_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "assign-roles")
	role1 := testutil.SeedTestRole(t, db, tenant.ID, "角色A")
	role2 := testutil.SeedTestRole(t, db, tenant.ID, "角色B")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "roleuser", "pass123", nil)

	svc := service.NewUserService(db)
	err := svc.AssignRoles(tenant.ID, user.ID, []uint64{role1.ID, role2.ID})
	assert.NoError(t, err)

	// Verify user now has both roles.
	var reloaded model.User
	err = db.Preload("Roles").First(&reloaded, user.ID).Error
	assert.NoError(t, err)
	assert.Len(t, reloaded.Roles, 2)
}

func TestAssignRoles_WrongTenantRole(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "tenant-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "tenant-b")
	roleB := testutil.SeedTestRole(t, db, tenantB.ID, "B角色")
	user, _ := testutil.SeedTestUser(t, db, tenantA.ID, "usera", "pass123", nil)

	svc := service.NewUserService(db)
	// Try to assign a role from tenant B to a user in tenant A.
	err := svc.AssignRoles(tenantA.ID, user.ID, []uint64{roleB.ID})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "do not belong to this tenant")
}

func TestAssignRoles_UserNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	testutil.SeedTestTenant(t, db, "诊所", "assign-nf")

	svc := service.NewUserService(db)
	err := svc.AssignRoles(1, 99999, []uint64{1})
	assert.ErrorIs(t, err, service.ErrUserNotFound)
}

// --- Admin user hiding tests ---

func TestListUsers_HidesAdminFromOthers(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "hide-admin")

	// Create user:manage permission and admin role
	adminPerm := testutil.SeedTestPermission(t, db, "user:manage", "用户管理")
	adminRole := testutil.SeedTestRole(t, db, tenant.ID, "管理员", adminPerm)
	adminUser, _ := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass123", adminRole)

	// Create a normal user
	normalUser, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor", "pass123", nil)

	svc := service.NewUserService(db)

	// Normal user should NOT see admin
	users, total, err := svc.ListUsers(1, 10, normalUser.ID)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, users, 1)
	assert.Equal(t, normalUser.ID, users[0].ID)

	// Admin should see themselves
	users2, total2, err := svc.ListUsers(1, 10, adminUser.ID)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total2)
	assert.Len(t, users2, 2)
}

func TestUpdateUser_TenantChangeBumpsTokenVersion(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "tv-bump-a")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "tv-bump-b")
	user, _ := testutil.SeedTestUser(t, db, tenant1.ID, "moveme", "pass123", nil)

	svc := service.NewUserService(db)

	// Move user to tenant2 — should bump token_version
	newTenantID := tenant2.ID
	_, err := svc.UpdateUser(0, user.ID, &service.UpdateUserRequest{
		TenantID: &newTenantID,
	})
	assert.NoError(t, err)

	var reloaded model.User
	db.First(&reloaded, user.ID)
	assert.Equal(t, tenant2.ID, reloaded.TenantID)
	assert.Equal(t, int64(1), reloaded.TokenVersion)
}

func TestUpdateUser_NonTenantChangeNoVersionBump(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "tv-no-bump")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "stayput", "pass123", nil)

	svc := service.NewUserService(db)

	// Update name only — should NOT bump token_version
	newName := "新名字"
	_, err := svc.UpdateUser(0, user.ID, &service.UpdateUserRequest{
		RealName: &newName,
	})
	assert.NoError(t, err)

	var reloaded model.User
	db.First(&reloaded, user.ID)
	assert.Equal(t, int64(0), reloaded.TokenVersion)
}
