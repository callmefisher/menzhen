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

func init() {
	gin.SetMode(gin.TestMode)
}

func TestTenantScope_FiltersCorrectly(t *testing.T) {
	db := testutil.SetupTestDB(t)

	tenantA := testutil.SeedTestTenant(t, db, "Clinic A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "Clinic B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "userA", "pass", nil)
	userB, _ := testutil.SeedTestUser(t, db, tenantB.ID, "userB", "pass", nil)
	testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "Patient A")
	testutil.SeedTestPatient(t, db, tenantB.ID, userB.ID, "Patient B")

	// Query with tenant A scope — should only see Patient A
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxKeyTenantID, tenantA.ID)

	var patients []model.Patient
	err := db.Scopes(middleware.TenantScope(c)).Find(&patients).Error
	assert.NoError(t, err)
	assert.Len(t, patients, 1)
	assert.Equal(t, "Patient A", patients[0].Name)
}

func TestTenantScope_CrossTenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)

	tenantA := testutil.SeedTestTenant(t, db, "Clinic A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "Clinic B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "userA", "pass", nil)
	userB, _ := testutil.SeedTestUser(t, db, tenantB.ID, "userB", "pass", nil)
	testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "Patient A")
	testutil.SeedTestPatient(t, db, tenantB.ID, userB.ID, "Patient B")

	// Query with tenant B scope — should only see Patient B
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxKeyTenantID, tenantB.ID)

	var patients []model.Patient
	err := db.Scopes(middleware.TenantScope(c)).Find(&patients).Error
	assert.NoError(t, err)
	assert.Len(t, patients, 1)
	assert.Equal(t, "Patient B", patients[0].Name)
}

func TestTenantScope_NoTenantID_ReturnsEmpty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "Clinic A", "clinic-a")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "userA", "pass", nil)
	testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "Patient A")

	// No tenant_id set — TenantScope uses tenant_id = 0 → empty result
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	var patients []model.Patient
	err := db.Scopes(middleware.TenantScope(c)).Find(&patients).Error
	assert.NoError(t, err)
	assert.Len(t, patients, 0)
}
