# 库存管理功能设计

> 日期: 2026-03-13
> 状态: 已确认

## 概述

为诊所系统新增库存管理模块，支持药物库存的增删改查、分页展示，以及前端定时扫描的库存预警功能。

## 核心需求

1. 左侧菜单新增「库存」分组，包含「药物」和「库存预警」两个子页面
2. 药物 CRUD：名称、种类（本草/成药）、库存量、进货价、出售价、备注
3. 库存预警：前端定时扫描，低于阈值红色高亮，可屏蔽告警，告警消除后高亮自动消除
4. 租户隔离：每个诊所独立管理库存
5. 权限控制：新增 `inventory:read/create/update/delete` 权限码

## 数据模型

### inventory_drugs 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT UNSIGNED PK | 主键 |
| tenant_id | BIGINT UNSIGNED NOT NULL | 租户隔离 |
| name | VARCHAR(100) NOT NULL | 药物名称 |
| category | ENUM('herb','patent') NOT NULL | 本草/成药 |
| stock | DECIMAL(10,2) DEFAULT 0 | 库存量（本草:克, 成药:盒） |
| purchase_price | DECIMAL(10,2) DEFAULT 0 | 进货单价（本草:元/500克, 成药:元/盒） |
| selling_price | DECIMAL(10,2) DEFAULT 0 | 出售价（本草:元/500克, 成药:元/盒） |
| alert_threshold | DECIMAL(10,2) NULL | 预警阈值（NULL=用全局默认） |
| remark | TEXT | 备注 |
| created_at | DATETIME(3) | 创建时间 |
| updated_at | DATETIME(3) | 更新时间 |
| deleted_at | DATETIME(3) | 软删除 |

索引: `idx_tenant(tenant_id)`, `idx_category(category)`, `idx_deleted_at(deleted_at)`

## 后端 API

```
GET    /api/v1/inventory/drugs          分页列表（name/category/page/size）
POST   /api/v1/inventory/drugs          新增药物
PUT    /api/v1/inventory/drugs/:id      编辑药物
DELETE /api/v1/inventory/drugs/:id      删除药物
```

权限码: `inventory:read`, `inventory:create`, `inventory:update`, `inventory:delete`

响应格式与现有一致:
```json
{
  "code": 0,
  "data": { "list": [...], "total": 50, "page": 1, "size": 20 }
}
```

### 后端文件

| 文件 | 职责 |
|------|------|
| `server/model/inventory_drug.go` | GORM 模型定义 |
| `server/service/inventory_drug.go` | 业务逻辑（CRUD + 分页） |
| `server/handler/inventory_drug.go` | HTTP handlers |
| `server/router/router.go` | 路由注册 + 权限中间件 |
| `server/database/database.go` | AutoMigrate 新增模型 |
| `server/database/seed.go` | Seed 4 个权限码 |

## 前端页面

### 菜单结构

```
📦 库存 (ShopOutlined)
  ├── 药物       → /inventory/drugs     (inventory:read)
  └── 库存预警   → /inventory/alerts    (inventory:read)
```

菜单项有未屏蔽告警时显示红色 Badge。

### 新增文件

| 文件 | 职责 |
|------|------|
| `web/src/pages/inventory/DrugList.tsx` | 药物库存 CRUD 页面 |
| `web/src/pages/inventory/InventoryAlert.tsx` | 库存预警页面 |
| `web/src/api/inventory.ts` | API 调用封装 |

### DrugList.tsx — 药物库存页面

- **搜索栏**: 名称搜索 + 分类筛选（全部/本草/成药）
- **表格列**: 名称、种类、库存量（含单位）、进货价（含单位）、出售价（含单位）、预警阈值、备注、操作
- **红色高亮**: 库存量 < 阈值的行红色背景，库存回升后自动消除
- **新增/编辑 Modal**: 表单根据分类动态切换单位标签（克/盒、元/500克/元/盒）
- **分页**: 默认 20 条/页

### InventoryAlert.tsx — 库存预警页面

- **数据源**: 调用 `GET /api/v1/inventory/drugs?size=9999` 获取全量，前端筛选低于阈值的
- **展示**: 药物名、分类、当前库存、阈值、缺口量
- **定时扫描**: 可配频率（默认 30 分钟），存 localStorage
- **屏蔽功能**: 每条告警可屏蔽（1h/6h/12h/24h/自定义），屏蔽信息存 localStorage `{ drugId: muteUntilTimestamp }`
- **告警消除**: 库存回升 >= 阈值后，自动从告警列表移除，红色高亮消除

### 全局默认阈值

- 在预警页面顶部配置
- 本草默认阈值（默认 500 克）、成药默认阈值（默认 10 盒）
- 存 localStorage，key = `inventory-alert-config`
- 药物记录的 `alert_threshold` 不为空时覆盖全局默认值

### 菜单红点

- Layout.tsx 中定时检查（与预警扫描同频）
- 有未屏蔽告警时，「库存」和「库存预警」菜单显示红色 Badge
- 告警全部消除或屏蔽后，Badge 消失

## 开方页面库存提示

在处方开方界面输入药物时，关联库存数据提供提示：

- **触发方式**: 输入药物名称时，查询 `inventory_drugs` 匹配药物
- **提示内容**: 在药物输入行旁显示当前库存量（如「库存: 800克」）
- **库存不足提示**: 库存 < 阈值时，文字变为红色/橙色警告色（如「库存不足: 200克」）
- **不阻止开方**: 仅提示，不阻止医生开该药物
- **无库存记录**: 药物在库存表中不存在时，显示「未录入库存」灰色提示
- **API**: 复用 `GET /api/v1/inventory/drugs?name=xxx` 接口，前端按名称精确/模糊匹配
