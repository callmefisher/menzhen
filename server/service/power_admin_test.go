package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPowerAdminService_AssignGroups(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPowerAdminService(db)

	tenant := model.Tenant{Name: "T", Code: "tc1", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)
	user := model.User{TenantID: tenant.ID, Username: "pa_test", PasswordHash: "x", RealName: "PA", Status: 1}
	require.NoError(t, db.Create(&user).Error)

	err := svc.AssignGroups(user.ID, []string{"华北分组", "华南分组"})
	require.NoError(t, err)

	groups, err := svc.GetManagedGroups(user.ID)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"华北分组", "华南分组"}, groups)
}

func TestPowerAdminService_AssignGroups_Replace(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPowerAdminService(db)

	tenant := model.Tenant{Name: "T2", Code: "tc2", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)
	user := model.User{TenantID: tenant.ID, Username: "pa_replace", PasswordHash: "x", RealName: "PA2", Status: 1}
	require.NoError(t, db.Create(&user).Error)

	require.NoError(t, svc.AssignGroups(user.ID, []string{"A", "B", "C"}))
	// Re-assign: should replace, not append
	require.NoError(t, svc.AssignGroups(user.ID, []string{"X", "Y"}))

	groups, err := svc.GetManagedGroups(user.ID)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"X", "Y"}, groups)
	assert.Len(t, groups, 2) // not 5
}

func TestPowerAdminService_AssignGroups_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPowerAdminService(db)

	tenant := model.Tenant{Name: "T3", Code: "tc3", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)
	user := model.User{TenantID: tenant.ID, Username: "pa_empty", PasswordHash: "x", RealName: "PA3", Status: 1}
	require.NoError(t, db.Create(&user).Error)

	require.NoError(t, svc.AssignGroups(user.ID, []string{"A"}))
	// Clear all groups
	require.NoError(t, svc.AssignGroups(user.ID, []string{}))

	groups, err := svc.GetManagedGroups(user.ID)
	require.NoError(t, err)
	assert.Empty(t, groups)
}

func TestPowerAdminService_ListPowerAdmins(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPowerAdminService(db)

	tenant := model.Tenant{Name: "T4", Code: "tc4", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)
	u1 := model.User{TenantID: tenant.ID, Username: "pa_list1", PasswordHash: "x", RealName: "PA1", Status: 1}
	u2 := model.User{TenantID: tenant.ID, Username: "pa_list2", PasswordHash: "x", RealName: "PA2", Status: 0}
	require.NoError(t, db.Create(&u1).Error)
	require.NoError(t, db.Create(&u2).Error)

	require.NoError(t, svc.AssignGroups(u1.ID, []string{"华北"}))
	require.NoError(t, svc.AssignGroups(u2.ID, []string{"华南"}))

	list, err := svc.ListPowerAdmins()
	require.NoError(t, err)
	assert.Len(t, list, 2)
}

func TestPowerAdminService_GetAllGroups(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPowerAdminService(db)

	// 3 named groups (1 tenant each) + 1 tenant falling into "default" group
	require.NoError(t, db.Create(&model.Tenant{Name: "T_bj", Code: "g_bj", Status: 1, GroupName: "华北"}).Error)
	require.NoError(t, db.Create(&model.Tenant{Name: "T_sh", Code: "g_sh", Status: 1, GroupName: "华南"}).Error)
	require.NoError(t, db.Create(&model.Tenant{Name: "T_cd", Code: "g_cd", Status: 1, GroupName: "西南"}).Error)
	require.NoError(t, db.Create(&model.Tenant{Name: "T_def", Code: "g_def", Status: 1}).Error) // GroupName defaults to "default"

	groups, err := svc.GetAllGroups()
	require.NoError(t, err)

	byName := make(map[string]service.GroupInfo)
	for _, g := range groups {
		byName[g.Name] = g
	}
	assert.Equal(t, 1, byName["华北"].Count, "华北 should have 1 tenant")
	assert.Equal(t, 1, byName["华南"].Count, "华南 should have 1 tenant")
	assert.Equal(t, 1, byName["西南"].Count, "西南 should have 1 tenant")
	assert.Equal(t, 1, byName["default"].Count, "default group should have 1 tenant")
}
