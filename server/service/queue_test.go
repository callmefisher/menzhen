package service_test

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// makeQueueSvc creates a QueueService backed by a fresh test database and two
// seeded tenants.  tenantA and tenantB are returned for convenience.
func makeQueueSvc(t *testing.T) (*service.QueueService, uint, uint) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "queue-clinic-a-"+t.Name())
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "queue-clinic-b-"+t.Name())
	// Create test users for both tenants
	for _, tid := range []uint64{tenantA.ID, tenantB.ID} {
		db.Create(&model.User{TenantID: tid, Username: "doc_" + t.Name(), PasswordHash: "h", RealName: "医生", Status: 1})
	}
	return service.NewQueueService(db), uint(tenantA.ID), uint(tenantB.ID)
}

// makeQueueSvcSingleTenant is a convenience helper that creates only one tenant + one user.
func makeQueueSvcSingle(t *testing.T) (*service.QueueService, uint) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "queue-single-"+t.Name())
	// Create a test user for patient auto-creation FK
	user := model.User{
		TenantID:     tenant.ID,
		Username:     "testdoc_" + t.Name(),
		PasswordHash: "hash",
		RealName:     "测试医生",
		Status:       1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("failed to seed test user: %v", err)
	}
	return service.NewQueueService(db), uint(tenant.ID)
}

// takeNumber is a test helper that calls TakeNumber with a default userID=1 and returns Entry.
func takeNumber(t *testing.T, svc *service.QueueService, tenantID uint, name string, doctorID uint, doctorName, room string) *model.QueueEntry {
	t.Helper()
	result, err := svc.TakeNumber(tenantID, name, doctorID, doctorName, room, 1)
	if err != nil {
		t.Fatalf("TakeNumber failed: %v", err)
	}
	return result.Entry
}

// TestQueueTakeNumber verifies that seq numbers auto-increment correctly.
func TestQueueTakeNumber(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const doctorID uint = 1
	const doctorName = "张医生"
	const room = "1诊室"

	e1 := takeNumber(t, svc, tenantID, "张三", doctorID, doctorName, room)
	assert.Equal(t, 1, e1.SeqNumber, "first ticket should be seq 1")
	assert.Equal(t, "waiting", e1.Status)
	assert.NotNil(t, e1.ArrivalTime)
	assert.Equal(t, tenantID, e1.TenantID)

	e2 := takeNumber(t, svc, tenantID, "李四", doctorID, doctorName, room)
	assert.Equal(t, 2, e2.SeqNumber, "second ticket should be seq 2")

	e3 := takeNumber(t, svc, tenantID, "王五", doctorID, doctorName, room)
	assert.Equal(t, 3, e3.SeqNumber, "third ticket should be seq 3")
}

// TestQueueListToday verifies listing all entries and filtering by doctor.
func TestQueueListToday(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docA uint = 10
	const docB uint = 20

	takeNumber(t, svc, tenantID, "患者1", docA, "张医生", "1诊室")
	takeNumber(t, svc, tenantID, "患者2", docA, "张医生", "1诊室")
	takeNumber(t, svc, tenantID, "患者3", docB, "李医生", "2诊室")

	t.Run("list all", func(t *testing.T) {
		entries, err := svc.ListToday(tenantID, nil)
		require.NoError(t, err)
		assert.Len(t, entries, 3)
		// Verify ascending order by seq number.
		for i := 1; i < len(entries); i++ {
			assert.LessOrEqual(t, entries[i-1].SeqNumber, entries[i].SeqNumber)
		}
	})

	t.Run("filter by doctor", func(t *testing.T) {
		filterDocA := docA
		entries, err := svc.ListToday(tenantID, &filterDocA)
		require.NoError(t, err)
		assert.Len(t, entries, 2)
		for _, e := range entries {
			assert.Equal(t, docA, e.DoctorID)
		}
	})
}

// TestQueueListToday_Empty verifies that no entries returns an empty (non-nil) slice.
func TestQueueListToday_Empty(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	entries, err := svc.ListToday(tenantID, nil)
	require.NoError(t, err)
	assert.NotNil(t, entries, "should return empty slice, not nil")
	assert.Len(t, entries, 0)
}

// TestQueueCall verifies that calling the first waiting entry transitions to "seeing".
func TestQueueCall(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e, err := svc.TakeNumber(tenantID, "患者", 1, "医生", "诊室", 1)
	require.NoError(t, err)

	called, changed, err := svc.Call(tenantID, e.Entry.ID)
	require.NoError(t, err)
	assert.True(t, changed, "first waiting entry should change status")
	assert.Equal(t, "seeing", called.Status)
	assert.NotNil(t, called.CalledAt)
}

// TestQueueCall_WhenSeeingExists verifies that calling a waiting entry while
// another patient is already seeing does NOT change status (notify only).
func TestQueueCall_WhenSeeingExists(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docID uint = 1
	first := takeNumber(t, svc, tenantID, "第一号", docID, "医生", "诊室")
	second := takeNumber(t, svc, tenantID, "第二号", docID, "医生", "诊室")

	// Make first entry "seeing"
	_, changed, err := svc.Call(tenantID, first.ID)
	require.NoError(t, err)
	assert.True(t, changed)

	// Now call second — someone is already seeing, so no status change
	called, changed2, err := svc.Call(tenantID, second.ID)
	require.NoError(t, err)
	assert.False(t, changed2, "should NOT change status when someone is already seeing")
	assert.Equal(t, "waiting", called.Status)
	assert.Nil(t, called.CalledAt)
}

// TestQueueCall_ReSeeingEntry verifies that calling an already-seeing entry
// returns the entry without changing status (re-call scenario).
func TestQueueCall_ReSeeingEntry(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e := takeNumber(t, svc, tenantID, "患者", 1, "医生", "诊室")
	_, changed, err := svc.Call(tenantID, e.ID)
	require.NoError(t, err)
	assert.True(t, changed)

	// Re-call the same entry (now seeing)
	called, changed2, err := svc.Call(tenantID, e.ID)
	require.NoError(t, err)
	assert.False(t, changed2, "re-call should not change status")
	assert.Equal(t, "seeing", called.Status)
}

// TestQueueCall_InvalidStatus verifies that calling a "done" patient returns ErrInvalidStatus.
func TestQueueCall_InvalidStatus(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e := takeNumber(t, svc, tenantID, "患者", 1, "医生", "诊室")

	_, _, err := svc.Call(tenantID, e.ID)
	require.NoError(t, err)
	_, _, err = svc.Complete(tenantID, e.ID)
	require.NoError(t, err)

	_, _, err = svc.Call(tenantID, e.ID)
	assert.ErrorIs(t, err, service.ErrInvalidStatus)
}

// TestQueueCall_AppointmentNotCheckedIn verifies that calling an appointment-source
// entry whose checkin_status is still pending does NOT transition it to seeing.
func TestQueueCall_AppointmentNotCheckedIn(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	// Create a walk_in entry, then override source/checkin_status to simulate an
	// appointment-derived entry that hasn't been checked in yet.
	e := takeNumber(t, svc, tenantID, "预约患者", 1, "医生", "诊室")
	require.NoError(t, svc.DB.Model(&model.QueueEntry{}).Where("id = ?", e.ID).
		Updates(map[string]interface{}{
			"source":         "appointment",
			"checkin_status": model.CheckinStatusPending,
		}).Error)

	called, changed, err := svc.Call(tenantID, e.ID)
	require.NoError(t, err)
	assert.False(t, changed, "unchecked-in appointment patient must not transition to seeing")
	assert.Equal(t, "waiting", called.Status)
}

// TestQueueCall_AppointmentCheckedIn verifies that after check-in the patient
// can be transitioned to seeing normally.
func TestQueueCall_AppointmentCheckedIn(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e := takeNumber(t, svc, tenantID, "已签到预约患者", 1, "医生", "诊室")
	require.NoError(t, svc.DB.Model(&model.QueueEntry{}).Where("id = ?", e.ID).
		Updates(map[string]interface{}{
			"source":         "appointment",
			"checkin_status": model.CheckinStatusDone,
		}).Error)

	called, changed, err := svc.Call(tenantID, e.ID)
	require.NoError(t, err)
	assert.True(t, changed, "checked-in appointment patient should transition to seeing")
	assert.Equal(t, "seeing", called.Status)
}

// TestQueueComplete_AutoCallSkipsUncheckedIn verifies that auto-call after Complete
// skips appointment patients who have not yet checked in.
func TestQueueComplete_AutoCallSkipsUncheckedIn(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docID uint = 7
	first := takeNumber(t, svc, tenantID, "第一号", docID, "医生", "诊室")
	second := takeNumber(t, svc, tenantID, "未签到预约", docID, "医生", "诊室")
	third := takeNumber(t, svc, tenantID, "第三号", docID, "医生", "诊室")

	// Make second entry a not-checked-in appointment patient
	require.NoError(t, svc.DB.Model(&model.QueueEntry{}).Where("id = ?", second.ID).
		Updates(map[string]interface{}{
			"source":         "appointment",
			"checkin_status": model.CheckinStatusPending,
		}).Error)

	_, _, err := svc.Call(tenantID, first.ID)
	require.NoError(t, err)

	_, next, err := svc.Complete(tenantID, first.ID)
	require.NoError(t, err)
	require.NotNil(t, next, "auto-call should find a callable patient")
	assert.Equal(t, third.ID, next.ID, "auto-call should skip unchecked-in appointment patient and pick third")
	assert.Equal(t, "seeing", next.Status)
}

// TestQueueComplete_OnlyUncheckedAppointmentRemaining verifies that completing a seeing
// patient succeeds (returns nil error, nil next) when the only remaining waiting patient
// is an unchecked appointment. This is the exact bug scenario reported: "完成时弹出失败，
// 因为下一个在队列的是未签到的预约号".
func TestQueueComplete_OnlyUncheckedAppointmentRemaining(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docID uint = 8
	// Patient A — real seeing patient
	patientA := takeNumber(t, svc, tenantID, "就诊患者", docID, "医生", "诊室")
	// Patient B — unchecked appointment, the ONLY next patient
	patientB := takeNumber(t, svc, tenantID, "未签到预约", docID, "医生", "诊室")
	require.NoError(t, svc.DB.Model(&model.QueueEntry{}).Where("id = ?", patientB.ID).
		Updates(map[string]interface{}{
			"source":         "appointment",
			"checkin_status": model.CheckinStatusPending,
		}).Error)

	// A is called and now seeing
	_, changed, err := svc.Call(tenantID, patientA.ID)
	require.NoError(t, err)
	require.True(t, changed)

	// Complete A — must succeed even though B is unchecked
	completed, next, err := svc.Complete(tenantID, patientA.ID)
	require.NoError(t, err, "Complete must not error when only unchecked appointment remains")
	assert.Equal(t, model.QueueStatusDone, completed.Status)
	assert.Nil(t, next, "no auto-call when only unchecked appointment remains")

	// B must still be waiting (not auto-called, not errored)
	var bEntry model.QueueEntry
	require.NoError(t, svc.DB.First(&bEntry, patientB.ID).Error)
	assert.Equal(t, model.QueueStatusWaiting, bEntry.Status, "unchecked appointment must remain waiting")
}

func TestQueueComplete(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e := takeNumber(t, svc, tenantID, "患者", 1, "医生", "诊室")
	_, _, err := svc.Call(tenantID, e.ID)
	require.NoError(t, err)

	completed, _, err := svc.Complete(tenantID, e.ID)
	require.NoError(t, err)
	assert.Equal(t, "done", completed.Status)
	assert.NotNil(t, completed.CompletedAt)
}

// TestTakeNumber_RequeueAfterDone verifies that a patient whose prior entry is "done"
// can take a new number on the same day.
func TestTakeNumber_RequeueAfterDone(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e := takeNumber(t, svc, tenantID, "张三", 1, "医生", "诊室")
	_, _, err := svc.Call(tenantID, e.ID)
	require.NoError(t, err)
	_, _, err = svc.Complete(tenantID, e.ID)
	require.NoError(t, err)

	// Re-queue same patient — must succeed
	result, err := svc.TakeNumber(tenantID, "张三", 1, "医生", "诊室", 1)
	require.NoError(t, err, "done patient should be allowed to re-queue")
	assert.Equal(t, "waiting", result.Entry.Status)
	assert.Greater(t, result.Entry.SeqNumber, e.SeqNumber, "new entry should have a higher seq number")
}

// TestTakeNumber_DuplicateBlocked verifies that an active (waiting/seeing) patient cannot take a second number.
func TestTakeNumber_DuplicateBlocked(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	_, err := svc.TakeNumber(tenantID, "李四", 1, "医生", "诊室", 1)
	require.NoError(t, err)

	_, err = svc.TakeNumber(tenantID, "李四", 1, "医生", "诊室", 1)
	assert.ErrorIs(t, err, service.ErrDuplicatePatient, "active patient must be blocked from taking a second number")
}

// TestQueueComplete_AutoCallNext verifies that completing a patient auto-calls
// the next waiting patient for the same doctor.
func TestQueueComplete_AutoCallNext(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docID uint = 5

	first := takeNumber(t, svc, tenantID, "第一号", docID, "医生", "诊室")
	second := takeNumber(t, svc, tenantID, "第二号", docID, "医生", "诊室")

	_, _, err := svc.Call(tenantID, first.ID)
	require.NoError(t, err)

	_, next, err := svc.Complete(tenantID, first.ID)
	require.NoError(t, err)
	require.NotNil(t, next, "next waiting patient should be auto-called")
	assert.Equal(t, second.ID, next.ID)
	assert.Equal(t, "seeing", next.Status)
	assert.NotNil(t, next.CalledAt)
}

// TestQueueComplete_NoNext verifies that Complete returns nil for next when no
// more waiting patients exist for that doctor.
func TestQueueComplete_NoNext(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e := takeNumber(t, svc, tenantID, "唯一患者", 1, "医生", "诊室")
	_, _, err := svc.Call(tenantID, e.ID)
	require.NoError(t, err)

	_, next, err := svc.Complete(tenantID, e.ID)
	require.NoError(t, err)
	assert.Nil(t, next, "next should be nil when no waiting patients remain")
}

// TestQueueStats verifies that stat counts match actual entry statuses.
func TestQueueStats(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docID uint = 1

	e1 := takeNumber(t, svc, tenantID, "患者1", docID, "医生", "诊室")
	e2 := takeNumber(t, svc, tenantID, "患者2", docID, "医生", "诊室")
	takeNumber(t, svc, tenantID, "患者3", docID, "医生", "诊室")

	svc.Call(tenantID, e1.ID)
	svc.Complete(tenantID, e1.ID)

	stats, err := svc.Stats(tenantID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), stats["done"])
	assert.Equal(t, int64(1), stats["seeing"])
	assert.Equal(t, int64(1), stats["waiting"])
	_ = e2
}

// TestQueueClear verifies that Clear removes all today's entries for a tenant.
func TestQueueClear(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	takeNumber(t, svc, tenantID, "患者1", 1, "医生", "诊室")
	takeNumber(t, svc, tenantID, "患者2", 1, "医生", "诊室")

	affected, err := svc.Clear(tenantID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), affected)

	entries, err := svc.ListToday(tenantID, nil)
	require.NoError(t, err)
	assert.Len(t, entries, 0, "all entries should be cleared")
}

// TestQueueTenantIsolation verifies that tenant A cannot see tenant B's queue.
func TestQueueTenantIsolation(t *testing.T) {
	svc, tenantA, tenantB := makeQueueSvc(t)

	takeNumber(t, svc, tenantA, "A患者", 1, "医生", "诊室")
	takeNumber(t, svc, tenantA, "A患者2", 1, "医生", "诊室")
	takeNumber(t, svc, tenantB, "B患者", 1, "医生", "诊室")

	entriesA, err := svc.ListToday(tenantA, nil)
	require.NoError(t, err)
	assert.Len(t, entriesA, 2, "tenant A should see only its own entries")

	entriesB, err := svc.ListToday(tenantB, nil)
	require.NoError(t, err)
	assert.Len(t, entriesB, 1, "tenant B should see only its own entry")
}

// TestQueueConcurrentTakeNumber verifies that concurrent TakeNumber calls yield unique seq numbers.
func TestQueueConcurrentTakeNumber(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const n = 10
	results := make(chan int, n)
	var wg sync.WaitGroup
	wg.Add(n)

	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			name := fmt.Sprintf("并发患者%d", i)
			r, err := svc.TakeNumber(tenantID, name, 1, "医生", "诊室", 1)
			require.NoError(t, err)
			results <- r.Entry.SeqNumber
		}(i)
	}
	wg.Wait()
	close(results)

	seen := make(map[int]bool)
	for seq := range results {
		assert.False(t, seen[seq], "duplicate seq number %d", seq)
		seen[seq] = true
	}
	assert.Len(t, seen, n, "should have %d distinct seq numbers", n)
}

// TestQueueCall_NotFound verifies that calling a non-existent entry returns ErrQueueEntryNotFound.
func TestQueueCall_NotFound(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	_, _, err := svc.Call(tenantID, 99999)
	assert.ErrorIs(t, err, service.ErrQueueEntryNotFound)
}

// TestQueueComplete_WaitingStatus verifies that completing a waiting (not seeing) entry
// returns ErrInvalidStatus.
func TestQueueComplete_WaitingStatus(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e := takeNumber(t, svc, tenantID, "患者", 1, "医生", "诊室")
	require.Equal(t, "waiting", e.Status)

	_, _, err := svc.Complete(tenantID, e.ID)
	assert.ErrorIs(t, err, service.ErrInvalidStatus)
}

// TestQueueTakeNumber_EmptyName verifies that TakeNumber accepts an empty patient name.
func TestQueueTakeNumber_EmptyName(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	r, err := svc.TakeNumber(tenantID, "", 1, "医生", "诊室", 1)
	require.NoError(t, err)
	assert.Equal(t, "", r.Entry.PatientName)
	assert.Equal(t, 1, r.Entry.SeqNumber)
}

// TestQueueStats_Empty verifies that Stats returns an empty map when no entries exist today.
func TestQueueStats_Empty(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	stats, err := svc.Stats(tenantID)
	require.NoError(t, err)
	assert.NotNil(t, stats, "stats map should not be nil")
	assert.Len(t, stats, 0, "stats map should be empty when no entries exist")
}

// TestQueueClear_Empty verifies that Clear on an empty queue returns 0 affected rows
// without error.
func TestQueueClear_Empty(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	affected, err := svc.Clear(tenantID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), affected, "clearing empty queue should affect 0 rows")
}

// TestNextSeq_Sequential verifies that consecutive NextSeq calls return 1, 2, 3.
func TestNextSeq_Sequential(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	for i := 1; i <= 3; i++ {
		seq, err := svc.NextSeq(tenantID)
		require.NoError(t, err)
		assert.Equal(t, i, seq, "seq %d should be %d", i, i)
	}
}

// TestNextSeq_CrossDay verifies that after a day rollover the first call returns 1,
// not the previous day's last seq + 1.
func TestNextSeq_CrossDay(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "queue-crossday-seq-"+t.Name())
	svc := service.NewQueueService(db)
	tenantID := uint(tenant.ID)

	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")

	// Simulate previous day: insert a queue_seq row with last_seq = 154
	require.NoError(t, db.Create(&model.QueueSeq{
		TenantID:  tenantID,
		QueueDate: yesterday,
		LastSeq:   154,
	}).Error)

	// First call of the new day must return 1, not 155
	seq, err := svc.NextSeq(tenantID)
	require.NoError(t, err)
	assert.Equal(t, 1, seq, "first ticket after day rollover must be seq 1")

	// Second call must return 2
	seq2, err := svc.NextSeq(tenantID)
	require.NoError(t, err)
	assert.Equal(t, 2, seq2)
}

// TestQueueCrossDayCleanup verifies that entries with queue_date < today are deleted.
func TestQueueCrossDayCleanup(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "queue-crossday-"+t.Name())
	db.Create(&model.User{TenantID: tenant.ID, Username: "doc_crossday", PasswordHash: "h", RealName: "医生", Status: 1})
	svc := service.NewQueueService(db)
	tenantID := uint(tenant.ID)

	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")

	// Manually insert two old entries (queue_date = yesterday).
	oldEntry1 := model.QueueEntry{
		TenantID:    tenantID,
		PatientName: "昨日患者1",
		DoctorID:    1,
		DoctorName:  "医生",
		SeqNumber:   1,
		Status:      "waiting",
		Source:      "walk_in",
		QueueDate:   yesterday,
	}
	oldEntry2 := model.QueueEntry{
		TenantID:    tenantID,
		PatientName: "昨日患者2",
		DoctorID:    1,
		DoctorName:  "医生",
		SeqNumber:   2,
		Status:      "done",
		Source:      "walk_in",
		QueueDate:   yesterday,
	}
	require.NoError(t, db.Create(&oldEntry1).Error)
	require.NoError(t, db.Create(&oldEntry2).Error)

	// Also create a today entry that must NOT be deleted.
	todayResult, err := svc.TakeNumber(tenantID, "今日患者", 1, "医生", "诊室", 1)
	require.NoError(t, err)

	affected, err := svc.CrossDayCleanup()
	require.NoError(t, err)
	assert.Equal(t, int64(2), affected, "exactly the two yesterday entries should be deleted")

	entries, err := svc.ListToday(tenantID, nil)
	require.NoError(t, err)
	assert.Len(t, entries, 1)
	assert.Equal(t, todayResult.Entry.ID, entries[0].ID)
}

// TestQueueCall_GhostSeeingAutoMissed verifies that an unchecked appointment entry
// that somehow ended up in "seeing" status (ghost entry) does not block calling the
// next real patient. The ghost entry should be auto-moved to "missed".
func TestQueueCall_GhostSeeingAutoMissed(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docID uint = 1

	// Create a walk_in entry and force it into seeing status directly (simulates ghost)
	ghost := takeNumber(t, svc, tenantID, "未签到预约患者", docID, "医生", "诊室")
	require.NoError(t, svc.DB.Model(&model.QueueEntry{}).Where("id = ?", ghost.ID).
		Updates(map[string]interface{}{
			"source":         "appointment",
			"checkin_status": model.CheckinStatusPending,
			"status":         model.QueueStatusSeeing,
		}).Error)

	// Create a real (walk-in) patient who should be callable
	real := takeNumber(t, svc, tenantID, "普通患者", docID, "医生", "诊室")

	// Calling the real patient should succeed despite the ghost seeing entry
	called, changed, err := svc.Call(tenantID, real.ID)
	require.NoError(t, err)
	assert.True(t, changed, "real patient should transition to seeing")
	assert.Equal(t, model.QueueStatusSeeing, called.Status)

	// Ghost entry should have been auto-moved to missed
	var ghostEntry model.QueueEntry
	require.NoError(t, svc.DB.First(&ghostEntry, ghost.ID).Error)
	assert.Equal(t, model.QueueStatusMissed, ghostEntry.Status, "ghost seeing entry must be auto-missed")
}

// TestTakeNumber_NormalizesUserIdToDoctorPK guards the fix in service.TakeNumber that
// calls resolveQueueDoctorID to normalize user_id → queue_doctor.id before storing.
// Before the fix, passing user_id as doctorID caused the entry to be stored under
// user_id, producing "two queues for the same doctor" when combined with entries
// stored under queue_doctor.id.
func TestTakeNumber_NormalizesUserIdToDoctorPK(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "queue-normalize-"+t.Name())
	svc := service.NewQueueService(db)
	tenantID := uint(tenant.ID)

	// Create a QueueDoctor with a known user_id that differs from its primary key.
	qd := model.QueueDoctor{TenantID: tenantID, UserID: 500, Room: "1诊室", Enabled: true, SortOrder: 1}
	require.NoError(t, db.Create(&qd).Error)
	require.NotEqual(t, uint(500), uint(qd.ID), "test precondition: queue_doctor.id must differ from user_id=500")

	// Simulate old admin UI passing user_id (500) instead of queue_doctor.id.
	result, err := svc.TakeNumber(tenantID, "用户ID患者", qd.UserID, "测试医生", "1诊室", 1)
	require.NoError(t, err)
	assert.Equal(t, uint(qd.ID), result.Entry.DoctorID,
		"TakeNumber must normalize user_id(%d) → queue_doctor.id(PK=%d)", qd.UserID, qd.ID)
	assert.NotEqual(t, qd.UserID, result.Entry.DoctorID,
		"queue_entry.doctor_id must NOT be the raw user_id")
}

// TestTakeNumber_AlreadyCanonicalIdUnchanged verifies that passing an already-canonical
// queue_doctor.id is stored as-is (no double-normalization side effects).
func TestTakeNumber_AlreadyCanonicalIdUnchanged(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "queue-canonical-"+t.Name())
	svc := service.NewQueueService(db)
	tenantID := uint(tenant.ID)

	qd := model.QueueDoctor{TenantID: tenantID, UserID: 600, Room: "2诊室", Enabled: true, SortOrder: 1}
	require.NoError(t, db.Create(&qd).Error)

	// Pass queue_doctor.id (canonical) — should store the same id.
	result, err := svc.TakeNumber(tenantID, "规范ID患者", uint(qd.ID), "测试医生", "2诊室", 1)
	require.NoError(t, err)
	assert.Equal(t, uint(qd.ID), result.Entry.DoctorID,
		"canonical queue_doctor.id must be preserved unchanged")
}
func TestQueueCall_RealSeeingBlocksCall(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docID uint = 1

	first := takeNumber(t, svc, tenantID, "第一号", docID, "医生", "诊室")
	second := takeNumber(t, svc, tenantID, "第二号", docID, "医生", "诊室")

	// Legitimately call first — becomes real seeing entry
	_, changed, err := svc.Call(tenantID, first.ID)
	require.NoError(t, err)
	assert.True(t, changed)

	// Calling second should be blocked (real seeing exists)
	called, changed2, err := svc.Call(tenantID, second.ID)
	require.NoError(t, err)
	assert.False(t, changed2, "real seeing entry must block calling next patient")
	assert.Equal(t, model.QueueStatusWaiting, called.Status)
}
