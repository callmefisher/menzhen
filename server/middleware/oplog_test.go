package middleware_test

import (
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestLogOperation_CreatesRecord(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxKeyUserID, user.ID)
	c.Set(middleware.CtxKeyTenantID, tenant.ID)
	c.Set(middleware.CtxKeyUsername, "admin")

	middleware.LogOperation(db, c, "create", "patient", 1, nil, map[string]string{"name": "张三"})

	var log model.OpLog
	err := db.First(&log).Error
	assert.NoError(t, err)
	assert.Equal(t, tenant.ID, log.TenantID)
	assert.Equal(t, user.ID, log.UserID)
	assert.Equal(t, "create", log.Action)
	assert.Equal(t, "patient", log.ResourceType)
	assert.Equal(t, uint64(1), log.ResourceID)
}

func TestLogOperation_UsesRealName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass", nil)
	db.Model(user).Update("real_name", "管理员")

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxKeyUserID, user.ID)
	c.Set(middleware.CtxKeyTenantID, tenant.ID)
	c.Set(middleware.CtxKeyUsername, "admin")

	middleware.LogOperation(db, c, "update", "patient", 1, nil, nil)

	var log model.OpLog
	db.First(&log)
	assert.Equal(t, "管理员", log.UserName)
}

func TestLogOperation_WithOldAndNewData(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxKeyUserID, user.ID)
	c.Set(middleware.CtxKeyTenantID, tenant.ID)
	c.Set(middleware.CtxKeyUsername, "admin")

	oldData := map[string]string{"name": "旧名"}
	newData := map[string]string{"name": "新名"}
	middleware.LogOperation(db, c, "update", "patient", 1, oldData, newData)

	var log model.OpLog
	err := db.First(&log).Error
	assert.NoError(t, err)
	assert.NotNil(t, log.OldData)
	assert.NotNil(t, log.NewData)
	assert.Contains(t, string(log.OldData), "旧名")
	assert.Contains(t, string(log.NewData), "新名")
}

func TestLogOperation_NilData(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxKeyUserID, user.ID)
	c.Set(middleware.CtxKeyTenantID, tenant.ID)
	c.Set(middleware.CtxKeyUsername, "admin")

	middleware.LogOperation(db, c, "delete", "patient", 1, nil, nil)

	var log model.OpLog
	err := db.First(&log).Error
	assert.NoError(t, err)
	assert.Equal(t, "delete", log.Action)
}
