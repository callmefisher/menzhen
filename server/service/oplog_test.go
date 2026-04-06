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
	logs, total, err := svc.QueryOpLogs(tenant.ID, nil, 0, "", "", "", 1, 10)
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

	logs, _, err := svc.QueryOpLogs(tenant.ID, nil, 0, "", "", "", 1, 10)
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
	logs, total, err := svc.QueryOpLogs(tenant.ID, nil, 0, "", "", "", 1, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, logs, 2)

	// Page 2 of 2
	logs2, _, err := svc.QueryOpLogs(tenant.ID, nil, 0, "", "", "", 2, 2)
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

	logs, total, err := svc.QueryOpLogs(tenant.ID, nil, 0, "张", "", "", 1, 10)
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
	logs, total, err := svc.QueryOpLogs(tenant.ID, nil, 0, "", today, today, 1, 10)
	assert.NoError(t, err)
	assert.True(t, total >= 1)
	assert.True(t, len(logs) >= 1)

	// Querying a past date range should find nothing
	logs, total, err = svc.QueryOpLogs(tenant.ID, nil, 0, "", "2020-01-01", "2020-01-02", 1, 10)
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
	logs, total, err := svc.QueryOpLogs(tenant2.ID, nil, 0, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, logs, 0)
}

func TestOpLogService_DeleteOpLog_Success(t *testing.T) {
	svc, tenant, user := setupOpLogService(t)

	err := svc.CreateOpLog(tenant.ID, user.ID, user.RealName, "create", "patient", 1, nil, nil)
	assert.NoError(t, err)

	logs, _, err := svc.QueryOpLogs(tenant.ID, nil, 0, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Len(t, logs, 1)

	err = svc.DeleteOpLog(tenant.ID, nil, logs[0].ID)
	assert.NoError(t, err)

	// Verify deleted
	logs, total, err := svc.QueryOpLogs(tenant.ID, nil, 0, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, logs, 0)
}

func TestOpLogService_DeleteOpLog_NotFound(t *testing.T) {
	svc, tenant, _ := setupOpLogService(t)

	err := svc.DeleteOpLog(tenant.ID, nil, 99999)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

func TestOpLogService_BatchDeleteOpLogs(t *testing.T) {
	svc, tenant, user := setupOpLogService(t)

	// Create 3 logs
	for i := 0; i < 3; i++ {
		err := svc.CreateOpLog(tenant.ID, user.ID, user.RealName, "create", "patient", uint64(i+1), nil, nil)
		assert.NoError(t, err)
	}

	logs, _, err := svc.QueryOpLogs(tenant.ID, nil, 0, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Len(t, logs, 3)

	// Delete first 2
	ids := []uint64{logs[0].ID, logs[1].ID}
	affected, err := svc.BatchDeleteOpLogs(tenant.ID, nil, ids)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), affected)

	// Verify 1 remaining
	logs, total, err := svc.QueryOpLogs(tenant.ID, nil, 0, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, logs, 1)
}

func TestOpLogService_QueryOpLogs_GlobalQuery(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", nil)
	svc := service.NewOpLogService(db)

	err := svc.CreateOpLog(tenant1.ID, user1.ID, "医生1", "create", "patient", 1, nil, nil)
	assert.NoError(t, err)
	err = svc.CreateOpLog(tenant2.ID, user2.ID, "医生2", "update", "patient", 2, nil, nil)
	assert.NoError(t, err)

	// Global query (tenantID=0, nil groups): should return all logs across tenants.
	logs, total, err := svc.QueryOpLogs(0, nil, 0, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, logs, 2)

	// Verify Tenant is preloaded.
	tenantIDs := map[uint64]bool{}
	for _, l := range logs {
		tenantIDs[l.TenantID] = true
		assert.NotEmpty(t, l.Tenant.Name, "Tenant should be preloaded in global query")
	}
	assert.True(t, tenantIDs[tenant1.ID], "should contain logs from tenant1")
	assert.True(t, tenantIDs[tenant2.ID], "should contain logs from tenant2")
}

func TestOpLogService_QueryOpLogs_GlobalQuery_WithNameFilter(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a2")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b2")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", nil)
	svc := service.NewOpLogService(db)

	err := svc.CreateOpLog(tenant1.ID, user1.ID, "张三", "create", "patient", 1, nil, nil)
	assert.NoError(t, err)
	err = svc.CreateOpLog(tenant2.ID, user2.ID, "李四", "update", "patient", 2, nil, nil)
	assert.NoError(t, err)

	// Global query with name filter should still work across tenants.
	logs, total, err := svc.QueryOpLogs(0, nil, 0, "张", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, logs, 1)
	assert.Equal(t, "张三", logs[0].UserName)
	assert.Equal(t, tenant1.ID, logs[0].TenantID)
}

func TestOpLogService_QueryOpLogs_SuperAdmin_FilterByTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所甲", "clinic-jiap")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所乙", "clinic-yip")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", nil)
	svc := service.NewOpLogService(db)

	err := svc.CreateOpLog(tenant1.ID, user1.ID, "医生甲", "create", "patient", 1, nil, nil)
	assert.NoError(t, err)
	err = svc.CreateOpLog(tenant2.ID, user2.ID, "医生乙", "update", "patient", 2, nil, nil)
	assert.NoError(t, err)

	// Super admin filtered to tenant1 only.
	logs, total, err := svc.QueryOpLogs(0, nil, tenant1.ID, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, logs, 1)
	assert.Equal(t, tenant1.ID, logs[0].TenantID)
	assert.NotEmpty(t, logs[0].Tenant.Name, "Tenant should be preloaded")
}

func TestOpLogService_QueryOpLogs_PowerAdmin_ManagedGroups(t *testing.T) {
	db := testutil.SetupTestDB(t)
	// Two tenants in "华北" group, one in "华南" group.
	tenant1 := testutil.SeedTestTenant(t, db, "北京诊所", "clinic-bj")
	tenant2 := testutil.SeedTestTenant(t, db, "天津诊所", "clinic-tj")
	tenant3 := testutil.SeedTestTenant(t, db, "广州诊所", "clinic-gz")
	db.Model(tenant1).Update("group_name", "华北")
	db.Model(tenant2).Update("group_name", "华北")
	db.Model(tenant3).Update("group_name", "华南")

	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", nil)
	user3, _ := testutil.SeedTestUser(t, db, tenant3.ID, "doc3", "pass", nil)
	svc := service.NewOpLogService(db)

	_ = svc.CreateOpLog(tenant1.ID, user1.ID, "北京医生", "create", "patient", 1, nil, nil)
	_ = svc.CreateOpLog(tenant2.ID, user2.ID, "天津医生", "create", "patient", 2, nil, nil)
	_ = svc.CreateOpLog(tenant3.ID, user3.ID, "广州医生", "create", "patient", 3, nil, nil)

	// Power admin managing "华北": should see only tenant1 and tenant2 logs.
	logs, total, err := svc.QueryOpLogs(0, []string{"华北"}, 0, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, logs, 2)
	for _, l := range logs {
		assert.NotEqual(t, tenant3.ID, l.TenantID, "should not see 华南 tenant")
		assert.NotEmpty(t, l.Tenant.Name, "Tenant should be preloaded")
	}
}

func TestOpLogService_QueryOpLogs_PowerAdmin_FilterByTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "北京诊所2", "clinic-bj2")
	tenant2 := testutil.SeedTestTenant(t, db, "天津诊所2", "clinic-tj2")
	db.Model(tenant1).Update("group_name", "华北")
	db.Model(tenant2).Update("group_name", "华北")

	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", nil)
	svc := service.NewOpLogService(db)

	_ = svc.CreateOpLog(tenant1.ID, user1.ID, "北京医生", "create", "patient", 1, nil, nil)
	_ = svc.CreateOpLog(tenant2.ID, user2.ID, "天津医生", "update", "patient", 2, nil, nil)

	// Power admin managing "华北" filtered to tenant1 only.
	logs, total, err := svc.QueryOpLogs(0, []string{"华北"}, tenant1.ID, "", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, logs, 1)
	assert.Equal(t, tenant1.ID, logs[0].TenantID)
}

func TestOpLogService_DeleteOpLog_SuperAdmin_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所SA1", "clinic-sa1")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所SA2", "clinic-sa2")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	svc := service.NewOpLogService(db)

	err := svc.CreateOpLog(tenant1.ID, user1.ID, "医生1", "create", "patient", 1, nil, nil)
	assert.NoError(t, err)

	logs, _, _ := svc.QueryOpLogs(tenant1.ID, nil, 0, "", "", "", 1, 10)
	assert.Len(t, logs, 1)
	logID := logs[0].ID

	// Super admin (tenantID=0, nil managedGroups) must be able to delete the log
	// regardless of which tenant it belongs to.
	err = svc.DeleteOpLog(0, nil, logID)
	assert.NoError(t, err)

	// Verify gone
	remaining, total, _ := svc.QueryOpLogs(tenant1.ID, nil, 0, "", "", "", 1, 10)
	assert.Equal(t, int64(0), total)
	assert.Len(t, remaining, 0)

	// Tenant 2 is unaffected
	_ = tenant2
}

func TestOpLogService_BatchDeleteOpLogs_SuperAdmin_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所BA1", "clinic-ba1")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所BA2", "clinic-ba2")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", nil)
	svc := service.NewOpLogService(db)

	_ = svc.CreateOpLog(tenant1.ID, user1.ID, "医生1", "create", "patient", 1, nil, nil)
	_ = svc.CreateOpLog(tenant2.ID, user2.ID, "医生2", "create", "patient", 2, nil, nil)

	logs1, _, _ := svc.QueryOpLogs(tenant1.ID, nil, 0, "", "", "", 1, 10)
	logs2, _, _ := svc.QueryOpLogs(tenant2.ID, nil, 0, "", "", "", 1, 10)
	assert.Len(t, logs1, 1)
	assert.Len(t, logs2, 1)

	// Super admin deletes logs from both tenants at once.
	ids := []uint64{logs1[0].ID, logs2[0].ID}
	affected, err := svc.BatchDeleteOpLogs(0, nil, ids)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), affected)

	// Both tenants should have 0 logs remaining.
	_, total1, _ := svc.QueryOpLogs(tenant1.ID, nil, 0, "", "", "", 1, 10)
	_, total2, _ := svc.QueryOpLogs(tenant2.ID, nil, 0, "", "", "", 1, 10)
	assert.Equal(t, int64(0), total1)
	assert.Equal(t, int64(0), total2)
}

func TestOpLogService_DeleteOpLog_PowerAdmin_ManagedGroups(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "PA诊所1", "clinic-pa1")
	tenant2 := testutil.SeedTestTenant(t, db, "PA诊所2", "clinic-pa2")
	db.Model(tenant1).Update("group_name", "华东")
	db.Model(tenant2).Update("group_name", "华西")

	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", nil)
	svc := service.NewOpLogService(db)

	_ = svc.CreateOpLog(tenant1.ID, user1.ID, "华东医生", "create", "patient", 1, nil, nil)
	_ = svc.CreateOpLog(tenant2.ID, user2.ID, "华西医生", "create", "patient", 2, nil, nil)

	logs1, _, _ := svc.QueryOpLogs(tenant1.ID, nil, 0, "", "", "", 1, 10)
	logs2, _, _ := svc.QueryOpLogs(tenant2.ID, nil, 0, "", "", "", 1, 10)

	// Power admin managing "华东" can delete tenant1's log.
	err := svc.DeleteOpLog(0, []string{"华东"}, logs1[0].ID)
	assert.NoError(t, err)

	// Power admin managing "华东" cannot delete tenant2's log (华西).
	err = svc.DeleteOpLog(0, []string{"华东"}, logs2[0].ID)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)

	// tenant2 log is still there.
	_, total2, _ := svc.QueryOpLogs(tenant2.ID, nil, 0, "", "", "", 1, 10)
	assert.Equal(t, int64(1), total2)
}
