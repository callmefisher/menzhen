package service

import (
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// statsDay returns midnight of the given date in local time.
func statsDay(year int, month time.Month, day int) time.Time {
	return time.Date(year, month, day, 0, 0, 0, 0, time.Local)
}

func TestRefreshDailyStats_Basic(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "clinic-basic", "basic")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	p1 := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "患者A")
	p2 := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "患者B")

	today := statsDay(2026, 3, 15)

	// Record 1 → Prescription 1 → Billing 1 (patient p1, consultation=100, paid=350)
	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: p1.ID, CreatedBy: user.ID, VisitDate: today, Diagnosis: "感冒"}
	require.NoError(t, db.Create(&r1).Error)
	presc1 := model.Prescription{RecordID: r1.ID, TenantID: tenant.ID, TotalDoses: 7, CreatedBy: user.ID}
	require.NoError(t, db.Create(&presc1).Error)
	bill1 := model.Billing{PrescriptionID: presc1.ID, RecordID: r1.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 350, CreatedBy: user.ID}
	require.NoError(t, db.Create(&bill1).Error)

	// Record 2 → Prescription 2 → Billing 2 (patient p2, consultation=100, paid=500)
	r2 := model.MedicalRecord{TenantID: tenant.ID, PatientID: p2.ID, CreatedBy: user.ID, VisitDate: today, Diagnosis: "头痛"}
	require.NoError(t, db.Create(&r2).Error)
	presc2 := model.Prescription{RecordID: r2.ID, TenantID: tenant.ID, TotalDoses: 5, CreatedBy: user.ID}
	require.NoError(t, db.Create(&presc2).Error)
	bill2 := model.Billing{PrescriptionID: presc2.ID, RecordID: r2.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 500, CreatedBy: user.ID}
	require.NoError(t, db.Create(&bill2).Error)

	require.NoError(t, svc.RefreshDailyStats(tenant.ID, today))

	var stats model.DailyStats
	require.NoError(t, db.Where("tenant_id = ? AND stat_date = ?", tenant.ID, today.Format("2006-01-02")).First(&stats).Error)

	assert.InDelta(t, 850, stats.Revenue, 0.01)         // 350 + 500
	assert.InDelta(t, 200, stats.ConsultationFee, 0.01) // 100 + 100
	assert.InDelta(t, 650, stats.DrugFee, 0.01)         // 850 - 200
	assert.Equal(t, 2, stats.RecordCount)
	assert.Equal(t, 2, stats.NewPatientCount)
	assert.Equal(t, 0, stats.ReturningPatientCount)
}

func TestRefreshDailyStats_ReturningPatient(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "clinic-returning", "ret")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "复诊患者")

	yesterday := statsDay(2026, 3, 14)
	today := statsDay(2026, 3, 15)

	// First visit: yesterday (establishes this patient as "not new" today)
	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: yesterday, Diagnosis: "初诊"}
	require.NoError(t, db.Create(&r1).Error)
	presc1 := model.Prescription{RecordID: r1.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: user.ID}
	require.NoError(t, db.Create(&presc1).Error)
	bill1 := model.Billing{PrescriptionID: presc1.ID, RecordID: r1.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 200, CreatedBy: user.ID}
	require.NoError(t, db.Create(&bill1).Error)

	// Second visit: today (returning patient)
	r2 := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: today, Diagnosis: "复诊"}
	require.NoError(t, db.Create(&r2).Error)
	presc2 := model.Prescription{RecordID: r2.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: user.ID}
	require.NoError(t, db.Create(&presc2).Error)
	bill2 := model.Billing{PrescriptionID: presc2.ID, RecordID: r2.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 300, CreatedBy: user.ID}
	require.NoError(t, db.Create(&bill2).Error)

	require.NoError(t, svc.RefreshDailyStats(tenant.ID, today))

	var stats model.DailyStats
	require.NoError(t, db.Where("tenant_id = ? AND stat_date = ?", tenant.ID, today.Format("2006-01-02")).First(&stats).Error)

	assert.Equal(t, 1, stats.RecordCount)
	assert.Equal(t, 0, stats.NewPatientCount)
	assert.Equal(t, 1, stats.ReturningPatientCount)
	assert.InDelta(t, 300, stats.Revenue, 0.01)
}

func TestRefreshDailyStats_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "clinic-empty", "empty")

	emptyDate := statsDay(2026, 1, 1)
	require.NoError(t, svc.RefreshDailyStats(tenant.ID, emptyDate))

	var stats model.DailyStats
	require.NoError(t, db.Where("tenant_id = ? AND stat_date = ?", tenant.ID, emptyDate.Format("2006-01-02")).First(&stats).Error)

	assert.InDelta(t, 0, stats.Revenue, 0.01)
	assert.InDelta(t, 0, stats.ConsultationFee, 0.01)
	assert.InDelta(t, 0, stats.DrugFee, 0.01)
	assert.Equal(t, 0, stats.RecordCount)
	assert.Equal(t, 0, stats.NewPatientCount)
	assert.Equal(t, 0, stats.ReturningPatientCount)
}

func TestRefreshDailyStats_TenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant1 := testutil.SeedTestTenant(t, db, "clinic-t1", "t1")
	tenant2 := testutil.SeedTestTenant(t, db, "clinic-t2", "t2")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", nil)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", nil)
	p1 := testutil.SeedTestPatient(t, db, tenant1.ID, user1.ID, "T1患者")
	p2 := testutil.SeedTestPatient(t, db, tenant2.ID, user2.ID, "T2患者")

	targetDate := statsDay(2026, 3, 10)

	// Tenant 1: 1 record, revenue=400
	r1 := model.MedicalRecord{TenantID: tenant1.ID, PatientID: p1.ID, CreatedBy: user1.ID, VisitDate: targetDate, Diagnosis: "咳嗽"}
	require.NoError(t, db.Create(&r1).Error)
	presc1 := model.Prescription{RecordID: r1.ID, TenantID: tenant1.ID, TotalDoses: 5, CreatedBy: user1.ID}
	require.NoError(t, db.Create(&presc1).Error)
	bill1 := model.Billing{PrescriptionID: presc1.ID, RecordID: r1.ID, TenantID: tenant1.ID, ConsultationFee: 100, ActualPaid: 400, CreatedBy: user1.ID}
	require.NoError(t, db.Create(&bill1).Error)

	// Tenant 2: 1 record, revenue=9999 — should NOT appear in tenant 1 stats
	r2 := model.MedicalRecord{TenantID: tenant2.ID, PatientID: p2.ID, CreatedBy: user2.ID, VisitDate: targetDate, Diagnosis: "发烧"}
	require.NoError(t, db.Create(&r2).Error)
	presc2 := model.Prescription{RecordID: r2.ID, TenantID: tenant2.ID, TotalDoses: 5, CreatedBy: user2.ID}
	require.NoError(t, db.Create(&presc2).Error)
	bill2 := model.Billing{PrescriptionID: presc2.ID, RecordID: r2.ID, TenantID: tenant2.ID, ConsultationFee: 100, ActualPaid: 9999, CreatedBy: user2.ID}
	require.NoError(t, db.Create(&bill2).Error)

	// Refresh only tenant 1
	require.NoError(t, svc.RefreshDailyStats(tenant1.ID, targetDate))

	var stats1 model.DailyStats
	require.NoError(t, db.Where("tenant_id = ? AND stat_date = ?", tenant1.ID, targetDate.Format("2006-01-02")).First(&stats1).Error)

	// Tenant 1 sees only its own data
	assert.InDelta(t, 400, stats1.Revenue, 0.01)
	assert.Equal(t, 1, stats1.RecordCount)

	// Tenant 2 stats must not exist (we never refreshed it)
	var count int64
	db.Model(&model.DailyStats{}).Where("tenant_id = ?", tenant2.ID).Count(&count)
	assert.Equal(t, int64(0), count)
}

func TestRebuildAllDailyStats(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "clinic-rebuild", "rebuild")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "全量患者")

	day1 := statsDay(2026, 3, 1)
	day2 := statsDay(2026, 3, 2)

	// Day 1: first ever visit (new patient)
	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: day1}
	require.NoError(t, db.Create(&r1).Error)
	p1 := model.Prescription{RecordID: r1.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: user.ID}
	require.NoError(t, db.Create(&p1).Error)
	b1 := model.Billing{PrescriptionID: p1.ID, RecordID: r1.ID, TenantID: tenant.ID, ConsultationFee: 80, ActualPaid: 200, CreatedBy: user.ID}
	require.NoError(t, db.Create(&b1).Error)

	// Day 2: same patient returns (returning)
	r2 := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: day2}
	require.NoError(t, db.Create(&r2).Error)
	p2 := model.Prescription{RecordID: r2.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: user.ID}
	require.NoError(t, db.Create(&p2).Error)
	b2 := model.Billing{PrescriptionID: p2.ID, RecordID: r2.ID, TenantID: tenant.ID, ConsultationFee: 80, ActualPaid: 150, CreatedBy: user.ID}
	require.NoError(t, db.Create(&b2).Error)

	require.NoError(t, svc.RebuildAllDailyStats(tenant.ID))

	var sd1, sd2 model.DailyStats
	require.NoError(t, db.Where("tenant_id = ? AND stat_date = ?", tenant.ID, day1.Format("2006-01-02")).First(&sd1).Error)
	require.NoError(t, db.Where("tenant_id = ? AND stat_date = ?", tenant.ID, day2.Format("2006-01-02")).First(&sd2).Error)

	// Day 1: first-ever visit → new=1, returning=0
	assert.Equal(t, 1, sd1.NewPatientCount)
	assert.Equal(t, 0, sd1.ReturningPatientCount)
	assert.InDelta(t, 200, sd1.Revenue, 0.01)

	// Day 2: same patient came back → new=0, returning=1
	assert.Equal(t, 0, sd2.NewPatientCount)
	assert.Equal(t, 1, sd2.ReturningPatientCount)
	assert.InDelta(t, 150, sd2.Revenue, 0.01)
}
