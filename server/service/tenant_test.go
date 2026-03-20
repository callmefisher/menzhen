package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func TestCreateTenant_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	req := &service.CreateTenantRequest{Name: "仁济诊所", Code: "renji-001"}
	tenant, err := svc.CreateTenant(req)

	assert.NoError(t, err)
	assert.NotZero(t, tenant.ID)
	assert.Equal(t, "仁济诊所", tenant.Name)
	assert.Equal(t, "renji-001", tenant.Code)
	assert.Equal(t, int8(1), tenant.Status)
}

func TestCreateTenant_DuplicateCode(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	req := &service.CreateTenantRequest{Name: "诊所A", Code: "dup-code"}
	_, err := svc.CreateTenant(req)
	assert.NoError(t, err)

	req2 := &service.CreateTenantRequest{Name: "诊所B", Code: "dup-code"}
	_, err = svc.CreateTenant(req2)
	assert.ErrorIs(t, err, service.ErrTenantCodeExist)
}

func TestGetTenant_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	created, err := svc.CreateTenant(&service.CreateTenantRequest{Name: "测试诊所", Code: "get-test"})
	assert.NoError(t, err)

	got, err := svc.GetTenant(created.ID)
	assert.NoError(t, err)
	assert.Equal(t, created.ID, got.ID)
	assert.Equal(t, "测试诊所", got.Name)
	assert.Equal(t, "get-test", got.Code)
}

func TestGetTenant_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	_, err := svc.GetTenant(99999)
	assert.ErrorIs(t, err, service.ErrTenantNotFound)
}

func TestListTenants_Pagination(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	// Create 5 tenants.
	for i := 0; i < 5; i++ {
		_, err := svc.CreateTenant(&service.CreateTenantRequest{
			Name: "诊所" + string(rune('A'+i)),
			Code: "list-" + string(rune('a'+i)),
		})
		assert.NoError(t, err)
	}

	// Page 1, size 2 — should get 2 items, total 5.
	tenants, total, err := svc.ListTenants(1, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, tenants, 2)

	// Verify ordered by created_at DESC: last created first.
	assert.Equal(t, "list-e", tenants[0].Code)
	assert.Equal(t, "list-d", tenants[1].Code)

	// Page 3, size 2 — should get 1 item (the oldest).
	tenants, total, err = svc.ListTenants(3, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, tenants, 1)
	assert.Equal(t, "list-a", tenants[0].Code)
}

func TestUpdateTenant_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	created, err := svc.CreateTenant(&service.CreateTenantRequest{Name: "旧名称", Code: "upd-test"})
	assert.NoError(t, err)

	newName := "新名称"
	newCode := "upd-new"
	updated, err := svc.UpdateTenant(created.ID, &service.UpdateTenantRequest{
		Name: &newName,
		Code: &newCode,
	})

	assert.NoError(t, err)
	assert.Equal(t, "新名称", updated.Name)
	assert.Equal(t, "upd-new", updated.Code)
}

func TestCreateTenant_DuplicateName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	_, err := svc.CreateTenant(&service.CreateTenantRequest{Name: "同名诊所", Code: "name-a"})
	assert.NoError(t, err)

	_, err = svc.CreateTenant(&service.CreateTenantRequest{Name: "同名诊所", Code: "name-b"})
	assert.ErrorIs(t, err, service.ErrTenantNameExist)
}

func TestUpdateTenant_DuplicateName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	_, err := svc.CreateTenant(&service.CreateTenantRequest{Name: "诊所X", Code: "namex"})
	assert.NoError(t, err)
	b, err := svc.CreateTenant(&service.CreateTenantRequest{Name: "诊所Y", Code: "namey"})
	assert.NoError(t, err)

	dupName := "诊所X"
	_, err = svc.UpdateTenant(b.ID, &service.UpdateTenantRequest{Name: &dupName})
	assert.ErrorIs(t, err, service.ErrTenantNameExist)
}

func TestUpdateTenant_SameName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	created, err := svc.CreateTenant(&service.CreateTenantRequest{Name: "自身诊所", Code: "self-name"})
	assert.NoError(t, err)

	sameName := "自身诊所"
	updated, err := svc.UpdateTenant(created.ID, &service.UpdateTenantRequest{Name: &sameName})
	assert.NoError(t, err)
	assert.Equal(t, "自身诊所", updated.Name)
}

func TestUpdateTenant_DuplicateCode(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	_, err := svc.CreateTenant(&service.CreateTenantRequest{Name: "诊所A", Code: "code-a"})
	assert.NoError(t, err)
	b, err := svc.CreateTenant(&service.CreateTenantRequest{Name: "诊所B", Code: "code-b"})
	assert.NoError(t, err)

	dupCode := "code-a"
	_, err = svc.UpdateTenant(b.ID, &service.UpdateTenantRequest{Code: &dupCode})
	assert.ErrorIs(t, err, service.ErrTenantCodeExist)
}

func TestUpdateTenant_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	newName := "不存在"
	_, err := svc.UpdateTenant(99999, &service.UpdateTenantRequest{Name: &newName})
	assert.ErrorIs(t, err, service.ErrTenantNotFound)
}

func TestDeleteTenant_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	created, err := svc.CreateTenant(&service.CreateTenantRequest{Name: "待删除", Code: "del-test"})
	assert.NoError(t, err)

	err = svc.DeleteTenant(created.ID)
	assert.NoError(t, err)

	// Confirm it no longer exists.
	_, err = svc.GetTenant(created.ID)
	assert.ErrorIs(t, err, service.ErrTenantNotFound)
}

func TestDeleteTenant_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewTenantService(db)

	err := svc.DeleteTenant(99999)
	assert.ErrorIs(t, err, service.ErrTenantNotFound)
}
