package service_test

import (
	"fmt"
	"testing"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

// ---------- helpers ----------

func setupRecordTest(t *testing.T) (*service.RecordService, uint64, uint64, uint64) {
	t.Helper()
	db := testutil.SetupTestDB(t)
	svc := service.NewRecordService(db)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")
	return svc, tenant.ID, user.ID, patient.ID
}

func baseCreateRecordReq(patientID uint64) *service.CreateRecordRequest {
	return &service.CreateRecordRequest{
		PatientID:      patientID,
		Diagnosis:      "感冒",
		Treatment:      "桂枝汤加减",
		Notes:          "三天后复诊",
		VisitDate:      "2025-06-01",
		ChiefComplaint: "头痛发热两天",
		PulseName:      "浮脉",
	}
}

// ---------- CreateRecord ----------

func TestCreateRecord_Success(t *testing.T) {
	svc, tenantID, userID, patientID := setupRecordTest(t)

	req := baseCreateRecordReq(patientID)
	record, err := svc.CreateRecord(tenantID, userID, req)

	assert.NoError(t, err)
	assert.NotZero(t, record.ID)
	assert.Equal(t, patientID, record.PatientID)
	assert.Equal(t, tenantID, record.TenantID)
	assert.Equal(t, "感冒", record.Diagnosis)
	assert.Equal(t, "桂枝汤加减", record.Treatment)
	assert.Equal(t, "头痛发热两天", record.ChiefComplaint)
	assert.Equal(t, "浮脉", record.PulseName)
	assert.Equal(t, "2025-06-01", record.VisitDate.Format("2006-01-02"))
}

func TestCreateRecord_WithAttachments(t *testing.T) {
	svc, tenantID, userID, patientID := setupRecordTest(t)

	req := baseCreateRecordReq(patientID)
	req.Attachments = []service.AttachmentRequest{
		{FileType: "image", FileName: "tongue.jpg", FilePath: "/uploads/tongue.jpg", FileSize: 1024},
		{FileType: "audio", FileName: "voice.mp3", FilePath: "/uploads/voice.mp3", FileSize: 2048},
	}

	record, err := svc.CreateRecord(tenantID, userID, req)

	assert.NoError(t, err)
	assert.Len(t, record.Attachments, 2)
	assert.Equal(t, "tongue.jpg", record.Attachments[0].FileName)
	assert.Equal(t, int64(1024), record.Attachments[0].FileSize)
	assert.Equal(t, "audio", record.Attachments[1].FileType)
}

func TestCreateRecord_InvalidPatient(t *testing.T) {
	svc, tenantID, userID, _ := setupRecordTest(t)

	req := baseCreateRecordReq(99999) // non-existent patient
	_, err := svc.CreateRecord(tenantID, userID, req)

	assert.ErrorIs(t, err, service.ErrPatientInvalid)
}

func TestCreateRecord_CrossTenantPatient(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewRecordService(db)

	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "docA", "pass", nil)
	userB, _ := testutil.SeedTestUser(t, db, tenantB.ID, "docB", "pass", nil)
	patientA := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "患者A")

	// Tenant B tries to create a record for Tenant A's patient.
	req := baseCreateRecordReq(patientA.ID)
	_, err := svc.CreateRecord(tenantB.ID, userB.ID, req)

	assert.ErrorIs(t, err, service.ErrPatientInvalid)
}

// ---------- GetRecord ----------

func TestGetRecord_Success(t *testing.T) {
	svc, tenantID, userID, patientID := setupRecordTest(t)

	req := baseCreateRecordReq(patientID)
	req.Attachments = []service.AttachmentRequest{
		{FileType: "image", FileName: "x.jpg", FilePath: "/uploads/x.jpg", FileSize: 512},
	}
	created, err := svc.CreateRecord(tenantID, userID, req)
	assert.NoError(t, err)

	got, err := svc.GetRecord(tenantID, created.ID)

	assert.NoError(t, err)
	assert.Equal(t, created.ID, got.ID)
	assert.Equal(t, "张三", got.Patient.Name)
	assert.Len(t, got.Attachments, 1)
}

func TestGetRecord_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewRecordService(db)

	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "docA", "pass", nil)
	patientA := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "患者A")

	req := baseCreateRecordReq(patientA.ID)
	created, err := svc.CreateRecord(tenantA.ID, userA.ID, req)
	assert.NoError(t, err)

	// Tenant B tries to get Tenant A's record.
	_, err = svc.GetRecord(tenantB.ID, created.ID)
	assert.ErrorIs(t, err, service.ErrRecordNotFound)
}

// ---------- ListRecords ----------

func TestListRecords_Pagination(t *testing.T) {
	svc, tenantID, userID, patientID := setupRecordTest(t)

	// Create 5 records with different dates.
	for i := 1; i <= 5; i++ {
		req := &service.CreateRecordRequest{
			PatientID: patientID,
			Diagnosis: "诊断",
			VisitDate: "2025-06-0" + string(rune('0'+i)),
		}
		_, err := svc.CreateRecord(tenantID, userID, req)
		assert.NoError(t, err)
	}

	// Page 1, size 2 -> should get 2 items, total 5.
	items, total, err := svc.ListRecords(tenantID, "", "", 1, 2)

	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, items, 2)

	// Page 3, size 2 -> should get 1 item.
	items2, total2, err := svc.ListRecords(tenantID, "", "", 3, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total2)
	assert.Len(t, items2, 1)
}

func TestListRecords_SearchByName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewRecordService(db)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	p1 := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")
	p2 := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "李四")

	_, err := svc.CreateRecord(tenant.ID, user.ID, &service.CreateRecordRequest{PatientID: p1.ID, VisitDate: "2025-06-01"})
	assert.NoError(t, err)
	_, err = svc.CreateRecord(tenant.ID, user.ID, &service.CreateRecordRequest{PatientID: p2.ID, VisitDate: "2025-06-02"})
	assert.NoError(t, err)

	items, total, err := svc.ListRecords(tenant.ID, "张", "", 1, 10)

	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, items, 1)
	assert.Equal(t, "张三", items[0].PatientName)
}

func TestListRecords_FilterByDate(t *testing.T) {
	svc, tenantID, userID, patientID := setupRecordTest(t)

	_, err := svc.CreateRecord(tenantID, userID, &service.CreateRecordRequest{PatientID: patientID, VisitDate: "2025-01-10"})
	assert.NoError(t, err)
	_, err = svc.CreateRecord(tenantID, userID, &service.CreateRecordRequest{PatientID: patientID, VisitDate: "2025-06-15"})
	assert.NoError(t, err)
	_, err = svc.CreateRecord(tenantID, userID, &service.CreateRecordRequest{PatientID: patientID, VisitDate: "2025-12-20"})
	assert.NoError(t, err)

	// Filter to June only.
	items, total, err := svc.ListRecords(tenantID, "", "2025-06-01,2025-06-30", 1, 10)

	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, items, 1)
	assert.Equal(t, "2025-06-15", items[0].VisitDate)
}

// ---------- UpdateRecord ----------

func TestUpdateRecord_PartialUpdate(t *testing.T) {
	svc, tenantID, userID, patientID := setupRecordTest(t)

	req := baseCreateRecordReq(patientID)
	created, err := svc.CreateRecord(tenantID, userID, req)
	assert.NoError(t, err)

	newDiag := "流感"
	old, updated, err := svc.UpdateRecord(tenantID, created.ID, &service.UpdateRecordRequest{
		Diagnosis: &newDiag,
	})

	assert.NoError(t, err)
	assert.Equal(t, "感冒", old.Diagnosis)        // old value preserved
	assert.Equal(t, "流感", updated.Diagnosis)      // new value applied
	assert.Equal(t, "桂枝汤加减", updated.Treatment) // unchanged field kept
}

func TestUpdateRecord_ReplaceAttachments(t *testing.T) {
	svc, tenantID, userID, patientID := setupRecordTest(t)

	req := baseCreateRecordReq(patientID)
	req.Attachments = []service.AttachmentRequest{
		{FileType: "image", FileName: "old.jpg", FilePath: "/old.jpg", FileSize: 100},
	}
	created, err := svc.CreateRecord(tenantID, userID, req)
	assert.NoError(t, err)
	assert.Len(t, created.Attachments, 1)

	// Replace with two new attachments.
	_, updated, err := svc.UpdateRecord(tenantID, created.ID, &service.UpdateRecordRequest{
		Attachments: []service.AttachmentRequest{
			{FileType: "image", FileName: "new1.jpg", FilePath: "/new1.jpg", FileSize: 200},
			{FileType: "video", FileName: "new2.mp4", FilePath: "/new2.mp4", FileSize: 300},
		},
	})

	assert.NoError(t, err)
	assert.Len(t, updated.Attachments, 2)
	assert.Equal(t, "new1.jpg", updated.Attachments[0].FileName)
}

func TestRecordService_UpdateRecord_AllFields(t *testing.T) {
	svc, tenantID, userID, patientID := setupRecordTest(t)

	req := baseCreateRecordReq(patientID)
	created, err := svc.CreateRecord(tenantID, userID, req)
	assert.NoError(t, err)

	newDiagnosis := "流感"
	newTreatment := "银翘散加减"
	newNotes := "五天后复诊"
	newVisitDate := "2025-07-15"
	newChiefComplaint := "咽痛咳嗽三天"
	newPulseName := "数脉"
	newTongueImage := "/uploads/tongue_new.jpg"
	newTongueDescription := "舌红苔黄"
	newTongueAnalysis := "热证表现"

	old, updated, err := svc.UpdateRecord(tenantID, created.ID, &service.UpdateRecordRequest{
		Diagnosis:         &newDiagnosis,
		Treatment:         &newTreatment,
		Notes:             &newNotes,
		VisitDate:         &newVisitDate,
		ChiefComplaint:    &newChiefComplaint,
		PulseName:         &newPulseName,
		TongueImage:       &newTongueImage,
		TongueDescription: &newTongueDescription,
		TongueAnalysis:    &newTongueAnalysis,
	})

	assert.NoError(t, err)
	assert.NotNil(t, old)
	assert.NotNil(t, updated)

	// Verify old values preserved.
	assert.Equal(t, "感冒", old.Diagnosis)
	assert.Equal(t, "桂枝汤加减", old.Treatment)

	// Verify all fields updated.
	assert.Equal(t, "流感", updated.Diagnosis)
	assert.Equal(t, "银翘散加减", updated.Treatment)
	assert.Equal(t, "五天后复诊", updated.Notes)
	assert.Equal(t, "2025-07-15", updated.VisitDate.Format("2006-01-02"))
	assert.Equal(t, "咽痛咳嗽三天", updated.ChiefComplaint)
	assert.Equal(t, "数脉", updated.PulseName)
	assert.Equal(t, "/uploads/tongue_new.jpg", updated.TongueImage)
	assert.Equal(t, "舌红苔黄", updated.TongueDescription)
	assert.Equal(t, "热证表现", updated.TongueAnalysis)
}

func TestUpdateRecord_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewRecordService(db)

	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "docA", "pass", nil)
	patientA := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "患者A")

	req := baseCreateRecordReq(patientA.ID)
	created, err := svc.CreateRecord(tenantA.ID, userA.ID, req)
	assert.NoError(t, err)

	newDiag := "hacked"
	_, _, err = svc.UpdateRecord(tenantB.ID, created.ID, &service.UpdateRecordRequest{Diagnosis: &newDiag})
	assert.ErrorIs(t, err, service.ErrRecordNotFound)
}

// ---------- DeleteRecord ----------

func TestDeleteRecord_Success(t *testing.T) {
	svc, tenantID, userID, patientID := setupRecordTest(t)

	req := baseCreateRecordReq(patientID)
	created, err := svc.CreateRecord(tenantID, userID, req)
	assert.NoError(t, err)

	deleted, err := svc.DeleteRecord(tenantID, created.ID)

	assert.NoError(t, err)
	assert.Equal(t, created.ID, deleted.ID)

	// Verify it's gone.
	_, err = svc.GetRecord(tenantID, created.ID)
	assert.ErrorIs(t, err, service.ErrRecordNotFound)
}

func TestDeleteRecord_CrossTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewRecordService(db)

	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "docA", "pass", nil)
	patientA := testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "患者A")

	req := baseCreateRecordReq(patientA.ID)
	created, err := svc.CreateRecord(tenantA.ID, userA.ID, req)
	assert.NoError(t, err)

	_, err = svc.DeleteRecord(tenantB.ID, created.ID)
	assert.ErrorIs(t, err, service.ErrRecordNotFound)

	// Confirm it still exists for the real tenant.
	got, err := svc.GetRecord(tenantA.ID, created.ID)
	assert.NoError(t, err)
	assert.Equal(t, created.ID, got.ID)
}

func TestRecordService_FindRecordPage(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewRecordService(db)

	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	// Create 5 records with different dates
	for i := 0; i < 5; i++ {
		req := &service.CreateRecordRequest{
			PatientID: patient.ID,
			Diagnosis: fmt.Sprintf("诊断%d", i),
			VisitDate: fmt.Sprintf("2025-01-%02d", i+1),
		}
		_, err := svc.CreateRecord(tenant.ID, user.ID, req)
		assert.NoError(t, err)
	}

	// Get all records to find an ID
	items, total, err := svc.ListRecords(tenant.ID, "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.True(t, len(items) > 0)

	// Find page for the first listed record
	page, err := svc.FindRecordPage(tenant.ID, items[0].ID, 2)
	assert.NoError(t, err)
	assert.Equal(t, 1, page)
}
