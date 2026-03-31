# 人员收费统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在统计分析页增加「人员收费」Tab，展示每位医生在指定时间段内的收入排行榜（含诊次、诊金、药费、人均、占比）。

**Architecture:** 新增 `daily_staff_stats` 预聚合表（tenant_id + user_id + stat_date 三列唯一索引），模仿现有 `daily_stats` 模式。`RefreshDailyStaffStats` 在每次账单 CRUD 时触发，`GetStaffRevenue` 从预聚合表查询（而非扫描 billings 原表），确保 1000 万+ 条时查询仍为毫秒级。前端在 `StatsDashboard` 顶部加 Tabs，新增 `StaffRevenuePanel` 排行榜组件。

**Tech Stack:** Go 1.21 + Gin + GORM + MySQL | React 18 + TypeScript + Ant Design 6 + Vitest + Testing Library

---

## File Map

### Backend — Create
- `server/model/daily_staff_stats.go` — DailyStaffStats 模型
- `server/service/statistics_staff_test.go` — service 层单元测试
- `server/handler/statistics_staff_handler_test.go` — handler 层集成测试

### Backend — Modify
- `server/service/statistics.go` — 新增 3 个方法：RefreshDailyStaffStats / RebuildAllDailyStaffStats / GetStaffRevenue
- `server/service/billing.go` — 3 处 RefreshDailyStats 调用旁加 RefreshDailyStaffStats
- `server/service/prescription.go` — 1 处 RefreshDailyStats 调用旁加 RefreshDailyStaffStats
- `server/service/record.go` — 1 处 RefreshDailyStats 调用旁加 RefreshDailyStaffStats
- `server/handler/statistics.go` — 新增 GetStaffRevenue handler
- `server/router/router.go` — 注册 GET /statistics/staff 路由
- `server/testutil/testutil.go` — AutoMigrate 加 DailyStaffStats
- `server/database/seed.go` — 启动时空表回填 rebuildEmptyDailyStaffStats

### Frontend — Create
- `web/src/pages/statistics/components/StaffRevenuePanel.tsx` — 排行榜组件
- `web/src/pages/statistics/__tests__/StaffRevenuePanel.test.tsx` — 组件测试

### Frontend — Modify
- `web/src/api/statistics.ts` — 新增类型 + getStaffRevenue()
- `web/src/pages/statistics/StatsDashboard.tsx` — 加 Tabs（数据概览 / 人员收费）
- `web/src/pages/statistics/__tests__/StatsDashboard.test.tsx` — 回归测试 Tabs

---

## Task 1: DailyStaffStats 模型 + testutil 注册

**Files:**
- Create: `server/model/daily_staff_stats.go`
- Modify: `server/testutil/testutil.go`

- [ ] **Step 1: 创建模型文件**

```go
// server/model/daily_staff_stats.go
package model

import "time"

// DailyStaffStats stores per-user per-day billing aggregations.
// Unique index (tenant_id, user_id, stat_date) enables efficient UPSERT and date-range scans.
// Max rows per tenant: doctors_count × active_days (e.g. 10 × 3650 = 36 500 rows — never near 10M).
type DailyStaffStats struct {
	ID              uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID        uint64    `gorm:"uniqueIndex:idx_staff_tenant_user_date;not null;index:idx_staff_tenant_date" json:"tenant_id"`
	UserID          uint64    `gorm:"uniqueIndex:idx_staff_tenant_user_date;not null" json:"user_id"`
	StatDate        time.Time `gorm:"uniqueIndex:idx_staff_tenant_user_date;type:date;not null;index:idx_staff_tenant_date" json:"stat_date"`
	Revenue         float64   `gorm:"type:decimal(12,2);default:0" json:"revenue"`
	ConsultationFee float64   `gorm:"type:decimal(12,2);default:0" json:"consultation_fee"`
	DrugFee         float64   `gorm:"type:decimal(12,2);default:0" json:"drug_fee"`
	RecordCount     int       `gorm:"default:0" json:"record_count"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
```

- [ ] **Step 2: 在 testutil 的 AutoMigrate 列表中注册 DailyStaffStats**

在 `server/testutil/testutil.go` 的 `testDB.AutoMigrate(...)` 调用中，在 `&model.DailyStats{}` 之后加一行：

```go
&model.DailyStaffStats{},
```

- [ ] **Step 3: 编译确认无错误**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go build ./...
```
Expected: 无输出（编译成功）

- [ ] **Step 4: Commit**

```bash
cd /Users/xiayanji/qbox/menzhen
git add server/model/daily_staff_stats.go server/testutil/testutil.go
git commit -m "feat: add DailyStaffStats model for per-user revenue pre-aggregation"
```

---

## Task 2: RefreshDailyStaffStats + RebuildAllDailyStaffStats 服务方法

**Files:**
- Modify: `server/service/statistics.go`

- [ ] **Step 1: 先写失败测试（RED）**

新建 `server/service/statistics_staff_test.go`，内容如下：

```go
package service

import (
	"testing"
	"time"

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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run "TestRefreshDailyStaffStats|TestRebuildAllDailyStaffStats" -v 2>&1 | head -20
```
Expected: `FAIL` — "undefined: ... RefreshDailyStaffStats"

- [ ] **Step 3: 在 statistics.go 末尾实现 3 个方法**

在 `server/service/statistics.go` 底部追加：

```go
// RefreshDailyStaffStats recomputes and upserts the stats row for one user on one date.
// Revenue = billings created on date for records owned by userID.
// RecordCount = records visited on date owned by userID.
// Drug fee = revenue - LEAST(consultation_fee, actual_paid) per billing (never negative).
func (s *StatisticsService) RefreshDailyStaffStats(tenantID, userID uint64, date time.Time) error {
	statDate := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	nextDate := statDate.AddDate(0, 0, 1)

	type billingSummary struct {
		Revenue         float64
		ConsultationFee float64
	}
	var summary billingSummary
	s.DB.Model(&model.Billing{}).
		Select("COALESCE(SUM(billings.actual_paid), 0) AS revenue, "+
			"COALESCE(SUM(LEAST(billings.consultation_fee, billings.actual_paid)), 0) AS consultation_fee").
		Joins("JOIN medical_records ON medical_records.id = billings.record_id AND medical_records.deleted_at IS NULL").
		Where("billings.tenant_id = ? AND medical_records.created_by = ? "+
			"AND billings.created_at >= ? AND billings.created_at < ? AND billings.deleted_at IS NULL",
			tenantID, userID, statDate, nextDate).
		Scan(&summary)

	drugFee := summary.Revenue - summary.ConsultationFee

	var recordCount int64
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND created_by = ? AND visit_date >= ? AND visit_date < ? AND deleted_at IS NULL",
			tenantID, userID, statDate, nextDate).
		Count(&recordCount)

	stats := model.DailyStaffStats{
		TenantID:        tenantID,
		UserID:          userID,
		StatDate:        statDate,
		Revenue:         summary.Revenue,
		ConsultationFee: summary.ConsultationFee,
		DrugFee:         drugFee,
		RecordCount:     int(recordCount),
	}

	return s.DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "tenant_id"}, {Name: "user_id"}, {Name: "stat_date"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"revenue", "consultation_fee", "drug_fee", "record_count", "updated_at",
		}),
	}).Create(&stats).Error
}

// RebuildAllDailyStaffStats drops and recomputes every daily_staff_stats row for the given tenant.
func (s *StatisticsService) RebuildAllDailyStaffStats(tenantID uint64) error {
	if err := s.DB.Where("tenant_id = ?", tenantID).Delete(&model.DailyStaffStats{}).Error; err != nil {
		return err
	}

	type userDate struct {
		UserID uint64
		Date   time.Time
	}

	// Billing dates per user (via record.created_by).
	var billingCombos []userDate
	s.DB.Raw(`
		SELECT mr.created_by AS user_id, DATE(b.created_at) AS date
		FROM billings b
		JOIN medical_records mr ON mr.id = b.record_id AND mr.deleted_at IS NULL
		WHERE b.tenant_id = ? AND b.deleted_at IS NULL
		GROUP BY mr.created_by, DATE(b.created_at)
	`, tenantID).Scan(&billingCombos)

	// Visit dates per user.
	var visitCombos []userDate
	s.DB.Model(&model.MedicalRecord{}).
		Select("created_by AS user_id, DATE(visit_date) AS date").
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Group("created_by, DATE(visit_date)").
		Scan(&visitCombos)

	// Merge and deduplicate.
	seen := make(map[string]bool, len(billingCombos)+len(visitCombos))
	all := make([]userDate, 0, len(billingCombos)+len(visitCombos))
	for _, c := range append(billingCombos, visitCombos...) {
		key := fmt.Sprintf("%d_%s", c.UserID, c.Date.Format("2006-01-02"))
		if !seen[key] {
			seen[key] = true
			all = append(all, c)
		}
	}

	for _, c := range all {
		if err := s.RefreshDailyStaffStats(tenantID, c.UserID, c.Date); err != nil {
			return err
		}
	}
	return nil
}
```

Also add `"fmt"` to the import block at the top of `statistics.go` if not already present.

- [ ] **Step 4: 运行测试，确认通过（GREEN）**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run "TestRefreshDailyStaffStats|TestRebuildAllDailyStaffStats" -v
```
Expected: 全部 `PASS`

- [ ] **Step 5: 回归确认原 statistics 测试仍全绿**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -v 2>&1 | tail -5
```
Expected: `ok github.com/callmefisher/menzhen/server/service`

- [ ] **Step 6: Commit**

```bash
cd /Users/xiayanji/qbox/menzhen
git add server/service/statistics.go server/service/statistics_staff_test.go
git commit -m "feat: RefreshDailyStaffStats + RebuildAllDailyStaffStats service methods"
```

---

## Task 3: GetStaffRevenue 服务方法

**Files:**
- Modify: `server/service/statistics.go`
- Modify: `server/service/statistics_staff_test.go`

- [ ] **Step 1: 先追加失败测试**

在 `server/service/statistics_staff_test.go` 末尾追加：

```go
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
	assert.InDelta(t, 280, result.Staff[1].ConsultationFee, 0.01) // 100+80+100(debit from day3 not in range)
	assert.InDelta(t, 320, result.Staff[1].DrugFee, 0.01)
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
	assert.InDelta(t, 250, result.Staff[0].AvgPerRecord, 0.01) // 1000/4
	assert.InDelta(t, 100, result.Staff[0].RevenuePercent, 0.01) // only one person
}
```

- [ ] **Step 2: 运行，确认失败**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run "TestGetStaffRevenue" -v 2>&1 | head -15
```
Expected: `FAIL` — "undefined: ... GetStaffRevenue"

- [ ] **Step 3: 在 statistics.go 中实现类型和方法**

在 `server/service/statistics.go` 的现有结构体定义区（`DashboardResult` 后面）追加：

```go
// StaffRevenueItem holds aggregated stats for one user over the queried date range.
type StaffRevenueItem struct {
	UserID          uint64  `json:"user_id"`
	RealName        string  `json:"real_name"`
	Revenue         float64 `json:"revenue"`
	ConsultationFee float64 `json:"consultation_fee"`
	DrugFee         float64 `json:"drug_fee"`
	RecordCount     int     `json:"record_count"`
	AvgPerRecord    float64 `json:"avg_per_record"`
	RevenuePercent  float64 `json:"revenue_percent"`
}

// StaffRevenueSummary holds team-level totals.
type StaffRevenueSummary struct {
	TotalRevenue float64 `json:"total_revenue"`
	TotalRecords int     `json:"total_records"`
	StaffCount   int     `json:"staff_count"`
	AvgPerRecord float64 `json:"avg_per_record"`
}

// StaffRevenueResult is the response type for GetStaffRevenue.
type StaffRevenueResult struct {
	Summary StaffRevenueSummary `json:"summary"`
	Staff   []StaffRevenueItem  `json:"staff"`
}
```

Then add the method at the end of `statistics.go`:

```go
// GetStaffRevenue aggregates daily_staff_stats for the given date range and returns
// per-user revenue sorted by total revenue descending.
// Queries the pre-aggregated table — O(doctors × days) not O(billings), safe at 10M+ rows.
func (s *StatisticsService) GetStaffRevenue(tenantID uint64, startDate, endDate time.Time) (*StaffRevenueResult, error) {
	type staffAgg struct {
		UserID          uint64
		Revenue         float64
		ConsultationFee float64
		DrugFee         float64
		RecordCount     int
	}
	var rows []staffAgg
	s.DB.Model(&model.DailyStaffStats{}).
		Select("user_id, SUM(revenue) AS revenue, SUM(consultation_fee) AS consultation_fee, "+
			"SUM(drug_fee) AS drug_fee, SUM(record_count) AS record_count").
		Where("tenant_id = ? AND stat_date >= ? AND stat_date <= ?", tenantID, startDate, endDate).
		Group("user_id").
		Order("revenue DESC").
		Scan(&rows)

	if len(rows) == 0 {
		return &StaffRevenueResult{
			Summary: StaffRevenueSummary{},
			Staff:   []StaffRevenueItem{},
		}, nil
	}

	// Fetch user names in a single query.
	userIDs := make([]uint64, len(rows))
	for i, r := range rows {
		userIDs[i] = r.UserID
	}
	var users []model.User
	s.DB.Where("id IN ?", userIDs).Find(&users)
	nameMap := make(map[uint64]string, len(users))
	for _, u := range users {
		nameMap[u.ID] = u.RealName
	}

	// Compute totals.
	var totalRevenue float64
	var totalRecords int
	for _, r := range rows {
		totalRevenue += r.Revenue
		totalRecords += r.RecordCount
	}

	var avgPerRecord float64
	if totalRecords > 0 {
		avgPerRecord = math.Round(totalRevenue/float64(totalRecords)*100) / 100
	}

	// Build result.
	staff := make([]StaffRevenueItem, len(rows))
	for i, r := range rows {
		var avg float64
		if r.RecordCount > 0 {
			avg = math.Round(r.Revenue/float64(r.RecordCount)*100) / 100
		}
		var pct float64
		if totalRevenue > 0 {
			pct = math.Round(r.Revenue/totalRevenue*1000) / 10 // 1 decimal place
		}
		staff[i] = StaffRevenueItem{
			UserID:          r.UserID,
			RealName:        nameMap[r.UserID],
			Revenue:         r.Revenue,
			ConsultationFee: r.ConsultationFee,
			DrugFee:         r.DrugFee,
			RecordCount:     r.RecordCount,
			AvgPerRecord:    avg,
			RevenuePercent:  pct,
		}
	}

	return &StaffRevenueResult{
		Summary: StaffRevenueSummary{
			TotalRevenue: totalRevenue,
			TotalRecords: totalRecords,
			StaffCount:   len(rows),
			AvgPerRecord: avgPerRecord,
		},
		Staff: staff,
	}, nil
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run "TestGetStaffRevenue" -v
```
Expected: 全部 `PASS`

- [ ] **Step 5: 全量 service 测试回归**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -v 2>&1 | tail -5
```
Expected: `ok github.com/callmefisher/menzhen/server/service`

- [ ] **Step 6: Commit**

```bash
cd /Users/xiayanji/qbox/menzhen
git add server/service/statistics.go server/service/statistics_staff_test.go
git commit -m "feat: GetStaffRevenue service method with pre-aggregation query"
```

---

## Task 4: Handler + Router

**Files:**
- Modify: `server/handler/statistics.go`
- Modify: `server/router/router.go`

- [ ] **Step 1: 先写 handler 集成测试（RED）**

新建 `server/handler/statistics_staff_handler_test.go`：

```go
package handler

import (
	"net/http"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetStaffRevenue_Success(t *testing.T) {
	env := setupTestEnv(t)

	// Seed a user with real_name so we can verify it comes back.
	env.DB.Model(&model.User{}).Where("id = ?", env.UserID).Update("real_name", "张医生")

	day := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	require.NoError(t, env.DB.Create(&model.DailyStaffStats{
		TenantID: env.TenantID, UserID: env.UserID, StatDate: day,
		Revenue: 1200, ConsultationFee: 400, DrugFee: 800, RecordCount: 6,
	}).Error)

	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=2026-03-01&end_date=2026-03-01", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	require.NotNil(t, body)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	summary := data["summary"].(map[string]interface{})
	assert.Equal(t, 1200.0, summary["total_revenue"])
	assert.Equal(t, float64(6), summary["total_records"])
	assert.Equal(t, float64(1), summary["staff_count"])

	staff := data["staff"].([]interface{})
	require.Len(t, staff, 1)
	item := staff[0].(map[string]interface{})
	assert.Equal(t, "张医生", item["real_name"])
	assert.Equal(t, 1200.0, item["revenue"])
	assert.Equal(t, 100.0, item["revenue_percent"])
}

func TestGetStaffRevenue_MissingParams(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=2026-03-01", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	w = env.doRequest("GET", "/api/v1/statistics/staff", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetStaffRevenue_NoAuth(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequestNoAuth("GET", "/api/v1/statistics/staff?start_date=2026-03-01&end_date=2026-03-31", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestGetStaffRevenue_EmptyResult(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=2026-01-01&end_date=2026-01-31", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	data := body["data"].(map[string]interface{})
	summary := data["summary"].(map[string]interface{})
	assert.Equal(t, 0.0, summary["total_revenue"])
	assert.Equal(t, float64(0), summary["staff_count"])

	staff := data["staff"].([]interface{})
	assert.Len(t, staff, 0)
}

func TestGetStaffRevenue_InvalidDate(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=bad&end_date=2026-03-31", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetStaffRevenue_EndBeforeStart(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("GET", "/api/v1/statistics/staff?start_date=2026-03-31&end_date=2026-03-01", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}
```

- [ ] **Step 2: 运行，确认失败**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./handler/ -run "TestGetStaffRevenue" -v 2>&1 | head -15
```
Expected: `FAIL` — route not found / 404

- [ ] **Step 3: 在 statistics.go handler 末尾追加 GetStaffRevenue**

在 `server/handler/statistics.go` 中追加：

```go
// GetStaffRevenue returns per-user revenue stats for the given date range.
// Query params: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)
func (h *StatisticsHandler) GetStaffRevenue(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	startStr := c.Query("start_date")
	endStr := c.Query("end_date")

	if startStr == "" || endStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "start_date and end_date are required"})
		return
	}

	startDate, err := time.ParseInLocation("2006-01-02", startStr, time.Local)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid start_date format, use YYYY-MM-DD"})
		return
	}
	endDate, err := time.ParseInLocation("2006-01-02", endStr, time.Local)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid end_date format, use YYYY-MM-DD"})
		return
	}

	if endDate.Before(startDate) {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "end_date must be after start_date"})
		return
	}

	result, err := h.svc.GetStaffRevenue(tenantID, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get staff revenue data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": result})
}
```

- [ ] **Step 4: 在 router.go 注册路由**

在 `server/router/router.go` 的 `statistics` 路由组中（`statistics.POST("/rebuild", ...)` 下面）加：

```go
statistics.GET("/staff", middleware.RequirePermission(db, "statistics:read"), statisticsHandler.GetStaffRevenue)
```

- [ ] **Step 5: 运行 handler 测试**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./handler/ -run "TestGetStaffRevenue" -v
```
Expected: 全部 `PASS`

- [ ] **Step 6: 全量 handler 回归**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./handler/ -v 2>&1 | tail -5
```
Expected: `ok github.com/callmefisher/menzhen/server/handler`

- [ ] **Step 7: Commit**

```bash
cd /Users/xiayanji/qbox/menzhen
git add server/handler/statistics.go server/handler/statistics_staff_handler_test.go server/router/router.go
git commit -m "feat: GET /statistics/staff handler and route"
```

---

## Task 5: 账单 CRUD 触发 RefreshDailyStaffStats

**Files:**
- Modify: `server/service/billing.go`
- Modify: `server/service/prescription.go`
- Modify: `server/service/record.go`

- [ ] **Step 1: billing.go — 3 处 RefreshDailyStats 旁加 RefreshDailyStaffStats**

**位置 1** (原 line ~238)：`CreateOrUpdateBilling` 函数内，现有代码：
```go
statsSvc := NewStatisticsService(s.DB)
_ = statsSvc.RefreshDailyStats(tenantID, billing.CreatedAt)
var record model.MedicalRecord
if err := s.DB.First(&record, billing.RecordID).Error; err == nil {
    if !sameDay(billing.CreatedAt, record.VisitDate) {
        _ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
    }
}
```

改为：
```go
statsSvc := NewStatisticsService(s.DB)
_ = statsSvc.RefreshDailyStats(tenantID, billing.CreatedAt)
var record model.MedicalRecord
if err := s.DB.First(&record, billing.RecordID).Error; err == nil {
    if !sameDay(billing.CreatedAt, record.VisitDate) {
        _ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
    }
    _ = statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, billing.CreatedAt)
    if !sameDay(billing.CreatedAt, record.VisitDate) {
        _ = statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, record.VisitDate)
    }
}
```

**位置 2** (原 line ~362)：`DeductStockAndBill` 函数内，现有代码：
```go
statsSvc := NewStatisticsService(s.DB)
_ = statsSvc.RefreshDailyStats(tenantID, result.CreatedAt)
var record model.MedicalRecord
if err := s.DB.First(&record, result.RecordID).Error; err == nil {
    if !sameDay(result.CreatedAt, record.VisitDate) {
        _ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
    }
}
```

改为：
```go
statsSvc := NewStatisticsService(s.DB)
_ = statsSvc.RefreshDailyStats(tenantID, result.CreatedAt)
var record model.MedicalRecord
if err := s.DB.First(&record, result.RecordID).Error; err == nil {
    if !sameDay(result.CreatedAt, record.VisitDate) {
        _ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
    }
    _ = statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, result.CreatedAt)
    if !sameDay(result.CreatedAt, record.VisitDate) {
        _ = statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, record.VisitDate)
    }
}
```

**位置 3** (原 line ~495)：`CreateRecordBilling` 函数内，`record` 变量已在作用域内，现有代码：
```go
statsSvc := NewStatisticsService(s.DB)
_ = statsSvc.RefreshDailyStats(tenantID, billing.CreatedAt)
if !sameDay(billing.CreatedAt, record.VisitDate) {
    _ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
}
```

改为：
```go
statsSvc := NewStatisticsService(s.DB)
_ = statsSvc.RefreshDailyStats(tenantID, billing.CreatedAt)
if !sameDay(billing.CreatedAt, record.VisitDate) {
    _ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
}
_ = statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, billing.CreatedAt)
if !sameDay(billing.CreatedAt, record.VisitDate) {
    _ = statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, record.VisitDate)
}
```

- [ ] **Step 2: prescription.go — 在 RefreshDailyStats 调用旁加 RefreshDailyStaffStats**

在 `server/service/prescription.go` 中找到：
```go
_ = statsSvc.RefreshDailyStats(tenantID, bd)
```
和
```go
_ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
```

在这两行下方分别加：
```go
_ = statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, bd)
```
和
```go
_ = statsSvc.RefreshDailyStaffStats(tenantID, record.CreatedBy, record.VisitDate)
```

（注：`record` 变量已在该函数作用域内；`bd` 是 billing date）

- [ ] **Step 3: record.go — 在 RefreshDailyStats 调用旁加 RefreshDailyStaffStats**

在 `server/service/record.go` 中找到 `RefreshDailyStats` 调用处（line ~456-466），加对应的 `RefreshDailyStaffStats` 调用，使用 `record.CreatedBy` 作为 userID。

- [ ] **Step 4: 编译**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go build ./...
```
Expected: 无错误

- [ ] **Step 5: 全量后端测试**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./... 2>&1 | tail -10
```
Expected: 所有包 `ok`，无 `FAIL`

- [ ] **Step 6: Commit**

```bash
cd /Users/xiayanji/qbox/menzhen
git add server/service/billing.go server/service/prescription.go server/service/record.go
git commit -m "feat: hook RefreshDailyStaffStats into billing/prescription/record CRUD"
```

---

## Task 6: seed.go 回填 + RebuildStats 端点联动

**Files:**
- Modify: `server/database/seed.go`
- Modify: `server/handler/statistics.go`

- [ ] **Step 1: 在 seed.go 加 rebuildEmptyDailyStaffStats 并调用**

在 `server/database/seed.go` 末尾追加：

```go
// rebuildEmptyDailyStaffStats checks if daily_staff_stats is empty for tenants that have
// billing records, and triggers a full rebuild if so.
func rebuildEmptyDailyStaffStats(db *gorm.DB) {
	var tenantIDs []uint64
	db.Model(&model.Billing{}).Distinct("tenant_id").Pluck("tenant_id", &tenantIDs)
	if len(tenantIDs) == 0 {
		return
	}

	statsSvc := service.NewStatisticsService(db)
	for _, tid := range tenantIDs {
		var count int64
		db.Model(&model.DailyStaffStats{}).Where("tenant_id = ?", tid).Count(&count)
		if count == 0 {
			log.Printf("Rebuilding daily staff stats for tenant %d", tid)
			if err := statsSvc.RebuildAllDailyStaffStats(tid); err != nil {
				log.Printf("Warning: failed to rebuild staff stats for tenant %d: %v", tid, err)
			}
		}
	}
}
```

并在 `Seed()` 函数末尾（`rebuildEmptyDailyStats(db)` 之后）加：

```go
rebuildEmptyDailyStaffStats(db)
```

Also add `&model.DailyStaffStats{}` to the `AutoMigrate` call in `database.go` (check `server/database/database.go` for the migrate list and add it there).

- [ ] **Step 2: 让 RebuildStats handler 同时 rebuild staff stats**

在 `server/handler/statistics.go` 的 `RebuildStats` 方法中，现有：
```go
if err := h.svc.RebuildAllDailyStats(tenantID); err != nil {
    c.JSON(http.StatusInternalServerError, gin.H{...})
    return
}
```

改为：
```go
if err := h.svc.RebuildAllDailyStats(tenantID); err != nil {
    c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to rebuild statistics"})
    return
}
if err := h.svc.RebuildAllDailyStaffStats(tenantID); err != nil {
    c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to rebuild staff statistics"})
    return
}
```

- [ ] **Step 3: 确认 database.go 的 AutoMigrate 包含 DailyStaffStats**

打开 `server/database/database.go`，找到 `AutoMigrate` 调用，加入 `&model.DailyStaffStats{}`（如果尚未包含）。

- [ ] **Step 4: 编译 + 全量测试**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go build ./... && go test ./... 2>&1 | tail -10
```
Expected: 编译成功，所有测试 `ok`

- [ ] **Step 5: Commit**

```bash
cd /Users/xiayanji/qbox/menzhen
git add server/database/seed.go server/database/database.go server/handler/statistics.go
git commit -m "feat: seed rebuild + RebuildStats endpoint now includes staff stats"
```

---

## Task 7: 前端 API 类型 + getStaffRevenue

**Files:**
- Modify: `web/src/api/statistics.ts`

- [ ] **Step 1: 追加类型和 API 函数**

在 `web/src/api/statistics.ts` 末尾追加：

```typescript
export interface StaffRevenueItem {
  user_id: number;
  real_name: string;
  revenue: number;
  consultation_fee: number;
  drug_fee: number;
  record_count: number;
  avg_per_record: number;
  revenue_percent: number;
}

export interface StaffRevenueSummary {
  total_revenue: number;
  total_records: number;
  staff_count: number;
  avg_per_record: number;
}

export interface StaffRevenueResult {
  summary: StaffRevenueSummary;
  staff: StaffRevenueItem[];
}

export function getStaffRevenue(startDate: string, endDate: string) {
  return request.get<{ code: number; data: StaffRevenueResult }>('/statistics/staff', {
    params: { start_date: startDate, end_date: endDate },
  });
}
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npx tsc --noEmit 2>&1 | head -20
```
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
cd /Users/xiayanji/qbox/menzhen
git add web/src/api/statistics.ts
git commit -m "feat: add StaffRevenue types and getStaffRevenue API function"
```

---

## Task 8: StaffRevenuePanel 组件

**Files:**
- Create: `web/src/pages/statistics/components/StaffRevenuePanel.tsx`
- Create: `web/src/pages/statistics/__tests__/StaffRevenuePanel.test.tsx`

- [ ] **Step 1: 先写失败测试**

新建 `web/src/pages/statistics/__tests__/StaffRevenuePanel.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import StaffRevenuePanel from '../components/StaffRevenuePanel';

const mockStaffData = {
  code: 0,
  data: {
    summary: {
      total_revenue: 28640,
      total_records: 142,
      staff_count: 4,
      avg_per_record: 201.69,
    },
    staff: [
      {
        user_id: 1,
        real_name: '李医生',
        revenue: 12300,
        consultation_fee: 5800,
        drug_fee: 6500,
        record_count: 58,
        avg_per_record: 212.07,
        revenue_percent: 42.9,
      },
      {
        user_id: 2,
        real_name: '王医生',
        revenue: 9840,
        consultation_fee: 4600,
        drug_fee: 5240,
        record_count: 46,
        avg_per_record: 213.91,
        revenue_percent: 34.4,
      },
    ],
  },
};

vi.mock('../../../api/statistics', () => ({
  getStaffRevenue: vi.fn().mockResolvedValue(mockStaffData),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: vi.fn().mockReturnValue(false),
}));

function renderPanel(startDate = '2026-03-01', endDate = '2026-03-31') {
  return render(
    <BrowserRouter>
      <StaffRevenuePanel startDate={startDate} endDate={endDate} />
    </BrowserRouter>,
  );
}

describe('StaffRevenuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders summary cards', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('¥28,640')).toBeInTheDocument();
    });
    expect(screen.getByText('142')).toBeInTheDocument();
    expect(screen.getByText('4人')).toBeInTheDocument();
  });

  it('renders rank cards for each staff member', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('李医生')).toBeInTheDocument();
    });
    expect(screen.getByText('王医生')).toBeInTheDocument();
  });

  it('renders revenue amounts', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('¥12,300')).toBeInTheDocument();
    });
    expect(screen.getByText('¥9,840')).toBeInTheDocument();
  });

  it('renders drug fee and consultation fee labels', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getAllByText('诊金')[0]).toBeInTheDocument();
    });
    expect(screen.getAllByText('药费')[0]).toBeInTheDocument();
  });

  it('shows empty state when no data', async () => {
    const { getStaffRevenue } = await import('../../../api/statistics');
    (getStaffRevenue as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 0,
      data: { summary: { total_revenue: 0, total_records: 0, staff_count: 0, avg_per_record: 0 }, staff: [] },
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('暂无人员收费数据')).toBeInTheDocument();
    });
  });

  it('renders rank numbers', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npx vitest run src/pages/statistics/__tests__/StaffRevenuePanel.test.tsx 2>&1 | tail -10
```
Expected: `FAIL` — module not found

- [ ] **Step 3: 实现 StaffRevenuePanel 组件**

新建 `web/src/pages/statistics/components/StaffRevenuePanel.tsx`：

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Row, Col, Spin, Empty } from 'antd';
import { getStaffRevenue } from '../../../api/statistics';
import type { StaffRevenueResult, StaffRevenueItem } from '../../../api/statistics';
import useIsMobile from '../../../hooks/useIsMobile';

interface Props {
  startDate: string;
  endDate: string;
}

const RANK_COLORS = ['#f59e0b', '#94a3b8', '#c97c34'];

function RankBadge({ rank }: { rank: number }) {
  const bg = rank <= 3 ? RANK_COLORS[rank - 1] : '#374151';
  const color = rank <= 3 ? '#000' : '#9ca3af';
  return (
    <div
      style={{
        width: 28, height: 28, borderRadius: '50%',
        background: bg, color, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 800, flexShrink: 0,
      }}
    >
      {rank}
    </div>
  );
}

function StaffCard({ item, rank, maxRevenue, isMobile }: {
  item: StaffRevenueItem;
  rank: number;
  maxRevenue: number;
  isMobile: boolean;
}) {
  const barWidth = maxRevenue > 0 ? (item.revenue / maxRevenue) * 100 : 0;
  const consultPct = item.revenue > 0 ? (item.consultation_fee / item.revenue) * 100 : 0;
  const drugPct = item.revenue > 0 ? (item.drug_fee / item.revenue) * 100 : 0;

  return (
    <div
      style={{
        background: '#0f1117',
        borderRadius: 12,
        padding: isMobile ? '12px 14px' : '14px 16px',
        marginBottom: 8,
      }}
    >
      {/* Top row: rank + name + revenue */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <RankBadge rank={rank} />
        <span style={{ fontSize: isMobile ? 14 : 15, fontWeight: 700, color: '#fff', flex: 1 }}>
          {item.real_name || `用户${item.user_id}`}
        </span>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: isMobile ? 17 : 19, fontWeight: 800, color: '#4ade80' }}>
            ¥{item.revenue.toLocaleString()}
          </span>
          <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 6 }}>
            {item.revenue_percent.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Progress bar: relative width based on max + dual color split */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ background: '#1e2433', borderRadius: 6, height: 8, overflow: 'hidden', display: 'flex', width: `${barWidth}%`, minWidth: barWidth > 0 ? 8 : 0 }}>
          <div style={{ height: 8, background: 'linear-gradient(90deg,#4f8ef7,#36cfc9)', width: `${consultPct}%` }} />
          <div style={{ height: 8, background: 'linear-gradient(90deg,#f59e0b,#fbbf24)', width: `${drugPct}%` }} />
        </div>
      </div>

      {/* Stats grid */}
      {isMobile ? (
        <div style={{ display: 'flex' }}>
          {[
            { label: '诊次', value: String(item.record_count) },
            { label: '诊金', value: `¥${item.consultation_fee.toLocaleString()}`, color: '#4f8ef7' },
            { label: '药费', value: `¥${item.drug_fee.toLocaleString()}`, color: '#f59e0b' },
            { label: '占比', value: `${item.revenue_percent.toFixed(1)}%` },
          ].map((s, i, arr) => (
            <div
              key={s.label}
              style={{
                flex: 1, textAlign: 'center', padding: '4px 0',
                borderRight: i < arr.length - 1 ? '1px solid #2d3748' : undefined,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: s.color ?? '#cbd5e1' }}>{s.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {[
            { label: '诊次', value: String(item.record_count) },
            { label: '诊金', value: `¥${item.consultation_fee.toLocaleString()}`, color: '#4f8ef7' },
            { label: '药费', value: `¥${item.drug_fee.toLocaleString()}`, color: '#f59e0b' },
            { label: '人均费用', value: `¥${item.avg_per_record.toLocaleString()}` },
            { label: '收入占比', value: `${item.revenue_percent.toFixed(1)}%` },
          ].map((s) => (
            <div
              key={s.label}
              style={{ background: '#1a2236', borderRadius: 6, padding: '6px 4px', textAlign: 'center' }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: s.color ?? '#e2e8f0' }}>{s.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StaffRevenuePanel({ startDate, endDate }: Props) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<StaffRevenueResult | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getStaffRevenue(startDate, endDate);
      const body = res as unknown as { code: number; data: StaffRevenueResult };
      setData(body.data);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const maxRevenue = data?.staff[0]?.revenue ?? 0;

  const summaryItems = data
    ? [
        { label: '团队总收入', value: `¥${data.summary.total_revenue.toLocaleString()}`, color: '#4ade80' },
        { label: '总诊次', value: String(data.summary.total_records), color: '#4f8ef7' },
        { label: '参与医生', value: `${data.summary.staff_count}人`, color: '#f59e0b' },
        { label: '人均诊次费用', value: `¥${data.summary.avg_per_record.toLocaleString()}`, color: '#a78bfa' },
      ]
    : [];

  return (
    <Spin spinning={loading}>
      {data && data.staff.length > 0 ? (
        <div>
          {/* Summary strip */}
          <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
            {summaryItems.map((s) => (
              <Col span={isMobile ? 12 : 6} key={s.label}>
                <div
                  style={{
                    background: '#141820',
                    borderRadius: 10,
                    padding: isMobile ? '10px 12px' : '12px 16px',
                  }}
                >
                  <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{s.label}</div>
                </div>
              </Col>
            ))}
          </Row>

          {/* Bar legend */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6b7280' }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: '#4f8ef7' }} />诊金
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6b7280' }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b' }} />药费
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#374151' }}>
              进度条宽度 = 与第1名收入的比例
            </div>
          </div>

          {/* Rank cards — all staff, no limit */}
          {data.staff.map((item, idx) => (
            <StaffCard
              key={item.user_id}
              item={item}
              rank={idx + 1}
              maxRevenue={maxRevenue}
              isMobile={isMobile}
            />
          ))}
        </div>
      ) : (
        !loading && <Empty description="暂无人员收费数据" />
      )}
    </Spin>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npx vitest run src/pages/statistics/__tests__/StaffRevenuePanel.test.tsx
```
Expected: 全部 `PASS`

- [ ] **Step 5: Commit**

```bash
cd /Users/xiayanji/qbox/menzhen
git add web/src/pages/statistics/components/StaffRevenuePanel.tsx web/src/pages/statistics/__tests__/StaffRevenuePanel.test.tsx
git commit -m "feat: StaffRevenuePanel ranking component with dual-color progress bar"
```

---

## Task 9: StatsDashboard 加 Tabs + 回归测试

**Files:**
- Modify: `web/src/pages/statistics/StatsDashboard.tsx`
- Modify: `web/src/pages/statistics/__tests__/StatsDashboard.test.tsx`

- [ ] **Step 1: 修改 StatsDashboard.tsx**

在 `web/src/pages/statistics/StatsDashboard.tsx` 中：

1. 新增 import：
```tsx
import { Radio, DatePicker, Spin, Empty, Tabs } from 'antd';
import StaffRevenuePanel from './components/StaffRevenuePanel';
```

2. 将当前 return 语句中 filters + Spin 部分包裹在 Tabs 中：

```tsx
export default function StatsDashboard() {
  const isMobile = useIsMobile();
  const [quickRange, setQuickRange] = useState<QuickRange>('month');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(getDateRange('month'));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);

  // ... existing fetchData, handleQuickRange, handleRangeChange, chartData unchanged ...

  const filterBar = (
    <div
      style={{
        marginBottom: 16,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        overflowX: isMobile ? 'auto' : undefined,
      }}
    >
      <Radio.Group
        value={quickRange}
        onChange={(e) => handleQuickRange(e.target.value)}
        size={isMobile ? 'small' : 'middle'}
        optionType="button"
        buttonStyle="solid"
      >
        <Radio.Button value="today">今日</Radio.Button>
        <Radio.Button value="week">本周</Radio.Button>
        <Radio.Button value="month">本月</Radio.Button>
        <Radio.Button value="quarter">本季</Radio.Button>
        <Radio.Button value="year">本年</Radio.Button>
      </Radio.Group>
      <RangePicker
        size={isMobile ? 'small' : 'middle'}
        value={dateRange}
        onChange={handleRangeChange}
        style={{ minWidth: isMobile ? 200 : 240 }}
      />
    </div>
  );

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      {filterBar}
      <Tabs
        defaultActiveKey="overview"
        size={isMobile ? 'small' : 'middle'}
        items={[
          {
            key: 'overview',
            label: isMobile ? '概览' : '数据概览',
            children: (
              <Spin spinning={loading}>
                {data ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <SummaryCards summary={data.summary} />
                    <RevenueTrendChart data={chartData} />
                    <div
                      style={{
                        display: isMobile ? 'flex' : 'grid',
                        flexDirection: 'column',
                        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                        gap: 16,
                      }}
                    >
                      <RevenueBreakdownChart data={chartData} />
                      <PatientChart data={chartData} />
                    </div>
                  </div>
                ) : (
                  !loading && <Empty description="暂无统计数据" />
                )}
              </Spin>
            ),
          },
          {
            key: 'staff',
            label: isMobile ? '人员' : '人员收费',
            children: (
              <StaffRevenuePanel
                startDate={dateRange[0].format('YYYY-MM-DD')}
                endDate={dateRange[1].format('YYYY-MM-DD')}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 2: 更新 StatsDashboard 测试**

在 `web/src/pages/statistics/__tests__/StatsDashboard.test.tsx` 中，在现有 mock 之后追加 `getStaffRevenue` mock（防止组件渲染时报错）：

在 `vi.mock('../../../api/statistics', () => ({` 的对象中追加：
```tsx
getStaffRevenue: vi.fn().mockResolvedValue({
  code: 0,
  data: {
    summary: { total_revenue: 0, total_records: 0, staff_count: 0, avg_per_record: 0 },
    staff: [],
  },
}),
```

然后在 `describe('StatsDashboard', ...)` 末尾追加：
```tsx
it('renders overview and staff tabs', async () => {
  renderWithRouter();
  await waitFor(() => {
    expect(screen.getByText('数据概览')).toBeInTheDocument();
  });
  expect(screen.getByText('人员收费')).toBeInTheDocument();
});

it('staff tab shows empty state when no data', async () => {
  const user = (await import('@testing-library/user-event')).default;
  renderWithRouter();
  await waitFor(() => {
    expect(screen.getByText('人员收费')).toBeInTheDocument();
  });
  await user.click(screen.getByText('人员收费'));
  await waitFor(() => {
    expect(screen.getByText('暂无人员收费数据')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 运行前端全量测试**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npm run test 2>&1 | tail -15
```
Expected: 所有测试文件通过

- [ ] **Step 4: 前端构建检查**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -10
```
Expected: `✓ built in ...`，无 TypeScript 错误

- [ ] **Step 5: Commit**

```bash
cd /Users/xiayanji/qbox/menzhen
git add web/src/pages/statistics/StatsDashboard.tsx web/src/pages/statistics/__tests__/StatsDashboard.test.tsx
git commit -m "feat: add 人员收费 Tab to StatsDashboard with StaffRevenuePanel"
```

---

## Task 10: 全量验证 + 部署

- [ ] **Step 1: 后端全量测试**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./... -v 2>&1 | grep -E "^(ok|FAIL|---)"
```
Expected: 所有包显示 `ok`，无 `FAIL`

- [ ] **Step 2: 前端全量测试**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npm run test 2>&1 | tail -10
```
Expected: 所有测试文件通过

- [ ] **Step 3: 前端构建**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -5
```
Expected: `✓ built in ...`

- [ ] **Step 4: 部署**

```bash
cd /Users/xiayanji/qbox/menzhen && bash deploy.sh
```

- [ ] **Step 5: 冒烟测试 — 验证 API 可访问**

```bash
# 替换 TOKEN 为实际登录 token
curl -s "http://localhost:8080/api/v1/statistics/staff?start_date=2026-03-01&end_date=2026-03-31" \
  -H "Authorization: Bearer TOKEN" | python3 -m json.tool | head -20
```
Expected: `"code": 0`，`"staff": [...]`

---

## 性能说明

| 场景 | 查询目标 | 行数估算 | 耗时 |
|------|---------|---------|------|
| `GetStaffRevenue` | `daily_staff_stats` | 10 医生 × 365 天 = 3,650 行/年 | < 5ms |
| `RefreshDailyStaffStats` | `billings` JOIN `medical_records`（单天单用户） | 索引扫描，平均几十行 | < 20ms |
| 原 `billings` 表 10M 行 | **不直接查询**（全走预聚合） | — | — |

关键索引：`idx_staff_tenant_date (tenant_id, stat_date)` 覆盖日期范围查询；`idx_staff_tenant_user_date (tenant_id, user_id, stat_date)` 覆盖 UPSERT。
