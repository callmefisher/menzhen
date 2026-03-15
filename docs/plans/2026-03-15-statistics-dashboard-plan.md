# 统计仪表盘实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在运营菜单下新增统计概览仪表盘，展示财务（实收）、诊疗记录、患者数量的可视化统计。

**Architecture:** 后端新增 `daily_stats` 汇总表 + statistics service/handler/router。billing 创建时写时聚合更新汇总表。前端新增 StatsDashboard 页面，使用 ECharts 可视化，`useIsMobile` 响应式适配。

**Tech Stack:** Go/Gin/GORM (后端) + React/TypeScript/Ant Design/ECharts (前端)

**Spec:** `docs/plans/2026-03-15-statistics-dashboard-design.md`

---

## File Structure

### 新建文件

| 文件 | 职责 |
|------|------|
| `server/model/daily_stats.go` | DailyStats 数据模型 |
| `server/service/statistics.go` | RefreshDailyStats / GetDashboard / RebuildAllDailyStats |
| `server/service/statistics_test.go` | 后端统计逻辑测试 |
| `server/handler/statistics.go` | GetDashboard API handler |
| `server/handler/statistics_test.go` | API handler 测试 |
| `web/src/api/statistics.ts` | 前端 API 调用层 |
| `web/src/pages/statistics/StatsDashboard.tsx` | 仪表盘主页面 |
| `web/src/pages/statistics/components/SummaryCards.tsx` | 渐变汇总卡片组件 |
| `web/src/pages/statistics/components/RevenueTrendChart.tsx` | 收入+诊疗量双轴图 |
| `web/src/pages/statistics/components/RevenueBreakdownChart.tsx` | 诊金 vs 药费堆叠柱状图 |
| `web/src/pages/statistics/components/PatientChart.tsx` | 新增 vs 复诊患者柱状图 |
| `web/src/pages/statistics/__tests__/StatsDashboard.test.tsx` | 前端页面测试 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `server/database/database.go:55` | AutoMigrate 添加 `&model.DailyStats{}` |
| `server/testutil/testutil.go:106` | 测试 AutoMigrate 添加 `&model.DailyStats{}` |
| `server/service/billing.go:192,275` | CreateBilling/DeductStockAndBill 末尾调 RefreshDailyStats |
| `server/router/router.go:276` | 新增 statistics 路由组 |
| `web/src/App.tsx:25,85` | 新增 import + Route |
| `web/src/components/Layout.tsx:162-208` | 运营菜单新增统计概览入口 |

---

## Task 1: DailyStats 数据模型 + AutoMigrate

**Files:**
- Create: `server/model/daily_stats.go`
- Modify: `server/database/database.go:55`
- Modify: `server/testutil/testutil.go:106`

- [ ] **Step 1: 创建 DailyStats 模型**

注意：DailyStats 是汇总表，不需要软删除。不使用 BaseModel，自定义字段。

```go
// server/model/daily_stats.go
package model

import "time"

type DailyStats struct {
	ID                    uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID              uint64    `gorm:"uniqueIndex:idx_tenant_date;not null" json:"tenant_id"`
	StatDate              time.Time `gorm:"uniqueIndex:idx_tenant_date;type:date;not null" json:"stat_date"`
	Revenue               float64   `gorm:"type:decimal(12,2);default:0" json:"revenue"`
	ConsultationFee       float64   `gorm:"type:decimal(12,2);default:0" json:"consultation_fee"`
	DrugFee               float64   `gorm:"type:decimal(12,2);default:0" json:"drug_fee"`
	RecordCount           int       `gorm:"default:0" json:"record_count"`
	NewPatientCount       int       `gorm:"default:0" json:"new_patient_count"`
	ReturningPatientCount int       `gorm:"default:0" json:"returning_patient_count"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}
```

- [ ] **Step 2: 添加到 AutoMigrate**

在 `server/database/database.go` 第 55 行 `&model.Billing{}` 后添加：
```go
&model.DailyStats{},
```

在 `server/testutil/testutil.go` 第 106 行 `&model.Billing{}` 后添加：
```go
&model.DailyStats{},
```

- [ ] **Step 3: 验证编译**

Run: `cd server && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add server/model/daily_stats.go server/database/database.go server/testutil/testutil.go
git commit -m "feat: add DailyStats model and AutoMigrate"
```

---

## Task 2: Statistics Service — RefreshDailyStats

**Files:**
- Create: `server/service/statistics.go`
- Create: `server/service/statistics_test.go`

- [ ] **Step 1: 写测试 — RefreshDailyStats 正确聚合**

```go
// server/service/statistics_test.go
package service

import (
	"testing"
	"time"

	"menzhen/server/model"
	"menzhen/server/testutil"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRefreshDailyStats_Basic(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenantID := uint64(1)
	date := time.Date(2026, 3, 15, 0, 0, 0, 0, time.Local)

	// 创建测试患者
	patient1 := model.Patient{TenantID: tenantID, Name: "张三", Gender: 1, Age: 30, CreatedBy: 1}
	patient2 := model.Patient{TenantID: tenantID, Name: "李四", Gender: 2, Age: 25, CreatedBy: 1}
	db.Create(&patient1)
	db.Create(&patient2)

	// 创建诊疗记录（visit_date = 当天）
	record1 := model.MedicalRecord{PatientID: patient1.ID, TenantID: tenantID, VisitDate: date, CreatedBy: 1, Diagnosis: "test"}
	record2 := model.MedicalRecord{PatientID: patient2.ID, TenantID: tenantID, VisitDate: date, CreatedBy: 1, Diagnosis: "test"}
	db.Create(&record1)
	db.Create(&record2)

	// 创建处方
	prescription1 := model.Prescription{RecordID: record1.ID, TenantID: tenantID, FormulaName: "test", TotalDoses: 3, CreatedBy: 1}
	prescription2 := model.Prescription{RecordID: record2.ID, TenantID: tenantID, FormulaName: "test", TotalDoses: 3, CreatedBy: 1}
	db.Create(&prescription1)
	db.Create(&prescription2)

	// 创建 billing
	billing1 := model.Billing{PrescriptionID: prescription1.ID, RecordID: record1.ID, TenantID: tenantID, ConsultationFee: 100, ActualPaid: 350, CreatedBy: 1}
	billing2 := model.Billing{PrescriptionID: prescription2.ID, RecordID: record2.ID, TenantID: tenantID, ConsultationFee: 100, ActualPaid: 500, CreatedBy: 1}
	db.Create(&billing1)
	db.Create(&billing2)

	// 执行聚合
	err := svc.RefreshDailyStats(tenantID, date)
	require.NoError(t, err)

	// 验证
	var stats model.DailyStats
	err = db.Where("tenant_id = ? AND stat_date = ?", tenantID, date).First(&stats).Error
	require.NoError(t, err)
	assert.Equal(t, 850.0, stats.Revenue)
	assert.Equal(t, 200.0, stats.ConsultationFee)
	assert.Equal(t, 650.0, stats.DrugFee)
	assert.Equal(t, 2, stats.RecordCount)
	// patient1 和 patient2 都是首次就诊 → 都是新患者
	assert.Equal(t, 2, stats.NewPatientCount)
	assert.Equal(t, 0, stats.ReturningPatientCount)
}

func TestRefreshDailyStats_ReturningPatient(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenantID := uint64(1)
	yesterday := time.Date(2026, 3, 14, 0, 0, 0, 0, time.Local)
	today := time.Date(2026, 3, 15, 0, 0, 0, 0, time.Local)

	// 创建患者
	patient := model.Patient{TenantID: tenantID, Name: "张三", Gender: 1, Age: 30, CreatedBy: 1}
	db.Create(&patient)

	// 昨天有一条记录（使此患者不是新患者）
	oldRecord := model.MedicalRecord{PatientID: patient.ID, TenantID: tenantID, VisitDate: yesterday, CreatedBy: 1, Diagnosis: "old"}
	db.Create(&oldRecord)

	// 今天又来了
	newRecord := model.MedicalRecord{PatientID: patient.ID, TenantID: tenantID, VisitDate: today, CreatedBy: 1, Diagnosis: "new"}
	db.Create(&newRecord)

	prescription := model.Prescription{RecordID: newRecord.ID, TenantID: tenantID, FormulaName: "test", TotalDoses: 1, CreatedBy: 1}
	db.Create(&prescription)
	billing := model.Billing{PrescriptionID: prescription.ID, RecordID: newRecord.ID, TenantID: tenantID, ConsultationFee: 100, ActualPaid: 200, CreatedBy: 1}
	db.Create(&billing)

	err := svc.RefreshDailyStats(tenantID, today)
	require.NoError(t, err)

	var stats model.DailyStats
	err = db.Where("tenant_id = ? AND stat_date = ?", tenantID, today).First(&stats).Error
	require.NoError(t, err)
	assert.Equal(t, 0, stats.NewPatientCount)
	assert.Equal(t, 1, stats.ReturningPatientCount)
}

func TestRefreshDailyStats_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenantID := uint64(1)
	date := time.Date(2026, 3, 15, 0, 0, 0, 0, time.Local)

	err := svc.RefreshDailyStats(tenantID, date)
	require.NoError(t, err)

	var stats model.DailyStats
	err = db.Where("tenant_id = ? AND stat_date = ?", tenantID, date).First(&stats).Error
	require.NoError(t, err)
	assert.Equal(t, 0.0, stats.Revenue)
	assert.Equal(t, 0, stats.RecordCount)
}

func TestRefreshDailyStats_TenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	date := time.Date(2026, 3, 15, 0, 0, 0, 0, time.Local)

	// 租户1数据
	p1 := model.Patient{TenantID: 1, Name: "A", Gender: 1, Age: 30, CreatedBy: 1}
	db.Create(&p1)
	r1 := model.MedicalRecord{PatientID: p1.ID, TenantID: 1, VisitDate: date, CreatedBy: 1, Diagnosis: "t"}
	db.Create(&r1)
	pr1 := model.Prescription{RecordID: r1.ID, TenantID: 1, FormulaName: "f", TotalDoses: 1, CreatedBy: 1}
	db.Create(&pr1)
	b1 := model.Billing{PrescriptionID: pr1.ID, RecordID: r1.ID, TenantID: 1, ConsultationFee: 100, ActualPaid: 500, CreatedBy: 1}
	db.Create(&b1)

	// 租户2数据
	p2 := model.Patient{TenantID: 2, Name: "B", Gender: 1, Age: 30, CreatedBy: 1}
	db.Create(&p2)
	r2 := model.MedicalRecord{PatientID: p2.ID, TenantID: 2, VisitDate: date, CreatedBy: 1, Diagnosis: "t"}
	db.Create(&r2)
	pr2 := model.Prescription{RecordID: r2.ID, TenantID: 2, FormulaName: "f", TotalDoses: 1, CreatedBy: 1}
	db.Create(&pr2)
	b2 := model.Billing{PrescriptionID: pr2.ID, RecordID: r2.ID, TenantID: 2, ConsultationFee: 50, ActualPaid: 200, CreatedBy: 1}
	db.Create(&b2)

	// 聚合租户1
	err := svc.RefreshDailyStats(1, date)
	require.NoError(t, err)

	var stats model.DailyStats
	db.Where("tenant_id = ? AND stat_date = ?", 1, date).First(&stats)
	assert.Equal(t, 500.0, stats.Revenue)
	assert.Equal(t, 1, stats.RecordCount)
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./service/ -run TestRefreshDailyStats -v`
Expected: FAIL (NewStatisticsService not defined)

- [ ] **Step 3: 实现 StatisticsService**

```go
// server/service/statistics.go
package service

import (
	"time"

	"menzhen/server/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
)

type StatisticsService struct {
	DB *gorm.DB
}

func NewStatisticsService(db *gorm.DB) *StatisticsService {
	return &StatisticsService{DB: db}
}

// RefreshDailyStats 重新聚合指定租户+日期的统计数据
func (s *StatisticsService) RefreshDailyStats(tenantID uint64, date time.Time) error {
	// 截断到日期
	statDate := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())

	// 1. 查当天 medical_records 数量
	var recordCount int64
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND DATE(visit_date) = ?", tenantID, statDate.Format("2006-01-02")).
		Count(&recordCount)

	// 2. 查当天 billings 汇总（通过 record_id JOIN medical_records 取 visit_date）
	type BillingSummary struct {
		Revenue         float64
		ConsultationFee float64
	}
	var billingSummary BillingSummary
	s.DB.Model(&model.Billing{}).
		Select("COALESCE(SUM(billings.actual_paid), 0) as revenue, COALESCE(SUM(billings.consultation_fee), 0) as consultation_fee").
		Joins("JOIN medical_records ON medical_records.id = billings.record_id AND medical_records.deleted_at IS NULL").
		Where("billings.tenant_id = ? AND DATE(medical_records.visit_date) = ? AND billings.deleted_at IS NULL", tenantID, statDate.Format("2006-01-02")).
		Scan(&billingSummary)

	drugFee := billingSummary.Revenue - billingSummary.ConsultationFee

	// 3. 新患者 vs 复诊患者
	// 查当天就诊的 distinct patient_id 列表
	var patientIDs []uint64
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND DATE(visit_date) = ?", tenantID, statDate.Format("2006-01-02")).
		Distinct("patient_id").
		Pluck("patient_id", &patientIDs)

	newCount := 0
	returningCount := 0
	for _, pid := range patientIDs {
		// 查该患者最早的 visit_date
		var firstVisit time.Time
		s.DB.Model(&model.MedicalRecord{}).
			Where("tenant_id = ? AND patient_id = ?", tenantID, pid).
			Order("visit_date ASC").
			Limit(1).
			Pluck("visit_date", &firstVisit)

		firstDate := time.Date(firstVisit.Year(), firstVisit.Month(), firstVisit.Day(), 0, 0, 0, 0, firstVisit.Location())
		if firstDate.Equal(statDate) {
			newCount++
		} else {
			returningCount++
		}
	}

	// 4. UPSERT
	stats := model.DailyStats{
		TenantID:              tenantID,
		StatDate:              statDate,
		Revenue:               billingSummary.Revenue,
		ConsultationFee:       billingSummary.ConsultationFee,
		DrugFee:               drugFee,
		RecordCount:           int(recordCount),
		NewPatientCount:       newCount,
		ReturningPatientCount: returningCount,
	}

	return s.DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "stat_date"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"revenue", "consultation_fee", "drug_fee",
			"record_count", "new_patient_count", "returning_patient_count",
			"updated_at",
		}),
	}).Create(&stats).Error
}

// RebuildAllDailyStats 重建指定租户的全部统计数据
func (s *StatisticsService) RebuildAllDailyStats(tenantID uint64) error {
	// 硬删除旧数据（DailyStats 无软删除）
	s.DB.Where("tenant_id = ?", tenantID).Delete(&model.DailyStats{})

	// 查所有有记录的日期
	var dates []time.Time
	s.DB.Model(&model.MedicalRecord{}).
		Where("tenant_id = ?", tenantID).
		Distinct("DATE(visit_date)").
		Pluck("DATE(visit_date)", &dates)

	for _, d := range dates {
		if err := s.RefreshDailyStats(tenantID, d); err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && go test ./service/ -run TestRefreshDailyStats -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/service/statistics.go server/service/statistics_test.go
git commit -m "feat: add StatisticsService with RefreshDailyStats and tests"
```

---

## Task 3: GetDashboard API（service 层 + handler）

**Files:**
- Modify: `server/service/statistics.go`
- Create: `server/handler/statistics.go`
- Create: `server/handler/statistics_test.go`

- [ ] **Step 1: 写测试 — GetDashboard service**

在 `server/service/statistics_test.go` 末尾追加：

```go
func TestGetDashboard_Basic(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenantID := uint64(1)
	// 插入几天的 daily_stats
	for i := 1; i <= 5; i++ {
		db.Create(&model.DailyStats{
			TenantID:              tenantID,
			StatDate:              time.Date(2026, 3, i, 0, 0, 0, 0, time.Local),
			Revenue:               float64(i * 100),
			ConsultationFee:       float64(i * 20),
			DrugFee:               float64(i*100 - i*20),
			RecordCount:           i,
			NewPatientCount:       1,
			ReturningPatientCount: i - 1,
		})
	}

	start := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	end := time.Date(2026, 3, 5, 0, 0, 0, 0, time.Local)
	result, err := svc.GetDashboard(tenantID, start, end)
	require.NoError(t, err)

	assert.Equal(t, 1500.0, result.Summary.TotalRevenue)       // 100+200+300+400+500
	assert.Equal(t, 15, result.Summary.TotalRecords)            // 1+2+3+4+5
	assert.Equal(t, 15, result.Summary.TotalPatients)           // (1+0)+(1+1)+(1+2)+(1+3)+(1+4) = 15
	assert.Equal(t, 100.0, result.Summary.AvgRevenuePerRecord)  // 1500/15
	assert.Len(t, result.DailyTrend, 5)
	assert.Equal(t, 300.0, result.RevenueBreakdown.ConsultationFeeTotal) // 20+40+60+80+100
	assert.Equal(t, 1200.0, result.RevenueBreakdown.DrugFeeTotal)       // 80+160+240+320+400
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
	assert.Len(t, result.DailyTrend, 0)
}

func TestGetDashboard_ChangePercent(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewStatisticsService(db)

	tenantID := uint64(1)
	// 上一时段 (3/1-3/5): revenue = 500
	for i := 1; i <= 5; i++ {
		db.Create(&model.DailyStats{
			TenantID: tenantID,
			StatDate: time.Date(2026, 3, i, 0, 0, 0, 0, time.Local),
			Revenue:  100, RecordCount: 2, NewPatientCount: 1, ReturningPatientCount: 1,
		})
	}
	// 当前时段 (3/6-3/10): revenue = 750
	for i := 6; i <= 10; i++ {
		db.Create(&model.DailyStats{
			TenantID: tenantID,
			StatDate: time.Date(2026, 3, i, 0, 0, 0, 0, time.Local),
			Revenue:  150, RecordCount: 3, NewPatientCount: 2, ReturningPatientCount: 1,
		})
	}

	start := time.Date(2026, 3, 6, 0, 0, 0, 0, time.Local)
	end := time.Date(2026, 3, 10, 0, 0, 0, 0, time.Local)
	result, err := svc.GetDashboard(tenantID, start, end)
	require.NoError(t, err)

	assert.Equal(t, 750.0, result.Summary.TotalRevenue)
	require.NotNil(t, result.Summary.RevenueChangePercent)
	assert.Equal(t, 50.0, *result.Summary.RevenueChangePercent) // (750-500)/500*100
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./service/ -run TestGetDashboard -v`
Expected: FAIL (GetDashboard not defined)

- [ ] **Step 3: 实现 GetDashboard**

在 `server/service/statistics.go` 中添加响应结构和方法：

```go
// 响应结构
type DashboardSummary struct {
	TotalRevenue          float64  `json:"total_revenue"`
	TotalRecords          int      `json:"total_records"`
	TotalPatients         int      `json:"total_patients"`
	AvgRevenuePerRecord   float64  `json:"avg_revenue_per_record"`
	RevenueChangePercent  *float64 `json:"revenue_change_percent"`
	RecordsChangePercent  *float64 `json:"records_change_percent"`
	PatientsChangePercent *float64 `json:"patients_change_percent"`
}

type DailyTrendItem struct {
	Date                  string  `json:"date"`
	Revenue               float64 `json:"revenue"`
	ConsultationFee       float64 `json:"consultation_fee"`
	DrugFee               float64 `json:"drug_fee"`
	RecordCount           int     `json:"record_count"`
	NewPatientCount       int     `json:"new_patient_count"`
	ReturningPatientCount int     `json:"returning_patient_count"`
}

type RevenueBreakdown struct {
	ConsultationFeeTotal float64 `json:"consultation_fee_total"`
	DrugFeeTotal         float64 `json:"drug_fee_total"`
}

type PatientBreakdown struct {
	NewPatients       int `json:"new_patients"`
	ReturningPatients int `json:"returning_patients"`
}

type DashboardResult struct {
	Summary          DashboardSummary `json:"summary"`
	DailyTrend       []DailyTrendItem `json:"daily_trend"`
	RevenueBreakdown RevenueBreakdown `json:"revenue_breakdown"`
	PatientBreakdown PatientBreakdown `json:"patient_breakdown"`
}

func (s *StatisticsService) GetDashboard(tenantID uint64, startDate, endDate time.Time) (*DashboardResult, error) {
	// 查当前时段 daily_stats
	var stats []model.DailyStats
	s.DB.Where("tenant_id = ? AND stat_date >= ? AND stat_date <= ?", tenantID, startDate, endDate).
		Order("stat_date ASC").
		Find(&stats)

	// 聚合
	var totalRevenue, totalConsultation, totalDrug float64
	var totalRecords, totalNew, totalReturning int
	dailyTrend := make([]DailyTrendItem, 0, len(stats))

	for _, st := range stats {
		totalRevenue += st.Revenue
		totalConsultation += st.ConsultationFee
		totalDrug += st.DrugFee
		totalRecords += st.RecordCount
		totalNew += st.NewPatientCount
		totalReturning += st.ReturningPatientCount

		dailyTrend = append(dailyTrend, DailyTrendItem{
			Date:                  st.StatDate.Format("2006-01-02"),
			Revenue:               st.Revenue,
			ConsultationFee:       st.ConsultationFee,
			DrugFee:               st.DrugFee,
			RecordCount:           st.RecordCount,
			NewPatientCount:       st.NewPatientCount,
			ReturningPatientCount: st.ReturningPatientCount,
		})
	}

	totalPatients := totalNew + totalReturning
	var avgRevenue float64
	if totalRecords > 0 {
		avgRevenue = math.Round(totalRevenue/float64(totalRecords)*100) / 100
	}

	// 环比计算：取同等时长的上一时段
	duration := endDate.Sub(startDate)
	prevEnd := startDate.AddDate(0, 0, -1)
	prevStart := prevEnd.Add(-duration)

	var prevStats []model.DailyStats
	s.DB.Where("tenant_id = ? AND stat_date >= ? AND stat_date <= ?", tenantID, prevStart, prevEnd).
		Find(&prevStats)

	var prevRevenue float64
	var prevRecords, prevPatients int
	for _, ps := range prevStats {
		prevRevenue += ps.Revenue
		prevRecords += ps.RecordCount
		prevPatients += ps.NewPatientCount + ps.ReturningPatientCount
	}

	calcChange := func(current, previous float64) *float64 {
		if previous == 0 {
			return nil
		}
		change := (current - previous) / previous * 100
		return &change
	}

	summary := DashboardSummary{
		TotalRevenue:          totalRevenue,
		TotalRecords:          totalRecords,
		TotalPatients:         totalPatients,
		AvgRevenuePerRecord:   avgRevenue,
		RevenueChangePercent:  calcChange(totalRevenue, prevRevenue),
		RecordsChangePercent:  calcChange(float64(totalRecords), float64(prevRecords)),
		PatientsChangePercent: calcChange(float64(totalPatients), float64(prevPatients)),
	}

	return &DashboardResult{
		Summary:    summary,
		DailyTrend: dailyTrend,
		RevenueBreakdown: RevenueBreakdown{
			ConsultationFeeTotal: totalConsultation,
			DrugFeeTotal:         totalDrug,
		},
		PatientBreakdown: PatientBreakdown{
			NewPatients:       totalNew,
			ReturningPatients: totalReturning,
		},
	}, nil
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && go test ./service/ -run TestGetDashboard -v`
Expected: ALL PASS

- [ ] **Step 5: 写 handler 测试**

```go
// server/handler/statistics_test.go
package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"menzhen/server/model"
	"menzhen/server/testutil"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetDashboard_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	perm := testutil.SeedTestPermission(t, db, "tenant:manage", "诊所管理")
	role := testutil.SeedTestRole(t, db, tenant.ID, "admin", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass", role)

	// 插入测试数据
	db.Create(&model.DailyStats{
		TenantID: tenant.ID, StatDate: time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local),
		Revenue: 1000, ConsultationFee: 300, DrugFee: 700, RecordCount: 5, NewPatientCount: 3, ReturningPatientCount: 2,
	})

	router := testutil.SetupRouter(db)
	h := NewStatisticsHandler(db)
	router.GET("/api/v1/statistics/dashboard", h.GetDashboard)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/statistics/dashboard?start_date=2026-03-01&end_date=2026-03-31", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestGetDashboard_MissingParams(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := testutil.SetupRouter(db)
	h := NewStatisticsHandler(db)
	router.GET("/api/v1/statistics/dashboard", h.GetDashboard)

	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	perm := testutil.SeedTestPermission(t, db, "tenant:manage", "诊所管理")
	role := testutil.SeedTestRole(t, db, tenant.ID, "admin", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass", role)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/statistics/dashboard", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetDashboard_InvalidDateFormat(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := testutil.SetupRouter(db)
	h := NewStatisticsHandler(db)
	router.GET("/api/v1/statistics/dashboard", h.GetDashboard)

	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	perm := testutil.SeedTestPermission(t, db, "tenant:manage", "诊所管理")
	role := testutil.SeedTestRole(t, db, tenant.ID, "admin", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass", role)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/statistics/dashboard?start_date=invalid&end_date=2026-03-31", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}
```

- [ ] **Step 6: 运行 handler 测试确认失败**

Run: `cd server && go test ./handler/ -run TestGetDashboard -v`
Expected: FAIL (NewStatisticsHandler not defined)

- [ ] **Step 7: 实现 handler**

```go
// server/handler/statistics.go
package handler

import (
	"net/http"
	"time"

	"menzhen/server/middleware"
	"menzhen/server/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type StatisticsHandler struct {
	db  *gorm.DB
	svc *service.StatisticsService
}

func NewStatisticsHandler(db *gorm.DB) *StatisticsHandler {
	return &StatisticsHandler{
		db:  db,
		svc: service.NewStatisticsService(db),
	}
}

func (h *StatisticsHandler) GetDashboard(c *gin.Context) {
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

	result, err := h.svc.GetDashboard(tenantID, startDate, endDate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get dashboard data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": result})
}
```

- [ ] **Step 8: 运行 handler 测试确认通过**

Run: `cd server && go test ./handler/ -run TestGetDashboard -v`
Expected: ALL PASS

- [ ] **Step 9: 验证编译**

Run: `cd server && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 10: Commit**

```bash
git add server/service/statistics.go server/service/statistics_test.go server/handler/statistics.go server/handler/statistics_test.go
git commit -m "feat: add GetDashboard API with change percent calculation and tests"
```

---

## Task 4: 路由注册 + Billing 调用 RefreshDailyStats

**Files:**
- Modify: `server/router/router.go:276`
- Modify: `server/service/billing.go:192,275`

- [ ] **Step 1: 注册路由**

在 `server/router/router.go` inventory 路由块（约第 276 行 `}` 闭合后）之后添加：

```go
	// Statistics routes (tenant-scoped).
	statistics := authenticated.Group("/statistics")
	{
		statisticsHandler := handler.NewStatisticsHandler(db)
		statistics.GET("/dashboard", middleware.RequirePermission(db, "tenant:manage"), statisticsHandler.GetDashboard)
	}
```

- [ ] **Step 2: Billing service 调用 RefreshDailyStats**

在 `server/service/billing.go` 中：

顶部 import 添加 `"time"`（如未导入）。

在 `CreateBilling` 方法的 return 前（约第 192 行 `return &billing, nil` 之前）添加：

```go
	// 同步刷新当天统计（汇总表查单天数据，很快）
	statsSvc := NewStatisticsService(s.DB)
	var record model.MedicalRecord
	if err := s.DB.First(&record, billing.RecordID).Error; err == nil {
		_ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
	}
```

在 `DeductStockAndBill` 方法的 `return result, nil` 前（约第 275 行）添加同样的代码：

```go
	statsSvc := NewStatisticsService(s.DB)
	var record model.MedicalRecord
	if err := s.DB.First(&record, result.RecordID).Error; err == nil {
		_ = statsSvc.RefreshDailyStats(tenantID, record.VisitDate)
	}
```

- [ ] **Step 3: 验证编译**

Run: `cd server && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 4: 运行全量后端测试**

Run: `cd server && go test ./...`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/router/router.go server/service/billing.go
git commit -m "feat: register statistics route and trigger RefreshDailyStats on billing"
```

---

## Task 5: 前端 — 安装 ECharts + API 层 + 类型

**Files:**
- Create: `web/src/api/statistics.ts`

- [ ] **Step 1: 安装 ECharts**

Run: `cd web && npm install echarts echarts-for-react`

- [ ] **Step 2: 创建 API 层**

```typescript
// web/src/api/statistics.ts
import request from '../utils/request';

export interface DailyTrendItem {
  date: string;
  revenue: number;
  consultation_fee: number;
  drug_fee: number;
  record_count: number;
  new_patient_count: number;
  returning_patient_count: number;
}

export interface DashboardSummary {
  total_revenue: number;
  total_records: number;
  total_patients: number;
  avg_revenue_per_record: number;
  revenue_change_percent: number | null;
  records_change_percent: number | null;
  patients_change_percent: number | null;
}

export interface RevenueBreakdown {
  consultation_fee_total: number;
  drug_fee_total: number;
}

export interface PatientBreakdown {
  new_patients: number;
  returning_patients: number;
}

export interface DashboardData {
  summary: DashboardSummary;
  daily_trend: DailyTrendItem[];
  revenue_breakdown: RevenueBreakdown;
  patient_breakdown: PatientBreakdown;
}

export function getDashboard(startDate: string, endDate: string) {
  return request.get<{ code: number; data: DashboardData }>('/statistics/dashboard', {
    params: { start_date: startDate, end_date: endDate },
  });
}
```

- [ ] **Step 3: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/api/statistics.ts web/package.json web/package-lock.json
git commit -m "feat: add echarts deps and statistics API layer"
```

---

## Task 6: 前端 — SummaryCards 组件

**Files:**
- Create: `web/src/pages/statistics/components/SummaryCards.tsx`

- [ ] **Step 1: 创建组件**

```tsx
// web/src/pages/statistics/components/SummaryCards.tsx
import { Row, Col } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { DashboardSummary } from '../../../api/statistics';
import useIsMobile from '../../../hooks/useIsMobile';

interface SummaryCardsProps {
  summary: DashboardSummary;
}

interface CardConfig {
  title: string;
  value: string;
  change: number | null;
  gradient: string;
}

function ChangeTag({ value }: { value: number | null }) {
  if (value === null) return <span style={{ fontSize: 12, opacity: 0.7 }}>--</span>;
  const isUp = value >= 0;
  return (
    <span style={{ fontSize: 12, opacity: 0.8 }}>
      {isUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
      {' '}{Math.abs(value).toFixed(1)}%
    </span>
  );
}

export default function SummaryCards({ summary }: SummaryCardsProps) {
  const isMobile = useIsMobile();

  const cards: CardConfig[] = [
    {
      title: '总收入',
      value: `¥${summary.total_revenue.toLocaleString()}`,
      change: summary.revenue_change_percent,
      gradient: 'linear-gradient(135deg, #1890ff, #36cfc9)',
    },
    {
      title: '诊疗记录',
      value: String(summary.total_records),
      change: summary.records_change_percent,
      gradient: 'linear-gradient(135deg, #52c41a, #95de64)',
    },
    {
      title: '患者人次',
      value: String(summary.total_patients),
      change: summary.patients_change_percent,
      gradient: 'linear-gradient(135deg, #722ed1, #b37feb)',
    },
  ];

  if (isMobile) {
    return (
      <div>
        {/* 收入卡片满宽 */}
        <div
          style={{
            background: cards[0].gradient,
            borderRadius: 8,
            padding: '16px 20px',
            color: '#fff',
            marginBottom: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>{cards[0].title}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{cards[0].value}</div>
          </div>
          <ChangeTag value={cards[0].change} />
        </div>
        {/* 诊疗/患者双列 */}
        <Row gutter={8}>
          {cards.slice(1).map((card) => (
            <Col span={12} key={card.title}>
              <div
                style={{
                  background: card.gradient,
                  borderRadius: 8,
                  padding: '12px 14px',
                  color: '#fff',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.85 }}>{card.title}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{card.value}</div>
                <ChangeTag value={card.change} />
              </div>
            </Col>
          ))}
        </Row>
      </div>
    );
  }

  return (
    <Row gutter={16}>
      {cards.map((card) => (
        <Col span={8} key={card.title}>
          <div
            style={{
              background: card.gradient,
              borderRadius: 8,
              padding: '20px 24px',
              color: '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 14, opacity: 0.85 }}>{card.title}</div>
              <div style={{ fontSize: 30, fontWeight: 700 }}>{card.value}</div>
            </div>
            <ChangeTag value={card.change} />
          </div>
        </Col>
      ))}
    </Row>
  );
}
```

- [ ] **Step 2: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/statistics/components/SummaryCards.tsx
git commit -m "feat: add SummaryCards component with gradient design"
```

---

## Task 7: 前端 — 三个 ECharts 图表组件

**Files:**
- Create: `web/src/pages/statistics/components/RevenueTrendChart.tsx`
- Create: `web/src/pages/statistics/components/RevenueBreakdownChart.tsx`
- Create: `web/src/pages/statistics/components/PatientChart.tsx`

- [ ] **Step 1: 收入趋势双轴图**

```tsx
// web/src/pages/statistics/components/RevenueTrendChart.tsx
import ReactECharts from 'echarts-for-react';
import { Card } from 'antd';
import type { DailyTrendItem } from '../../../api/statistics';

interface Props {
  data: DailyTrendItem[];
}

export default function RevenueTrendChart({ data }: Props) {
  const option = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['每日收入', '诊疗量'] },
    xAxis: {
      type: 'category' as const,
      data: data.map((d) => d.date.slice(5)), // MM-DD
    },
    yAxis: [
      { type: 'value' as const, name: '收入(¥)', position: 'left' as const },
      { type: 'value' as const, name: '诊疗量', position: 'right' as const },
    ],
    series: [
      {
        name: '诊疗量',
        type: 'bar',
        yAxisIndex: 1,
        data: data.map((d) => d.record_count),
        itemStyle: { color: 'rgba(24,144,255,0.3)' },
        barMaxWidth: 30,
      },
      {
        name: '每日收入',
        type: 'line',
        yAxisIndex: 0,
        data: data.map((d) => d.revenue),
        itemStyle: { color: '#ff4d4f' },
        smooth: true,
      },
    ],
    grid: { left: 60, right: 60, bottom: 30 },
  };

  return (
    <Card title="收入趋势 + 诊疗量" size="small">
      <ReactECharts option={option} style={{ height: 300 }} />
    </Card>
  );
}
```

- [ ] **Step 2: 诊金 vs 药费堆叠柱状图**

```tsx
// web/src/pages/statistics/components/RevenueBreakdownChart.tsx
import ReactECharts from 'echarts-for-react';
import { Card } from 'antd';
import type { DailyTrendItem } from '../../../api/statistics';

interface Props {
  data: DailyTrendItem[];
}

export default function RevenueBreakdownChart({ data }: Props) {
  const option = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['诊金', '药费'] },
    xAxis: {
      type: 'category' as const,
      data: data.map((d) => d.date.slice(5)),
    },
    yAxis: { type: 'value' as const, name: '金额(¥)' },
    series: [
      {
        name: '诊金',
        type: 'bar',
        stack: 'revenue',
        data: data.map((d) => d.consultation_fee),
        itemStyle: { color: '#1890ff' },
        barMaxWidth: 30,
      },
      {
        name: '药费',
        type: 'bar',
        stack: 'revenue',
        data: data.map((d) => d.drug_fee),
        itemStyle: { color: '#52c41a' },
        barMaxWidth: 30,
      },
    ],
    grid: { left: 60, right: 20, bottom: 30 },
  };

  return (
    <Card title="诊金 vs 药费" size="small">
      <ReactECharts option={option} style={{ height: 250 }} />
    </Card>
  );
}
```

- [ ] **Step 3: 新增 vs 复诊患者柱状图**

```tsx
// web/src/pages/statistics/components/PatientChart.tsx
import ReactECharts from 'echarts-for-react';
import { Card } from 'antd';
import type { DailyTrendItem } from '../../../api/statistics';

interface Props {
  data: DailyTrendItem[];
}

export default function PatientChart({ data }: Props) {
  const option = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['新增患者', '复诊患者'] },
    xAxis: {
      type: 'category' as const,
      data: data.map((d) => d.date.slice(5)),
    },
    yAxis: { type: 'value' as const, name: '人次' },
    series: [
      {
        name: '新增患者',
        type: 'bar',
        data: data.map((d) => d.new_patient_count),
        itemStyle: { color: '#722ed1' },
        barMaxWidth: 30,
      },
      {
        name: '复诊患者',
        type: 'bar',
        data: data.map((d) => d.returning_patient_count),
        itemStyle: { color: '#eb2f96' },
        barMaxWidth: 30,
      },
    ],
    grid: { left: 50, right: 20, bottom: 30 },
  };

  return (
    <Card title="新增 vs 复诊患者" size="small">
      <ReactECharts option={option} style={{ height: 250 }} />
    </Card>
  );
}
```

- [ ] **Step 4: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/statistics/components/
git commit -m "feat: add ECharts components — revenue trend, breakdown, patient chart"
```

---

## Task 8: 前端 — StatsDashboard 主页面

**Files:**
- Create: `web/src/pages/statistics/StatsDashboard.tsx`
- Modify: `web/src/App.tsx:25,85`

- [ ] **Step 1: 创建主页面**

```tsx
// web/src/pages/statistics/StatsDashboard.tsx
import { useState, useEffect, useCallback } from 'react';
import { Radio, DatePicker, Spin, Empty, Space } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { getDashboard } from '../../api/statistics';
import type { DashboardData } from '../../api/statistics';
import useIsMobile from '../../hooks/useIsMobile';
import SummaryCards from './components/SummaryCards';
import RevenueTrendChart from './components/RevenueTrendChart';
import RevenueBreakdownChart from './components/RevenueBreakdownChart';
import PatientChart from './components/PatientChart';

const { RangePicker } = DatePicker;

type QuickRange = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

function getDateRange(range: QuickRange): [Dayjs, Dayjs] {
  const now = dayjs();
  switch (range) {
    case 'today':
      return [now.startOf('day'), now.endOf('day')];
    case 'week':
      return [now.startOf('week'), now.endOf('day')];
    case 'month':
      return [now.startOf('month'), now.endOf('day')];
    case 'quarter':
      return [now.startOf('quarter'), now.endOf('day')];
    case 'year':
      return [now.startOf('year'), now.endOf('day')];
    default:
      return [now.startOf('month'), now.endOf('day')];
  }
}

export default function StatsDashboard() {
  const isMobile = useIsMobile();
  const [quickRange, setQuickRange] = useState<QuickRange>('month');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(getDateRange('month'));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDashboard(
        dateRange[0].format('YYYY-MM-DD'),
        dateRange[1].format('YYYY-MM-DD'),
      );
      setData(res.data.data);
    } catch {
      // 静默处理
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleQuickRange = (range: QuickRange) => {
    setQuickRange(range);
    if (range !== 'custom') {
      setDateRange(getDateRange(range));
    }
  };

  const handleRangeChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    if (dates && dates[0] && dates[1]) {
      setQuickRange('custom');
      setDateRange([dates[0], dates[1]]);
    }
  };

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      {/* 时间选择器 */}
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
          value={quickRange === 'custom' ? dateRange : undefined}
          onChange={handleRangeChange}
          style={{ minWidth: isMobile ? 200 : 240 }}
        />
      </div>

      <Spin spinning={loading}>
        {data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 汇总卡片 */}
            <SummaryCards summary={data.summary} />

            {/* 双轴图 */}
            <RevenueTrendChart data={data.daily_trend} />

            {/* 底部双列（桌面端） / 纵向堆叠（移动端） */}
            <div
              style={{
                display: isMobile ? 'flex' : 'grid',
                flexDirection: 'column',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: 16,
              }}
            >
              <RevenueBreakdownChart data={data.daily_trend} />
              <PatientChart data={data.daily_trend} />
            </div>
          </div>
        ) : (
          !loading && <Empty description="暂无统计数据" />
        )}
      </Spin>
    </div>
  );
}
```

- [ ] **Step 2: 注册路由**

在 `web/src/App.tsx` 中：

第 25 行后添加 import：
```tsx
import StatsDashboard from './pages/statistics/StatsDashboard';
```

第 84 行（`<Route path="inventory/alerts" .../>` 之后）添加：
```tsx
        <Route path="statistics" element={<StatsDashboard />} />
```

- [ ] **Step 3: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/statistics/StatsDashboard.tsx web/src/App.tsx
git commit -m "feat: add StatsDashboard page with time range selector"
```

---

## Task 9: 前端 — 菜单入口

**Files:**
- Modify: `web/src/components/Layout.tsx:162-208`

- [ ] **Step 1: 运营菜单添加统计入口**

在 `web/src/components/Layout.tsx` 中：

1. 顶部 import 添加 `BarChartOutlined`：
```tsx
import { BarChartOutlined } from '@ant-design/icons';
```

2. 修改运营菜单的显示条件（约第 162 行），从 `hasPermission('inventory:read')` 改为：
```tsx
if (hasPermission('inventory:read') || hasPermission('tenant:manage')) {
```

3. 在运营菜单的 children 数组末尾（库存预警项之后）添加：
```tsx
...(hasPermission('tenant:manage') ? [{
  key: '/statistics',
  icon: <BarChartOutlined />,
  label: '统计概览',
}] : []),
```

- [ ] **Step 2: 更新菜单展开逻辑**

确保 `/statistics` 路由匹配时运营菜单组自动展开。在 `openKeys` 逻辑中（约第 278-284 行），确认 pathname 以 `/statistics` 开头时也映射到 `/inventory` 组：

```tsx
if (pathname.startsWith('/inventory') || pathname.startsWith('/statistics')) {
  keys.push('/inventory');
}
```

- [ ] **Step 3: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Layout.tsx
git commit -m "feat: add statistics entry in operations menu"
```

---

## Task 10: 前端测试

**Files:**
- Create: `web/src/pages/statistics/__tests__/StatsDashboard.test.tsx`

- [ ] **Step 1: 写测试**

```tsx
// web/src/pages/statistics/__tests__/StatsDashboard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import StatsDashboard from '../StatsDashboard';

const mockDashboardData = {
  summary: {
    total_revenue: 48600,
    total_records: 156,
    total_patients: 89,
    avg_revenue_per_record: 311.54,
    revenue_change_percent: 12.5,
    records_change_percent: 8.3,
    patients_change_percent: 5.2,
  },
  daily_trend: [
    {
      date: '2026-03-01',
      revenue: 1680,
      consultation_fee: 500,
      drug_fee: 1180,
      record_count: 6,
      new_patient_count: 2,
      returning_patient_count: 4,
    },
  ],
  revenue_breakdown: { consultation_fee_total: 15600, drug_fee_total: 33000 },
  patient_breakdown: { new_patients: 34, returning_patients: 55 },
};

vi.mock('../../../api/statistics', () => ({
  getDashboard: vi.fn().mockResolvedValue({ data: { data: mockDashboardData } }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: vi.fn().mockReturnValue(false),
}));

function renderWithRouter() {
  return render(
    <BrowserRouter>
      <StatsDashboard />
    </BrowserRouter>,
  );
}

describe('StatsDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders summary cards with data', async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('¥48,600')).toBeInTheDocument();
    });
    expect(screen.getByText('156')).toBeInTheDocument();
    expect(screen.getByText('89')).toBeInTheDocument();
  });

  it('renders time range buttons', async () => {
    renderWithRouter();
    expect(screen.getByText('今日')).toBeInTheDocument();
    expect(screen.getByText('本周')).toBeInTheDocument();
    expect(screen.getByText('本月')).toBeInTheDocument();
    expect(screen.getByText('本季')).toBeInTheDocument();
    expect(screen.getByText('本年')).toBeInTheDocument();
  });

  it('renders chart titles', async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('收入趋势 + 诊疗量')).toBeInTheDocument();
    });
    expect(screen.getByText('诊金 vs 药费')).toBeInTheDocument();
    expect(screen.getByText('新增 vs 复诊患者')).toBeInTheDocument();
  });

  it('switches time range on button click', async () => {
    const { getDashboard } = await import('../../../api/statistics');
    renderWithRouter();
    await waitFor(() => {
      expect(getDashboard).toHaveBeenCalled();
    });

    const todayBtn = screen.getByText('今日');
    await userEvent.click(todayBtn);
    await waitFor(() => {
      expect(getDashboard).toHaveBeenCalledTimes(2);
    });
  });

  it('shows empty state when no data', async () => {
    const { getDashboard } = await import('../../../api/statistics');
    (getDashboard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { data: null },
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText('暂无统计数据')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `cd web && npx vitest run src/pages/statistics/__tests__/StatsDashboard.test.tsx`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/statistics/__tests__/
git commit -m "test: add StatsDashboard component tests"
```

---

## Task 11: 全量验证 + 构建 + 部署

- [ ] **Step 1: 后端全量测试**

Run: `cd server && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 2: 前端全量测试**

Run: `cd web && npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: 前端构建**

Run: `cd web && npm run build`
Expected: BUILD SUCCESS

- [ ] **Step 4: 后端构建**

Run: `cd server && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 5: 部署到 Docker**

```bash
cd web && npm run build
docker cp dist/. menzhen-web-1:/usr/share/nginx/html/
docker exec menzhen-nginx-1 nginx -s reload
```

- [ ] **Step 6: 更新文档**

更新 `docs/codebase.md`、`README.md`、`CLAUDE.md` 中的相关文档。

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "docs: update codebase docs with statistics dashboard feature"
```
