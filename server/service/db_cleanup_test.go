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

// ── op_logs ──────────────────────────────────────────────────────────────────

func TestDBCleanup_ScansExpiredOpLogs(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)

	// Create two op_logs and then manually set their created_at
	old := model.OpLog{TenantID: tenant.ID, UserID: user.ID, UserName: user.Username, Action: "create", ResourceType: "patient", ResourceID: 1}
	fresh := model.OpLog{TenantID: tenant.ID, UserID: user.ID, UserName: user.Username, Action: "update", ResourceType: "patient", ResourceID: 2}
	require.NoError(t, db.Create(&old).Error)
	require.NoError(t, db.Create(&fresh).Error)

	// old → 91 days ago (beyond 90-day cutoff)
	db.Exec("UPDATE op_logs SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -91), old.ID)
	// fresh → 89 days ago (within cutoff)
	db.Exec("UPDATE op_logs SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -89), fresh.ID)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.ExpiredOpLogs)
}

func TestDBCleanup_CleansExpiredOpLogs(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)

	old := model.OpLog{TenantID: tenant.ID, UserID: user.ID, UserName: user.Username, Action: "delete", ResourceType: "record", ResourceID: 10}
	fresh := model.OpLog{TenantID: tenant.ID, UserID: user.ID, UserName: user.Username, Action: "create", ResourceType: "record", ResourceID: 11}
	require.NoError(t, db.Create(&old).Error)
	require.NoError(t, db.Create(&fresh).Error)
	db.Exec("UPDATE op_logs SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -91), old.ID)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.Cleaned["expired_op_logs"])

	// Re-scan: expired count should be 0
	rescan, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 0, rescan.ExpiredOpLogs)

	// Fresh log must still exist
	var count int64
	db.Unscoped().Model(&model.OpLog{}).Where("id = ?", fresh.ID).Count(&count)
	assert.Equal(t, int64(1), count)
}

// ── queue_entries ─────────────────────────────────────────────────────────────

func TestDBCleanup_ScansExpiredQueueEntries(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	today := time.Now().Format("2006-01-02")
	oldEntry := model.QueueEntry{TenantID: uint(tenant.ID), PatientName: "张三", DoctorID: 1, DoctorName: "王医生", SeqNumber: 1, Status: model.QueueStatusDone, QueueDate: today, Source: "walk_in", CheckinStatus: "done"}
	freshEntry := model.QueueEntry{TenantID: uint(tenant.ID), PatientName: "李四", DoctorID: 1, DoctorName: "王医生", SeqNumber: 2, Status: model.QueueStatusDone, QueueDate: today, Source: "walk_in", CheckinStatus: "done"}
	require.NoError(t, db.Create(&oldEntry).Error)
	require.NoError(t, db.Create(&freshEntry).Error)
	db.Exec("UPDATE queue_entries SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -8), oldEntry.ID)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.ExpiredQueueEntries)
}

func TestDBCleanup_CleansExpiredQueueEntries(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	today := time.Now().Format("2006-01-02")
	oldEntry := model.QueueEntry{TenantID: uint(tenant.ID), PatientName: "张三", DoctorID: 1, DoctorName: "王医生", SeqNumber: 1, Status: model.QueueStatusDone, QueueDate: today, Source: "walk_in", CheckinStatus: "done"}
	freshEntry := model.QueueEntry{TenantID: uint(tenant.ID), PatientName: "李四", DoctorID: 1, DoctorName: "王医生", SeqNumber: 2, Status: model.QueueStatusDone, QueueDate: today, Source: "walk_in", CheckinStatus: "done"}
	require.NoError(t, db.Create(&oldEntry).Error)
	require.NoError(t, db.Create(&freshEntry).Error)
	// 8 days old (beyond 7-day cutoff); fresh entry stays at created_at = now
	db.Exec("UPDATE queue_entries SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -8), oldEntry.ID)
	// 6 days old (within 7-day cutoff) — must survive
	db.Exec("UPDATE queue_entries SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -6), freshEntry.ID)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.Cleaned["expired_queue_entries"])

	// 6-day-old entry must survive
	var count int64
	db.Model(&model.QueueEntry{}).Where("id = ?", freshEntry.ID).Count(&count)
	assert.Equal(t, int64(1), count)

	// 8-day-old entry must be gone
	db.Model(&model.QueueEntry{}).Where("id = ?", oldEntry.ID).Count(&count)
	assert.Equal(t, int64(0), count)
}

// ── queue_seqs ────────────────────────────────────────────────────────────────

func TestDBCleanup_ScansExpiredQueueSeqs(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	// Same tenant, different dates — uniqueIndex (tenant_id, queue_date) won't conflict
	oldSeq := model.QueueSeq{TenantID: uint(tenant.ID), QueueDate: time.Now().AddDate(0, 0, -8).Format("2006-01-02"), LastSeq: 5}
	freshSeq := model.QueueSeq{TenantID: uint(tenant.ID), QueueDate: time.Now().Format("2006-01-02"), LastSeq: 3}
	require.NoError(t, db.Create(&oldSeq).Error)
	require.NoError(t, db.Create(&freshSeq).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.ExpiredQueueSeqs)
}

func TestDBCleanup_CleansExpiredQueueSeqs(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	oldSeq := model.QueueSeq{TenantID: uint(tenant.ID), QueueDate: time.Now().AddDate(0, 0, -8).Format("2006-01-02"), LastSeq: 5}
	freshSeq := model.QueueSeq{TenantID: uint(tenant.ID), QueueDate: time.Now().Format("2006-01-02"), LastSeq: 1}
	require.NoError(t, db.Create(&oldSeq).Error)
	require.NoError(t, db.Create(&freshSeq).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.Cleaned["expired_queue_seqs"])

	// Fresh seq must survive
	var count int64
	db.Model(&model.QueueSeq{}).Where("id = ?", freshSeq.ID).Count(&count)
	assert.Equal(t, int64(1), count)
}

// ── appointments ──────────────────────────────────────────────────────────────

func TestDBCleanup_ScansExpiredAppointments(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	// Cleanup checks appoint_date (the actual visit date), not created_at.
	oldDate := time.Now().AddDate(0, 0, -31).Format("2006-01-02")
	todayDate := time.Now().Format("2006-01-02")
	cancelled := model.Appointment{TenantID: uint(tenant.ID), PatientName: "张三", DoctorID: 1, DoctorName: "王医生", AppointDate: oldDate, SlotStart: "09:00", SlotEnd: "09:30", Status: model.AppointmentStatusCancelled}
	noShow := model.Appointment{TenantID: uint(tenant.ID), PatientName: "李四", DoctorID: 1, DoctorName: "王医生", AppointDate: oldDate, SlotStart: "10:00", SlotEnd: "10:30", Status: model.AppointmentStatusNoShow}
	queued := model.Appointment{TenantID: uint(tenant.ID), PatientName: "王五", DoctorID: 1, DoctorName: "王医生", AppointDate: oldDate, SlotStart: "11:00", SlotEnd: "11:30", Status: model.AppointmentStatusQueued}
	pending := model.Appointment{TenantID: uint(tenant.ID), PatientName: "赵六", DoctorID: 1, DoctorName: "王医生", AppointDate: todayDate, SlotStart: "14:00", SlotEnd: "14:30", Status: model.AppointmentStatusPending}

	require.NoError(t, db.Create(&cancelled).Error)
	require.NoError(t, db.Create(&noShow).Error)
	require.NoError(t, db.Create(&queued).Error)
	require.NoError(t, db.Create(&pending).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	// cancelled + no_show + queued = 3; pending is excluded
	assert.Equal(t, 3, result.ExpiredAppointments)
}

func TestDBCleanup_PreservesPendingAppointments(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	// Use an old appoint_date to prove pending is preserved regardless of date
	oldDate := time.Now().AddDate(0, 0, -60).Format("2006-01-02")
	pending := model.Appointment{TenantID: uint(tenant.ID), PatientName: "张三", DoctorID: 1, DoctorName: "王医生", AppointDate: oldDate, SlotStart: "09:00", SlotEnd: "09:30", Status: model.AppointmentStatusPending}
	require.NoError(t, db.Create(&pending).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	// pending appointment must NOT be in cleaned map
	assert.Equal(t, 0, result.Cleaned["expired_appointments"])

	var count int64
	db.Model(&model.Appointment{}).Where("id = ?", pending.ID).Count(&count)
	assert.Equal(t, int64(1), count)
}

func TestDBCleanup_CleansExpiredAppointments(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	oldDate := time.Now().AddDate(0, 0, -31).Format("2006-01-02")
	todayDate := time.Now().Format("2006-01-02")
	cancelled := model.Appointment{TenantID: uint(tenant.ID), PatientName: "张三", DoctorID: 1, DoctorName: "王医生", AppointDate: oldDate, SlotStart: "09:00", SlotEnd: "09:30", Status: model.AppointmentStatusCancelled}
	pending := model.Appointment{TenantID: uint(tenant.ID), PatientName: "李四", DoctorID: 1, DoctorName: "王医生", AppointDate: todayDate, SlotStart: "10:00", SlotEnd: "10:30", Status: model.AppointmentStatusPending}
	require.NoError(t, db.Create(&cancelled).Error)
	require.NoError(t, db.Create(&pending).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.Cleaned["expired_appointments"])

	// pending must survive
	var count int64
	db.Model(&model.Appointment{}).Where("id = ?", pending.ID).Count(&count)
	assert.Equal(t, int64(1), count)
}

// ── ai_analyses TTL ───────────────────────────────────────────────────────────

func TestDBCleanup_ScansExpiredAIAnalyses(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	// Case 1: last_accessed_at is 181 days ago
	oldAccessed := time.Now().AddDate(0, 0, -181)
	ai1 := model.AIAnalysis{RecordID: 1001, TenantID: tenant.ID, Diagnosis: "气虚", Analysis: "补气", LastAccessedAt: &oldAccessed}
	require.NoError(t, db.Create(&ai1).Error)

	// Case 2: last_accessed_at is NULL, but created_at is 181 days ago
	ai2 := model.AIAnalysis{RecordID: 1002, TenantID: tenant.ID, Diagnosis: "血虚", Analysis: "补血"}
	require.NoError(t, db.Create(&ai2).Error)
	db.Exec("UPDATE ai_analyses SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -181), ai2.ID)

	// Case 3: recently accessed — must NOT be counted
	recentAccessed := time.Now().AddDate(0, 0, -10)
	ai3 := model.AIAnalysis{RecordID: 1003, TenantID: tenant.ID, Diagnosis: "痰湿", Analysis: "化痰", LastAccessedAt: &recentAccessed}
	require.NoError(t, db.Create(&ai3).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 2, result.ExpiredAIAnalyses)
}

func TestDBCleanup_CleansExpiredAIAnalyses(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	oldAccessed := time.Now().AddDate(0, 0, -181)
	expired := model.AIAnalysis{RecordID: 2001, TenantID: tenant.ID, Diagnosis: "气虚", Analysis: "补气", LastAccessedAt: &oldAccessed}
	recentAccessed := time.Now().AddDate(0, 0, -10)
	alive := model.AIAnalysis{RecordID: 2002, TenantID: tenant.ID, Diagnosis: "血虚", Analysis: "补血", LastAccessedAt: &recentAccessed}
	require.NoError(t, db.Create(&expired).Error)
	require.NoError(t, db.Create(&alive).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.Cleaned["expired_ai_analyses"])

	// Recently-accessed ai_analysis must survive
	var count int64
	db.Model(&model.AIAnalysis{}).Where("id = ?", alive.ID).Count(&count)
	assert.Equal(t, int64(1), count)
}

func TestDBCleanup_PreservesRecentlyAccessedAIAnalyses(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")

	// Accessed 179 days ago — within 180-day TTL
	accessed := time.Now().AddDate(0, 0, -179)
	ai := model.AIAnalysis{RecordID: 3001, TenantID: tenant.ID, Diagnosis: "痰湿", Analysis: "化痰", LastAccessedAt: &accessed}
	require.NoError(t, db.Create(&ai).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 0, result.ExpiredAIAnalyses)

	cleanResult, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 0, cleanResult.Cleaned["expired_ai_analyses"])
}

// ── fresh data safety ─────────────────────────────────────────────────────────

func TestDBCleanup_PreservesFreshOpLogsAndQueue(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所", "clinic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)

	// Fresh op_log (1 day ago)
	oplog := model.OpLog{TenantID: tenant.ID, UserID: user.ID, UserName: user.Username, Action: "create", ResourceType: "patient", ResourceID: 1}
	require.NoError(t, db.Create(&oplog).Error)
	db.Exec("UPDATE op_logs SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -1), oplog.ID)

	// Fresh queue_seq (today)
	seq := model.QueueSeq{TenantID: uint(tenant.ID), QueueDate: time.Now().Format("2006-01-02"), LastSeq: 10}
	require.NoError(t, db.Create(&seq).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.ScanOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 0, result.ExpiredOpLogs)
	assert.Equal(t, 0, result.ExpiredQueueSeqs)

	cleanResult, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 0, cleanResult.Cleaned["expired_op_logs"])
	assert.Equal(t, 0, cleanResult.Cleaned["expired_queue_seqs"])
}

// ── multi-tenant isolation ─────────────────────────────────────────────────────

// TestDBCleanup_MultiTenant_OpLogs: tenant A's expired logs are cleaned; tenant B's fresh logs survive.
func TestDBCleanup_MultiTenant_OpLogs(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "docA", "pass", nil)
	userB, _ := testutil.SeedTestUser(t, db, tenantB.ID, "docB", "pass", nil)

	// Tenant A: expired op_log (91 days ago)
	expiredA := model.OpLog{TenantID: tenantA.ID, UserID: userA.ID, UserName: "docA", Action: "delete", ResourceType: "patient", ResourceID: 1}
	// Tenant B: fresh op_log (1 day ago)
	freshB := model.OpLog{TenantID: tenantB.ID, UserID: userB.ID, UserName: "docB", Action: "create", ResourceType: "patient", ResourceID: 2}
	require.NoError(t, db.Create(&expiredA).Error)
	require.NoError(t, db.Create(&freshB).Error)
	db.Exec("UPDATE op_logs SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -91), expiredA.ID)
	db.Exec("UPDATE op_logs SET created_at = ? WHERE id = ?", time.Now().AddDate(0, 0, -1), freshB.ID)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.Cleaned["expired_op_logs"])

	// Tenant B's fresh log must survive
	var count int64
	db.Unscoped().Model(&model.OpLog{}).Where("id = ?", freshB.ID).Count(&count)
	assert.Equal(t, int64(1), count)

	// Tenant A's expired log must be gone
	db.Unscoped().Model(&model.OpLog{}).Where("id = ?", expiredA.ID).Count(&count)
	assert.Equal(t, int64(0), count)
}

// TestDBCleanup_MultiTenant_QueueSeqs: each tenant's queue data cleaned independently.
func TestDBCleanup_MultiTenant_QueueSeqs(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")

	// Tenant A: seq from 8 days ago (expired)
	oldA := model.QueueSeq{TenantID: uint(tenantA.ID), QueueDate: time.Now().AddDate(0, 0, -8).Format("2006-01-02"), LastSeq: 20}
	// Tenant B: seq from today (fresh)
	freshB := model.QueueSeq{TenantID: uint(tenantB.ID), QueueDate: time.Now().Format("2006-01-02"), LastSeq: 5}
	require.NoError(t, db.Create(&oldA).Error)
	require.NoError(t, db.Create(&freshB).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.Cleaned["expired_queue_seqs"])

	// Tenant B's fresh seq survives
	var count int64
	db.Model(&model.QueueSeq{}).Where("id = ?", freshB.ID).Count(&count)
	assert.Equal(t, int64(1), count)

	// Tenant A's old seq is gone
	db.Model(&model.QueueSeq{}).Where("id = ?", oldA.ID).Count(&count)
	assert.Equal(t, int64(0), count)
}

// TestDBCleanup_MultiTenant_Appointments: expired cancelled appt from tenant A cleaned;
// pending appt from tenant B (even if old) is preserved.
func TestDBCleanup_MultiTenant_Appointments(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")

	oldDate := time.Now().AddDate(0, 0, -31).Format("2006-01-02")
	todayDate := time.Now().Format("2006-01-02")

	// Tenant A: cancelled, appoint_date 31 days ago → must be deleted
	cancelledA := model.Appointment{TenantID: uint(tenantA.ID), PatientName: "张三", DoctorID: 1, DoctorName: "医生A", AppointDate: oldDate, SlotStart: "09:00", SlotEnd: "09:30", Status: model.AppointmentStatusCancelled}
	// Tenant B: pending, appoint_date 31 days ago → must survive (pending never deleted)
	pendingB := model.Appointment{TenantID: uint(tenantB.ID), PatientName: "李四", DoctorID: 1, DoctorName: "医生B", AppointDate: oldDate, SlotStart: "10:00", SlotEnd: "10:30", Status: model.AppointmentStatusPending}
	// Tenant B: cancelled, today's appoint_date → must survive (not old enough)
	freshCancelledB := model.Appointment{TenantID: uint(tenantB.ID), PatientName: "王五", DoctorID: 1, DoctorName: "医生B", AppointDate: todayDate, SlotStart: "11:00", SlotEnd: "11:30", Status: model.AppointmentStatusCancelled}

	require.NoError(t, db.Create(&cancelledA).Error)
	require.NoError(t, db.Create(&pendingB).Error)
	require.NoError(t, db.Create(&freshCancelledB).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.Cleaned["expired_appointments"])

	// Tenant B pending (old) must survive
	var count int64
	db.Model(&model.Appointment{}).Where("id = ?", pendingB.ID).Count(&count)
	assert.Equal(t, int64(1), count)

	// Tenant B fresh cancelled must survive
	db.Model(&model.Appointment{}).Where("id = ?", freshCancelledB.ID).Count(&count)
	assert.Equal(t, int64(1), count)

	// Tenant A expired cancelled must be gone
	db.Model(&model.Appointment{}).Where("id = ?", cancelledA.ID).Count(&count)
	assert.Equal(t, int64(0), count)
}

// TestDBCleanup_MultiTenant_AIAnalyses: tenant A's expired analysis cleaned;
// tenant B's recently-accessed analysis preserved.
func TestDBCleanup_MultiTenant_AIAnalyses(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")

	// Tenant A: last accessed 200 days ago → expired
	oldAccessed := time.Now().AddDate(0, 0, -200)
	expiredA := model.AIAnalysis{RecordID: 9001, TenantID: tenantA.ID, Diagnosis: "气虚", Analysis: "补气", LastAccessedAt: &oldAccessed}
	// Tenant B: last accessed 5 days ago → alive
	recentAccessed := time.Now().AddDate(0, 0, -5)
	aliveB := model.AIAnalysis{RecordID: 9002, TenantID: tenantB.ID, Diagnosis: "血虚", Analysis: "补血", LastAccessedAt: &recentAccessed}
	require.NoError(t, db.Create(&expiredA).Error)
	require.NoError(t, db.Create(&aliveB).Error)

	svc := service.NewDBCleanupService(db)
	result, err := svc.CleanupOrphanData()
	require.NoError(t, err)
	assert.Equal(t, 1, result.Cleaned["expired_ai_analyses"])

	// Tenant B's alive analysis must survive
	var count int64
	db.Model(&model.AIAnalysis{}).Where("id = ?", aliveB.ID).Count(&count)
	assert.Equal(t, int64(1), count)

	// Tenant A's expired analysis must be gone
	db.Unscoped().Model(&model.AIAnalysis{}).Where("id = ?", expiredA.ID).Count(&count)
	assert.Equal(t, int64(0), count)
}
