# 全局统计功能设计文档

**日期：** 2026-04-03  
**作者：** Claude  
**状态：** 已确认

---

## 背景与目标

在现有统计分析页（`/statistics`）的基础上，为 superAdmin（`username=admin` 且具备 `user:manage` 权限）增加一个「全局总览」Tab，提供：

1. 全平台所有诊所的累计汇总数据（收入、接诊、患者、客单价）
2. 各诊所在四个维度的排名（可切换）
3. 点击排名行展开该诊所摘要卡片
4. 顶部搜索框快速跳转至某诊所的完整统计视图

---

## 范围边界

- **仅 superAdmin 可见**：Tab 和后端接口均做权限守卫，非 superAdmin 无法访问
- **共用时间选择器**：全局总览与现有「数据概览」「人员收费」Tab 共用同一个时间筛选器
- **不新增路由**：复用 `/statistics` 路由，通过 Tab 切换展示，不需要独立页面

---

## 后端设计

### 新接口：GET /api/v1/admin/statistics/global

**权限：** Handler 层调用 `service.IsProtectedAdminAccount`，非 superAdmin 返回 403，不走 RBAC 中间件（避免为其单独维护权限码）。

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| start_date | string | 是 | YYYY-MM-DD |
| end_date | string | 是 | YYYY-MM-DD |

**响应结构：**

```json
{
  "code": 0,
  "data": {
    "summary": {
      "total_revenue": 386240.00,
      "total_records": 4821,
      "total_patients": 3106,
      "avg_revenue_per_record": 80.1,
      "tenant_count": 12
    },
    "tenants": [
      {
        "tenant_id": 1,
        "tenant_name": "仁心中医诊所",
        "revenue": 68420.00,
        "records": 891,
        "patients": 0,
        "avg_per_record": 76.8,
        "revenue_percent": 17.7
      }
    ]
  }
}
```

**注：** `patients` 字段（新患+复诊合计）来自 `daily_stats.new_patient_count + returning_patient_count`。

**查询逻辑：**

```sql
SELECT
  ds.tenant_id,
  t.name AS tenant_name,
  SUM(ds.revenue) AS revenue,
  SUM(ds.record_count) AS records,
  SUM(ds.new_patient_count + ds.returning_patient_count) AS patients,
  ROUND(SUM(ds.revenue) / NULLIF(SUM(ds.record_count), 0), 2) AS avg_per_record
FROM daily_stats ds
JOIN tenants t ON t.id = ds.tenant_id
WHERE ds.stat_date >= :start_date AND ds.stat_date <= :end_date
GROUP BY ds.tenant_id, t.name
ORDER BY revenue DESC
```

一条 SQL，O(tenants × days)，`daily_stats` 已预聚合，不扫 billings 大表。

**新文件：**
- `server/handler/admin_statistics.go` — AdminStatisticsHandler
- `server/service/admin_statistics.go` — AdminStatisticsService + GlobalStatsResult 结构体

**路由注册（router.go）：**

```go
adminStats := authenticated.Group("/admin/statistics")
{
    adminStats.GET("/global", adminStatsHandler.GetGlobal)
}
```

### 修改接口：GET /api/v1/statistics/dashboard

新增可选 query param `tenant_id`。superAdmin 传入时使用该值，否则沿用 JWT 中的 tenant_id（现有行为不变）。

Handler 中判断：
```go
targetTenantID := middleware.GetTenantID(c)
if service.IsProtectedAdminAccount(db, userID) {
    if tid := c.Query("tenant_id"); tid != "" {
        // 解析并使用
    }
}
```

---

## 前端设计

### 新增文件

| 文件 | 说明 |
|------|------|
| `web/src/pages/statistics/components/GlobalStatsPanel.tsx` | 全局总览 Tab 的主体组件 |
| `web/src/api/statistics.ts`（追加） | 新增 `getGlobalStats()` 函数和类型定义 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `web/src/pages/statistics/StatsDashboard.tsx` | 当 `isSuperAdmin` 时，在 Tabs items 末尾追加「全局总览」Tab |

### GlobalStatsPanel 组件结构

```
GlobalStatsPanel
├── 平台汇总卡片行（响应式）
│   ├── 桌面：4 列 grid
│   └── 移动：大卡 + 2列小卡 + 大卡
├── 诊所搜索框
│   ├── Select 组件（options 来自 tenants 列表，支持模糊搜索）
│   └── 「查看完整报表」按钮 → 调用 getDashboard(startDate, endDate, tenantId)
├── 排名区域
│   ├── 4 个排序维度切换按钮（revenue / records / patients / avg_per_record）
│   ├── 桌面（isMobile=false）：Table 组件
│   │   └── 点击行展开内联摘要（expandedRowRender）
│   └── 移动（isMobile=true）：卡片列表
│       └── 点击卡片展开折叠摘要块
└── 展开摘要（包含 4 项 mini 卡片 + 「查看完整报表」按钮）
```

### 响应式断点

| 场景 | 布局 |
|------|------|
| `isMobile = false`（≥768px） | 4 列汇总卡片，Ant Design Table 带展开行 |
| `isMobile = true`（<768px） | 大卡+2列小卡+大卡，卡片列表（无水平滚动） |

使用现有 `useIsMobile()` hook，与其他统计组件保持一致。

### 「查看完整报表」交互

选中诊所后点击按钮：
1. 将父组件 `StatsDashboard` 的激活 Tab 切回「数据概览」
2. 通过 props 回调或状态提升，传入 `overrideTenantId`
3. `getDashboard` 调用时附带 `tenant_id` query param
4. 页面标题区显示「当前查看：仁心中医诊所」提示条，可点击 ✕ 清除

---

## 数据流

```
GlobalStatsPanel
  → useEffect([startDate, endDate])
  → getGlobalStats(startDate, endDate)          // GET /admin/statistics/global
  → 渲染汇总卡片 + 排名列表

点击排名行/卡片
  → 本地 state expandedId = tenantId
  → 展开摘要（数据已在 tenants[] 中，无需二次请求）

选中诊所 + 点击「查看完整报表」
  → onViewDetail(tenantId) 回调给 StatsDashboard
  → StatsDashboard 切换 activeTab = 'overview'
  → 传 overrideTenantId 给数据概览
  → getDashboard(start, end, tenantId)          // GET /statistics/dashboard?tenant_id=xxx
```

---

## 权限守卫

| 层 | 守卫方式 |
|----|---------|
| 前端 Tab | `isSuperAdmin` 为 false 时不渲染此 Tab |
| 后端 `/admin/statistics/global` | Handler 首行 `IsProtectedAdminAccount`，否则返回 403 |
| 后端 `/statistics/dashboard?tenant_id` | 非 superAdmin 时忽略 `tenant_id` 参数，使用 JWT tenant_id |

---

## 测试覆盖要求

### 后端（Go test）

- `AdminStatisticsService.GetGlobal`：正常多租户聚合、空结果、单租户
- `AdminStatisticsHandler.GetGlobal`：非 superAdmin 返回 403、参数缺失 400、成功 200
- `StatisticsHandler.GetDashboard`：superAdmin 传 tenant_id 成功、非 superAdmin 传 tenant_id 被忽略

### 前端（Vitest）

- `GlobalStatsPanel`：正常渲染、loading 状态、展开/折叠行为
- `StatsDashboard`：superAdmin 时显示全局总览 Tab、非 superAdmin 不显示

---

## 性能策略（数据量大时）

### 背景分析

`daily_stats` 的规模 = `租户数 × 运营天数`。  
100 家诊所 × 3 年 = **109,500 行**，1000 家诊所 × 3 年 = **1,095,000 行（约 110 万行）**。  
全局查询需要对 `stat_date` 做范围扫描，但现有索引 `idx_tenant_date(tenant_id, stat_date)` 前缀是 `tenant_id`，跨租户全表扫时无法利用该索引。

### 措施一：新增覆盖索引（必做）

在 `DailyStats` 模型上补充一个以 `stat_date` 为前缀的复合索引：

```go
// model/daily_stats.go
StatDate time.Time `gorm:"uniqueIndex:idx_tenant_date;type:date;not null;index:idx_date_tenant" json:"stat_date"`
```

新索引 `idx_date_tenant(stat_date, tenant_id)` 让全局范围查询直接走索引范围扫描，避免全表扫描。同时把聚合用到的列加入索引使其成为覆盖索引：

```sql
-- 迁移时 AutoMigrate 自动创建，或手动补：
ALTER TABLE daily_stats ADD INDEX idx_date_covering (stat_date, tenant_id, revenue, record_count, new_patient_count, returning_patient_count);
```

### 措施二：后端分页返回租户列表

排名接口默认返回前 **50 条**，支持 `page` / `size` 参数。  
绝大多数 superAdmin 场景诊所数 < 200，分页后每次查询行数有上界。

```
GET /admin/statistics/global?start_date=&end_date=&page=1&size=50
```

响应增加 `total` 字段，前端 Table 使用 Ant Design 的服务端分页模式。

### 措施三：前端排序在本地完成（无需重新请求）

四个维度（收入/接诊/患者/客单价）的切换排序**纯前端完成**，对已加载的 `tenants[]` 做 `sort()`，不重发请求。只有翻页时才发新请求。

### 措施四：接口级缓存（可选，诊所数 > 500 时开启）

在 `AdminStatisticsService.GetGlobal` 中，对相同的 `(start_date, end_date)` 组合结果做内存缓存，TTL = **5 分钟**。  
缓存 key = `global_stats:{start}:{end}`，使用 `sync.Map` 存储，无需引入 Redis。  
实现时加注释说明缓存存在，避免调试困惑。

### 措施五：前端 Skeleton + 加载状态

数据未到达前显示 Skeleton 占位（4 张卡片骨架 + 表格骨架），避免空白闪烁，提升感知性能。

### 数据量与响应时间估算

| 诊所数 | 查询 180 天 | 有索引后预期耗时 |
|--------|------------|----------------|
| 50 家 | 9,000 行 | < 10ms |
| 200 家 | 36,000 行 | < 30ms |
| 1,000 家 | 180,000 行 | < 100ms（加索引后范围扫描） |
| 5,000 家 | 900,000 行 | < 300ms，可开内存缓存 |

---

## 不在范围内

- 趋势折线图（全局维度）：留作后续迭代
- 导出 Excel：留作后续迭代
- 诊所间数据对比图表：留作后续迭代
