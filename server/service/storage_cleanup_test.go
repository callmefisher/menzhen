package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func TestScanOrphanFiles_EmptyDB(t *testing.T) {
	db := testutil.SetupTestDB(t)

	svc := &service.StorageCleanupService{
		DB: db,
		// MinIOClient is nil — ScanOrphanFiles only needs DB for referenced paths,
		// but ListAllObjects needs MinIO. We test the DB query portion here.
	}

	// We can't call ScanOrphanFiles without a real MinIO client.
	// Instead test the DB queries via GetReferencedPaths.
	referenced, err := svc.GetReferencedPaths()
	assert.NoError(t, err)
	assert.Empty(t, referenced)
}

func TestScanOrphanFiles_WithRecords(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	// Create a record with attachments and tongue image.
	recordSvc := service.NewRecordService(db)
	record, err := recordSvc.CreateRecord(tenant.ID, user.ID, &service.CreateRecordRequest{
		PatientID:   patient.ID,
		VisitDate:   "2025-06-01",
		TongueImage: "1/image/tongue-abc.jpg",
		Attachments: []service.AttachmentRequest{
			{FileType: "image", FileName: "xray.jpg", FilePath: "1/image/xray-123.jpg", FileSize: 1024},
			{FileType: "audio", FileName: "pulse.mp3", FilePath: "1/audio/pulse-456.mp3", FileSize: 2048},
		},
	})
	assert.NoError(t, err)
	assert.NotZero(t, record.ID)

	svc := &service.StorageCleanupService{DB: db}
	referenced, err := svc.GetReferencedPaths()
	assert.NoError(t, err)
	assert.Len(t, referenced, 3)
	assert.Contains(t, referenced, "1/image/tongue-abc.jpg")
	assert.Contains(t, referenced, "1/image/xray-123.jpg")
	assert.Contains(t, referenced, "1/audio/pulse-456.mp3")
}

func TestScanOrphanFiles_SoftDeletedRecordExcluded(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	recordSvc := service.NewRecordService(db)
	record, err := recordSvc.CreateRecord(tenant.ID, user.ID, &service.CreateRecordRequest{
		PatientID:   patient.ID,
		VisitDate:   "2025-06-01",
		TongueImage: "1/image/tongue-to-delete.jpg",
		Attachments: []service.AttachmentRequest{
			{FileType: "image", FileName: "to-delete.jpg", FilePath: "1/image/to-delete.jpg", FileSize: 1024},
		},
	})
	assert.NoError(t, err)

	// Delete the record — tongue image should no longer be referenced,
	// but attachments are hard-deleted so also not referenced.
	_, err = recordSvc.DeleteRecord(tenant.ID, record.ID)
	assert.NoError(t, err)

	svc := &service.StorageCleanupService{DB: db}
	referenced, err := svc.GetReferencedPaths()
	assert.NoError(t, err)
	// Tongue image of soft-deleted record should be excluded.
	// Attachments were hard-deleted.
	assert.Empty(t, referenced)
}

func TestFindOrphanFiles(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	recordSvc := service.NewRecordService(db)
	_, err := recordSvc.CreateRecord(tenant.ID, user.ID, &service.CreateRecordRequest{
		PatientID:   patient.ID,
		VisitDate:   "2025-06-01",
		TongueImage: "1/image/tongue.jpg",
		Attachments: []service.AttachmentRequest{
			{FileType: "image", FileName: "xray.jpg", FilePath: "1/image/xray.jpg", FileSize: 1024},
		},
	})
	assert.NoError(t, err)

	svc := &service.StorageCleanupService{DB: db}

	// Simulate MinIO keys — some referenced, some orphaned.
	allKeys := []string{
		"1/image/tongue.jpg",   // referenced
		"1/image/xray.jpg",     // referenced
		"1/image/orphan-1.jpg", // orphan
		"1/audio/orphan-2.mp3", // orphan
	}

	orphans := svc.FindOrphanFiles(allKeys, map[string]bool{
		"1/image/tongue.jpg": true,
		"1/image/xray.jpg":   true,
	})
	assert.Len(t, orphans, 2)
	assert.Contains(t, orphans, "1/image/orphan-1.jpg")
	assert.Contains(t, orphans, "1/audio/orphan-2.mp3")
}

func TestUpdateRecord_CleansUpOldAttachments(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	svc := service.NewRecordService(db)
	record, err := svc.CreateRecord(tenant.ID, user.ID, &service.CreateRecordRequest{
		PatientID:   patient.ID,
		VisitDate:   "2025-06-01",
		TongueImage: "1/image/old-tongue.jpg",
		Attachments: []service.AttachmentRequest{
			{FileType: "image", FileName: "old.jpg", FilePath: "1/image/old.jpg", FileSize: 1024},
		},
	})
	assert.NoError(t, err)

	// Update with new attachments and new tongue image.
	newTongue := "1/image/new-tongue.jpg"
	_, updated, err := svc.UpdateRecord(tenant.ID, record.ID, &service.UpdateRecordRequest{
		TongueImage: &newTongue,
		Attachments: []service.AttachmentRequest{
			{FileType: "image", FileName: "new.jpg", FilePath: "1/image/new.jpg", FileSize: 2048},
		},
	})
	assert.NoError(t, err)
	assert.Equal(t, "1/image/new-tongue.jpg", updated.TongueImage)
	assert.Len(t, updated.Attachments, 1)
	assert.Equal(t, "1/image/new.jpg", updated.Attachments[0].FilePath)

	// Verify old attachment was hard-deleted from DB.
	var count int64
	db.Model(&model.RecordAttachment{}).Where("file_path = ?", "1/image/old.jpg").Count(&count)
	assert.Zero(t, count)
}
