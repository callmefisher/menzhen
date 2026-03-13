package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

// ---------- helpers ----------

// setupPrescriptionTest creates DB, tenant, user, patient, and a medical record.
// Returns the PrescriptionService plus IDs needed for tests.
func setupPrescriptionTest(t *testing.T) (*service.PrescriptionService, uint64, uint64, uint64) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	pSvc := service.NewPrescriptionService(db)

	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	// Create a medical record that prescriptions can reference.
	rSvc := service.NewRecordService(db)
	record, err := rSvc.CreateRecord(tenant.ID, user.ID, &service.CreateRecordRequest{
		PatientID: patient.ID,
		VisitDate: "2025-06-01",
		Diagnosis: "感冒",
	})
	if err != nil {
		t.Fatalf("failed to seed record: %v", err)
	}

	return pSvc, tenant.ID, user.ID, record.ID
}

func baseCreatePrescriptionReq(recordID uint64) *service.CreatePrescriptionRequest {
	return &service.CreatePrescriptionRequest{
		RecordID:    recordID,
		FormulaName: "小青龙汤",
		TotalDoses:  5,
		Notes:       "饭后温服",
		Items: []service.PrescriptionItemRequest{
			{HerbName: "麻黄", Dosage: "9g", SortOrder: 1},
			{HerbName: "桂枝", Dosage: "9g", SortOrder: 2},
			{HerbName: "白芍", Dosage: "9g", SortOrder: 3},
		},
	}
}

// ---------- Create ----------

func TestPrescription_Create_Success(t *testing.T) {
	svc, tenantID, userID, recordID := setupPrescriptionTest(t)

	req := baseCreatePrescriptionReq(recordID)
	p, err := svc.Create(tenantID, userID, req)

	assert.NoError(t, err)
	assert.NotZero(t, p.ID)
	assert.Equal(t, recordID, p.RecordID)
	assert.Equal(t, tenantID, p.TenantID)
	assert.Equal(t, "小青龙汤", p.FormulaName)
	assert.Equal(t, 5, p.TotalDoses)
	assert.Len(t, p.Items, 3)
	assert.Equal(t, "麻黄", p.Items[0].HerbName)
}

func TestPrescription_Create_DefaultDoses(t *testing.T) {
	svc, tenantID, userID, recordID := setupPrescriptionTest(t)

	req := baseCreatePrescriptionReq(recordID)
	req.TotalDoses = 0 // should default to 7

	p, err := svc.Create(tenantID, userID, req)

	assert.NoError(t, err)
	assert.Equal(t, 7, p.TotalDoses)
}

func TestPrescription_Create_InvalidRecord(t *testing.T) {
	svc, tenantID, userID, _ := setupPrescriptionTest(t)

	req := baseCreatePrescriptionReq(99999) // non-existent record
	_, err := svc.Create(tenantID, userID, req)

	assert.ErrorIs(t, err, service.ErrRecordInvalid)
}

func TestPrescription_Create_CrossTenantRecord(t *testing.T) {
	db := testutil.SetupTestDB(t)
	pSvc := service.NewPrescriptionService(db)
	rSvc := service.NewRecordService(db)

	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "docA", "pass", nil)
	userB, _ := testutil.SeedTestUser(t, db, tenantB.ID, "docB", "pass", nil)
	patientA := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "患者A")

	recordA, err := rSvc.CreateRecord(tenantA.ID, userA.ID, &service.CreateRecordRequest{
		PatientID: patientA.ID,
		VisitDate: "2025-06-01",
	})
	assert.NoError(t, err)

	// Tenant B tries to create a prescription for Tenant A's record.
	req := baseCreatePrescriptionReq(recordA.ID)
	_, err = pSvc.Create(tenantB.ID, userB.ID, req)

	assert.ErrorIs(t, err, service.ErrRecordInvalid)
}

// ---------- Get ----------

func TestPrescription_Get_Success(t *testing.T) {
	svc, tenantID, userID, recordID := setupPrescriptionTest(t)

	req := baseCreatePrescriptionReq(recordID)
	created, err := svc.Create(tenantID, userID, req)
	assert.NoError(t, err)

	got, err := svc.Get(tenantID, created.ID)

	assert.NoError(t, err)
	assert.Equal(t, created.ID, got.ID)
	assert.Equal(t, "小青龙汤", got.FormulaName)
	assert.Len(t, got.Items, 3)
	// Items should be sorted by sort_order.
	assert.Equal(t, "麻黄", got.Items[0].HerbName)
	assert.Equal(t, "桂枝", got.Items[1].HerbName)
	assert.Equal(t, "白芍", got.Items[2].HerbName)
	// Creator should be preloaded.
	assert.Equal(t, "doc1", got.Creator.Username)
}

func TestPrescription_Get_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	pSvc := service.NewPrescriptionService(db)
	rSvc := service.NewRecordService(db)

	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "docA", "pass", nil)
	patientA := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "患者A")

	recordA, err := rSvc.CreateRecord(tenantA.ID, userA.ID, &service.CreateRecordRequest{
		PatientID: patientA.ID,
		VisitDate: "2025-06-01",
	})
	assert.NoError(t, err)

	created, err := pSvc.Create(tenantA.ID, userA.ID, baseCreatePrescriptionReq(recordA.ID))
	assert.NoError(t, err)

	_, err = pSvc.Get(tenantB.ID, created.ID)
	assert.ErrorIs(t, err, service.ErrPrescriptionNotFound)
}

// ---------- ListByRecord ----------

func TestPrescription_ListByRecord_Success(t *testing.T) {
	svc, tenantID, userID, recordID := setupPrescriptionTest(t)

	// Create two prescriptions for the same record.
	req1 := baseCreatePrescriptionReq(recordID)
	req1.FormulaName = "方一"
	_, err := svc.Create(tenantID, userID, req1)
	assert.NoError(t, err)

	req2 := baseCreatePrescriptionReq(recordID)
	req2.FormulaName = "方二"
	_, err = svc.Create(tenantID, userID, req2)
	assert.NoError(t, err)

	list, err := svc.ListByRecord(tenantID, recordID)

	assert.NoError(t, err)
	assert.Len(t, list, 2)
	// Each prescription should have its items preloaded.
	for _, p := range list {
		assert.Len(t, p.Items, 3)
	}
}

func TestPrescription_ListByRecord_Empty(t *testing.T) {
	svc, tenantID, _, recordID := setupPrescriptionTest(t)

	list, err := svc.ListByRecord(tenantID, recordID)

	assert.NoError(t, err)
	assert.Empty(t, list)
}

// ---------- Update ----------

func TestPrescription_Update_ChangeItems(t *testing.T) {
	svc, tenantID, userID, recordID := setupPrescriptionTest(t)

	created, err := svc.Create(tenantID, userID, baseCreatePrescriptionReq(recordID))
	assert.NoError(t, err)
	assert.Len(t, created.Items, 3)

	newFormula := "银翘散"
	newDoses := 3
	old, updated, err := svc.Update(tenantID, created.ID, &service.UpdatePrescriptionRequest{
		FormulaName: &newFormula,
		TotalDoses:  &newDoses,
		Items: []service.PrescriptionItemRequest{
			{HerbName: "金银花", Dosage: "15g", SortOrder: 1},
			{HerbName: "连翘", Dosage: "10g", SortOrder: 2},
		},
	})

	assert.NoError(t, err)
	// Old values preserved.
	assert.Equal(t, "小青龙汤", old.FormulaName)
	assert.Len(t, old.Items, 3)
	// New values applied.
	assert.Equal(t, "银翘散", updated.FormulaName)
	assert.Equal(t, 3, updated.TotalDoses)
	assert.Len(t, updated.Items, 2)
	assert.Equal(t, "金银花", updated.Items[0].HerbName)

	// Verify old items are actually deleted from DB.
	var count int64
	svc.DB.Model(&model.PrescriptionItem{}).Where("prescription_id = ?", created.ID).Count(&count)
	assert.Equal(t, int64(2), count)
}

// ---------- Delete ----------

func TestPrescription_Delete_Success(t *testing.T) {
	svc, tenantID, userID, recordID := setupPrescriptionTest(t)

	created, err := svc.Create(tenantID, userID, baseCreatePrescriptionReq(recordID))
	assert.NoError(t, err)

	deleted, err := svc.Delete(tenantID, created.ID)

	assert.NoError(t, err)
	assert.Equal(t, created.ID, deleted.ID)

	// Verify it's gone.
	_, err = svc.Get(tenantID, created.ID)
	assert.ErrorIs(t, err, service.ErrPrescriptionNotFound)
}

func TestPrescription_Delete_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	pSvc := service.NewPrescriptionService(db)
	rSvc := service.NewRecordService(db)

	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "docA", "pass", nil)
	patientA := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "患者A")

	recordA, err := rSvc.CreateRecord(tenantA.ID, userA.ID, &service.CreateRecordRequest{
		PatientID: patientA.ID,
		VisitDate: "2025-06-01",
	})
	assert.NoError(t, err)

	created, err := pSvc.Create(tenantA.ID, userA.ID, baseCreatePrescriptionReq(recordA.ID))
	assert.NoError(t, err)

	_, err = pSvc.Delete(tenantB.ID, created.ID)
	assert.ErrorIs(t, err, service.ErrPrescriptionNotFound)

	// Confirm it still exists for the real tenant.
	got, err := pSvc.Get(tenantA.ID, created.ID)
	assert.NoError(t, err)
	assert.Equal(t, created.ID, got.ID)
}
