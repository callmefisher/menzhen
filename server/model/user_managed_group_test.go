package model_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserManagedGroup_CreateAndQuery(t *testing.T) {
	db := testutil.SetupTestDB(t)

	tenant := model.Tenant{Name: "T1", Code: "t1", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)
	user := model.User{TenantID: tenant.ID, Username: "pa1", PasswordHash: "x", RealName: "PA", Status: 1}
	require.NoError(t, db.Create(&user).Error)

	mg := model.UserManagedGroup{UserID: user.ID, GroupName: "华北分组"}
	require.NoError(t, db.Create(&mg).Error)

	var groups []model.UserManagedGroup
	require.NoError(t, db.Where("user_id = ?", user.ID).Find(&groups).Error)
	require.Len(t, groups, 1)
	assert.Equal(t, "华北分组", groups[0].GroupName)
}

func TestUserManagedGroup_UniqueConstraint(t *testing.T) {
	db := testutil.SetupTestDB(t)

	tenant := model.Tenant{Name: "T2", Code: "t2", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)
	user := model.User{TenantID: tenant.ID, Username: "pa2", PasswordHash: "x", RealName: "PA2", Status: 1}
	require.NoError(t, db.Create(&user).Error)

	mg1 := model.UserManagedGroup{UserID: user.ID, GroupName: "华南分组"}
	require.NoError(t, db.Create(&mg1).Error)

	// Duplicate (user_id, group_name) should fail
	mg2 := model.UserManagedGroup{UserID: user.ID, GroupName: "华南分组"}
	err := db.Create(&mg2).Error
	assert.Error(t, err, "duplicate (user_id, group_name) should fail")
}
