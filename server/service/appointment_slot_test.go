package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupSlotService(t *testing.T) (*service.SlotConfigService, uint) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "时间段测试诊所", "slot-test-"+t.Name())
	return service.NewSlotConfigService(db), uint(tenant.ID)
}

// ── Create ────────────────────────────────────────────────────────────────────

func TestSlotCreate_Success(t *testing.T) {
	svc, tid := setupSlotService(t)
	cfg, err := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 0, SlotStart: "09:00", SlotEnd: "09:30", MaxCount: 1,
	})
	require.NoError(t, err)
	assert.Equal(t, "09:00", cfg.SlotStart)
	assert.Equal(t, "09:30", cfg.SlotEnd)
	assert.Equal(t, 1, cfg.MaxCount)
}

func TestSlotCreate_DefaultMaxCount(t *testing.T) {
	svc, tid := setupSlotService(t)
	cfg, err := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 0, SlotStart: "10:00", SlotEnd: "10:30", MaxCount: 0,
	})
	require.NoError(t, err)
	assert.Equal(t, 1, cfg.MaxCount, "MaxCount<=0 should default to 1")
}

func TestSlotCreate_InvalidTimeFormat(t *testing.T) {
	svc, tid := setupSlotService(t)
	_, err := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 0, SlotStart: "9:00", SlotEnd: "09:30",
	})
	assert.ErrorIs(t, err, service.ErrInvalidTimeFormat)
}

func TestSlotCreate_EndBeforeStart(t *testing.T) {
	svc, tid := setupSlotService(t)
	_, err := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 0, SlotStart: "10:00", SlotEnd: "09:00",
	})
	assert.ErrorIs(t, err, service.ErrSlotEndBeforeStart)
}

func TestSlotCreate_EqualStartEnd(t *testing.T) {
	svc, tid := setupSlotService(t)
	_, err := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 0, SlotStart: "09:00", SlotEnd: "09:00",
	})
	assert.ErrorIs(t, err, service.ErrSlotEndBeforeStart)
}

// ── Overlap detection ─────────────────────────────────────────────────────────

func TestSlotCreate_OverlapRejected(t *testing.T) {
	svc, tid := setupSlotService(t)
	_, err := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)

	// Exact overlap
	_, err2 := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30",
	})
	assert.ErrorIs(t, err2, service.ErrSlotOverlap, "exact duplicate should be rejected")

	// Partial overlap (starts in the middle)
	_, err3 := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:15", SlotEnd: "09:45",
	})
	assert.ErrorIs(t, err3, service.ErrSlotOverlap, "partial overlap should be rejected")
}

func TestSlotCreate_AdjacentAllowed(t *testing.T) {
	svc, tid := setupSlotService(t)
	_, err := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)

	// Adjacent (starts exactly when first ends) — must be allowed
	_, err2 := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:30", SlotEnd: "10:00",
	})
	assert.NoError(t, err2, "adjacent slot should be allowed")
}

func TestSlotCreate_DifferentDoctorOverlapAllowed(t *testing.T) {
	svc, tid := setupSlotService(t)
	_, err := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)

	// Same time window, different doctor — allowed
	_, err2 := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 2, SlotStart: "09:00", SlotEnd: "09:30",
	})
	assert.NoError(t, err2, "same slot for different doctor should be allowed")
}

func TestSlotCreate_CrossTenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "slot-cross-a-"+t.Name())
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "slot-cross-b-"+t.Name())
	svc := service.NewSlotConfigService(db)

	_, err := svc.Create(uint(tenantA.ID), service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)

	// Same doctor_id and slot, different tenant — must be allowed (overlap check is per-tenant)
	_, err2 := svc.Create(uint(tenantB.ID), service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30",
	})
	assert.NoError(t, err2, "same slot config for different tenant should be allowed")
}

// ── Update ────────────────────────────────────────────────────────────────────

func TestSlotUpdate_Success(t *testing.T) {
	svc, tid := setupSlotService(t)
	cfg, err := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30", MaxCount: 1,
	})
	require.NoError(t, err)

	updated, err := svc.Update(tid, cfg.ID, service.UpsertSlotInput{
		SlotStart: "09:00", SlotEnd: "09:30", MaxCount: 3,
	})
	require.NoError(t, err)
	assert.Equal(t, 3, updated.MaxCount)
}

func TestSlotUpdate_OverlapWithOtherSlotRejected(t *testing.T) {
	svc, tid := setupSlotService(t)
	_, _ = svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30",
	})
	cfg2, _ := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 1, SlotStart: "10:00", SlotEnd: "10:30",
	})
	// Try to update cfg2 to overlap with cfg1
	_, err := svc.Update(tid, cfg2.ID, service.UpsertSlotInput{
		SlotStart: "09:15", SlotEnd: "09:45",
	})
	assert.ErrorIs(t, err, service.ErrSlotOverlap)
}

func TestSlotUpdate_NotFound(t *testing.T) {
	svc, tid := setupSlotService(t)
	_, err := svc.Update(tid, 99999, service.UpsertSlotInput{
		SlotStart: "09:00", SlotEnd: "09:30",
	})
	assert.ErrorIs(t, err, service.ErrSlotConfigNotFound)
}

// ── List ──────────────────────────────────────────────────────────────────────

func TestSlotList_GlobalAndDoctorIsolated(t *testing.T) {
	svc, tid := setupSlotService(t)
	// Global slot
	_, _ = svc.Create(tid, service.UpsertSlotInput{DoctorID: 0, SlotStart: "08:00", SlotEnd: "08:30"})
	// Doctor-specific slot
	_, _ = svc.Create(tid, service.UpsertSlotInput{DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30"})

	globalID := uint(0)
	globalList, err := svc.List(tid, &globalID)
	require.NoError(t, err)
	require.Len(t, globalList, 1)
	assert.Equal(t, "08:00", globalList[0].SlotStart)

	doctorID := uint(1)
	doctorList, err := svc.List(tid, &doctorID)
	require.NoError(t, err)
	require.Len(t, doctorList, 1)
	assert.Equal(t, "09:00", doctorList[0].SlotStart)
}

// ── Delete ────────────────────────────────────────────────────────────────────

func TestSlotDelete_Success(t *testing.T) {
	svc, tid := setupSlotService(t)
	cfg, _ := svc.Create(tid, service.UpsertSlotInput{
		DoctorID: 0, SlotStart: "11:00", SlotEnd: "11:30",
	})
	err := svc.Delete(tid, cfg.ID)
	assert.NoError(t, err)

	// Verify it's gone
	list, _ := svc.List(tid, nil)
	for _, s := range list {
		assert.NotEqual(t, cfg.ID, s.ID)
	}
}

func TestSlotDelete_NotFound(t *testing.T) {
	svc, tid := setupSlotService(t)
	err := svc.Delete(tid, 99999)
	assert.ErrorIs(t, err, service.ErrSlotConfigNotFound)
}

func TestSlotDelete_CrossTenantRejected(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "slot-del-a-"+t.Name())
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "slot-del-b-"+t.Name())
	svc := service.NewSlotConfigService(db)

	cfg, _ := svc.Create(uint(tenantA.ID), service.UpsertSlotInput{
		DoctorID: 0, SlotStart: "09:00", SlotEnd: "09:30",
	})

	// Tenant B tries to delete tenant A's config
	err := svc.Delete(uint(tenantB.ID), cfg.ID)
	assert.ErrorIs(t, err, service.ErrSlotConfigNotFound, "cross-tenant delete must return not found")
}
