package service_test

import (
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
)

func setupOpLogService(t *testing.T) (*service.OpLogService, *model.Tenant, *model.User) {
	db := testutil.SetupTestDB(t)
	tenant, user, _ := testutil.SeedAdminUser(t, db)
	svc := service.NewOpLogService(db)
	return svc, tenant, user
}

func TestOpLogService_CreateOpLog_Success(t *testing.T) {
	svc, tenant, user := setupOpLogService(t)

	err := svc.CreateOpLog(tenant.ID, user.ID, user.RealName, "create", "patient", 1, nil, nil)
	assert.NoError(t, err)

	// Verify created
	logs, total, err := svc.QueryOpLogs(tenant.ID, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, logs, 1)
	assert.Equal(t, "create", logs[0].Action)
	assert.Equal(t, "patient", logs[0].ResourceType)
}

func TestOpLogService_CreateOpLog_WithData(t *testing.T) {
	svc, tenant, user := setupOpLogService(t)

	oldData := map[string]interface{}{"name": "旧名称"}
	newData := map[string]interface{}{"name": "新名称"}

	err := svc.CreateOpLog(tenant.ID, user.ID, user.RealName, "update", "patient", 1, oldData, newData)
	assert.NoError(t, err)

	logs, _, err := svc.QueryOpLogs(tenant.ID, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.NotNil(t, logs[0].OldData)
	assert.NotNil(t, logs[0].NewData)
	assert.Contains(t, string(logs[0].OldData), "旧名称")
	assert.Contains(t, string(logs[0].NewData), "新名称")
}

func TestOpLogService_QueryOpLogs_Pagination(t *testing.T) {
	svc, tenant, user := setupOpLogService(t)

	// Create 5 logs
	for i := 0; i < 5; i++ {
		err := svc.CreateOpLog(tenant.ID, user.ID, user.RealName, "create", "patient", uint64(i+1), nil, nil)
		assert.NoError(t, err)
	}

	// Page 1 of 2
	logs, total, err := svc.QueryOpLogs(tenant.ID, "", "", "", 1, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, logs, 2)

	// Page 2 of 2
	logs2, _, err := svc.QueryOpLogs(tenant.ID, "", "", "", 2, 2)
	assert.NoError(t, err)
	assert.Len(t, logs2, 2)
	assert.NotEqual(t, logs[0].ID, logs2[0].ID)
}

func TestOpLogService_QueryOpLogs_FilterByName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user1, _ := testutil.SeedTestUser(t, db, tenant.ID, "zhangsan", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant.ID, "lisi", "pass", nil)
	svc := service.NewOpLogService(db)

	// Create logs with different user names
	err := svc.CreateOpLog(tenant.ID, user1.ID, "张三", "create", "patient", 1, nil, nil)
	assert.NoError(t, err)
	err = svc.CreateOpLog(tenant.ID, user2.ID, "李四", "update", "patient", 2, nil, nil)
	assert.NoError(t, err)

	logs, total, err := svc.QueryOpLogs(tenant.ID, "张", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, logs, 1)
	assert.Equal(t, "张三", logs[0].UserName)
}

func TestOpLogService_QueryOpLogs_FilterByDate(t *testing.T) {
	svc, tenant, user := setupOpLogService(t)

	err := svc.CreateOpLog(tenant.ID, user.ID, user.RealName, "create", "patient", 1, nil, nil)
	assert.NoError(t, err)

	today := time.Now().Format("2006-01-02")

	// Querying today should find the log
	logs, total, err := svc.QueryOpLogs(tenant.ID, "", today, today, 1, 10)
	assert.NoError(t, err)
	assert.True(t, total >= 1)
	assert.True(t, len(logs) >= 1)

	// Querying a past date range should find nothing
	logs, total, err = svc.QueryOpLogs(tenant.ID, "", "2020-01-01", "2020-01-02", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, logs, 0)
}

func TestOpLogService_QueryOpLogs_TenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所1", "clinic-1")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所2", "clinic-2")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "admin1", "pass", nil)
	svc := service.NewOpLogService(db)

	err := svc.CreateOpLog(tenant1.ID, user1.ID, "admin", "create", "patient", 1, nil, nil)
	assert.NoError(t, err)

	// Tenant 2 should not see tenant 1's logs
	logs, total, err := svc.QueryOpLogs(tenant2.ID, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, logs, 0)
}

func TestOpLogService_DeleteOpLog_Success(t *testing.T) {
	svc, tenant, user := setupOpLogService(t)

	err := svc.CreateOpLog(tenant.ID, user.ID, user.RealName, "create", "patient", 1, nil, nil)
	assert.NoError(t, err)

	logs, _, err := svc.QueryOpLogs(tenant.ID, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Len(t, logs, 1)

	err = svc.DeleteOpLog(tenant.ID, logs[0].ID)
	assert.NoError(t, err)

	// Verify deleted
	logs, total, err := svc.QueryOpLogs(tenant.ID, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, logs, 0)
}

func TestOpLogService_DeleteOpLog_NotFound(t *testing.T) {
	svc, tenant, _ := setupOpLogService(t)

	err := svc.DeleteOpLog(tenant.ID, 99999)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

func TestOpLogService_BatchDeleteOpLogs(t *testing.T) {
	svc, tenant, user := setupOpLogService(t)

	// Create 3 logs
	for i := 0; i < 3; i++ {
		err := svc.CreateOpLog(tenant.ID, user.ID, user.RealName, "create", "patient", uint64(i+1), nil, nil)
		assert.NoError(t, err)
	}

	logs, _, err := svc.QueryOpLogs(tenant.ID, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Len(t, logs, 3)

	// Delete first 2
	ids := []uint64{logs[0].ID, logs[1].ID}
	affected, err := svc.BatchDeleteOpLogs(tenant.ID, ids)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), affected)

	// Verify 1 remaining
	logs, total, err := svc.QueryOpLogs(tenant.ID, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, logs, 1)
}
