# 统计仪表盘设计方案

> 日期：2026-03-15
> 状态：已确认

## 概述

在运营菜单下新增"统计概览"入口，提供可选时间范围的综合仪表盘，展示财务报表（实收帐款）、诊疗记录数量、患者数量等统计数据，支持可视化图表，适配桌面端与移动端。

## 需求要点

- **页面形态**：综合仪表盘（单页展示全部统计）
- **图表库**：ECharts
- **时间范围**：快捷按钮（今日/本周/本月/本季/本年）+ 自定义日期区间
- **数据粒度**：按日聚合
- **权限**：`tenant:manage`（系统管理员或诊所管理角色）
- **性能**：采用 `daily_stats` 每日汇总表，查询恒定快速（O(天数)），支撑 500 万条原始数据

## 权限与菜单

### 菜单位置

运营 → 统计概览（第三个子项）

```
运营 (ShopOutlined)
├── 库存药物 (/inventory/drugs)
├── 库存预警 (/inventory/alerts)
└── 统计概览 (/statistics)        ← 新增
```

### 权限控制

- 复用 `tenant:manage` 权限码，不新增权限
- 前端菜单：`hasPerm('tenant:manage')` 时显示
- 后端路由：`RequirePermission("tenant:manage")` 中间件

## 后端设计

### 数据模型 — DailyStats

```go
// server/model/daily_stats.go
type DailyStats struct {
    BaseModel
    TenantID              uint64    `gorm:"uniqueIndex:idx_tenant_date;not null"`
    StatDate              time.Time `gorm:"uniqueIndex:idx_tenant_date;type:date;not null"`
    Revenue               float64   `gorm:"type:decimal(12,2);default:0"`       // 实收总额（actual_paid 合计）
    ConsultationFee       float64   `gorm:"type:decimal(12,2);default:0"`       // 诊金合计
    DrugFee               float64   `gorm:"type:decimal(12,2);default:0"`       // 药费合计（实收 - 诊金，可能为负表示折扣）
    RecordCount           int       `gorm:"default:0"`                          // 诊疗记录数
    NewPatientCount       int       `gorm:"default:0"`                          // 新增患者数（当天首次就诊）
    ReturningPatientCount int       `gorm:"default:0"`                          // 复诊患者数
}
```

**索引**：`UNIQUE(tenant_id, stat_date)` 复合索引

**注意**：新增模型需在 `database/database.go` 的 `AutoMigrate` 列表中添加 `&model.DailyStats{}`

### 汇总表更新机制

**聚合日期基准**：以 `medical_records.visit_date`（就诊日期）为准，不用 `billing.created_at`。因为收费可能延后，但收入应归属就诊当天。

**写时聚合**：每次 billing 创建/更新/删除时，调用 `RefreshDailyStats(tenantID, date)` 重新聚合当天数据。

```go
// service/statistics.go
func RefreshDailyStats(tenantID uint64, date time.Time) error {
    // 1. 查 visit_date = date 的 medical_records，关联 billings
    //    SUM(actual_paid), SUM(consultation_fee)
    //    drug_fee = actual_paid - consultation_fee（派生值，可能为负表示折扣）
    // 2. COUNT medical_records 得 record_count
    // 3. 新患者判定：当天就诊的 patient 中，该 patient 在整个系统中
    //    最早的 visit_date == 当天 → 新患者；否则 → 复诊
    //    SQL: LEFT JOIN (SELECT patient_id, MIN(visit_date) as first_visit FROM medical_records GROUP BY patient_id)
    // 4. UPSERT daily_stats 记录
}
```

**调用时机**：
- `CreateBilling` service 方法完成后
- `DeductStockAndBill` service 方法完成后
- billing 软删除后（如有此场景）

**时区约定**：服务器时区与诊所运营时区一致（Docker 部署时通过 TZ 环境变量设置），`visit_date` 为 DATE 类型无时区问题。

**重建命令**：提供 `RebuildAllDailyStats(tenantID)` 用于数据修复/初始化。

### API 接口

```
GET /api/v1/statistics/dashboard?start_date=2026-03-01&end_date=2026-03-15
```

**中间件**：`AuthMiddleware` + `RequirePermission("tenant:manage")`

**返回数据**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "summary": {
      "total_revenue": 48600.00,
      "total_records": 156,
      "total_patients": 89,
      "avg_revenue_per_record": 311.54,
      "revenue_change_percent": 12.5,
      "records_change_percent": 8.3,
      "patients_change_percent": 5.2
    },
    "daily_trend": [
      {
        "date": "2026-03-01",
        "revenue": 1680.00,
        "consultation_fee": 500.00,
        "drug_fee": 1180.00,
        "record_count": 6,
        "new_patient_count": 2,
        "returning_patient_count": 4
      }
    ],
    "revenue_breakdown": {
      "consultation_fee_total": 15600.00,
      "drug_fee_total": 33000.00
    },
    "patient_breakdown": {
      "new_patients": 34,
      "returning_patients": 55
    }
  }
}
```

**环比计算**：取同等长度的上一时段对比。如选 3/1-3/15（15天），则对比 2/14-2/28。
- `total_patients` = `SUM(new_patient_count + returning_patient_count)`（即患者就诊人次，非去重）
- `avg_revenue_per_record`：当 `total_records == 0` 时返回 `0`
- `*_change_percent`：当上一时段基数为 0 时返回 `null`（前端显示"--"）

### 后端文件

```
server/
├── model/daily_stats.go         # DailyStats 模型
├── database/database.go         # AutoMigrate 添加 &model.DailyStats{}
├── service/statistics.go        # 聚合查询 + RefreshDailyStats + RebuildAllDailyStats
├── service/billing.go           # CreateBilling/DeductStockAndBill 末尾调用 RefreshDailyStats
├── handler/statistics.go        # GetDashboard handler
└── router/router.go             # 新增 statistics 路由组
```

## 前端设计

### 桌面端布局（方案 B — 渐变卡片 + 双轴图）

```
┌──────────────────────────────────────────────────────┐
│ [今日] [本周] [本月] [本季] [本年]  [自定义日期区间]      │
├────────────────┬────────────────┬────────────────────┤
│ 渐变蓝          │ 渐变绿          │ 渐变紫              │
│ 总收入 ¥48,600  │ 诊疗记录 156    │ 患者数 89           │
│ ↑ 12.5%        │ ↑ 8.3%         │ ↑ 5.2%             │
├────────────────┴────────────────┴────────────────────┤
│             收入趋势 + 诊疗量（双轴图）                  │
│  柱状 = 每日诊疗量    折线 = 每日收入                    │
├──────────────────────┬───────────────────────────────┤
│ 诊金 vs 药费          │ 新增 vs 复诊患者               │
│（堆叠柱状图）          │（柱状图）                      │
└──────────────────────┴───────────────────────────────┘
```

### 移动端布局（方案 A — 纵向堆叠）

移动端保留全部时间快捷按钮，使用横向滚动容纳。

```
┌──────────────────────┐
│ [今日][本周][本月][本季][本年][自定义]│
├──────────────────────┤
│ 渐变蓝 · 总收入        │
│ ¥48,600   ↑ 12.5%    │
├──────────┬───────────┤
│ 诊疗 156  │ 患者 89    │
│ ↑ 8.3%   │ ↑ 5.2%    │
├──────────┴───────────┤
│ 收入趋势 + 诊疗量      │
│ （双轴图，全宽）        │
├──────────────────────┤
│ 诊金 vs 药费           │
│ （堆叠柱状图，全宽）    │
├──────────────────────┤
│ 新增 vs 复诊患者       │
│ （柱状图，全宽）        │
└──────────────────────┘
```

### 前端文件结构

```
web/src/
├── pages/statistics/
│   ├── StatsDashboard.tsx              # 主页面
│   └── components/
│       ├── SummaryCards.tsx             # 3个渐变汇总卡片（含环比箭头）
│       ├── RevenueTrendChart.tsx        # 双轴图（ECharts）
│       ├── RevenueBreakdownChart.tsx    # 诊金 vs 药费堆叠柱状图
│       └── PatientChart.tsx            # 新增 vs 复诊患者柱状图
├── services/statistics.ts              # API 调用
└── components/Layout.tsx               # 菜单新增统计入口
```

### 图表配置

| 图表 | ECharts 类型 | 数据源 |
|------|-------------|--------|
| 收入+诊疗趋势 | 双轴：bar (record_count) + line (revenue) | `daily_trend[]` |
| 收入构成 | 堆叠 bar：consultation_fee + drug_fee | `daily_trend[]` |
| 患者统计 | 分组 bar：new_patient_count + returning_patient_count | `daily_trend[]` |

### 时间选择器

- `Radio.Group`：今日 / 本周 / 本月 / 本季 / 本年
- `DatePicker.RangePicker`：自定义区间
- 默认选中"本月"
- 切换时重新请求 API

### 响应式

- 使用现有 `useIsMobile()` hook
- 桌面端：CSS Grid 双列布局
- 移动端：单列纵向堆叠，收入卡片满宽突出

## 依赖

- 前端新增：`echarts` + `echarts-for-react`（ECharts React 封装）
- 后端：无新增依赖

## 测试计划

### 后端

- `service/statistics_test.go`：RefreshDailyStats 正确聚合、环比计算、租户隔离、空数据处理
- `handler/statistics_test.go`：API 参数校验、权限检查、返回格式

### 前端

- `StatsDashboard.test.tsx`：页面渲染、时间切换、API 调用、移动端适配
- `SummaryCards.test.tsx`：数据展示、环比箭头方向

## 数据流

```
billing 创建/更新
  → service.RefreshDailyStats(tenantID, date)
    → UPSERT daily_stats

用户打开统计页
  → GET /api/v1/statistics/dashboard?start_date&end_date
    → SELECT FROM daily_stats WHERE tenant_id AND stat_date BETWEEN
    → 计算环比（查上一时段的 daily_stats）
    → 返回 summary + daily_trend + breakdowns
```
