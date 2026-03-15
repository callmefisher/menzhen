package service

import (
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupFollowUpTest(t *testing.T) (*FollowUpService, uint64, uint64, uint64) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "测试诊所", "test")
	perms := testutil.SeedAllPermissions(t, db)
	_ = perms
	role := testutil.SeedTestRole(t, db, tenant.ID, "admin")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor", "pass", role)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	svc := NewFollowUpService(db)
	return svc, tenant.ID, user.ID, patient.ID
}

func TestFollowUpCreate(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	req := &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2026-03-20",
		Method:      "电话",
		Content:     "术后回访",
	}
	fu, err := svc.Create(tenantID, userID, req)
	require.NoError(t, err)
	assert.Equal(t, patientID, fu.PatientID)
	assert.Equal(t, "pending", fu.Status)
	assert.Equal(t, "电话", fu.Method)
	assert.Nil(t, fu.RecordID)
}

func TestFollowUpCreateWithRecord(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "测试诊所", "test")
	role := testutil.SeedTestRole(t, db, tenant.ID, "admin")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor", "pass", role)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "李四")

	// Create a medical record
	record := model.MedicalRecord{
		TenantID:  tenant.ID,
		PatientID: patient.ID,
		Diagnosis: "感冒",
		VisitDate: time.Now(),
		CreatedBy: user.ID,
	}
	require.NoError(t, db.Create(&record).Error)

	svc := NewFollowUpService(db)
	recordID := record.ID
	req := &CreateFollowUpRequest{
		PatientID:   patient.ID,
		RecordID:    &recordID,
		PlannedDate: "2026-03-25",
		Method:      "微信",
	}
	fu, err := svc.Create(tenant.ID, user.ID, req)
	require.NoError(t, err)
	assert.NotNil(t, fu.RecordID)
	assert.Equal(t, recordID, *fu.RecordID)
}

func TestFollowUpCreateInvalidDate(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	req := &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "invalid-date",
		Method:      "电话",
	}
	_, err := svc.Create(tenantID, userID, req)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid planned_date")
}

func TestFollowUpList(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	// Create 3 follow-ups
	for i := 0; i < 3; i++ {
		_, err := svc.Create(tenantID, userID, &CreateFollowUpRequest{
			PatientID:   patientID,
			PlannedDate: "2026-03-20",
			Method:      "电话",
		})
		require.NoError(t, err)
	}

	items, total, err := svc.List(tenantID, "", "", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	assert.Len(t, items, 3)
	assert.Equal(t, "张三", items[0].PatientName)
}

func TestFollowUpListFilterByStatus(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	// Create pending (future)
	_, err := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2099-12-31",
		Method:      "电话",
	})
	require.NoError(t, err)

	// Create overdue (past, still pending)
	_, err = svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2020-01-01",
		Method:      "微信",
	})
	require.NoError(t, err)

	// Filter pending only (future)
	items, _, err := svc.List(tenantID, "", "pending", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, 1, len(items))
	assert.Equal(t, "pending", items[0].Status)

	// Filter overdue
	items, _, err = svc.List(tenantID, "", "overdue", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, 1, len(items))
	assert.Equal(t, "overdue", items[0].Status)
}

func TestFollowUpUpdate(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	fu, err := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2026-03-20",
		Method:      "电话",
	})
	require.NoError(t, err)

	// Update with actual_date → completed
	actualDate := "2026-03-21"
	newMethod := "微信"
	_, updated, err := svc.Update(tenantID, fu.ID, &UpdateFollowUpRequest{
		ActualDate: &actualDate,
		Method:     &newMethod,
	})
	require.NoError(t, err)
	assert.Equal(t, "completed", updated.Status)
	assert.NotNil(t, updated.ActualDate)
	assert.Equal(t, "微信", updated.Method)
}

func TestFollowUpUpdateClearActualDate(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	fu, _ := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2026-03-20",
		Method:      "电话",
	})

	// Set actual_date
	ad := "2026-03-21"
	svc.Update(tenantID, fu.ID, &UpdateFollowUpRequest{ActualDate: &ad})

	// Clear actual_date → revert to pending
	empty := ""
	_, updated, err := svc.Update(tenantID, fu.ID, &UpdateFollowUpRequest{ActualDate: &empty})
	require.NoError(t, err)
	assert.Equal(t, "pending", updated.Status)
	assert.Nil(t, updated.ActualDate)
}

func TestFollowUpDelete(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	fu, _ := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2026-03-20",
		Method:      "电话",
	})

	deleted, err := svc.Delete(tenantID, fu.ID)
	require.NoError(t, err)
	assert.Equal(t, fu.ID, deleted.ID)

	// Verify not found after delete
	_, err = svc.GetByID(tenantID, fu.ID)
	assert.ErrorIs(t, err, ErrFollowUpNotFound)
}

func TestFollowUpDeleteNotFound(t *testing.T) {
	svc, tenantID, _, _ := setupFollowUpTest(t)
	_, err := svc.Delete(tenantID, 99999)
	assert.ErrorIs(t, err, ErrFollowUpNotFound)
}

func TestFollowUpTenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	role1 := testutil.SeedTestRole(t, db, tenant1.ID, "admin")
	role2 := testutil.SeedTestRole(t, db, tenant2.ID, "admin")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", role1)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", role2)
	patient1 := testutil.SeedTestPatient(t, db, tenant1.ID, user1.ID, "患者A")
	patient2 := testutil.SeedTestPatient(t, db, tenant2.ID, user2.ID, "患者B")

	svc := NewFollowUpService(db)

	// Create in tenant1
	svc.Create(tenant1.ID, user1.ID, &CreateFollowUpRequest{
		PatientID: patient1.ID, PlannedDate: "2026-03-20", Method: "电话",
	})

	// Create in tenant2
	svc.Create(tenant2.ID, user2.ID, &CreateFollowUpRequest{
		PatientID: patient2.ID, PlannedDate: "2026-03-20", Method: "微信",
	})

	// Tenant1 should only see its own
	items, total, err := svc.List(tenant1.ID, "", "", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "患者A", items[0].PatientName)

	// Tenant2 should only see its own
	items, total, err = svc.List(tenant2.ID, "", "", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "患者B", items[0].PatientName)
}

func TestFollowUpStats(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	// Create future pending
	svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, PlannedDate: "2099-12-31", Method: "电话",
	})

	// Create overdue (past pending)
	svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, PlannedDate: "2020-01-01", Method: "微信",
	})

	// Create completed
	fu, _ := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, PlannedDate: "2026-03-01", Method: "到诊",
	})
	ad := "2026-03-02"
	svc.Update(tenantID, fu.ID, &UpdateFollowUpRequest{ActualDate: &ad})

	stats, err := svc.Stats(tenantID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), stats.PendingCount)
	assert.Equal(t, int64(1), stats.OverdueCount)
	assert.Equal(t, int64(1), stats.CompletedCount)
}
