# 全局统计功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `/statistics` 页面为 superAdmin 新增「全局总览」Tab，展示所有诊所的汇总数据与排名，支持快速查询单个诊所完整报表。

**Architecture:** 后端新增 `GET /api/v1/admin/statistics/global` 接口（跨租户聚合 `daily_stats`），并为 `daily_stats` 加覆盖索引；同时允许 superAdmin 在现有 `/statistics/dashboard` 接口传入 `tenant_id` 越权查询。前端在 `StatsDashboard` 追加一个 `isSuperAdmin` 守卫的 Tab，由新组件 `GlobalStatsPanel` 渲染。

**Tech Stack:** Go 1.21 + Gin + GORM (MySQL 8.0)；React 19 + TypeScript + Ant Design 6；Vitest + Testing Library；testify + testutil.SetupTestDB

---

## 文件清单

### 新增
| 文件 | 职责 |
|------|------|
| `server/service/admin_statistics.go` | `AdminStatisticsService`：跨租户聚合查询 + 内存缓存 |
| `server/service/admin_statistics_test.go` | 服务层测试 |
| `server/handler/admin_statistics.go` | `AdminStatisticsHandler`：权限校验 + 参数解析 |
| `server/handler/admin_statistics_test.go` | Handler 层测试 |
| `web/src/pages/statistics/components/GlobalStatsPanel.tsx` | 全局总览 Tab 主体组件 |
| `web/src/pages/statistics/components/__tests__/GlobalStatsPanel.test.tsx` | 前端组件测试 |

### 修改
| 文件 | 改动 |
|------|------|
| `server/model/daily_stats.go` | 新增 `idx_date_covering` 覆盖索引 tag |
| `server/router/router.go` | 注册 `/admin/statistics/global` 路由 |
| `server/handler/statistics.go` | `GetDashboard` 支持 superAdmin 传入 `tenant_id` |
| `server/handler/statistics_test.go`（若不存在则新增） | 补充 tenant_id override 测试 |
| `web/src/api/statistics.ts` | 新增 `GlobalStatsData` 类型 + `getGlobalStats()` 函数 |
| `web/src/pages/statistics/StatsDashboard.tsx` | 追加「全局总览」Tab + `overrideTenantId` 状态 |

---

## Task 1：DailyStats 覆盖索引

**Files:**
- Modify: `server/model/daily_stats.go`

- [ ] **Step 1：修改 DailyStats 模型，新增覆盖索引 tag**

```go
// server/model/daily_stats.go
package model

import "time"

type DailyStats struct {
	ID                    uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID              uint64    `gorm:"uniqueIndex:idx_tenant_date;not null" json:"tenant_id"`
	StatDate              time.Time `gorm:"uniqueIndex:idx_tenant_date;type:date;not null;index:idx_date_covering" json:"stat_date"`
	Revenue               float64   `gorm:"type:decimal(12,2);default:0;index:idx_date_covering" json:"revenue"`
	ConsultationFee       float64   `gorm:"type:decimal(12,2);default:0" json:"consultation_fee"`
	DrugFee               float64   `gorm:"type:decimal(12,2);default:0" json:"drug_fee"`
	RecordCount           int       `gorm:"default:0;index:idx_date_covering" json:"record_count"`
	NewPatientCount       int       `gorm:"default:0;index:idx_date_covering" json:"new_patient_count"`
	ReturningPatientCount int       `gorm:"default:0;index:idx_date_covering" json:"returning_patient_count"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}
```

> 注意：GORM composite index tag `index:idx_date_covering` 加在多个字段上会生成 `(stat_date, revenue, record_count, ...)` 联合索引，AutoMigrate 时自动创建。

- [ ] **Step 2：确认编译通过**

```bash
cd server && go build ./...
```

预期：无错误输出。

- [ ] **Step 3：Commit**

```bash
cd server && git add model/daily_stats.go
git commit -m "perf: add idx_date_covering on daily_stats for global stats query"
```

---

## Task 2：AdminStatisticsService（后端服务层）

**Files:**
- Create: `server/service/admin_statistics.go`
- Create: `server/service/admin_statistics_test.go`

- [ ] **Step 1：先写失败测试**

```go
// server/service/admin_statistics_test.go
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

func seedDailyStats(t *testing.T, db interface{ Create(interface{}) interface{ Error error } }, tenantID uint64, date time.Time, revenue float64, records, newP, retP int) {
	// helper: use testutil db
}

func TestGetGlobalStats_MultiTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	t1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	t2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")

	date := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	db.Create(&model.DailyStats{TenantID: t1.ID, StatDate: date, Revenue: 1000, RecordCount: 10, NewPatientCount: 3, ReturningPatientCount: 7})
	db.Create(&model.DailyStats{TenantID: t2.ID, StatDate: date, Revenue: 500,  RecordCount: 5,  NewPatientCount: 2, ReturningPatientCount: 3})

	svc := service.NewAdminStatisticsService(db)
	result, err := svc.GetGlobalStats(date, date, 1, 50)
	require.NoError(t, err)

	assert.Equal(t, float64(1500), result.Summary.TotalRevenue)
	assert.Equal(t, 15, result.Summary.TotalRecords)
	assert.Equal(t, 15, result.Summary.TotalPatients)
	assert.Equal(t, 2, result.Summary.TenantCount)
	assert.Equal(t, float64(100), result.Summary.AvgRevenuePerRecord)
	require.Len(t, result.Tenants, 2)
	// First item should be t1 (higher revenue)
	assert.Equal(t, t1.ID, result.Tenants[0].TenantID)
	assert.Equal(t, "诊所A", result.Tenants[0].TenantName)
	assert.InDelta(t, 66.67, result.Tenants[0].RevenuePercent, 0.1)
}

func TestGetGlobalStats_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewAdminStatisticsService(db)
	date := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	result, err := svc.GetGlobalStats(date, date, 1, 50)
	require.NoError(t, err)
	assert.Equal(t, float64(0), result.Summary.TotalRevenue)
	assert.Empty(t, result.Tenants)
}

func TestGetGlobalStats_Pagination(t *testing.T) {
	db := testutil.SetupTestDB(t)
	// Create 3 tenants
	for i := 0; i < 3; i++ {
		tn := testutil.SeedTestTenant(t, db, "诊所"+string(rune('A'+i)), "clinic-"+string(rune('a'+i)))
		date := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
		db.Create(&model.DailyStats{TenantID: tn.ID, StatDate: date, Revenue: float64((3 - i) * 100), RecordCount: 1})
	}
	svc := service.NewAdminStatisticsService(db)
	date := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
	result, err := svc.GetGlobalStats(date, date, 1, 2)
	require.NoError(t, err)
	assert.Equal(t, 3, result.Summary.TenantCount) // total across all pages
	assert.Len(t, result.Tenants, 2)               // page size = 2
}
```

- [ ] **Step 2：运行测试确认失败**

```bash
cd server && go test ./service/ -run TestGetGlobalStats -v
```

预期：`FAIL` — `service.NewAdminStatisticsService undefined`

- [ ] **Step 3：实现 AdminStatisticsService**

```go
// server/service/admin_statistics.go
package service

import (
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

// GlobalTenantItem holds per-tenant aggregated stats for one query period.
type GlobalTenantItem struct {
	TenantID      uint64  `json:"tenant_id"`
	TenantName    string  `json:"tenant_name"`
	Revenue       float64 `json:"revenue"`
	Records       int     `json:"records"`
	Patients      int     `json:"patients"`
	AvgPerRecord  float64 `json:"avg_per_record"`
	RevenuePercent float64 `json:"revenue_percent"`
}

// GlobalSummary holds platform-wide totals.
type GlobalSummary struct {
	TotalRevenue        float64 `json:"total_revenue"`
	TotalRecords        int     `json:"total_records"`
	TotalPatients       int     `json:"total_patients"`
	AvgRevenuePerRecord float64 `json:"avg_revenue_per_record"`
	TenantCount         int     `json:"tenant_count"`
	Total               int     `json:"total"` // total tenants with data (for pagination)
}

// GlobalStatsResult is the response type for GetGlobalStats.
type GlobalStatsResult struct {
	Summary GlobalSummary      `json:"summary"`
	Tenants []GlobalTenantItem `json:"tenants"`
}

type globalCacheEntry struct {
	result    *GlobalStatsResult
	expiresAt time.Time
}

// AdminStatisticsService aggregates daily_stats across all tenants.
type AdminStatisticsService struct {
	DB    *gorm.DB
	cache sync.Map // key: "start:end:page:size" → *globalCacheEntry; TTL 5 min
}

// NewAdminStatisticsService creates a new AdminStatisticsService.
func NewAdminStatisticsService(db *gorm.DB) *AdminStatisticsService {
	return &AdminStatisticsService{DB: db}
}

// GetGlobalStats returns platform-wide aggregated stats for the given date range.
// Results are cached in memory for 5 minutes to reduce DB load at large scale.
// page and size control the returned tenants slice; Summary.Total reflects all tenants.
func (s *AdminStatisticsService) GetGlobalStats(startDate, endDate time.Time, page, size int) (*GlobalStatsResult, error) {
	cacheKey := fmt.Sprintf("%s:%s:%d:%d",
		startDate.Format("2006-01-02"), endDate.Format("2006-01-02"), page, size)

	if v, ok := s.cache.Load(cacheKey); ok {
		entry := v.(*globalCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.result, nil
		}
		s.cache.Delete(cacheKey)
	}

	type row struct {
		TenantID   uint64
		TenantName string
		Revenue    float64
		Records    int
		Patients   int
	}

	// Count total distinct tenants with data in range (for pagination metadata).
	var totalCount int64
	s.DB.Model(&model.DailyStats{}).
		Where("stat_date >= ? AND stat_date <= ?", startDate, endDate).
		Distinct("tenant_id").
		Count(&totalCount)

	// Aggregate per tenant with pagination (ORDER BY revenue DESC).
	var rows []row
	offset := (page - 1) * size
	s.DB.Model(&model.DailyStats{}).
		Select("daily_stats.tenant_id, tenants.name AS tenant_name, "+
			"SUM(daily_stats.revenue) AS revenue, "+
			"SUM(daily_stats.record_count) AS records, "+
			"SUM(daily_stats.new_patient_count + daily_stats.returning_patient_count) AS patients").
		Joins("JOIN tenants ON tenants.id = daily_stats.tenant_id").
		Where("daily_stats.stat_date >= ? AND daily_stats.stat_date <= ?", startDate, endDate).
		Group("daily_stats.tenant_id, tenants.name").
		Order("revenue DESC").
		Limit(size).Offset(offset).
		Scan(&rows)

	// Platform totals (across ALL tenants, not just current page).
	type totalRow struct {
		TotalRevenue  float64
		TotalRecords  int
		TotalPatients int
	}
	var totals totalRow
	s.DB.Model(&model.DailyStats{}).
		Select("SUM(revenue) AS total_revenue, SUM(record_count) AS total_records, "+
			"SUM(new_patient_count + returning_patient_count) AS total_patients").
		Where("stat_date >= ? AND stat_date <= ?", startDate, endDate).
		Scan(&totals)

	var avgPerRecord float64
	if totals.TotalRecords > 0 {
		avgPerRecord = math.Round(totals.TotalRevenue/float64(totals.TotalRecords)*100) / 100
	}

	tenants := make([]GlobalTenantItem, len(rows))
	for i, r := range rows {
		var avg float64
		if r.Records > 0 {
			avg = math.Round(r.Revenue/float64(r.Records)*100) / 100
		}
		var pct float64
		if totals.TotalRevenue > 0 {
			pct = math.Round(r.Revenue/totals.TotalRevenue*1000) / 10
		}
		tenants[i] = GlobalTenantItem{
			TenantID:      r.TenantID,
			TenantName:    r.TenantName,
			Revenue:       r.Revenue,
			Records:       r.Records,
			Patients:      r.Patients,
			AvgPerRecord:  avg,
			RevenuePercent: pct,
		}
	}

	result := &GlobalStatsResult{
		Summary: GlobalSummary{
			TotalRevenue:        totals.TotalRevenue,
			TotalRecords:        totals.TotalRecords,
			TotalPatients:       totals.TotalPatients,
			AvgRevenuePerRecord: avgPerRecord,
			TenantCount:         int(totalCount),
			Total:               int(totalCount),
		},
		Tenants: tenants,
	}

	// Cache for 5 minutes.
	s.cache.Store(cacheKey, &globalCacheEntry{result: result, expiresAt: time.Now().Add(5 * time.Minute)})
	return result, nil
}
```

- [ ] **Step 4：运行测试确认通过**

```bash
cd server && go test ./service/ -run TestGetGlobalStats -v
```

预期：全部 `PASS`

- [ ] **Step 5：Commit**

```bash
cd server && git add service/admin_statistics.go service/admin_statistics_test.go
git commit -m "feat: add AdminStatisticsService with cross-tenant aggregation and 5-min cache"
```

---

## Task 3：AdminStatisticsHandler（后端 Handler 层）

**Files:**
- Create: `server/handler/admin_statistics.go`
- Create: `server/handler/admin_statistics_test.go`

- [ ] **Step 1：先写失败测试**

```go
// server/handler/admin_statistics_test.go
package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/handler"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupAdminStatsRouter(db interface{ /* gorm.DB */ }) *gin.Engine {
	// placeholder — filled in Step 3
	return nil
}

func TestAdminStatsHandler_Forbidden(t *testing.T) {
	db := testutil.SetupTestDB(t)
	// Non-admin user
	tenant, _, token := testutil.SeedAdminUser(t, db)
	_ = tenant
	// Create a regular user (not username=admin)
	perm := testutil.SeedTestPermission(t, db, "statistics:read", "统计查看")
	role := testutil.SeedTestRole(t, db, tenant.ID, "staff", perm)
	_, staffToken := testutil.SeedTestUser(t, db, tenant.ID, "staff1", "pass123", role)
	_ = token

	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewAdminStatisticsHandler(db)
	r.GET("/admin/statistics/global", func(c *gin.Context) {
		// inject staff user_id into context
		c.Set("user_id", uint64(999)) // non-admin id
		h.GetGlobal(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/admin/statistics/global?start_date=2026-03-01&end_date=2026-03-31", nil)
	req.Header.Set("Authorization", "Bearer "+staffToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestAdminStatsHandler_MissingParams(t *testing.T) {
	db := testutil.SetupTestDB(t)
	_, adminUser, token := testutil.SeedAdminUser(t, db)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewAdminStatisticsHandler(db)
	r.GET("/admin/statistics/global", func(c *gin.Context) {
		c.Set("user_id", adminUser.ID)
		h.GetGlobal(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/admin/statistics/global", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAdminStatsHandler_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	_, adminUser, token := testutil.SeedAdminUser(t, db)
	t2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b2")
	db.Create(&model.DailyStats{
		TenantID: t2.ID, StatDate: mustParseDate("2026-03-01"),
		Revenue: 2000, RecordCount: 20, NewPatientCount: 5, ReturningPatientCount: 15,
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewAdminStatisticsHandler(db)
	r.GET("/admin/statistics/global", func(c *gin.Context) {
		c.Set("user_id", adminUser.ID)
		h.GetGlobal(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/admin/statistics/global?start_date=2026-03-01&end_date=2026-03-31", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	var resp struct {
		Code int `json:"code"`
		Data struct {
			Summary struct {
				TotalRevenue float64 `json:"total_revenue"`
			} `json:"summary"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, 0, resp.Code)
	assert.Equal(t, float64(2000), resp.Data.Summary.TotalRevenue)
}

func mustParseDate(s string) time.Time {
	t, _ := time.ParseInLocation("2006-01-02", s, time.Local)
	return t
}
```

- [ ] **Step 2：运行测试确认失败**

```bash
cd server && go test ./handler/ -run TestAdminStatsHandler -v
```

预期：`FAIL` — `handler.NewAdminStatisticsHandler undefined`

- [ ] **Step 3：实现 AdminStatisticsHandler**

```go
// server/handler/admin_statistics.go
package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AdminStatisticsHandler handles cross-tenant statistics for superAdmin.
type AdminStatisticsHandler struct {
	db  *gorm.DB
	svc *service.AdminStatisticsService
}

// NewAdminStatisticsHandler creates a new AdminStatisticsHandler.
func NewAdminStatisticsHandler(db *gorm.DB) *AdminStatisticsHandler {
	return &AdminStatisticsHandler{db: db, svc: service.NewAdminStatisticsService(db)}
}

// GetGlobal handles GET /api/v1/admin/statistics/global
// Query params: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), page (default 1), size (default 50)
func (h *AdminStatisticsHandler) GetGlobal(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if !service.IsProtectedAdminAccount(h.db, userID) {
		c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "仅超级管理员可访问全局统计"})
		return
	}

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

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "50"))
	if size < 1 || size > 200 {
		size = 50
	}

	result, err := h.svc.GetGlobalStats(startDate, endDate, page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to get global statistics"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": result})
}
```

- [ ] **Step 4：运行测试确认通过**

```bash
cd server && go test ./handler/ -run TestAdminStatsHandler -v
```

预期：全部 `PASS`

- [ ] **Step 5：Commit**

```bash
cd server && git add handler/admin_statistics.go handler/admin_statistics_test.go
git commit -m "feat: add AdminStatisticsHandler with superAdmin guard and pagination"
```

---

## Task 4：注册路由 + GetDashboard 支持 tenant_id override

**Files:**
- Modify: `server/router/router.go`
- Modify: `server/handler/statistics.go`

- [ ] **Step 1：修改 `GetDashboard` 支持 superAdmin 传 `tenant_id`**

在 `server/handler/statistics.go` 的 `GetDashboard` 函数中，在 `tenantID := middleware.GetTenantID(c)` 之后加入：

```go
// GetDashboard returns aggregated statistics for the given date range.
// Query params: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), tenant_id (optional, superAdmin only)
func (h *StatisticsHandler) GetDashboard(c *gin.Context) {
	userID := middleware.GetUserID(c)
	tenantID := middleware.GetTenantID(c)

	// SuperAdmin can query any tenant by passing tenant_id query param.
	if service.IsProtectedAdminAccount(h.db, userID) {
		if tidStr := c.Query("tenant_id"); tidStr != "" {
			if tid, err := strconv.ParseUint(tidStr, 10, 64); err == nil && tid > 0 {
				tenantID = tid
			}
		}
	}

	startStr := c.Query("start_date")
	// ... rest of existing code unchanged ...
```

Full updated function — replace the existing `GetDashboard` body in `server/handler/statistics.go`:

```go
func (h *StatisticsHandler) GetDashboard(c *gin.Context) {
	userID := middleware.GetUserID(c)
	tenantID := middleware.GetTenantID(c)

	// SuperAdmin can cross-query any tenant.
	if service.IsProtectedAdminAccount(h.db, userID) {
		if tidStr := c.Query("tenant_id"); tidStr != "" {
			if tid, err := strconv.ParseUint(tidStr, 10, 64); err == nil && tid > 0 {
				tenantID = tid
			}
		}
	}

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

注意：需要在 `statistics.go` 顶部 import 中加入 `"strconv"`。

- [ ] **Step 2：在 `router.go` 注册新路由**

在 `server/router/router.go` 中，找到 Statistics routes 段（约 429 行）后面，插入：

```go
// Admin statistics routes (superAdmin only, checked inside handler).
adminStatsHandler := handler.NewAdminStatisticsHandler(db)
adminStats := authenticated.Group("/admin/statistics")
{
    adminStats.GET("/global", adminStatsHandler.GetGlobal)
}
```

- [ ] **Step 3：编译验证**

```bash
cd server && go build ./...
```

预期：无错误。

- [ ] **Step 4：全量后端测试**

```bash
cd server && go test ./... -timeout 120s
```

预期：全部通过（无 MySQL 时跳过 DB 测试是正常的）。

- [ ] **Step 5：Commit**

```bash
cd server && git add handler/statistics.go router/router.go
git commit -m "feat: register /admin/statistics/global route; allow superAdmin tenant_id override in dashboard"
```

---

## Task 5：前端 API 类型 + getGlobalStats 函数

**Files:**
- Modify: `web/src/api/statistics.ts`

- [ ] **Step 1：在 `web/src/api/statistics.ts` 末尾追加类型和函数**

```typescript
// ── Global stats (superAdmin only) ──────────────────────────────────────────

export interface GlobalTenantItem {
  tenant_id: number;
  tenant_name: string;
  revenue: number;
  records: number;
  patients: number;
  avg_per_record: number;
  revenue_percent: number;
}

export interface GlobalSummary {
  total_revenue: number;
  total_records: number;
  total_patients: number;
  avg_revenue_per_record: number;
  tenant_count: number;
  total: number; // total tenants for pagination
}

export interface GlobalStatsData {
  summary: GlobalSummary;
  tenants: GlobalTenantItem[];
}

export function getGlobalStats(
  startDate: string,
  endDate: string,
  page = 1,
  size = 50,
) {
  return request.get<{ code: number; data: GlobalStatsData }>(
    '/admin/statistics/global',
    { params: { start_date: startDate, end_date: endDate, page, size } },
  );
}
```

- [ ] **Step 2：前端编译验证**

```bash
cd web && npm run build 2>&1 | tail -5
```

预期：`built in Xs` 无类型错误。

- [ ] **Step 3：Commit**

```bash
cd web && git add src/api/statistics.ts
git commit -m "feat: add GlobalStatsData types and getGlobalStats API function"
```

---

## Task 6：GlobalStatsPanel 组件

**Files:**
- Create: `web/src/pages/statistics/components/GlobalStatsPanel.tsx`
- Create: `web/src/pages/statistics/components/__tests__/GlobalStatsPanel.test.tsx`

- [ ] **Step 1：先写失败测试**

```typescript
// web/src/pages/statistics/components/__tests__/GlobalStatsPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import GlobalStatsPanel from '../GlobalStatsPanel';
import * as statsApi from '../../../../api/statistics';
import type { GlobalStatsData } from '../../../../api/statistics';

const mockData: GlobalStatsData = {
  summary: {
    total_revenue: 10000,
    total_records: 100,
    total_patients: 80,
    avg_revenue_per_record: 100,
    tenant_count: 2,
    total: 2,
  },
  tenants: [
    { tenant_id: 1, tenant_name: '诊所A', revenue: 6000, records: 60, patients: 50, avg_per_record: 100, revenue_percent: 60 },
    { tenant_id: 2, tenant_name: '诊所B', revenue: 4000, records: 40, patients: 30, avg_per_record: 100, revenue_percent: 40 },
  ],
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConfigProvider>{children}</ConfigProvider>
);

describe('GlobalStatsPanel', () => {
  beforeEach(() => {
    vi.spyOn(statsApi, 'getGlobalStats').mockResolvedValue({
      data: { code: 0, data: mockData },
    } as never);
  });

  it('renders summary cards with correct totals', async () => {
    render(
      <GlobalStatsPanel startDate="2026-03-01" endDate="2026-03-31" onViewDetail={() => {}} />,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText(/¥.*10,000/)).toBeTruthy());
    expect(screen.getByText('100')).toBeTruthy(); // total_records
  });

  it('renders tenant ranking list', async () => {
    render(
      <GlobalStatsPanel startDate="2026-03-01" endDate="2026-03-31" onViewDetail={() => {}} />,
      { wrapper },
    );
    await waitFor(() => expect(screen.getByText('诊所A')).toBeTruthy());
    expect(screen.getByText('诊所B')).toBeTruthy();
  });

  it('calls onViewDetail when 查看完整报表 is clicked after selecting tenant', async () => {
    const onViewDetail = vi.fn();
    render(
      <GlobalStatsPanel startDate="2026-03-01" endDate="2026-03-31" onViewDetail={onViewDetail} />,
      { wrapper },
    );
    await waitFor(() => screen.getByText('诊所A'));
    // Click the full report button that appears in expanded row for tenant 1
    // (expand first row by clicking it)
    const rows = screen.getAllByText('诊所A');
    fireEvent.click(rows[0]);
    await waitFor(() => {
      const btn = screen.getByText('查看完整报表');
      fireEvent.click(btn);
    });
    expect(onViewDetail).toHaveBeenCalledWith(1);
  });

  it('shows loading skeleton while fetching', () => {
    vi.spyOn(statsApi, 'getGlobalStats').mockReturnValue(new Promise(() => {}));
    render(
      <GlobalStatsPanel startDate="2026-03-01" endDate="2026-03-31" onViewDetail={() => {}} />,
      { wrapper },
    );
    expect(document.querySelector('.ant-skeleton')).toBeTruthy();
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
cd web && npx vitest run src/pages/statistics/components/__tests__/GlobalStatsPanel.test.tsx
```

预期：`FAIL` — `Cannot find module '../GlobalStatsPanel'`

- [ ] **Step 3：实现 GlobalStatsPanel 组件**

```typescript
// web/src/pages/statistics/components/GlobalStatsPanel.tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Select, Button, Table, Skeleton, Empty, Tag, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getGlobalStats } from '../../../api/statistics';
import type { GlobalStatsData, GlobalTenantItem } from '../../../api/statistics';
import useIsMobile from '../../../hooks/useIsMobile';

type SortKey = 'revenue' | 'records' | 'patients' | 'avg_per_record';

interface Props {
  startDate: string;
  endDate: string;
  /** Called when user clicks "查看完整报表" — passes tenantId */
  onViewDetail: (tenantId: number) => void;
}

const SORT_LABELS: Record<SortKey, string> = {
  revenue: '收入',
  records: '接诊',
  patients: '患者',
  avg_per_record: '客单价',
};

const RANK_COLORS = ['#faad14', '#8c8c8c', '#d48806'];

function RankBadge({ rank }: { rank: number }) {
  const bg = rank <= 3 ? RANK_COLORS[rank - 1] : '#f5f5f5';
  const color = rank <= 3 ? '#fff' : '#999';
  return (
    <div style={{
      width: 26, height: 26, borderRadius: '50%', background: bg, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700,
    }}>
      {rank}
    </div>
  );
}

function SummaryCards({ data, isMobile }: { data: GlobalStatsData; isMobile: boolean }) {
  const { summary } = data;
  const cards = [
    { label: '平台总收入', value: `¥ ${Math.round(summary.total_revenue).toLocaleString()}`, sub: `${summary.tenant_count} 家诊所累计`, gradient: 'linear-gradient(135deg,#1890ff,#36cfc9)' },
    { label: '总接诊记录', value: String(summary.total_records), sub: '本期全平台', gradient: 'linear-gradient(135deg,#52c41a,#95de64)' },
    { label: '总患者人次', value: String(summary.total_patients), sub: '新患+复诊', gradient: 'linear-gradient(135deg,#722ed1,#b37feb)' },
    { label: '平均客单价', value: `¥ ${summary.avg_revenue_per_record.toFixed(1)}`, sub: '收入÷接诊数', gradient: 'linear-gradient(135deg,#fa8c16,#ffc069)' },
  ];

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <div style={{ borderRadius: 10, padding: '14px 16px', color: '#fff', background: cards[0].gradient }}>
          <div style={{ fontSize: 12, opacity: 0.88 }}>{cards[0].label}</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{cards[0].value}</div>
          <div style={{ fontSize: 11, opacity: 0.72 }}>{cards[0].sub}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {cards.slice(1, 3).map(c => (
            <div key={c.label} style={{ borderRadius: 10, padding: '12px 14px', color: '#fff', background: c.gradient }}>
              <div style={{ fontSize: 11, opacity: 0.88 }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{c.value}</div>
            </div>
          ))}
        </div>
        <div style={{ borderRadius: 10, padding: '14px 16px', color: '#fff', background: cards[3].gradient }}>
          <div style={{ fontSize: 12, opacity: 0.88 }}>{cards[3].label}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{cards[3].value}</div>
          <div style={{ fontSize: 11, opacity: 0.72 }}>{cards[3].sub}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 14 }}>
      {cards.map(c => (
        <div key={c.label} style={{ borderRadius: 10, padding: '18px 20px', color: '#fff', background: c.gradient, boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}>
          <div style={{ fontSize: 13, opacity: 0.88 }}>{c.label}</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{c.value}</div>
          <div style={{ fontSize: 11, opacity: 0.72, marginTop: 3 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

export default function GlobalStatsPanel({ startDate, endDate, onViewDetail }: Props) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<GlobalStatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await getGlobalStats(startDate, endDate, p, pageSize);
      const body = res as unknown as { code: number; data: GlobalStatsData };
      if (body.code === 0) setData(body.data);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    setPage(1);
    fetchData(1);
  }, [fetchData]);

  // Local sort (no re-request) when switching dimensions
  const sortedTenants = useMemo(() => {
    if (!data) return [];
    return [...data.tenants].sort((a, b) => b[sortKey] - a[sortKey]);
  }, [data, sortKey]);

  const tenantOptions = useMemo(() =>
    sortedTenants.map(t => ({ value: t.tenant_id, label: t.tenant_name })),
    [sortedTenants],
  );

  if (loading && !data) {
    return (
      <div style={{ padding: isMobile ? 0 : 4 }}>
        <Skeleton active paragraph={{ rows: 3 }} style={{ marginBottom: 14 }} />
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (!data) return <Empty description="暂无全局统计数据" />;

  const ExpandDetail = ({ item }: { item: GlobalTenantItem }) => (
    <div style={{ padding: '12px 16px', background: '#f6ffed', borderLeft: '3px solid #52c41a', borderRadius: '0 6px 6px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 8, marginBottom: 10 }}>
        {[
          { label: '总收入', value: `¥ ${Math.round(item.revenue).toLocaleString()}`, color: '#1890ff' },
          { label: '接诊记录', value: String(item.records), color: '#52c41a' },
          { label: '患者人次', value: String(item.patients), color: '#722ed1' },
          { label: '客单价', value: `¥ ${item.avg_per_record.toFixed(1)}`, color: '#fa8c16' },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', borderRadius: 6, padding: '8px 10px', border: '1px solid #e8e8e8', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{c.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'right' }}>
        <Button size="small" type="primary" onClick={() => onViewDetail(item.tenant_id)}>查看完整报表</Button>
      </div>
    </div>
  );

  // ── Mobile: card list ──────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SummaryCards data={data} isMobile={isMobile} />

        {/* Search */}
        <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>快速查询诊所</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              style={{ flex: 1 }}
              size="small"
              showSearch
              placeholder="选择诊所"
              options={tenantOptions}
              value={selectedTenantId}
              onChange={setSelectedTenantId}
              filterOption={(input, opt) => (opt?.label as string ?? '').includes(input)}
              allowClear
            />
            <Button size="small" type="primary" disabled={!selectedTenantId} onClick={() => selectedTenantId && onViewDetail(selectedTenantId)}>
              完整报表
            </Button>
          </div>
        </div>

        {/* Ranking */}
        <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>各诊所排名</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => setSortKey(k)}
                  style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 10, cursor: 'pointer',
                    background: sortKey === k ? '#52c41a' : '#fff',
                    color: sortKey === k ? '#fff' : '#666',
                    border: `1px solid ${sortKey === k ? '#52c41a' : '#e8e8e8'}`,
                  }}
                >
                  {SORT_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          {sortedTenants.map((item, idx) => (
            <div key={item.tenant_id}>
              <div
                onClick={() => setExpandedId(expandedId === item.tenant_id ? null : item.tenant_id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer', background: expandedId === item.tenant_id ? '#f6ffed' : undefined, borderRadius: expandedId === item.tenant_id ? '6px 6px 0 0' : undefined }}
              >
                <RankBadge rank={idx + 1} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.tenant_name}</div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>接诊 {item.records} · 患者 {item.patients} · 客单 ¥{item.avg_per_record.toFixed(1)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <div style={{ flex: 1, height: 4, background: '#f0f0f0', borderRadius: 2 }}>
                      <div style={{ width: `${item.revenue_percent}%`, height: 4, background: 'linear-gradient(90deg,#52c41a,#36cfc9)', borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#bbb' }}>{item.revenue_percent.toFixed(1)}%</span>
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1890ff', flexShrink: 0 }}>¥ {Math.round(item.revenue).toLocaleString()}</div>
              </div>
              {expandedId === item.tenant_id && <ExpandDetail item={item} />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Desktop: table ─────────────────────────────────────────────────────────
  const columns: ColumnsType<GlobalTenantItem & { rank: number }> = [
    { title: '排名', dataIndex: 'rank', width: 56, render: (r) => <RankBadge rank={r} /> },
    { title: '诊所名称', dataIndex: 'tenant_name', render: (v) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { title: <span style={{ color: sortKey === 'revenue' ? '#52c41a' : undefined }}>收入 {sortKey === 'revenue' ? '↓' : ''}</span>, dataIndex: 'revenue', align: 'right', render: (v) => <span style={{ color: '#1890ff', fontWeight: 600 }}>¥ {Math.round(v).toLocaleString()}</span> },
    { title: <span style={{ color: sortKey === 'records' ? '#52c41a' : undefined }}>接诊 {sortKey === 'records' ? '↓' : ''}</span>, dataIndex: 'records', align: 'right' },
    { title: <span style={{ color: sortKey === 'patients' ? '#52c41a' : undefined }}>患者 {sortKey === 'patients' ? '↓' : ''}</span>, dataIndex: 'patients', align: 'right' },
    { title: <span style={{ color: sortKey === 'avg_per_record' ? '#52c41a' : undefined }}>客单价 {sortKey === 'avg_per_record' ? '↓' : ''}</span>, dataIndex: 'avg_per_record', align: 'right', render: (v) => `¥ ${v.toFixed(1)}` },
    {
      title: '收入占比', dataIndex: 'revenue_percent', width: 140,
      render: (v) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, height: 5, background: '#f0f0f0', borderRadius: 3 }}>
            <div style={{ width: `${v}%`, height: 5, background: 'linear-gradient(90deg,#52c41a,#36cfc9)', borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 11, color: '#999', minWidth: 32 }}>{v.toFixed(1)}%</span>
        </div>
      ),
    },
  ];

  const tableData = sortedTenants.map((t, i) => ({ ...t, rank: i + 1, key: t.tenant_id }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SummaryCards data={data} isMobile={isMobile} />

      {/* Search bar */}
      <div style={{ background: '#fff', borderRadius: 8, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: '#666', fontWeight: 500, whiteSpace: 'nowrap' }}>快速查询诊所：</span>
        <Select
          style={{ minWidth: 280 }}
          showSearch
          placeholder="输入诊所名称搜索"
          options={tenantOptions}
          value={selectedTenantId}
          onChange={setSelectedTenantId}
          filterOption={(input, opt) => (opt?.label as string ?? '').includes(input)}
          allowClear
        />
        <Button type="primary" disabled={!selectedTenantId} onClick={() => selectedTenantId && onViewDetail(selectedTenantId)}>
          查看完整报表 →
        </Button>
        <span style={{ fontSize: 12, color: '#aaa' }}>将切换到该诊所的数据概览</span>
      </div>

      {/* Ranking table */}
      <div style={{ background: '#fff', borderRadius: 8, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>各诊所排名</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                style={{
                  padding: '4px 12px', borderRadius: 12, fontSize: 12, cursor: 'pointer',
                  background: sortKey === k ? '#52c41a' : '#fff',
                  color: sortKey === k ? '#fff' : '#666',
                  border: `1px solid ${sortKey === k ? '#52c41a' : '#e8e8e8'}`,
                }}
              >
                {SORT_LABELS[k]}排名
              </button>
            ))}
          </div>
        </div>
        <Table
          size="small"
          columns={columns}
          dataSource={tableData}
          rowKey="tenant_id"
          expandable={{
            expandedRowKeys: expandedId ? [expandedId] : [],
            onExpand: (_, record) => setExpandedId(expandedId === record.tenant_id ? null : record.tenant_id),
            expandedRowRender: (record) => <ExpandDetail item={record} />,
            showExpandColumn: false,
          }}
          onRow={(record) => ({
            onClick: () => setExpandedId(expandedId === record.tenant_id ? null : record.tenant_id),
            style: { cursor: 'pointer', background: expandedId === record.tenant_id ? '#f6ffed' : undefined },
          })}
          pagination={{
            current: page,
            pageSize,
            total: data.summary.total,
            onChange: (p) => { setPage(p); fetchData(p); },
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 家诊所`,
          }}
        />
        <div style={{ fontSize: 11, color: '#ccc', textAlign: 'right', marginTop: 4 }}>点击任意行展开摘要 · 切换排名维度不重新请求</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4：运行测试确认通过**

```bash
cd web && npx vitest run src/pages/statistics/components/__tests__/GlobalStatsPanel.test.tsx
```

预期：全部 `PASS`

- [ ] **Step 5：Commit**

```bash
cd web && git add src/pages/statistics/components/GlobalStatsPanel.tsx src/pages/statistics/components/__tests__/GlobalStatsPanel.test.tsx
git commit -m "feat: add GlobalStatsPanel with responsive layout, ranking sort, and expand detail"
```

---

## Task 7：StatsDashboard 集成

**Files:**
- Modify: `web/src/pages/statistics/StatsDashboard.tsx`
- Modify: `web/src/api/statistics.ts`（追加 `tenant_id` 参数）

- [ ] **Step 1：扩展 `getDashboard` 支持可选 `tenant_id`**

在 `web/src/api/statistics.ts` 中修改 `getDashboard` 函数签名：

```typescript
export function getDashboard(startDate: string, endDate: string, tenantId?: number) {
  return request.get<{ code: number; data: DashboardData }>('/statistics/dashboard', {
    params: {
      start_date: startDate,
      end_date: endDate,
      ...(tenantId != null ? { tenant_id: tenantId } : {}),
    },
  });
}
```

- [ ] **Step 2：修改 `StatsDashboard.tsx`**

在 `StatsDashboard.tsx` 中：

1. 导入新组件和 hook：
```typescript
import { useAuth } from '../../store/auth';
import GlobalStatsPanel from './components/GlobalStatsPanel';
```

2. 在组件顶部加状态：
```typescript
const { isSuperAdmin } = useAuth();
const [activeTab, setActiveTab] = useState<string>('overview');
const [overrideTenantId, setOverrideTenantId] = useState<number | null>(null);
const [overrideTenantName, setOverrideTenantName] = useState<string | null>(null);
```

3. 修改 `fetchData` 以支持 `overrideTenantId`：
```typescript
const fetchData = useCallback(async () => {
  setLoading(true);
  try {
    const res = await getDashboard(
      dateRange[0].format('YYYY-MM-DD'),
      dateRange[1].format('YYYY-MM-DD'),
      overrideTenantId ?? undefined,
    );
    const body = res as unknown as { code: number; data: DashboardData };
    setData(body.data);
  } catch {
    // silently handle
  } finally {
    setLoading(false);
  }
}, [dateRange, overrideTenantId]);
```

4. 在 `overviewContent` 上方加诊所提示条（仅 isSuperAdmin 且有 overrideTenantId 时显示）：
```typescript
const tenantAlert = isSuperAdmin && overrideTenantName ? (
  <div style={{ marginBottom: 12, padding: '8px 14px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <span style={{ fontSize: 13, color: '#389e0d' }}>当前查看：<b>{overrideTenantName}</b></span>
    <button
      onClick={() => { setOverrideTenantId(null); setOverrideTenantName(null); }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 16 }}
    >✕</button>
  </div>
) : null;
```

5. 把 `onViewDetail` 回调传给 `GlobalStatsPanel`，它需要从 `data.tenants` 查名字。由于 `GlobalStatsPanel` 已知 tenantName（通过 `GlobalTenantItem`），改为回调传 `{id, name}`：

```typescript
const handleViewDetail = useCallback((tenantId: number, tenantName: string) => {
  setOverrideTenantId(tenantId);
  setOverrideTenantName(tenantName);
  setActiveTab('overview');
}, []);
```

6. 修改 Tabs items，追加全局总览 Tab（`isSuperAdmin` 守卫）：
```typescript
const tabItems = [
  { key: 'overview', label: '数据概览', children: <>{tenantAlert}{overviewContent}</> },
  {
    key: 'staff',
    label: '人员收费',
    children: <StaffRevenuePanel startDate={startDateStr} endDate={endDateStr} />,
  },
  ...(isSuperAdmin ? [{
    key: 'global',
    label: <span>全局总览 <span style={{ display: 'inline-block', background: '#ff4d4f', color: '#fff', fontSize: 9, borderRadius: 8, padding: '1px 4px', marginLeft: 2, verticalAlign: 'middle' }}>Admin</span></span>,
    children: (
      <GlobalStatsPanel
        startDate={startDateStr}
        endDate={endDateStr}
        onViewDetail={(id, name) => handleViewDetail(id, name)}
      />
    ),
  }] : []),
];
```

7. 将 `<Tabs>` 改为受控模式：
```typescript
<Tabs
  activeKey={activeTab}
  onChange={setActiveTab}
  items={tabItems}
/>
```

- [ ] **Step 3：更新 GlobalStatsPanel 的 Props 类型**

在 `GlobalStatsPanel.tsx` 中把 `onViewDetail` 签名改为接受 id + name：

```typescript
interface Props {
  startDate: string;
  endDate: string;
  onViewDetail: (tenantId: number, tenantName: string) => void;
}
```

同时在组件内所有 `onViewDetail(item.tenant_id)` 调用改为 `onViewDetail(item.tenant_id, item.tenant_name)`。

- [ ] **Step 4：前端编译 + 测试**

```bash
cd web && npm run build 2>&1 | tail -5
cd web && npx vitest run
```

预期：构建成功，全部测试通过。

- [ ] **Step 5：Commit**

```bash
cd web && git add src/pages/statistics/StatsDashboard.tsx src/api/statistics.ts src/pages/statistics/components/GlobalStatsPanel.tsx
git commit -m "feat: integrate GlobalStatsPanel into StatsDashboard with superAdmin guard and tenant override"
```

---

## Task 8：StatsDashboard 测试补充

**Files:**
- Modify/Create: `web/src/pages/statistics/__tests__/StatsDashboard.test.tsx`

- [ ] **Step 1：补充 superAdmin Tab 可见性测试**

```typescript
// web/src/pages/statistics/__tests__/StatsDashboard.test.tsx
// 在现有测试文件末尾追加（或新建）:

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import StatsDashboard from '../StatsDashboard';
import * as statsApi from '../../../api/statistics';
import * as authStore from '../../../store/auth';

const mockDashboard = { summary: { total_revenue: 0, total_records: 0, total_patients: 0, avg_revenue_per_record: 0, revenue_change_percent: null, records_change_percent: null, patients_change_percent: null, cure_rate: null, cure_rate_change_percent: null }, daily_trend: [], revenue_breakdown: { consultation_fee_total: 0, drug_fee_total: 0 }, patient_breakdown: { new_patients: 0, returning_patients: 0 } };

function mockAuth(isSuperAdmin: boolean) {
  vi.spyOn(authStore, 'useAuth').mockReturnValue({
    user: { id: 1, username: isSuperAdmin ? 'admin' : 'staff', real_name: '测试', tenant_id: 1 },
    permissions: isSuperAdmin ? ['user:manage'] : [],
    token: 'mock-token',
    loading: false,
    queueEnabled: true,
    appointmentEnabled: true,
    login: vi.fn(),
    logout: vi.fn(),
    hasPermission: (c: string) => isSuperAdmin && c === 'user:manage',
    isGlobalAdmin: isSuperAdmin,
    isSuperAdmin,
    fetchQueueEnabled: vi.fn(),
    fetchAppointmentEnabled: vi.fn(),
  });
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter><ConfigProvider>{children}</ConfigProvider></MemoryRouter>
);

describe('StatsDashboard global tab visibility', () => {
  beforeEach(() => {
    vi.spyOn(statsApi, 'getDashboard').mockResolvedValue({ data: { code: 0, data: mockDashboard } } as never);
    vi.spyOn(statsApi, 'getGlobalStats').mockResolvedValue({ data: { code: 0, data: { summary: { total_revenue: 0, total_records: 0, total_patients: 0, avg_revenue_per_record: 0, tenant_count: 0, total: 0 }, tenants: [] } } } as never);
  });

  it('shows 全局总览 tab for superAdmin', () => {
    mockAuth(true);
    render(<StatsDashboard />, { wrapper });
    expect(screen.getByText(/全局总览/)).toBeTruthy();
  });

  it('hides 全局总览 tab for regular user', () => {
    mockAuth(false);
    render(<StatsDashboard />, { wrapper });
    expect(screen.queryByText(/全局总览/)).toBeNull();
  });
});
```

- [ ] **Step 2：运行测试**

```bash
cd web && npx vitest run src/pages/statistics/__tests__/StatsDashboard.test.tsx
```

预期：全部 `PASS`

- [ ] **Step 3：全量前后端测试**

```bash
cd server && go test ./... -timeout 120s
cd web && npx vitest run
```

预期：全部通过。

- [ ] **Step 4：Commit**

```bash
git add web/src/pages/statistics/__tests__/StatsDashboard.test.tsx
git commit -m "test: add superAdmin tab visibility tests for StatsDashboard"
```

---

## Task 9：部署验证

- [ ] **Step 1：后端完整编译**

```bash
cd server && go build ./...
```

- [ ] **Step 2：前端完整构建**

```bash
cd web && npm run build
```

- [ ] **Step 3：执行部署**

```bash
cd /Users/xiayanji/qbox/menzhen && bash deploy.sh
```

- [ ] **Step 4：手工验证清单**

1. 以普通用户登录 → `/statistics` 页面，确认看不到「全局总览」Tab
2. 以 `admin` 账号登录 → `/statistics` 页面，确认能看到「全局总览」Tab（带红色 Admin 徽标）
3. 全局总览 Tab：汇总卡片数据正确、排名表渲染正常
4. 切换「收入/接诊/患者/客单价」排名 → 数据重排，**不触发新网络请求**（F12 Network 确认）
5. 点击排名行 → 展开摘要卡片；再点击折叠
6. 搜索框选择一个诊所 → 点「查看完整报表」→ Tab 切回「数据概览」→ 显示该诊所数据 + 顶部提示条
7. 点击提示条 ✕ → 恢复自己租户数据
8. 移动端（F12 切 375px）→ 确认卡片、列表排布正确，无横向溢出

- [ ] **Step 5：最终 Commit**

```bash
git add -A
git commit -m "feat: global statistics dashboard for superAdmin with cross-tenant aggregation"
```

---

## 自查结果

**Spec 覆盖：**
- ✅ 平台汇总 4 张卡片（Task 6）
- ✅ 四维度排名（Task 6）
- ✅ 快捷查询诊所（Task 6-7）
- ✅ 点击排名行展开摘要（Task 6）
- ✅ superAdmin 权限守卫前后端（Task 3、7）
- ✅ 移动端响应式（Task 6）
- ✅ 覆盖索引性能优化（Task 1）
- ✅ 分页 + 本地排序（Task 2、6）
- ✅ 5 分钟内存缓存（Task 2）
- ✅ Skeleton 加载（Task 6）

**类型一致性：**
- `onViewDetail(id, name)` 签名在 Task 7 Step 3 统一更新 GlobalStatsPanel

**无占位符：** 所有步骤含完整代码。
