package service_test

import (
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupApptService(t *testing.T) (*service.AppointmentService, uint) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "预约测试诊所", "appt-test-"+t.Name())
	return service.NewAppointmentService(db), uint(tenant.ID)
}

func TestCreateAppointment_Success(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "张三",
		DoctorID:    1,
		DoctorName:  "李医生",
		Room:        "诊室1",
		AppointDate: time.Now().Format("2006-01-02"),
		SlotStart:   "09:00",
		SlotEnd:     "09:30",
	})
	require.NoError(t, err)
	assert.Equal(t, model.AppointmentStatusPending, appt.Status)
	assert.Equal(t, "09:00", appt.SlotStart)
}

func TestCreateAppointment_DuplicateSameDay(t *testing.T) {
	svc, tid := setupApptService(t)
	input := service.CreateAppointmentInput{
		PatientName: "张三",
		DoctorID:    1,
		DoctorName:  "李医生",
		Room:        "诊室1",
		AppointDate: time.Now().Format("2006-01-02"),
		SlotStart:   "09:00",
		SlotEnd:     "09:30",
	}
	_, err := svc.CreateAppointment(tid, input)
	require.NoError(t, err)
	_, err2 := svc.CreateAppointment(tid, input)
	assert.ErrorIs(t, err2, service.ErrDuplicateAppointment)
}

func TestCreateAppointment_DifferentDayAllowed(t *testing.T) {
	svc, tid := setupApptService(t)
	_, err1 := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		AppointDate: "2026-04-01", SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err1)
	_, err2 := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		AppointDate: "2026-04-02", SlotStart: "09:00", SlotEnd: "09:30",
	})
	assert.NoError(t, err2, "same patient different day should be allowed")
}

func TestEnqueueAppointment_SetsQueueEntryID(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "李四", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	queueSvc := service.NewQueueService(svc.DB)
	err := svc.EnqueueAppointment(tid, appt.ID, queueSvc)
	require.NoError(t, err)

	var updated model.Appointment
	svc.DB.First(&updated, appt.ID)
	assert.Equal(t, model.AppointmentStatusQueued, updated.Status)
	assert.NotNil(t, updated.QueueEntryID)
}

func TestEnqueueAppointment_Idempotent(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "孙七", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))
	// Second call should be idempotent (no error, no duplicate)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))

	var count int64
	svc.DB.Model(&model.QueueEntry{}).Where("appointment_id = ?", appt.ID).Count(&count)
	assert.Equal(t, int64(1), count, "should not create duplicate queue entries")
}

func TestCheckin_Success(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "王五", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))

	entry, err := svc.Checkin(tid, appt.ID)
	require.NoError(t, err)
	assert.Equal(t, model.CheckinStatusDone, entry.CheckinStatus)
	assert.NotNil(t, entry.ArrivalTime)
}

func TestCheckin_AnySlotCurrentDay(t *testing.T) {
	// A past-slot appointment can still be checked in on the same day (no time restriction)
	svc, tid := setupApptService(t)
	appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "赵六", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "08:00", SlotEnd: "08:30",
	})
	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))
	_, err := svc.Checkin(tid, appt.ID)
	assert.NoError(t, err, "past-slot appointment on current day must be checkin-able")
}

func TestCheckin_WrongTenant(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))
	_, err := svc.Checkin(tid+999, appt.ID)
	assert.ErrorIs(t, err, service.ErrAppointmentNotFound)
}

func TestCheckin_NotQueued(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	_, err := svc.Checkin(tid, appt.ID)
	assert.ErrorIs(t, err, service.ErrNotQueued)
}

func TestCancel_Success(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "测试", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	err := svc.Cancel(tid, appt.ID)
	require.NoError(t, err)

	var updated model.Appointment
	svc.DB.First(&updated, appt.ID)
	assert.Equal(t, model.AppointmentStatusCancelled, updated.Status)
}

func TestCancel_NotPending(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "测试", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	// Cancel once (succeeds)
	require.NoError(t, svc.Cancel(tid, appt.ID))
	// Cancel again — should return ErrCancelNotAllowed, not ErrAppointmentNotFound
	err := svc.Cancel(tid, appt.ID)
	assert.ErrorIs(t, err, service.ErrCancelNotAllowed)
}

func TestAutoEnqueueToday_SkipsAlreadyQueued(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "孙七", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))

	failedIDs, total := svc.AutoEnqueueToday(queueSvc)
	assert.Equal(t, 0, total)
	assert.Empty(t, failedIDs)
}

func TestListByDate(t *testing.T) {
	svc, tid := setupApptService(t)
	_, _ = svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "甲", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	_, _ = svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "乙", DoctorID: 2, DoctorName: "王医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "10:00", SlotEnd: "10:30",
	})

	list, err := svc.ListByDate(tid, time.Now().Format("2006-01-02"), nil)
	require.NoError(t, err)
	assert.Len(t, list, 2)
}

// TestUpdateAppointment_HappyPath verifies that a pending appointment can be updated.
func TestUpdateAppointment_HappyPath(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "原名", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)

	updated, err := svc.Update(tid, appt.ID, service.UpdateAppointmentInput{
		PatientName: "新名", DoctorID: 2, DoctorName: "王医生",
		Room: "VIP诊室", AppointDate: time.Now().Format("2006-01-02"),
		SlotStart: "10:00", SlotEnd: "10:30",
	})
	require.NoError(t, err)
	assert.Equal(t, "新名", updated.PatientName)
	assert.Equal(t, uint(2), updated.DoctorID)

	// Confirm the DB record is updated too.
	var fromDB model.Appointment
	svc.DB.First(&fromDB, appt.ID)
	assert.Equal(t, "新名", fromDB.PatientName)
	assert.Equal(t, "王医生", fromDB.DoctorName)
	assert.Equal(t, "VIP诊室", fromDB.Room)
}

// TestUpdateAppointment_CancelledBlocked verifies that a cancelled appointment cannot be updated.
func TestUpdateAppointment_CancelledBlocked(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "测试", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)
	require.NoError(t, svc.Cancel(tid, appt.ID))

	_, err = svc.Update(tid, appt.ID, service.UpdateAppointmentInput{
		PatientName: "新名", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	assert.ErrorIs(t, err, service.ErrUpdateNotAllowed)
}

// TestUpdateAppointment_QueuedAllowed verifies that a queued appointment can still be updated.
func TestUpdateAppointment_QueuedAllowed(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "测试", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)
	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))

	_, err = svc.Update(tid, appt.ID, service.UpdateAppointmentInput{
		PatientName: "已排队改名", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	assert.NoError(t, err, "queued appointment should be updatable")
}

// TestUpdateAppointment_NotFound verifies that updating a non-existent appointment returns ErrAppointmentNotFound.
func TestUpdateAppointment_NotFound(t *testing.T) {
	svc, tid := setupApptService(t)

	_, err := svc.Update(tid, 99999, service.UpdateAppointmentInput{
		PatientName: "不存在", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	assert.ErrorIs(t, err, service.ErrAppointmentNotFound)
}

// TestUpdateAppointment_TenantIsolation verifies that a cross-tenant update is blocked.
func TestUpdateAppointment_TenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "appt-update-ta-"+t.Name())
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "appt-update-tb-"+t.Name())
	svc := service.NewAppointmentService(db)

	appt, err := svc.CreateAppointment(uint(tenantA.ID), service.CreateAppointmentInput{
		PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)

	// Tenant B tries to update tenant A's appointment — must fail with not found.
	_, err = svc.Update(uint(tenantB.ID), appt.ID, service.UpdateAppointmentInput{
		PatientName: "恶意修改", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	assert.ErrorIs(t, err, service.ErrAppointmentNotFound, "cross-tenant update must return not found")
}

func TestListByDate_FilterByDoctor(t *testing.T) {
	svc, tid := setupApptService(t)
	_, _ = svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "甲", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	_, _ = svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "乙", DoctorID: 2, DoctorName: "王医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "10:00", SlotEnd: "10:30",
	})

	docID := uint(1)
	list, err := svc.ListByDate(tid, time.Now().Format("2006-01-02"), &docID)
	require.NoError(t, err)
	assert.Len(t, list, 1)
	assert.Equal(t, uint(1), list[0].DoctorID)
}

// ── New tests for H-2 fix: duplicate check now scoped to doctor_id ──────────

func TestCreateAppointment_SamePatientDifferentDoctorAllowed(t *testing.T) {
	svc, tid := setupApptService(t)
	date := time.Now().Format("2006-01-02")
	_, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		AppointDate: date, SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)
	// Same patient, different doctor, same day — must be allowed
	_, err2 := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "张三", DoctorID: 2, DoctorName: "王医生",
		AppointDate: date, SlotStart: "10:00", SlotEnd: "10:30",
	})
	assert.NoError(t, err2, "same patient different doctor same day should be allowed")
}

func TestCreateAppointment_SamePatientSameDoctorDuplicateRejected(t *testing.T) {
	svc, tid := setupApptService(t)
	date := time.Now().Format("2006-01-02")
	input := service.CreateAppointmentInput{
		PatientName: "李四", DoctorID: 1, DoctorName: "李医生",
		AppointDate: date, SlotStart: "09:00", SlotEnd: "09:30",
	}
	_, err := svc.CreateAppointment(tid, input)
	require.NoError(t, err)
	_, err2 := svc.CreateAppointment(tid, input)
	assert.ErrorIs(t, err2, service.ErrDuplicateAppointment)
}

// ── Tests for C-3 fix: Update returns fresh data ─────────────────────────────

func TestUpdateAppointment_ReturnsFreshData(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "王五", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Add(24*time.Hour).Format("2006-01-02"),
		SlotStart:   "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)

	updated, err := svc.Update(tid, appt.ID, service.UpdateAppointmentInput{
		PatientName: "王五已改名", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Add(48*time.Hour).Format("2006-01-02"),
		SlotStart:   "10:00", SlotEnd: "10:30",
	})
	require.NoError(t, err)
	// Returned struct must reflect the new values, not the pre-update in-memory copy
	assert.Equal(t, "王五已改名", updated.PatientName)
	assert.Equal(t, "10:00", updated.SlotStart)
	assert.Equal(t, "10:30", updated.SlotEnd)
}

// ── MarkNoShowAllTenantsForPastDates ─────────────────────────────────────────

func TestMarkNoShow_MarksQueuedPastAppointments(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	svc := service.NewAppointmentService(db)

	// Create a pending appointment for yesterday, then force it to queued status
	// via direct DB update (EnqueueAppointment would silently skip non-today dates).
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	appt, err := svc.CreateAppointment(uint(tenant.ID), service.CreateAppointmentInput{
		PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		AppointDate: yesterday, SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)
	// Force queued status directly — bypassing the date guard
	require.NoError(t, db.Model(&model.Appointment{}).Where("id = ?", appt.ID).
		Updates(map[string]interface{}{"status": model.AppointmentStatusQueued, "queue_entry_id": 999}).Error)

	affected, err := svc.MarkNoShowAllTenantsForPastDates()
	require.NoError(t, err)
	assert.Equal(t, int64(1), affected)

	var updated model.Appointment
	require.NoError(t, db.First(&updated, appt.ID).Error)
	assert.Equal(t, model.AppointmentStatusNoShow, updated.Status)
}

// TestEnqueueAppointment_UpdatesStatus verifies that EnqueueAppointment changes
// the appointment status from pending to queued and sets queue_entry_id.
// This guards against the silent-skip bug where date comparison failed.
func TestEnqueueAppointment_UpdatesStatus(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "入队测试", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)
	assert.Equal(t, model.AppointmentStatusPending, appt.Status)

	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))

	var updated model.Appointment
	require.NoError(t, svc.DB.First(&updated, appt.ID).Error)
	assert.Equal(t, model.AppointmentStatusQueued, updated.Status, "EnqueueAppointment must change status to queued")
	assert.NotNil(t, updated.QueueEntryID, "EnqueueAppointment must set queue_entry_id")
}

func TestMarkNoShow_MarksPendingPastAppointments(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	svc := service.NewAppointmentService(db)

	// Pending appointment from yesterday — server was down, never enqueued
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	appt, err := svc.CreateAppointment(uint(tenant.ID), service.CreateAppointmentInput{
		PatientName: "李四", DoctorID: 1, DoctorName: "李医生",
		AppointDate: yesterday, SlotStart: "10:00", SlotEnd: "10:30",
	})
	require.NoError(t, err)
	assert.Equal(t, model.AppointmentStatusPending, appt.Status)

	affected, err := svc.MarkNoShowAllTenantsForPastDates()
	require.NoError(t, err)
	assert.Equal(t, int64(1), affected)

	var updated model.Appointment
	require.NoError(t, db.First(&updated, appt.ID).Error)
	assert.Equal(t, model.AppointmentStatusNoShow, updated.Status)
}

func TestMarkNoShow_PreservesTodayPendingAppointments(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	svc := service.NewAppointmentService(db)

	// Today's pending appointment must NOT be touched
	appt, err := svc.CreateAppointment(uint(tenant.ID), service.CreateAppointmentInput{
		PatientName: "王五", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "14:00", SlotEnd: "14:30",
	})
	require.NoError(t, err)

	affected, err := svc.MarkNoShowAllTenantsForPastDates()
	require.NoError(t, err)
	assert.Equal(t, int64(0), affected)

	var updated model.Appointment
	require.NoError(t, db.First(&updated, appt.ID).Error)
	assert.Equal(t, model.AppointmentStatusPending, updated.Status)
}

func TestWeeklyMatrix(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewAppointmentService(db)
	tenant := testutil.SeedTestTenant(t, db, "矩阵测试诊所", "matrix-test-"+t.Name())
	tenantID := uint(tenant.ID)

	_ = db.Create(&model.Appointment{
		TenantID: tenantID, DoctorID: 10, DoctorName: "王医生",
		AppointDate: "2026-04-07", SlotStart: "09:00", SlotEnd: "09:30",
		PatientName: "张三", Status: model.AppointmentStatusPending,
	})
	_ = db.Create(&model.Appointment{
		TenantID: tenantID, DoctorID: 10, DoctorName: "王医生",
		AppointDate: "2026-04-07", SlotStart: "09:30", SlotEnd: "10:00",
		PatientName: "李四", Status: model.AppointmentStatusQueued,
	})
	_ = db.Create(&model.Appointment{
		TenantID: tenantID, DoctorID: 20, DoctorName: "赵医生",
		AppointDate: "2026-04-08", SlotStart: "10:00", SlotEnd: "10:30",
		PatientName: "王五", Status: model.AppointmentStatusPending,
	})
	// cancelled — must NOT be counted
	_ = db.Create(&model.Appointment{
		TenantID: tenantID, DoctorID: 10, DoctorName: "王医生",
		AppointDate: "2026-04-07", SlotStart: "11:00", SlotEnd: "11:30",
		PatientName: "取消人", Status: model.AppointmentStatusCancelled,
	})

	result, err := svc.WeeklyMatrix(tenantID, "2026-04-07")
	assert.NoError(t, err)
	assert.Len(t, result.Doctors, 2)
	assert.Len(t, result.Days, 7)
	assert.Equal(t, "2026-04-07", result.Days[0])
	assert.Equal(t, "2026-04-13", result.Days[6])
	assert.Equal(t, 2, result.Counts[10]["2026-04-07"])
	assert.Equal(t, 1, result.Counts[20]["2026-04-08"])
	assert.Equal(t, 0, result.Counts[10]["2026-04-08"])
	assert.Equal(t, 2, result.RowTotals[10])
	assert.Equal(t, 1, result.RowTotals[20])
	assert.Equal(t, 2, result.ColTotals["2026-04-07"])
	assert.Equal(t, 1, result.ColTotals["2026-04-08"])
	assert.Equal(t, 3, result.GrandTotal)
}

// ── Doctor-ID regression tests ────────────────────────────────────────────────

// TestCheckin_ParseTimeFormat_Regression guards against the "只能在预约当日签到"
// false-positive caused by parseTime=True in the MySQL DSN.  When the DSN has
// parseTime=True, GORM scans DATE columns as full timestamp strings such as
// "2026-04-04 00:00:00 +0800 CST".  The fix uses strings.HasPrefix so both
// the plain "2026-04-04" and the full-timestamp form are accepted.
func TestCheckin_ParseTimeFormat_Regression(t *testing.T) {
	svc, tid := setupApptService(t)
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "parseTime测试患者", DoctorID: 1, DoctorName: "李医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "10:00", SlotEnd: "10:30",
	})
	require.NoError(t, err)
	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))

	// Simulate MySQL parseTime=True: overwrite appoint_date in DB with a full
	// timestamp string so that Go scans it as "YYYY-MM-DD 00:00:00 +0800 CST".
	today := time.Now().Format("2006-01-02")
	fullTS := today + " 00:00:00 +0800 CST"
	require.NoError(t, svc.DB.Exec("UPDATE appointments SET appoint_date = ? WHERE id = ?", fullTS, appt.ID).Error)

	_, err = svc.Checkin(tid, appt.ID)
	assert.NoError(t, err, "Checkin must succeed when appoint_date is stored as a full timestamp (parseTime=True DSN)")
}

// TestEnqueueAppointment_QueueEntryUsesDoctorPK guards that queue_entry.doctor_id
// stores queue_doctor.id (the PK of queue_doctors), NOT user_id.
func TestEnqueueAppointment_QueueEntryUsesDoctorPK(t *testing.T) {
	svc, tid := setupApptService(t)

	qd := &model.QueueDoctor{TenantID: tid, UserID: 100, Room: "1诊室", Enabled: true, SortOrder: 1}
	require.NoError(t, svc.DB.Create(qd).Error)

	// Create appointment with doctor_id = qd.ID (queue_doctor.id PK, not user_id)
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "PK测试患者", DoctorID: uint(qd.ID), DoctorName: "测试医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)

	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))

	var entry model.QueueEntry
	require.NoError(t, svc.DB.Where("appointment_id = ?", appt.ID).First(&entry).Error)
	assert.Equal(t, uint(qd.ID), entry.DoctorID,
		"queue_entry.doctor_id must be queue_doctor.id (PK=%d), not user_id (%d)", qd.ID, qd.UserID)
	assert.NotEqual(t, qd.UserID, entry.DoctorID,
		"queue_entry.doctor_id must NOT be user_id")
}

// TestEnqueueAppointment_FallbackUserIdToDoctorPK guards the normalization code
// that handles legacy appointments where doctor_id was stored as user_id
// (e.g. created via the old admin panel before the d.user_id→d.id fix).
func TestEnqueueAppointment_FallbackUserIdToDoctorPK(t *testing.T) {
	svc, tid := setupApptService(t)

	qd := &model.QueueDoctor{TenantID: tid, UserID: 200, Room: "2诊室", Enabled: true, SortOrder: 1}
	require.NoError(t, svc.DB.Create(qd).Error)

	// Simulate old bug: appointment stores user_id (200) instead of queue_doctor.id
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "旧数据患者", DoctorID: uint(qd.UserID), DoctorName: "测试医生",
		AppointDate: time.Now().Format("2006-01-02"), SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)

	queueSvc := service.NewQueueService(svc.DB)
	require.NoError(t, svc.EnqueueAppointment(tid, appt.ID, queueSvc))

	var entry model.QueueEntry
	require.NoError(t, svc.DB.Where("appointment_id = ?", appt.ID).First(&entry).Error)
	assert.Equal(t, uint(qd.ID), entry.DoctorID,
		"EnqueueAppointment must normalize user_id (%d) → queue_doctor.id (PK=%d)", qd.UserID, qd.ID)
}

// TestCreateAppointment_AfterNoShowAllowed verifies that a patient whose prior appointment
// was no_show can create a new appointment for the same doctor on the same day.
// This is the regression test for the patient portal handler fix that excluded
// no_show (in addition to cancelled) from the duplicate check.
func TestCreateAppointment_AfterNoShowAllowed(t *testing.T) {
	svc, tid := setupApptService(t)
	date := time.Now().Format("2006-01-02")
	appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "王小花", DoctorID: 1, DoctorName: "夏老三",
		AppointDate: date, SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)
	// Force to no_show (simulating server-side auto-mark)
	require.NoError(t, svc.DB.Model(appt).Update("status", model.AppointmentStatusNoShow).Error)

	// Same patient, same doctor, same day — must be allowed after no_show
	_, err2 := svc.CreateAppointment(tid, service.CreateAppointmentInput{
		PatientName: "王小花", DoctorID: 1, DoctorName: "夏老三",
		AppointDate: date, SlotStart: "10:00", SlotEnd: "10:30",
	})
	assert.NoError(t, err2, "appointment after no_show on same day must be allowed")
}

// TestCreateAppointment_SlotCapacityExcludesNoShow verifies that a no_show booking
// does not consume a slot (i.e. does not count toward max_count).
// This mirrors the patient portal handler fix that changed status != cancelled
// to status NOT IN (cancelled, no_show) in the slot capacity count.
func TestCreateAppointment_SlotCapacityExcludesNoShow(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "slot-no-show-"+t.Name())
	svc := service.NewAppointmentService(db)
	tenantID := uint(tenant.ID)
	date := time.Now().Format("2006-01-02")

	// Create a slot config with max_count = 1
	require.NoError(t, db.Create(&model.AppointmentSlotConfig{
		TenantID: tenantID, DoctorID: 1, SlotStart: "09:00", SlotEnd: "09:30", MaxCount: 1,
	}).Error)

	// First booking (张三) — succeeds, then forced to no_show
	appt, err := svc.CreateAppointment(tenantID, service.CreateAppointmentInput{
		PatientName: "张三", DoctorID: 1, DoctorName: "李医生",
		AppointDate: date, SlotStart: "09:00", SlotEnd: "09:30",
	})
	require.NoError(t, err)
	require.NoError(t, db.Model(appt).Update("status", model.AppointmentStatusNoShow).Error)

	// ListSlots should show the slot as available (no_show must not count)
	slots, err := svc.ListSlots(tenantID, date, 1)
	require.NoError(t, err)
	require.Len(t, slots, 1)
	assert.True(t, slots[0].Available, "slot must be available after prior booking is no_show")
	assert.Equal(t, 0, slots[0].BookedCount, "no_show booking must not count toward booked_count")
}

func TestWeeklyMatrix_OtherTenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewAppointmentService(db)
	tenantA := testutil.SeedTestTenant(t, db, "隔离诊所A", "matrix-iso-a-"+t.Name())
	tenantB := testutil.SeedTestTenant(t, db, "隔离诊所B", "matrix-iso-b-"+t.Name())

	_ = db.Create(&model.Appointment{
		TenantID: uint(tenantB.ID), DoctorID: 99, DoctorName: "他院医生",
		AppointDate: "2026-04-07", SlotStart: "09:00", SlotEnd: "09:30",
		PatientName: "隔离患者", Status: model.AppointmentStatusPending,
	})

	result, err := svc.WeeklyMatrix(uint(tenantA.ID), "2026-04-07")
	assert.NoError(t, err)
	assert.Len(t, result.Doctors, 0)
	assert.Equal(t, 0, result.GrandTotal)
}

// TestListByDate_NormalizesUserIdDoctorID is a regression test for the bug where
// WeeklyMatrix showed appointments for a doctor but ListByDate returned empty
// because historical appointments stored user_id in the doctor_id column.
// ListByDate must search by both canonical queue_doctor.id AND the linked user_id.
func TestListByDate_NormalizesUserIdDoctorID(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewAppointmentService(db)
	tenant := testutil.SeedTestTenant(t, db, "测试诊所", "listbydate-norm-"+t.Name())

	// Create a QueueDoctor with an associated user (user_id = 500, queue_doctor.id = auto).
	userID := uint(500)
	qd := model.QueueDoctor{
		TenantID: uint(tenant.ID),
		UserName: "夏老三",
		UserID:   userID,
		Room:     "诊室1",
		Enabled:  true,
	}
	require.NoError(t, db.Create(&qd).Error)
	canonicalID := uint(qd.ID)

	// Simulate historical appointment stored with user_id as doctor_id.
	appt := model.Appointment{
		TenantID:    uint(tenant.ID),
		PatientName: "王小花",
		DoctorID:    userID, // old bug: user_id stored here instead of queue_doctor.id
		DoctorName:  "夏老三",
		AppointDate: "2026-04-07",
		SlotStart:   "09:00",
		SlotEnd:     "09:30",
		Status:      model.AppointmentStatusPending,
	}
	require.NoError(t, db.Create(&appt).Error)

	// ListByDate with canonical queue_doctor.id must still find the appointment.
	list, err := svc.ListByDate(uint(tenant.ID), "2026-04-07", &canonicalID)
	assert.NoError(t, err)
	assert.Len(t, list, 1, "ListByDate should find appointment stored with user_id via canonical id lookup")

	// ListByDate with user_id directly must also work (legacy callers).
	list2, err := svc.ListByDate(uint(tenant.ID), "2026-04-07", &userID)
	assert.NoError(t, err)
	assert.Len(t, list2, 1, "ListByDate should find appointment when queried by user_id directly")
}

