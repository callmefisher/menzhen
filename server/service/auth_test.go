package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"golang.org/x/crypto/bcrypt"
)

func TestLogin_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	svc := service.NewAuthService(db)
	user, err := svc.Login("doctor1", "pass123")

	assert.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, "doctor1", user.Username)
	assert.Equal(t, tenant.ID, user.TenantID)
}

func TestLogin_WrongPassword(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	svc := service.NewAuthService(db)
	user, err := svc.Login("doctor1", "wrongpassword")

	assert.Nil(t, user)
	assert.ErrorIs(t, err, service.ErrInvalidCredentials)
}

func TestLogin_UserNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)

	svc := service.NewAuthService(db)
	user, err := svc.Login("nonexistent", "pass123")

	assert.Nil(t, user)
	assert.ErrorIs(t, err, service.ErrInvalidCredentials)
}

func TestLogin_Disabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	// Disable the user.
	db.Model(user).Update("status", 0)

	svc := service.NewAuthService(db)
	result, err := svc.Login("doctor1", "pass123")

	assert.Nil(t, result)
	assert.ErrorIs(t, err, service.ErrUserDisabled)
}

func TestRegister_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")

	svc := service.NewAuthService(db)
	user, err := svc.Register(tenant.ID, "newdoctor", "secret123", "张三", "13800138000")

	assert.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, "newdoctor", user.Username)
	assert.Equal(t, "张三", user.RealName)
	assert.Equal(t, "13800138000", user.Phone)
	assert.Equal(t, tenant.ID, user.TenantID)
	assert.Equal(t, int8(1), user.Status)
	// Verify password was hashed.
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte("secret123")))
}

func TestRegister_DuplicateUsername(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	svc := service.NewAuthService(db)
	user, err := svc.Register(tenant.ID, "doctor1", "newpass", "李四", "13900139000")

	assert.Nil(t, user)
	assert.ErrorIs(t, err, service.ErrUsernameExists)
}

func TestGetCurrentUser_WithPermissions(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")

	perm1 := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	perm2 := testutil.SeedTestPermission(t, db, "patient:create", "创建患者")
	role := testutil.SeedTestRole(t, db, tenant.ID, "医生", perm1, perm2)
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", role)

	svc := service.NewAuthService(db)
	result, perms, err := svc.GetCurrentUser(user.ID)

	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, user.ID, result.ID)
	assert.Len(t, perms, 2)
	assert.Contains(t, perms, "patient:read")
	assert.Contains(t, perms, "patient:create")
}

func TestGetCurrentUser_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)

	svc := service.NewAuthService(db)
	result, perms, err := svc.GetCurrentUser(99999)

	assert.Nil(t, result)
	assert.Nil(t, perms)
	assert.ErrorIs(t, err, service.ErrUserNotFound)
}

func TestChangePassword_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "oldpass", nil)

	svc := service.NewAuthService(db)
	err := svc.ChangePassword(user.ID, "oldpass", "newpass")
	assert.NoError(t, err)

	// Verify new password works via Login.
	result, err := svc.Login("doctor1", "newpass")
	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, user.ID, result.ID)

	// Verify old password no longer works.
	_, err = svc.Login("doctor1", "oldpass")
	assert.ErrorIs(t, err, service.ErrInvalidCredentials)
}

func TestChangePassword_WrongOld(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	svc := service.NewAuthService(db)
	err := svc.ChangePassword(user.ID, "wrongold", "newpass")

	assert.ErrorIs(t, err, service.ErrWrongOldPassword)
}

func TestChangePassword_UserNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)

	svc := service.NewAuthService(db)
	err := svc.ChangePassword(99999, "old", "new")

	assert.ErrorIs(t, err, service.ErrUserNotFound)
}

func TestLogin_TenantDisabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	// Disable the tenant.
	db.Model(tenant).Update("status", 0)

	svc := service.NewAuthService(db)
	result, err := svc.Login("doctor1", "pass123")

	assert.Nil(t, result)
	assert.ErrorIs(t, err, service.ErrTenantDisabled)
}
