package service

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRefreshDailyStaffStats_Basic(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "staff-basic", "sb")
	doc1, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)
	doc2, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc2", "pass", nil)
	p1 := testutil.SeedTestPatient(t, db, tenant.ID, doc1.ID, "患者A")
	p2 := testutil.SeedTestPatient(t, db, tenant.ID, doc2.ID, "患者B")

	today := statsDay(2026, 3, 15)

	// doc1: 2 records, revenue=600 (consult=200, drug=400)
	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: p1.ID, CreatedBy: doc1.ID, VisitDate: today}
	require.NoError(t, db.Create(&r1).Error)
	presc1 := model.Prescription{RecordID: r1.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: doc1.ID}
	require.NoError(t, db.Create(&presc1).Error)
	bill1 := model.Billing{PrescriptionID: presc1.ID, RecordID: r1.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 300, CreatedBy: doc1.ID}
	createBillingAt(t, db, &bill1, today)

	r2 := model.MedicalRecord{TenantID: tenant.ID, PatientID: p1.ID, CreatedBy: doc1.ID, VisitDate: today}
	require.NoError(t, db.Create(&r2).Error)
	presc2 := model.Prescription{RecordID: r2.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: doc1.ID}
	require.NoError(t, db.Create(&presc2).Error)
	bill2 := model.Billing{PrescriptionID: presc2.ID, RecordID: r2.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 300, CreatedBy: doc1.ID}
	createBillingAt(t, db, &bill2, today)

	// doc2: 1 record, revenue=500
	r3 := model.MedicalRecord{TenantID: tenant.ID, PatientID: p2.ID, CreatedBy: doc2.ID, VisitDate: today}
	require.NoError(t, db.Create(&r3).Error)
	presc3 := model.Prescription{RecordID: r3.ID, TenantID: tenant.ID, TotalDoses: 5, CreatedBy: doc2.ID}
	require.NoError(t, db.Create(&presc3).Error)
	bill3 := model.Billing{PrescriptionID: presc3.ID, RecordID: r3.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 500, CreatedBy: doc2.ID}
	createBillingAt(t, db, &bill3, today)

	require.NoError(t, svc.RefreshDailyStaffStats(tenant.ID, doc1.ID, today))
	require.NoError(t, svc.RefreshDailyStaffStats(tenant.ID, doc2.ID, today))

	var s1 model.DailyStaffStats
	require.NoError(t, db.Where("tenant_id = ? AND user_id = ? AND stat_date = ?", tenant.ID, doc1.ID, today.Format("2006-01-02")).First(&s1).Error)
	assert.InDelta(t, 600, s1.Revenue, 0.01)
	assert.InDelta(t, 200, s1.ConsultationFee, 0.01)
	assert.InDelta(t, 400, s1.DrugFee, 0.01)
	assert.Equal(t, 2, s1.RecordCount)

	var s2 model.DailyStaffStats
	require.NoError(t, db.Where("tenant_id = ? AND user_id = ? AND stat_date = ?", tenant.ID, doc2.ID, today.Format("2006-01-02")).First(&s2).Error)
	assert.InDelta(t, 500, s2.Revenue, 0.01)
	assert.Equal(t, 1, s2.RecordCount)
}

func TestRefreshDailyStaffStats_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "staff-empty", "se")
	doc, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	emptyDate := statsDay(2026, 1, 1)

	require.NoError(t, svc.RefreshDailyStaffStats(tenant.ID, doc.ID, emptyDate))

	var s model.DailyStaffStats
	require.NoError(t, db.Where("tenant_id = ? AND user_id = ? AND stat_date = ?", tenant.ID, doc.ID, emptyDate.Format("2006-01-02")).First(&s).Error)
	assert.InDelta(t, 0, s.Revenue, 0.01)
	assert.Equal(t, 0, s.RecordCount)
}

func TestRefreshDailyStaffStats_TenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	t1 := testutil.SeedTestTenant(t, db, "staff-t1", "st1")
	t2 := testutil.SeedTestTenant(t, db, "staff-t2", "st2")
	doc1, _ := testutil.SeedTestUser(t, db, t1.ID, "doc", "pass", nil)
	doc2, _ := testutil.SeedTestUser(t, db, t2.ID, "doc", "pass", nil)
	p1 := testutil.SeedTestPatient(t, db, t1.ID, doc1.ID, "T1患者")
	p2 := testutil.SeedTestPatient(t, db, t2.ID, doc2.ID, "T2患者")

	targetDate := statsDay(2026, 3, 10)

	r1 := model.MedicalRecord{TenantID: t1.ID, PatientID: p1.ID, CreatedBy: doc1.ID, VisitDate: targetDate}
	require.NoError(t, db.Create(&r1).Error)
	presc1 := model.Prescription{RecordID: r1.ID, TenantID: t1.ID, TotalDoses: 3, CreatedBy: doc1.ID}
	require.NoError(t, db.Create(&presc1).Error)
	bill1 := model.Billing{PrescriptionID: presc1.ID, RecordID: r1.ID, TenantID: t1.ID, ConsultationFee: 100, ActualPaid: 400, CreatedBy: doc1.ID}
	createBillingAt(t, db, &bill1, targetDate)

	r2 := model.MedicalRecord{TenantID: t2.ID, PatientID: p2.ID, CreatedBy: doc2.ID, VisitDate: targetDate}
	require.NoError(t, db.Create(&r2).Error)
	presc2 := model.Prescription{RecordID: r2.ID, TenantID: t2.ID, TotalDoses: 3, CreatedBy: doc2.ID}
	require.NoError(t, db.Create(&presc2).Error)
	bill2 := model.Billing{PrescriptionID: presc2.ID, RecordID: r2.ID, TenantID: t2.ID, ConsultationFee: 100, ActualPaid: 9999, CreatedBy: doc2.ID}
	createBillingAt(t, db, &bill2, targetDate)

	require.NoError(t, svc.RefreshDailyStaffStats(t1.ID, doc1.ID, targetDate))

	var s1 model.DailyStaffStats
	require.NoError(t, db.Where("tenant_id = ? AND user_id = ? AND stat_date = ?", t1.ID, doc1.ID, targetDate.Format("2006-01-02")).First(&s1).Error)
	assert.InDelta(t, 400, s1.Revenue, 0.01)

	var count int64
	db.Model(&model.DailyStaffStats{}).Where("tenant_id = ?", t2.ID).Count(&count)
	assert.Equal(t, int64(0), count)
}

func TestRefreshDailyStaffStats_ActualPaidLessThanConsultation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "staff-discount", "sd")
	doc, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, doc.ID, "折扣患者")

	today := statsDay(2026, 3, 15)

	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: patient.ID, CreatedBy: doc.ID, VisitDate: today}
	require.NoError(t, db.Create(&r1).Error)
	presc1 := model.Prescription{RecordID: r1.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: doc.ID}
	require.NoError(t, db.Create(&presc1).Error)
	bill1 := model.Billing{PrescriptionID: presc1.ID, RecordID: r1.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 30, CreatedBy: doc.ID}
	createBillingAt(t, db, &bill1, today)

	require.NoError(t, svc.RefreshDailyStaffStats(tenant.ID, doc.ID, today))

	var s model.DailyStaffStats
	require.NoError(t, db.Where("tenant_id = ? AND user_id = ? AND stat_date = ?", tenant.ID, doc.ID, today.Format("2006-01-02")).First(&s).Error)
	assert.InDelta(t, 30, s.Revenue, 0.01)
	assert.InDelta(t, 30, s.ConsultationFee, 0.01)
	assert.InDelta(t, 0, s.DrugFee, 0.01)
}

func TestRebuildAllDailyStaffStats(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "staff-rebuild", "srb")
	doc1, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)
	doc2, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc2", "pass", nil)
	p1 := testutil.SeedTestPatient(t, db, tenant.ID, doc1.ID, "患者X")
	p2 := testutil.SeedTestPatient(t, db, tenant.ID, doc2.ID, "患者Y")

	day1 := statsDay(2026, 3, 1)
	day2 := statsDay(2026, 3, 2)

	r1 := model.MedicalRecord{TenantID: tenant.ID, PatientID: p1.ID, CreatedBy: doc1.ID, VisitDate: day1}
	require.NoError(t, db.Create(&r1).Error)
	p1r1 := model.Prescription{RecordID: r1.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: doc1.ID}
	require.NoError(t, db.Create(&p1r1).Error)
	b1 := model.Billing{PrescriptionID: p1r1.ID, RecordID: r1.ID, TenantID: tenant.ID, ConsultationFee: 80, ActualPaid: 200, CreatedBy: doc1.ID}
	createBillingAt(t, db, &b1, day1)

	r2 := model.MedicalRecord{TenantID: tenant.ID, PatientID: p2.ID, CreatedBy: doc2.ID, VisitDate: day2}
	require.NoError(t, db.Create(&r2).Error)
	p2r2 := model.Prescription{RecordID: r2.ID, TenantID: tenant.ID, TotalDoses: 3, CreatedBy: doc2.ID}
	require.NoError(t, db.Create(&p2r2).Error)
	b2 := model.Billing{PrescriptionID: p2r2.ID, RecordID: r2.ID, TenantID: tenant.ID, ConsultationFee: 100, ActualPaid: 450, CreatedBy: doc2.ID}
	createBillingAt(t, db, &b2, day2)

	require.NoError(t, svc.RebuildAllDailyStaffStats(tenant.ID))

	var s1 model.DailyStaffStats
	require.NoError(t, db.Where("tenant_id = ? AND user_id = ? AND stat_date = ?", tenant.ID, doc1.ID, day1.Format("2006-01-02")).First(&s1).Error)
	assert.InDelta(t, 200, s1.Revenue, 0.01)
	assert.Equal(t, 1, s1.RecordCount)

	var s2 model.DailyStaffStats
	require.NoError(t, db.Where("tenant_id = ? AND user_id = ? AND stat_date = ?", tenant.ID, doc2.ID, day2.Format("2006-01-02")).First(&s2).Error)
	assert.InDelta(t, 450, s2.Revenue, 0.01)
	assert.Equal(t, 1, s2.RecordCount)
}

func TestGetStaffRevenue_Basic(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "sr-basic", "srb2")
	doc1, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc1", "pass", nil)
	doc2, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc2", "pass", nil)

	day1 := statsDay(2026, 3, 1)
	day2 := statsDay(2026, 3, 2)

	// doc1: day1=300, day2=200 → total=500
	db.Create(&model.DailyStaffStats{TenantID: tenant.ID, UserID: doc1.ID, StatDate: day1, Revenue: 300, ConsultationFee: 100, DrugFee: 200, RecordCount: 3})
	db.Create(&model.DailyStaffStats{TenantID: tenant.ID, UserID: doc1.ID, StatDate: day2, Revenue: 200, ConsultationFee: 80, DrugFee: 120, RecordCount: 2})
	// doc2: day1=600
	db.Create(&model.DailyStaffStats{TenantID: tenant.ID, UserID: doc2.ID, StatDate: day1, Revenue: 600, ConsultationFee: 200, DrugFee: 400, RecordCount: 4})

	start := statsDay(2026, 3, 1)
	end := statsDay(2026, 3, 2)
	result, err := svc.GetStaffRevenue(tenant.ID, start, end)
	require.NoError(t, err)

	// Summary
	assert.InDelta(t, 1100, result.Summary.TotalRevenue, 0.01) // 500+600
	assert.Equal(t, 9, result.Summary.TotalRecords)            // 3+2+4
	assert.Equal(t, 2, result.Summary.StaffCount)

	// Sorted by revenue: doc2(600) first, doc1(500) second
	require.Len(t, result.Staff, 2)
	assert.Equal(t, doc2.ID, result.Staff[0].UserID)
	assert.InDelta(t, 600, result.Staff[0].Revenue, 0.01)
	assert.InDelta(t, 600.0/1100.0*100, result.Staff[0].RevenuePercent, 0.1)

	assert.Equal(t, doc1.ID, result.Staff[1].UserID)
	assert.InDelta(t, 500, result.Staff[1].Revenue, 0.01)
	assert.InDelta(t, 180, result.Staff[1].ConsultationFee, 0.01) // 100+80
	assert.InDelta(t, 320, result.Staff[1].DrugFee, 0.01)        // 200+120
	assert.Equal(t, 5, result.Staff[1].RecordCount)
	assert.InDelta(t, 100, result.Staff[1].AvgPerRecord, 0.01) // 500/5
}

func TestGetStaffRevenue_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	start := statsDay(2026, 3, 1)
	end := statsDay(2026, 3, 5)
	result, err := svc.GetStaffRevenue(1, start, end)
	require.NoError(t, err)
	assert.InDelta(t, 0, result.Summary.TotalRevenue, 0.01)
	assert.Equal(t, 0, result.Summary.StaffCount)
	assert.Empty(t, result.Staff)
}

func TestGetStaffRevenue_TenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	t1 := testutil.SeedTestTenant(t, db, "sr-t1", "srt1")
	t2 := testutil.SeedTestTenant(t, db, "sr-t2", "srt2")
	doc1, _ := testutil.SeedTestUser(t, db, t1.ID, "doc", "pass", nil)
	doc2, _ := testutil.SeedTestUser(t, db, t2.ID, "doc", "pass", nil)

	day := statsDay(2026, 3, 1)
	db.Create(&model.DailyStaffStats{TenantID: t1.ID, UserID: doc1.ID, StatDate: day, Revenue: 300, RecordCount: 2})
	db.Create(&model.DailyStaffStats{TenantID: t2.ID, UserID: doc2.ID, StatDate: day, Revenue: 9999, RecordCount: 50})

	result, err := svc.GetStaffRevenue(t1.ID, day, day)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Summary.StaffCount)
	assert.InDelta(t, 300, result.Summary.TotalRevenue, 0.01)
}

func TestGetStaffRevenue_AvgPerRecord(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenant := testutil.SeedTestTenant(t, db, "sr-avg", "sra")
	doc, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", nil)

	day := statsDay(2026, 3, 1)
	db.Create(&model.DailyStaffStats{TenantID: tenant.ID, UserID: doc.ID, StatDate: day, Revenue: 1000, ConsultationFee: 400, DrugFee: 600, RecordCount: 4})

	result, err := svc.GetStaffRevenue(tenant.ID, day, day)
	require.NoError(t, err)
	require.Len(t, result.Staff, 1)
	assert.InDelta(t, 250, result.Staff[0].AvgPerRecord, 0.01)   // 1000/4
	assert.InDelta(t, 100, result.Staff[0].RevenuePercent, 0.01) // only one person
}

