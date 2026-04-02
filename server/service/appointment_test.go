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
