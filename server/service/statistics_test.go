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

func TestRefreshDailyStats_ActualPaidLessThanConsultation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "clinic-discount", "disc")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "优惠患者")

	today := statsDay(2026, 3, 15)

	// 应收诊金100，实收30（打折/优惠），药费不应为负
	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: today, Diagnosis: "感冒"}
	require.NoError(t, db.Create(&r1).Error)
	presc1 := model.Prescription{RecordID: r1.ID, TenantID: tenant.ID, TotalDoses: 7, CreatedBy: user.ID}
	require.NoError(t, db.Create(&presc1).Error)
	bill1 := model.Billing{PrescriptionID: presc1.ID, RecordID: r1.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 30, CreatedBy: user.ID}
	require.NoError(t, db.Create(&bill1).Error)

	require.NoError(t, svc.RefreshDailyStats(tenant.ID, today))

	var stats model.DailyStats
	require.NoError(t, db.Where("tenant_id = ? AND stat_date = ?", tenant.ID, today.Format("2006-01-02")).First(&stats).Error)

	// 以实收为准：revenue=30, 诊金=min(100,30)=30, 药费=0（不为负）
	assert.InDelta(t, 30, stats.Revenue, 0.01)
	assert.InDelta(t, 30, stats.ConsultationFee, 0.01)
	assert.InDelta(t, 0, stats.DrugFee, 0.01)
	assert.Equal(t, 1, stats.RecordCount)
}

func TestRefreshDailyStats_MixedBillings(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "clinic-mixed", "mixed")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	p1 := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "正常患者")
	p2 := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "优惠患者")

	today := statsDay(2026, 3, 15)

	// 患者1：诊金100，实收500（正常付费）
	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: p1.ID, CreatedBy: user.ID, VisitDate: today, Diagnosis: "头痛"}
	require.NoError(t, db.Create(&r1).Error)
	presc1 := model.Prescription{RecordID: r1.ID, TenantID: tenant.ID, TotalDoses: 7, CreatedBy: user.ID}
	require.NoError(t, db.Create(&presc1).Error)
	bill1 := model.Billing{PrescriptionID: presc1.ID, RecordID: r1.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 500, CreatedBy: user.ID}
	require.NoError(t, db.Create(&bill1).Error)

	// 患者2：诊金100，实收50（优惠）
	r2 := model.MedicalRecord{TenantID: tenant.ID, PatientID: p2.ID, CreatedBy: user.ID, VisitDate: today, Diagnosis: "腰痛"}
	require.NoError(t, db.Create(&r2).Error)
	presc2 := model.Prescription{RecordID: r2.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: user.ID}
	require.NoError(t, db.Create(&presc2).Error)
	bill2 := model.Billing{PrescriptionID: presc2.ID, RecordID: r2.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 50, CreatedBy: user.ID}
	require.NoError(t, db.Create(&bill2).Error)

	require.NoError(t, svc.RefreshDailyStats(tenant.ID, today))

	var stats model.DailyStats
	require.NoError(t, db.Where("tenant_id = ? AND stat_date = ?", tenant.ID, today.Format("2006-01-02")).First(&stats).Error)

	// revenue=550, 诊金=min(100,500)+min(100,50)=100+50=150, 药费=550-150=400
	assert.InDelta(t, 550, stats.Revenue, 0.01)
	assert.InDelta(t, 150, stats.ConsultationFee, 0.01)
	assert.InDelta(t, 400, stats.DrugFee, 0.01)
	assert.Equal(t, 2, stats.RecordCount)
}

func TestGetDashboard_Basic(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)
	tenantID := uint64(1)
	for i := 1; i <= 5; i++ {
		db.Create(&model.DailyStats{
			TenantID: tenantID, StatDate: time.Date(2026, 3, i, 0, 0, 0, 0, time.Local),
			Revenue: float64(i * 100), ConsultationFee: float64(i * 20), DrugFee: float64(i*100 - i*20),
			RecordCount: i, NewPatientCount: 1, ReturningPatientCount: i - 1,
		})
	}
	start := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	end := time.Date(2026, 3, 5, 0, 0, 0, 0, time.Local)
	result, err := svc.GetDashboard(tenantID, start, end)
	require.NoError(t, err)
	assert.Equal(t, 1500.0, result.Summary.TotalRevenue)
	assert.Equal(t, 15, result.Summary.TotalRecords)
	assert.Equal(t, 15, result.Summary.TotalPatients)
	assert.Equal(t, 100.0, result.Summary.AvgRevenuePerRecord)
	assert.Len(t, result.DailyTrend, 5)
	assert.Equal(t, 300.0, result.RevenueBreakdown.ConsultationFeeTotal)
	assert.Equal(t, 1200.0, result.RevenueBreakdown.DrugFeeTotal)
	assert.Equal(t, 5, result.PatientBreakdown.NewPatients)
	assert.Equal(t, 10, result.PatientBreakdown.ReturningPatients)
}

func TestGetDashboard_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)
	start := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	end := time.Date(2026, 3, 5, 0, 0, 0, 0, time.Local)
	result, err := svc.GetDashboard(1, start, end)
	require.NoError(t, err)
	assert.Equal(t, 0.0, result.Summary.TotalRevenue)
	assert.Equal(t, 0.0, result.Summary.AvgRevenuePerRecord)
	assert.Nil(t, result.Summary.RevenueChangePercent)
	assert.Len(t, result.DailyTrend, 5) // all 5 days filled with zeros
}

func TestGetDashboard_SparseData(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)
	tenantID := uint64(1)

	// Only day 1 and day 5 have data, days 2-4 have no data
	db.Create(&model.DailyStats{
		TenantID: tenantID, StatDate: time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local),
		Revenue: 100, RecordCount: 1, NewPatientCount: 1,
	})
	db.Create(&model.DailyStats{
		TenantID: tenantID, StatDate: time.Date(2026, 3, 5, 0, 0, 0, 0, time.Local),
		Revenue: 500, RecordCount: 3, NewPatientCount: 2, ReturningPatientCount: 1,
	})

	start := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	end := time.Date(2026, 3, 5, 0, 0, 0, 0, time.Local)
	result, err := svc.GetDashboard(tenantID, start, end)
	require.NoError(t, err)

	// All 5 days should be present
	assert.Len(t, result.DailyTrend, 5)

	// Verify dates are sequential
	assert.Equal(t, "2026-03-01", result.DailyTrend[0].Date)
	assert.Equal(t, "2026-03-02", result.DailyTrend[1].Date)
	assert.Equal(t, "2026-03-03", result.DailyTrend[2].Date)
	assert.Equal(t, "2026-03-04", result.DailyTrend[3].Date)
	assert.Equal(t, "2026-03-05", result.DailyTrend[4].Date)

	// Day 1 has data
	assert.Equal(t, 100.0, result.DailyTrend[0].Revenue)
	assert.Equal(t, 1, result.DailyTrend[0].RecordCount)

	// Days 2-4 are zero-filled
	for i := 1; i <= 3; i++ {
		assert.Equal(t, 0.0, result.DailyTrend[i].Revenue)
		assert.Equal(t, 0, result.DailyTrend[i].RecordCount)
		assert.Equal(t, 0, result.DailyTrend[i].NewPatientCount)
	}

	// Day 5 has data
	assert.Equal(t, 500.0, result.DailyTrend[4].Revenue)
	assert.Equal(t, 3, result.DailyTrend[4].RecordCount)

	// Summary totals only count actual data
	assert.Equal(t, 600.0, result.Summary.TotalRevenue)
	assert.Equal(t, 4, result.Summary.TotalRecords)
}

func TestGetDashboard_ChangePercent(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)
	tenantID := uint64(1)
	// Previous period (3/1-3/5): revenue = 500
	for i := 1; i <= 5; i++ {
		db.Create(&model.DailyStats{
			TenantID: tenantID, StatDate: time.Date(2026, 3, i, 0, 0, 0, 0, time.Local),
			Revenue: 100, RecordCount: 2, NewPatientCount: 1, ReturningPatientCount: 1,
		})
	}
	// Current period (3/6-3/10): revenue = 750
	for i := 6; i <= 10; i++ {
		db.Create(&model.DailyStats{
			TenantID: tenantID, StatDate: time.Date(2026, 3, i, 0, 0, 0, 0, time.Local),
			Revenue: 150, RecordCount: 3, NewPatientCount: 2, ReturningPatientCount: 1,
		})
	}
	start := time.Date(2026, 3, 6, 0, 0, 0, 0, time.Local)
	end := time.Date(2026, 3, 10, 0, 0, 0, 0, time.Local)
	result, err := svc.GetDashboard(tenantID, start, end)
	require.NoError(t, err)
	assert.Equal(t, 750.0, result.Summary.TotalRevenue)
	require.NotNil(t, result.Summary.RevenueChangePercent)
	assert.Equal(t, 50.0, *result.Summary.RevenueChangePercent)
}

func TestGetDashboard_CureRate_NoFollowUps(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)
	tenantID := uint64(1)

	// Create some daily stats but no follow-ups
	db.Create(&model.DailyStats{
		TenantID: tenantID, StatDate: time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local),
		Revenue: 100, RecordCount: 1, NewPatientCount: 1,
	})

	start := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	end := time.Date(2026, 3, 5, 0, 0, 0, 0, time.Local)
	result, err := svc.GetDashboard(tenantID, start, end)
	require.NoError(t, err)
	assert.Nil(t, result.Summary.CureRate)
	assert.Nil(t, result.Summary.CureRateChangePercent)
}

func TestGetDashboard_CureRate_PartialRecovery(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "clinic-cure", "cure")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "治愈患者")

	targetDate := statsDay(2026, 3, 10)

	// Create 2 medical records
	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: targetDate, Diagnosis: "感冒"}
	require.NoError(t, db.Create(&r1).Error)
	r2 := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: targetDate, Diagnosis: "头痛"}
	require.NoError(t, db.Create(&r2).Error)

	// Create daily stats to ensure GetDashboard works
	db.Create(&model.DailyStats{
		TenantID: tenant.ID, StatDate: targetDate,
		Revenue: 200, RecordCount: 2, NewPatientCount: 1,
	})

	fuSvc := NewFollowUpService(db)
	// Follow-up for r1: recovered
	fuSvc.Create(tenant.ID, user.ID, &CreateFollowUpRequest{
		PatientID: patient.ID, RecordID: r1.ID, PlannedDate: "2026-03-15", Method: "电话", IsRecovered: true,
	})
	// Follow-up for r2: not recovered
	fuSvc.Create(tenant.ID, user.ID, &CreateFollowUpRequest{
		PatientID: patient.ID, RecordID: r2.ID, PlannedDate: "2026-03-15", Method: "微信",
	})

	start := time.Date(2026, 3, 10, 0, 0, 0, 0, time.Local)
	end := time.Date(2026, 3, 15, 0, 0, 0, 0, time.Local)
	result, err := svc.GetDashboard(tenant.ID, start, end)
	require.NoError(t, err)
	require.NotNil(t, result.Summary.CureRate)
	assert.InDelta(t, 50.0, *result.Summary.CureRate, 0.1) // 1/2 = 50%
}

func TestGetDashboard_CureRate_AllRecovered(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "clinic-all-cure", "allcure")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "全愈患者")

	targetDate := statsDay(2026, 3, 10)

	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: user.ID, VisitDate: targetDate, Diagnosis: "感冒"}
	require.NoError(t, db.Create(&r1).Error)

	db.Create(&model.DailyStats{
		TenantID: tenant.ID, StatDate: targetDate,
		Revenue: 100, RecordCount: 1, NewPatientCount: 1,
	})

	fuSvc := NewFollowUpService(db)
	fuSvc.Create(tenant.ID, user.ID, &CreateFollowUpRequest{
		PatientID: patient.ID, RecordID: r1.ID, PlannedDate: "2026-03-15", Method: "电话", IsRecovered: true,
	})

	start := time.Date(2026, 3, 10, 0, 0, 0, 0, time.Local)
	end := time.Date(2026, 3, 15, 0, 0, 0, 0, time.Local)
	result, err := svc.GetDashboard(tenant.ID, start, end)
	require.NoError(t, err)
	require.NotNil(t, result.Summary.CureRate)
	assert.InDelta(t, 100.0, *result.Summary.CureRate, 0.1)
}
