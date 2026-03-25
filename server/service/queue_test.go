package service_test

import (
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
	return service.NewQueueService(db), uint(tenantA.ID), uint(tenantB.ID)
}

// makeQueueSvcSingleTenant is a convenience helper that creates only one tenant.
func makeQueueSvcSingle(t *testing.T) (*service.QueueService, uint) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "queue-single-"+t.Name())
	return service.NewQueueService(db), uint(tenant.ID)
}

// TestQueueTakeNumber verifies that seq numbers auto-increment correctly.
func TestQueueTakeNumber(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const doctorID uint = 1
	const doctorName = "张医生"
	const room = "1诊室"

	e1, err := svc.TakeNumber(tenantID, "张三", doctorID, doctorName, room)
	require.NoError(t, err)
	assert.Equal(t, 1, e1.SeqNumber, "first ticket should be seq 1")
	assert.Equal(t, "waiting", e1.Status)
	assert.NotNil(t, e1.ArrivalTime)
	assert.Equal(t, tenantID, e1.TenantID)

	e2, err := svc.TakeNumber(tenantID, "李四", doctorID, doctorName, room)
	require.NoError(t, err)
	assert.Equal(t, 2, e2.SeqNumber, "second ticket should be seq 2")

	e3, err := svc.TakeNumber(tenantID, "王五", doctorID, doctorName, room)
	require.NoError(t, err)
	assert.Equal(t, 3, e3.SeqNumber, "third ticket should be seq 3")
}

// TestQueueListToday verifies listing all entries and filtering by doctor.
func TestQueueListToday(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docA uint = 10
	const docB uint = 20

	svc.TakeNumber(tenantID, "患者1", docA, "张医生", "1诊室")
	svc.TakeNumber(tenantID, "患者2", docA, "张医生", "1诊室")
	svc.TakeNumber(tenantID, "患者3", docB, "李医生", "2诊室")

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

// TestQueueCall verifies that a waiting entry becomes "seeing" after Call.
func TestQueueCall(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e, err := svc.TakeNumber(tenantID, "患者", 1, "医生", "诊室")
	require.NoError(t, err)

	called, err := svc.Call(tenantID, e.ID)
	require.NoError(t, err)
	assert.Equal(t, "seeing", called.Status)
	assert.NotNil(t, called.CalledAt)
}

// TestQueueCall_InvalidStatus verifies that calling a "done" patient returns ErrInvalidStatus.
func TestQueueCall_InvalidStatus(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e, err := svc.TakeNumber(tenantID, "患者", 1, "医生", "诊室")
	require.NoError(t, err)

	// Advance to seeing then complete so it becomes "done".
	_, err = svc.Call(tenantID, e.ID)
	require.NoError(t, err)
	_, _, err = svc.Complete(tenantID, e.ID)
	require.NoError(t, err)

	// Now try calling a done patient.
	_, err = svc.Call(tenantID, e.ID)
	assert.ErrorIs(t, err, service.ErrInvalidStatus)
}

// TestQueueComplete verifies that a seeing entry becomes "done" with CompletedAt set.
func TestQueueComplete(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e, err := svc.TakeNumber(tenantID, "患者", 1, "医生", "诊室")
	require.NoError(t, err)
	_, err = svc.Call(tenantID, e.ID)
	require.NoError(t, err)

	completed, _, err := svc.Complete(tenantID, e.ID)
	require.NoError(t, err)
	assert.Equal(t, "done", completed.Status)
	assert.NotNil(t, completed.CompletedAt)
}

// TestQueueComplete_AutoCallNext verifies that completing a patient auto-calls
// the next waiting patient for the same doctor.
func TestQueueComplete_AutoCallNext(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docID uint = 5

	first, err := svc.TakeNumber(tenantID, "第一号", docID, "医生", "诊室")
	require.NoError(t, err)
	second, err := svc.TakeNumber(tenantID, "第二号", docID, "医生", "诊室")
	require.NoError(t, err)

	// Call the first patient into the room.
	_, err = svc.Call(tenantID, first.ID)
	require.NoError(t, err)

	// Complete the first patient; second should be auto-called.
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

	e, err := svc.TakeNumber(tenantID, "唯一患者", 1, "医生", "诊室")
	require.NoError(t, err)
	_, err = svc.Call(tenantID, e.ID)
	require.NoError(t, err)

	_, next, err := svc.Complete(tenantID, e.ID)
	require.NoError(t, err)
	assert.Nil(t, next, "next should be nil when no waiting patients remain")
}

// TestQueueStats verifies that stat counts match actual entry statuses.
func TestQueueStats(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	const docID uint = 1

	// Take 3 numbers.
	e1, _ := svc.TakeNumber(tenantID, "患者1", docID, "医生", "诊室")
	e2, _ := svc.TakeNumber(tenantID, "患者2", docID, "医生", "诊室")
	svc.TakeNumber(tenantID, "患者3", docID, "医生", "诊室")

	// Call e1 → seeing.
	svc.Call(tenantID, e1.ID)

	// Complete e1 → done; e2 gets auto-called → seeing.
	svc.Complete(tenantID, e1.ID)

	// After the above: e1=done, e2=seeing (auto-called), e3=waiting.
	stats, err := svc.Stats(tenantID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), stats["done"])
	assert.Equal(t, int64(1), stats["seeing"])
	assert.Equal(t, int64(1), stats["waiting"])

	// e2 won't be auto-called again since we triggered it from Complete(e1).
	_ = e2
}

// TestQueueClear verifies that Clear removes all today's entries for a tenant.
func TestQueueClear(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	svc.TakeNumber(tenantID, "患者1", 1, "医生", "诊室")
	svc.TakeNumber(tenantID, "患者2", 1, "医生", "诊室")

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

	svc.TakeNumber(tenantA, "A患者", 1, "医生", "诊室")
	svc.TakeNumber(tenantA, "A患者2", 1, "医生", "诊室")
	svc.TakeNumber(tenantB, "B患者", 1, "医生", "诊室")

	entriesA, err := svc.ListToday(tenantA, nil)
	require.NoError(t, err)
	assert.Len(t, entriesA, 2, "tenant A should see only its own entries")
	for _, e := range entriesA {
		assert.Equal(t, tenantA, e.TenantID)
	}

	entriesB, err := svc.ListToday(tenantB, nil)
	require.NoError(t, err)
	assert.Len(t, entriesB, 1, "tenant B should see only its own entry")
	assert.Equal(t, tenantB, entriesB[0].TenantID)
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
			e, err := svc.TakeNumber(tenantID, "并发患者", 1, "医生", "诊室")
			require.NoError(t, err)
			results <- e.SeqNumber
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

	_, err := svc.Call(tenantID, 99999)
	assert.ErrorIs(t, err, service.ErrQueueEntryNotFound)
}

// TestQueueComplete_WaitingStatus verifies that completing a waiting (not seeing) entry
// returns ErrInvalidStatus.
func TestQueueComplete_WaitingStatus(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e, err := svc.TakeNumber(tenantID, "患者", 1, "医生", "诊室")
	require.NoError(t, err)
	require.Equal(t, "waiting", e.Status)

	// Attempt to complete without calling first.
	_, _, err = svc.Complete(tenantID, e.ID)
	assert.ErrorIs(t, err, service.ErrInvalidStatus)
}

// TestQueueTakeNumber_EmptyName verifies that TakeNumber accepts an empty patient name
// at the service level (validation is the handler's responsibility).
func TestQueueTakeNumber_EmptyName(t *testing.T) {
	svc, tenantID := makeQueueSvcSingle(t)

	e, err := svc.TakeNumber(tenantID, "", 1, "医生", "诊室")
	require.NoError(t, err)
	assert.Equal(t, "", e.PatientName)
	assert.Equal(t, 1, e.SeqNumber)
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

// TestQueueCrossDayCleanup verifies that entries with queue_date < today are deleted.
func TestQueueCrossDayCleanup(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "queue-crossday-"+t.Name())
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
	todayEntry, err := svc.TakeNumber(tenantID, "今日患者", 1, "医生", "诊室")
	require.NoError(t, err)

	affected, err := svc.CrossDayCleanup()
	require.NoError(t, err)
	assert.Equal(t, int64(2), affected, "exactly the two yesterday entries should be deleted")

	// Today's entry should still exist.
	entries, err := svc.ListToday(tenantID, nil)
	require.NoError(t, err)
	assert.Len(t, entries, 1)
	assert.Equal(t, todayEntry.ID, entries[0].ID)
}
