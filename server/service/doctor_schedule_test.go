package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupScheduleSvc(t *testing.T) (*service.DoctorScheduleService, uint) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "出诊规则测试诊所", "sched-"+t.Name())
	return service.NewDoctorScheduleService(db), uint(tenant.ID)
}

// ── Get ───────────────────────────────────────────────────────────────────────

func TestDoctorScheduleGet_NotExist_ReturnsDefault(t *testing.T) {
	svc, tid := setupScheduleSvc(t)
	cfg, err := svc.Get(tid, 999)
	require.NoError(t, err)
	assert.Equal(t, uint8(0), cfg.Weekdays, "weekdays should default to 0 (no restriction)")
	assert.Equal(t, 1, cfg.RangeStart, "range_start should default to 1")
	assert.Equal(t, 30, cfg.RangeEnd, "range_end should default to 30")
	assert.Equal(t, uint(0), cfg.ID, "default config should not be persisted (ID=0)")
}

// ── Upsert ────────────────────────────────────────────────────────────────────

func TestDoctorScheduleUpsert_Create(t *testing.T) {
	svc, tid := setupScheduleSvc(t)
	cfg, err := svc.Upsert(tid, 1, service.UpsertScheduleInput{
		Weekdays: 42, RangeStart: 1, RangeEnd: 14,
	})
	require.NoError(t, err)
	assert.Equal(t, uint8(42), cfg.Weekdays)
	assert.Equal(t, 1, cfg.RangeStart)
	assert.Equal(t, 14, cfg.RangeEnd)
	assert.NotZero(t, cfg.ID)
}

func TestDoctorScheduleUpsert_Update(t *testing.T) {
	svc, tid := setupScheduleSvc(t)
	_, err := svc.Upsert(tid, 1, service.UpsertScheduleInput{
		Weekdays: 42, RangeStart: 1, RangeEnd: 14,
	})
	require.NoError(t, err)

	// Update with different values — should update in-place, not insert new row
	updated, err := svc.Upsert(tid, 1, service.UpsertScheduleInput{
		Weekdays: 21, RangeStart: 2, RangeEnd: 20,
	})
	require.NoError(t, err)
	assert.Equal(t, uint8(21), updated.Weekdays)
	assert.Equal(t, 2, updated.RangeStart)
	assert.Equal(t, 20, updated.RangeEnd)

	// Verify only one row exists
	cfg2, err := svc.Get(tid, 1)
	require.NoError(t, err)
	assert.Equal(t, uint8(21), cfg2.Weekdays)
}

func TestDoctorScheduleUpsert_WeekdaysZero_Valid(t *testing.T) {
	svc, tid := setupScheduleSvc(t)
	cfg, err := svc.Upsert(tid, 1, service.UpsertScheduleInput{
		Weekdays: 0, RangeStart: 1, RangeEnd: 30,
	})
	require.NoError(t, err, "weekdays=0 should be valid (means no restriction)")
	assert.Equal(t, uint8(0), cfg.Weekdays)
}

func TestDoctorScheduleUpsert_RangeStartLessThan1(t *testing.T) {
	svc, tid := setupScheduleSvc(t)
	_, err := svc.Upsert(tid, 1, service.UpsertScheduleInput{
		Weekdays: 0, RangeStart: 0, RangeEnd: 15,
	})
	assert.ErrorIs(t, err, service.ErrInvalidRange)
}

func TestDoctorScheduleUpsert_RangeEndLessThanStart(t *testing.T) {
	svc, tid := setupScheduleSvc(t)
	_, err := svc.Upsert(tid, 1, service.UpsertScheduleInput{
		Weekdays: 0, RangeStart: 10, RangeEnd: 5,
	})
	assert.ErrorIs(t, err, service.ErrInvalidRange)
}

// ── Doctor-ID regression: schedule is keyed by queue_doctor.id (PK) ──────────

// TestDoctorSchedule_KeyedByQueueDoctorPK guards that DoctorScheduleService
// stores and retrieves configs by queue_doctor.id (PK), not by user_id.
// The handler fix (GetDoctorSchedule / SetDoctorSchedule) ensures the :id URL
// param is interpreted as queue_doctor.id so it matches this service expectation.
func TestDoctorSchedule_KeyedByQueueDoctorPK(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "PK出诊规则测试", "sched-pk-"+t.Name())
	tid := uint(tenant.ID)
	svc := service.NewDoctorScheduleService(db)

	const queueDoctorPK uint = 7 // queue_doctor.id (PK)
	const userID uint = 99        // user_id — different number

	saved, err := svc.Upsert(tid, queueDoctorPK, service.UpsertScheduleInput{
		Weekdays: 0b0011110, RangeStart: 3, RangeEnd: 21,
	})
	require.NoError(t, err)
	assert.Equal(t, queueDoctorPK, saved.DoctorID)

	// Lookup by queue_doctor.id → should find the saved config.
	gotByPK, err := svc.Get(tid, queueDoctorPK)
	require.NoError(t, err)
	assert.Equal(t, uint8(0b0011110), gotByPK.Weekdays, "Get(queueDoctorId) must return the saved config")
	assert.Equal(t, 3, gotByPK.RangeStart)

	// Lookup by user_id → must return the DEFAULT (not the saved config).
	gotByUserID, err := svc.Get(tid, userID)
	require.NoError(t, err)
	assert.Equal(t, uint(0), gotByUserID.ID,
		"Get(userId=%d) must return default config (ID=0), not the config saved for doctorPK=%d", userID, queueDoctorPK)
	assert.Equal(t, 30, gotByUserID.RangeEnd, "Get(userId) must return default range_end=30")
}

// ── Tenant Isolation ──────────────────────────────────────────────────────────

func TestDoctorScheduleTenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "sched-iso-a-"+t.Name())
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "sched-iso-b-"+t.Name())
	svc := service.NewDoctorScheduleService(db)

	_, err := svc.Upsert(uint(tenantA.ID), 1, service.UpsertScheduleInput{
		Weekdays: 42, RangeStart: 1, RangeEnd: 10,
	})
	require.NoError(t, err)

	// Tenant B querying same doctor_id should get default (not tenant A's data)
	cfg, err := svc.Get(uint(tenantB.ID), 1)
	require.NoError(t, err)
	assert.Equal(t, uint8(0), cfg.Weekdays, "tenant B should not see tenant A's config")
	assert.Equal(t, 30, cfg.RangeEnd, "tenant B should get default range_end=30")
}
