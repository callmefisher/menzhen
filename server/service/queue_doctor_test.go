package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// makeQueueDoctorSvc creates a QueueDoctorService backed by a fresh test DB with one tenant.
func makeQueueDoctorSvc(t *testing.T) (*service.QueueDoctorService, uint) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "qd-single-"+t.Name())
	return service.NewQueueDoctorService(db), uint(tenant.ID)
}

// makeQueueDoctorSvcTwoTenants creates a QueueDoctorService with two tenants for isolation tests.
func makeQueueDoctorSvcTwoTenants(t *testing.T) (*service.QueueDoctorService, uint, uint) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "qd-tenant-a-"+t.Name())
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "qd-tenant-b-"+t.Name())
	return service.NewQueueDoctorService(db), uint(tenantA.ID), uint(tenantB.ID)
}

// newDoc is a helper to build a QueueDoctor for tests.
func newDoc(tenantID, userID uint, room string) *model.QueueDoctor {
	return &model.QueueDoctor{
		TenantID: tenantID,
		UserID:   userID,
		Room:     room,
		Enabled:  true,
	}
}

// TestQueueDoctorCreate verifies normal creation and that sort_order auto-increments.
func TestQueueDoctorCreate(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	doc1 := newDoc(tenantID, 1, "1诊室")
	require.NoError(t, svc.Create(doc1))
	assert.Equal(t, 1, doc1.SortOrder, "first doctor should have sort_order=1")
	assert.NotZero(t, doc1.ID)

	doc2 := newDoc(tenantID, 2, "2诊室")
	require.NoError(t, svc.Create(doc2))
	assert.Equal(t, 2, doc2.SortOrder, "second doctor should have sort_order=2")

	doc3 := newDoc(tenantID, 3, "3诊室")
	require.NoError(t, svc.Create(doc3))
	assert.Equal(t, 3, doc3.SortOrder, "third doctor should have sort_order=3")
}

// TestQueueDoctorCreateDuplicate verifies that creating the same user twice returns ErrQueueDoctorDuplicate.
func TestQueueDoctorCreateDuplicate(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	doc := newDoc(tenantID, 10, "1诊室")
	require.NoError(t, svc.Create(doc))

	dup := newDoc(tenantID, 10, "2诊室")
	err := svc.Create(dup)
	assert.ErrorIs(t, err, service.ErrQueueDoctorDuplicate)
}

// TestQueueDoctorList verifies that List returns all doctors ordered by sort_order ASC.
func TestQueueDoctorList(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	require.NoError(t, svc.Create(newDoc(tenantID, 1, "1诊室")))
	require.NoError(t, svc.Create(newDoc(tenantID, 2, "2诊室")))
	require.NoError(t, svc.Create(newDoc(tenantID, 3, "3诊室")))

	docs, err := svc.List(tenantID)
	require.NoError(t, err)
	assert.Len(t, docs, 3)

	// Verify ascending sort_order.
	for i := 1; i < len(docs); i++ {
		assert.LessOrEqual(t, docs[i-1].SortOrder, docs[i].SortOrder,
			"docs should be ordered by sort_order ASC")
	}
}

// TestQueueDoctorListEnabled verifies that ListEnabled returns only enabled=true doctors.
func TestQueueDoctorListEnabled(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	// Create two enabled and one disabled.
	require.NoError(t, svc.Create(newDoc(tenantID, 1, "1诊室")))
	require.NoError(t, svc.Create(newDoc(tenantID, 2, "2诊室")))
	doc3 := newDoc(tenantID, 3, "3诊室")
	require.NoError(t, svc.Create(doc3))
	// Disable doc3.
	_, err := svc.Update(tenantID, doc3.ID, "3诊室", false)
	require.NoError(t, err)

	enabled, err := svc.ListEnabled(tenantID)
	require.NoError(t, err)
	assert.Len(t, enabled, 2, "only enabled doctors should be returned")
	for _, d := range enabled {
		assert.True(t, d.Enabled)
	}
}

// TestQueueDoctorUpdate verifies modifying room and enabled status.
func TestQueueDoctorUpdate(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	doc := newDoc(tenantID, 1, "1诊室")
	require.NoError(t, svc.Create(doc))

	updated, err := svc.Update(tenantID, doc.ID, "VIP诊室", false)
	require.NoError(t, err)
	require.NotNil(t, updated)
	assert.Equal(t, "VIP诊室", updated.Room)
	assert.False(t, updated.Enabled)
}

// TestQueueDoctorUpdateNotFound verifies that updating a non-existent ID returns ErrQueueDoctorNotFound.
func TestQueueDoctorUpdateNotFound(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	_, err := svc.Update(tenantID, 99999, "诊室", true)
	assert.ErrorIs(t, err, service.ErrQueueDoctorNotFound)
}

// TestQueueDoctorDelete verifies that a doctor can be deleted and no longer appears in List.
func TestQueueDoctorDelete(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	doc := newDoc(tenantID, 1, "1诊室")
	require.NoError(t, svc.Create(doc))

	err := svc.Delete(tenantID, doc.ID)
	require.NoError(t, err)

	docs, err := svc.List(tenantID)
	require.NoError(t, err)
	assert.Len(t, docs, 0, "deleted doctor should not appear in List")
}

// TestQueueDoctorDeleteNotFound verifies that deleting a non-existent ID returns ErrQueueDoctorNotFound.
func TestQueueDoctorDeleteNotFound(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	err := svc.Delete(tenantID, 99999)
	assert.ErrorIs(t, err, service.ErrQueueDoctorNotFound)
}

// TestQueueDoctorUpdateSort verifies batch sort_order update.
func TestQueueDoctorUpdateSort(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	doc1 := newDoc(tenantID, 1, "1诊室")
	doc2 := newDoc(tenantID, 2, "2诊室")
	doc3 := newDoc(tenantID, 3, "3诊室")
	require.NoError(t, svc.Create(doc1))
	require.NoError(t, svc.Create(doc2))
	require.NoError(t, svc.Create(doc3))

	// Reverse the order: doc3=1, doc2=2, doc1=3.
	orders := []service.SortOrder{
		{ID: doc3.ID, SortOrder: 1},
		{ID: doc2.ID, SortOrder: 2},
		{ID: doc1.ID, SortOrder: 3},
	}
	require.NoError(t, svc.UpdateSort(tenantID, orders))

	docs, err := svc.List(tenantID)
	require.NoError(t, err)
	require.Len(t, docs, 3)
	// After reversal, the first in list should be doc3.
	assert.Equal(t, doc3.ID, docs[0].ID, "doc3 should be first after sort update")
	assert.Equal(t, doc2.ID, docs[1].ID)
	assert.Equal(t, doc1.ID, docs[2].ID)
}

// TestQueueDoctorTenantIsolation verifies that each tenant only sees its own doctors.
func TestQueueDoctorTenantIsolation(t *testing.T) {
	svc, tenantA, tenantB := makeQueueDoctorSvcTwoTenants(t)

	// Add two doctors to tenant A and one to tenant B.
	require.NoError(t, svc.Create(newDoc(tenantA, 1, "A-1诊室")))
	require.NoError(t, svc.Create(newDoc(tenantA, 2, "A-2诊室")))
	require.NoError(t, svc.Create(newDoc(tenantB, 3, "B-1诊室")))

	docsA, err := svc.List(tenantA)
	require.NoError(t, err)
	assert.Len(t, docsA, 2, "tenant A should see only its own doctors")
	for _, d := range docsA {
		assert.Equal(t, tenantA, d.TenantID)
	}

	docsB, err := svc.List(tenantB)
	require.NoError(t, err)
	assert.Len(t, docsB, 1, "tenant B should see only its own doctor")
	assert.Equal(t, tenantB, docsB[0].TenantID)
}

// TestQueueEnabled verifies GetQueueEnabled and SetQueueEnabled round-trip.
func TestQueueEnabled(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	// Initially should be true (default).
	enabled, err := svc.GetQueueEnabled(tenantID)
	require.NoError(t, err)
	assert.True(t, enabled, "queue should be enabled by default")

	// Disable it.
	require.NoError(t, svc.SetQueueEnabled(tenantID, false))
	enabled, err = svc.GetQueueEnabled(tenantID)
	require.NoError(t, err)
	assert.False(t, enabled, "queue should be disabled after SetQueueEnabled(false)")

	// Re-enable it.
	require.NoError(t, svc.SetQueueEnabled(tenantID, true))
	enabled, err = svc.GetQueueEnabled(tenantID)
	require.NoError(t, err)
	assert.True(t, enabled, "queue should be enabled after SetQueueEnabled(true)")
}

// TestQueueEnabledDefault verifies that GetQueueEnabled returns true when queue_enabled is NULL.
func TestQueueEnabledDefault(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所NULL", "qd-null-"+t.Name())

	// Explicitly set queue_enabled to NULL to simulate old rows before migration.
	require.NoError(t, db.Model(&model.Tenant{}).Where("id = ?", tenant.ID).
		Update("queue_enabled", nil).Error)

	svc := service.NewQueueDoctorService(db)
	enabled, err := svc.GetQueueEnabled(uint(tenant.ID))
	require.NoError(t, err)
	assert.True(t, enabled, "NULL queue_enabled should default to true")
}

// TestQueueEnabledNotFound verifies that GetQueueEnabled returns ErrTenantNotFound for unknown tenant.
func TestQueueEnabledNotFound(t *testing.T) {
	svc, _ := makeQueueDoctorSvc(t)

	_, err := svc.GetQueueEnabled(99999)
	assert.ErrorIs(t, err, service.ErrTenantNotFound)
}

// TestQueueDoctorUpdateSortOtherTenantIgnored verifies UpdateSort ignores records from other tenants.
func TestQueueDoctorUpdateSortOtherTenantIgnored(t *testing.T) {
	svc, tenantA, tenantB := makeQueueDoctorSvcTwoTenants(t)

	docA := newDoc(tenantA, 1, "A-1诊室")
	docB := newDoc(tenantB, 2, "B-1诊室")
	require.NoError(t, svc.Create(docA))
	require.NoError(t, svc.Create(docB))

	// tenantA tries to update sort_order of docB (belongs to tenantB) — should be a no-op.
	orders := []service.SortOrder{
		{ID: docB.ID, SortOrder: 99},
	}
	require.NoError(t, svc.UpdateSort(tenantA, orders))

	docsB, err := svc.List(tenantB)
	require.NoError(t, err)
	require.Len(t, docsB, 1)
	assert.NotEqual(t, 99, docsB[0].SortOrder, "other tenant's sort_order must not be modified")
}

// TestGetCallDisplayDuration_Default verifies the default value (10) when the column is NULL.
func TestGetCallDisplayDuration_Default(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所NULL", "qd-calldur-null-"+t.Name())

	// Explicitly set call_display_duration to NULL to simulate old rows.
	require.NoError(t, db.Model(&model.Tenant{}).Where("id = ?", tenant.ID).
		Update("call_display_duration", nil).Error)

	svc := service.NewQueueDoctorService(db)
	seconds, err := svc.GetCallDisplayDuration(uint(tenant.ID))
	require.NoError(t, err)
	assert.Equal(t, 10, seconds, "NULL call_display_duration should default to 10")
}

// TestGetCallDisplayDuration_Custom verifies that a saved value is returned correctly.
func TestGetCallDisplayDuration_Custom(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	require.NoError(t, svc.SetCallDisplayDuration(tenantID, 30))
	seconds, err := svc.GetCallDisplayDuration(tenantID)
	require.NoError(t, err)
	assert.Equal(t, 30, seconds)
}

// TestSetCallDisplayDuration_Valid verifies that a valid duration is saved.
func TestSetCallDisplayDuration_Valid(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	for _, v := range []int{3, 10, 30, 60} {
		require.NoError(t, svc.SetCallDisplayDuration(tenantID, v), "value %d should be valid", v)
		got, err := svc.GetCallDisplayDuration(tenantID)
		require.NoError(t, err)
		assert.Equal(t, v, got)
	}
}

// TestSetCallDisplayDuration_OutOfRange verifies that values outside 3–60 are rejected.
func TestSetCallDisplayDuration_OutOfRange(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	for _, v := range []int{0, 1, 2, 61, 100} {
		err := svc.SetCallDisplayDuration(tenantID, v)
		assert.ErrorIs(t, err, service.ErrCallDurationOutOfRange, "value %d should be out of range", v)
	}
}

// TestSetCallDisplayDuration_NotFound verifies ErrTenantNotFound for unknown tenant.
func TestSetCallDisplayDuration_NotFound(t *testing.T) {
	svc, _ := makeQueueDoctorSvc(t)

	err := svc.SetCallDisplayDuration(99999, 10)
	assert.ErrorIs(t, err, service.ErrTenantNotFound)
}

// TestGetCallDisplayDuration_NotFound verifies ErrTenantNotFound for unknown tenant.
func TestGetCallDisplayDuration_NotFound(t *testing.T) {
	svc, _ := makeQueueDoctorSvc(t)

	_, err := svc.GetCallDisplayDuration(99999)
	assert.ErrorIs(t, err, service.ErrTenantNotFound)
}

// TestGetShowArrivalTime_Default verifies the default value (true) when the column is NULL.
func TestGetShowArrivalTime_Default(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所NULL", "qd-showat-null-"+t.Name())

	// Explicitly set show_arrival_time to NULL to simulate old rows.
	require.NoError(t, db.Model(&model.Tenant{}).Where("id = ?", tenant.ID).
		Update("show_arrival_time", nil).Error)

	svc := service.NewQueueDoctorService(db)
	show, err := svc.GetShowArrivalTime(uint(tenant.ID))
	require.NoError(t, err)
	assert.True(t, show, "NULL show_arrival_time should default to true")
}

// TestShowArrivalTime_RoundTrip verifies Set → Get round-trip for both true and false.
func TestShowArrivalTime_RoundTrip(t *testing.T) {
	svc, tenantID := makeQueueDoctorSvc(t)

	for _, val := range []bool{false, true, false} {
		require.NoError(t, svc.SetShowArrivalTime(tenantID, val))
		got, err := svc.GetShowArrivalTime(tenantID)
		require.NoError(t, err)
		assert.Equal(t, val, got, "GetShowArrivalTime should return %v after SetShowArrivalTime(%v)", val, val)
	}
}

// TestSetShowArrivalTime_NotFound verifies ErrTenantNotFound for unknown tenant.
func TestSetShowArrivalTime_NotFound(t *testing.T) {
	svc, _ := makeQueueDoctorSvc(t)

	err := svc.SetShowArrivalTime(99999, true)
	assert.ErrorIs(t, err, service.ErrTenantNotFound)
}

// TestGetShowArrivalTime_NotFound verifies ErrTenantNotFound for unknown tenant.
func TestGetShowArrivalTime_NotFound(t *testing.T) {
	svc, _ := makeQueueDoctorSvc(t)

	_, err := svc.GetShowArrivalTime(99999)
	assert.ErrorIs(t, err, service.ErrTenantNotFound)
}
