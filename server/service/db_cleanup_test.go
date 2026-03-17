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

func TestDBCleanup_EmptyDB(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewDBCleanupService(db)

	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 0, result.OrphanPrescriptions)
	assert.Equal(t, 0, result.OrphanItems)
	assert.Equal(t, 0, result.OrphanBillings)
	assert.Equal(t, 0, result.OrphanUserRoles)
	assert.Equal(t, 0, result.OrphanRolePermissions)
	assert.Empty(t, result.SoftDeleted)
}

func TestDBCleanup_DetectsOrphanPrescriptions(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	// Create a medical record
	record := model.MedicalRecord{
		PatientID: patient.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
		VisitDate: time.Now(),
	}
	require.NoError(t, db.Create(&record).Error)

	// Create a prescription linked to that record
	rx := model.Prescription{
		RecordID:  record.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
	}
	require.NoError(t, db.Create(&rx).Error)

	// Soft-delete the record → prescription becomes orphan
	require.NoError(t, db.Delete(&record).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.OrphanPrescriptions)
}

func TestDBCleanup_DetectsOrphanItems(t *testing.T) {
	db := testutil.SetupTestDB(t)

	// Insert items with non-existent prescription_id by temporarily disabling FK checks
	require.NoError(t, db.Exec("SET FOREIGN_KEY_CHECKS=0").Error)
	items := []model.PrescriptionItem{
		{PrescriptionID: 99999, HerbName: "当归", Dosage: "10g"},
		{PrescriptionID: 99999, HerbName: "黄芪", Dosage: "15g"},
	}
	require.NoError(t, db.Create(&items).Error)
	require.NoError(t, db.Exec("SET FOREIGN_KEY_CHECKS=1").Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 2, result.OrphanItems)
}

func TestDBCleanup_SoftDeletedPrescriptionItemsPreserved(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	record := model.MedicalRecord{
		PatientID: patient.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
		VisitDate: time.Now(),
	}
	require.NoError(t, db.Create(&record).Error)

	rx := model.Prescription{
		RecordID:  record.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
	}
	require.NoError(t, db.Create(&rx).Error)

	items := []model.PrescriptionItem{
		{PrescriptionID: rx.ID, HerbName: "当归", Dosage: "10g"},
	}
	require.NoError(t, db.Create(&items).Error)

	// Soft-delete the prescription (within 30-day window) → items should NOT be orphaned
	require.NoError(t, db.Delete(&rx).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	// Items of soft-deleted prescriptions are preserved for recovery
	assert.Equal(t, 0, result.OrphanItems)
}

func TestDBCleanup_DetectsOrphanBillings(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	record := model.MedicalRecord{
		PatientID: patient.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
		VisitDate: time.Now(),
	}
	require.NoError(t, db.Create(&record).Error)

	// Create a billing linked to the record (record-level, no prescription)
	billing := model.Billing{
		RecordID:        record.ID,
		PrescriptionID:  0,
		TenantID:        tenant.ID,
		ConsultationFee: 100,
		TotalAmount:     100,
		CreatedBy:       user.ID,
	}
	require.NoError(t, db.Create(&billing).Error)

	// Soft-delete the record → billing becomes orphan
	require.NoError(t, db.Delete(&record).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.OrphanBillings)
}

func TestDBCleanup_DetectsOrphanUserRoles(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	role := model.Role{TenantID: tenant.ID, Name: "test-role"}
	require.NoError(t, db.Create(&role).Error)

	// Insert user_role with a non-existent user_id
	require.NoError(t, db.Exec("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", 99999, role.ID).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.OrphanUserRoles)
}

func TestDBCleanup_DetectsOrphanRolePermissions(t *testing.T) {
	db := testutil.SetupTestDB(t)

	// Insert role_permission with non-existent role and permission
	require.NoError(t, db.Exec("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", 99999, 99999).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.OrphanRolePermissions)
}

func TestDBCleanup_DetectsSoftDeletedRecords(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	record := model.MedicalRecord{
		PatientID: patient.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
		VisitDate: time.Now(),
	}
	require.NoError(t, db.Create(&record).Error)
	require.NoError(t, db.Delete(&record).Error)

	// Set deleted_at to 31 days ago so it passes the 30-day cutoff
	db.Exec("UPDATE medical_records SET deleted_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -31), record.ID)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.SoftDeleted["medical_records"])
}

func TestDBCleanup_CleansOrphanData(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	// Create record + prescription + items + billing
	record := model.MedicalRecord{
		PatientID: patient.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
		VisitDate: time.Now(),
	}
	require.NoError(t, db.Create(&record).Error)

	rx := model.Prescription{
		RecordID:  record.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
	}
	require.NoError(t, db.Create(&rx).Error)

	items := []model.PrescriptionItem{
		{PrescriptionID: rx.ID, HerbName: "当归", Dosage: "10g"},
	}
	require.NoError(t, db.Create(&items).Error)

	billing := model.Billing{
		RecordID:        record.ID,
		PrescriptionID:  rx.ID,
		TenantID:        tenant.ID,
		ConsultationFee: 100,
		TotalAmount:     100,
		CreatedBy:       user.ID,
	}
	require.NoError(t, db.Create(&billing).Error)

	// Soft-delete the record → prescription, items, billing become orphans
	require.NoError(t, db.Delete(&record).Error)

	// Also insert orphan user_role
	require.NoError(t, db.Exec("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", 99999, 1).Error)

	svc := service.NewDBCleanupService(db)

	// Verify scan detects them
	scan, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, scan.OrphanPrescriptions)
	// OrphanItems is 0 because the prescription still exists (only the record is soft-deleted).
	// Items will be cascade-deleted during cleanup step 2a.
	assert.Equal(t, 0, scan.OrphanItems)
	assert.Equal(t, 1, scan.OrphanBillings)
	assert.Equal(t, 1, scan.OrphanUserRoles)

	// Execute cleanup
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.NotNil(t, result.Cleaned)
	assert.Equal(t, 1, result.Cleaned["orphan_prescriptions"])
	assert.Equal(t, 1, result.Cleaned["orphan_items"])
	assert.Equal(t, 1, result.Cleaned["orphan_billings"])
	assert.Equal(t, 1, result.Cleaned["orphan_user_roles"])

	// Verify cleanup worked — re-scan should return zeros
	rescan, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 0, rescan.OrphanPrescriptions)
	assert.Equal(t, 0, rescan.OrphanItems)
	assert.Equal(t, 0, rescan.OrphanBillings)
	assert.Equal(t, 0, rescan.OrphanUserRoles)
}

func TestDBCleanup_DoesNotAffectNormalData(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	// Create normal (non-orphan) data
	record := model.MedicalRecord{
		PatientID: patient.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
		VisitDate: time.Now(),
	}
	require.NoError(t, db.Create(&record).Error)

	rx := model.Prescription{
		RecordID:  record.ID,
		TenantID:  tenant.ID,
		CreatedBy: user.ID,
	}
	require.NoError(t, db.Create(&rx).Error)

	items := []model.PrescriptionItem{
		{PrescriptionID: rx.ID, HerbName: "当归", Dosage: "10g"},
	}
	require.NoError(t, db.Create(&items).Error)

	svc := service.NewDBCleanupService(db)

	// Cleanup should not affect normal data
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 0, result.OrphanPrescriptions)
	assert.Equal(t, 0, result.OrphanItems)

	// Verify normal data still exists
	var rxCount int64
	db.Model(&model.Prescription{}).Count(&rxCount)
	assert.Equal(t, int64(1), rxCount)

	var itemCount int64
	db.Model(&model.PrescriptionItem{}).Count(&itemCount)
	assert.Equal(t, int64(1), itemCount)
}
