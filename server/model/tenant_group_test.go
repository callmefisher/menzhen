package model_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTenantGroupName_DefaultIsDefault(t *testing.T) {
	db := testutil.SetupTestDB(t)

	tenant := model.Tenant{
		Name:   "测试诊所",
		Code:   "test001",
		Status: 1,
		// GroupName not set, should default to "default"
	}
	require.NoError(t, db.Create(&tenant).Error)

	var loaded model.Tenant
	require.NoError(t, db.First(&loaded, tenant.ID).Error)
	assert.Equal(t, "default", loaded.GroupName)
}

func TestTenantGroupName_CanSetCustomGroup(t *testing.T) {
	db := testutil.SetupTestDB(t)

	tenant := model.Tenant{
		Name:      "华北诊所",
		Code:      "north001",
		Status:    1,
		GroupName: "华北分组",
	}
	require.NoError(t, db.Create(&tenant).Error)

	var loaded model.Tenant
	require.NoError(t, db.First(&loaded, tenant.ID).Error)
	assert.Equal(t, "华北分组", loaded.GroupName)
}
