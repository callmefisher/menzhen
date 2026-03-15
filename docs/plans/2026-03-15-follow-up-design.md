# 回访功能设计文档

> 日期: 2026-03-15
> 状态: 已确认

## 1. 功能概述

在运营菜单下新增"回访"入口，支持对患者进行计划回访和回访记录管理。每个回访可关联患者和（可选）诊疗记录，支持状态追踪（待回访/已完成/逾期）和菜单徽标提醒。

### 核心需求
- 回访 CRUD（创建、查看、编辑、删除）
- 每个患者可有多个回访记录
- 可选关联诊疗记录
- 患者姓名和诊疗记录可点击跳转
- 桌面端和移动端适配
- 独立权限组 `followup:*`
- 逾期提醒（菜单徽标 + 列表高亮）

## 2. 数据模型

### follow_ups 表（租户隔离）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uint64 | PK, auto-increment | 主键 |
| tenant_id | uint64 | NOT NULL, index | 租户 ID |
| patient_id | uint64 | NOT NULL, index | 患者 ID（FK → patients.id） |
| record_id | uint64 | nullable, index | 诊疗记录 ID（FK → medical_records.id） |
| planned_date | date | NOT NULL | 计划回访日期 |
| actual_date | date | nullable | 实际回访日期 |
| status | varchar(20) | NOT NULL, default 'pending' | 状态：pending/completed/overdue |
| method | varchar(50) | NOT NULL | 回访方式：电话/微信/到诊/其他（选"其他"时自定义文本直接存入此字段） |
| content | text | | 回访内容（前端 TextArea maxLength 2000） |
| created_by | uint64 | NOT NULL | 创建者用户 ID |
| created_at | datetime | | 创建时间 |
| updated_at | datetime | | 更新时间 |
| deleted_at | datetime | index | 软删除 |

### 关联关系
- `patient_id` → `patients.id`（必填，多对一）
- `record_id` → `medical_records.id`（可选，多对一）
- `tenant_id` → 租户隔离
- `created_by` → 创建者

### 状态流转
- 数据库只存储 `pending` 和 `completed` 两种状态
- 创建时 → `pending`
- 填写实际日期 → `completed`（更新时自动设置）
- `overdue` 为**查询时计算的虚拟状态**：后端在 List/Detail 响应中，对 `planned_date < 今天 && status == 'pending'` 的记录，将 `status` 字段覆盖为 `overdue` 返回给前端
- 允许创建过去日期的回访（补录场景），此时立即显示为 overdue

### 关联数据删除处理
- 患者/诊疗记录软删除后，回访仍然保留
- 列表 JOIN 使用 LEFT JOIN，已删除的患者/记录显示"已删除"标识
- 前端：已删除的患者/记录链接置灰不可点击

## 3. 权限设计

### 新增权限码

| 权限码 | 名称 | 描述 |
|--------|------|------|
| `followup:create` | 新增回访 | 创建回访记录 |
| `followup:read` | 查看回访 | 查看回访列表和详情 |
| `followup:update` | 编辑回访 | 修改回访记录 |
| `followup:delete` | 删除回访 | 删除回访记录 |

### 菜单可见性
- 运营菜单本身：`inventory:read` **OR** `followup:read` 即可见
- 回访子菜单：`followup:read`
- 库存子菜单：`inventory:read`（不变）
- 管理员自动拥有所有权限

### Seed
- 在 `seed.go` 中 upsert 4 个权限
- 管理员角色自动拥有

## 4. API 设计

### 路由

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/follow-ups` | `followup:read` | 列表（分页+筛选） |
| POST | `/api/v1/follow-ups` | `followup:create` | 新建 |
| GET | `/api/v1/follow-ups/stats` | `followup:read` | 统计（徽标用，**必须在 /:id 之前注册**） |
| GET | `/api/v1/follow-ups/:id` | `followup:read` | 详情 |
| PUT | `/api/v1/follow-ups/:id` | `followup:update` | 编辑 |
| DELETE | `/api/v1/follow-ups/:id` | `followup:delete` | 删除 |

### 列表筛选参数
- `patient_name` — 患者姓名模糊搜索
- `status` — pending/completed/overdue
- `planned_date_from` / `planned_date_to` — 日期范围
- `page` / `size` — 分页

### 默认排序
- `planned_date ASC`（最近待回访优先），逾期在最前

### 后端 overdue 计算
列表查询时，对 `status == 'pending' && planned_date < today` 的记录，在 JSON 响应中将 status 覆盖为 `"overdue"`。筛选 `status=overdue` 时，实际查询 `status = 'pending' AND planned_date < CURDATE()`。

### 列表响应（反规范化）

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 1,
        "patient_id": 10,
        "patient_name": "张三",
        "record_id": 5,
        "record_diagnosis": "感冒发热",
        "record_visit_date": "2026-03-10",
        "planned_date": "2026-03-20",
        "actual_date": null,
        "status": "pending",
        "method": "电话",
        "content": "",
        "created_by": 1,
        "created_by_name": "李医生",
        "created_at": "2026-03-15T10:00:00Z",
        "updated_at": "2026-03-15T10:00:00Z"
      }
    ],
    "total": 50,
    "page": 1,
    "size": 20
  }
}
```

### 统计响应

```json
{
  "code": 0,
  "data": {
    "pending_count": 12,
    "overdue_count": 3,
    "today_count": 2,
    "completed_count": 45
  }
}
```

### 创建请求

```json
{
  "patient_id": 10,
  "record_id": 5,
  "planned_date": "2026-03-20",
  "method": "电话",
  "content": "术后一周回访"
}
```

### 编辑请求

Go 结构体使用指针字段区分"未提供"和"零值"（同 `UpdateInventoryDrugRequest` 模式）：

```go
type UpdateFollowUpRequest struct {
    PatientID   *uint64    `json:"patient_id"`
    RecordID    *uint64    `json:"record_id"`    // 传 null 清除关联
    PlannedDate *string    `json:"planned_date"` // "2006-01-02" 格式
    ActualDate  *string    `json:"actual_date"`  // 传 null 清除
    Method      *string    `json:"method"`
    Content     *string    `json:"content"`
}
```

填写 `actual_date` 时后端自动将 `status` 设为 `completed`；清除 `actual_date` 时恢复为 `pending`。

### 编辑/删除权限
同 inventory 模式：租户内任何拥有 `followup:update`/`followup:delete` 权限的用户可编辑/删除该租户的任意回访记录，不限创建者。

### 操作日志（OpLog）
Create/Update/Delete 操作均调用 `middleware.LogOperation()`，记录到 OpLog 表。

## 5. 前端设计

### 路由
- `/follow-ups` — 回访列表页

### 运营菜单结构

```
运营 (ShopOutlined) [徽标: 待回访+逾期数]
├── 库存药物 (inventory:read)
├── 库存预警 (inventory:read)
└── 回访 (followup:read) [徽标: 待回访+逾期数]
```

菜单可见性：`hasPermission('inventory:read') || hasPermission('followup:read')`

### 徽标逻辑
- 徽标数值 = `pending_count + overdue_count`（即所有未完成的回访）
- 页面加载时请求 `/follow-ups/stats`；切换到回访页时刷新
- 同 inventory alert 的 polling 模式，Layout 组件中 useEffect 定时刷新（间隔 5 分钟）

### 桌面端

**搜索栏**：患者姓名输入框、状态下拉（全部/待回访/已完成/逾期）、日期范围选择器

**统计卡片**：待回访数、今日需回访、逾期数（红色）

**Table 列**：

| 列 | 说明 |
|----|------|
| 患者姓名 | 蓝色链接，点击跳转 `/patients/:id` |
| 关联诊疗 | 蓝色链接，点击跳转 `/records/:id`，显示诊断+就诊日期 |
| 计划日期 | 日期格式 |
| 实际日期 | 日期格式（未完成显示"—"） |
| 状态 | Tag：绿色(已完成)、蓝色(待回访)、红色(逾期) |
| 回访方式 | 文本 |
| 操作 | 编辑/删除按钮 |

**逾期行**：红色背景高亮 `rowClassName`

### 移动端

- 搜索栏简化：姓名 + 状态筛选
- Card 列表替代 Table
- 每张卡片：患者姓名（可点击）、计划日期、状态 Tag、操作按钮
- Modal 宽度 `calc(100vw - 32px)`
- 分页 `<Pagination size="small" simple />`

### Modal 表单

| 字段 | 组件 | 必填 | 说明 |
|------|------|------|------|
| 患者 | Select + 搜索 | 是 | 搜索选择患者 |
| 关联诊疗记录 | Select | 否 | 选择患者后加载该患者的记录列表 |
| 计划回访日期 | DatePicker | 是 | |
| 回访方式 | Select（电话/微信/到诊/其他） | 是 | 选"其他"时出现输入框 |
| 实际回访日期 | DatePicker | 否 | 完成回访时填写 |
| 回访内容 | TextArea | 否 | |

### 交互要点
- 选择患者后自动请求该患者的诊疗记录列表（复用现有 `GET /api/v1/records?patient_id=X` 端点）
- 患者姓名和诊疗记录为蓝色可点击链接，跳转对应页面
- 已删除的患者/记录：链接置灰不可点击，显示"已删除"标识
- 填写实际日期时状态自动变为"已完成"
- 逾期项在列表中红色高亮

## 6. 文档更新

实现完成后需同步更新：
- `docs/codebase.md` — 新增 follow_ups 表定义、API 路由、权限码
- `CLAUDE.md` — 权限码列表新增 `followup:*`
- `README.md` — 功能列表新增回访

## 6. 后端文件清单

| 文件 | 说明 |
|------|------|
| `server/model/follow_up.go` | 数据模型 |
| `server/service/follow_up.go` | 业务逻辑（CRUD + 统计） |
| `server/handler/follow_up.go` | HTTP 处理器 |
| `server/router/router.go` | 路由注册（追加） |
| `server/database/database.go` | AutoMigrate（追加） |
| `server/database/seed.go` | 权限 seed（追加） |

## 7. 前端文件清单

| 文件 | 说明 |
|------|------|
| `web/src/api/followUp.ts` | API 调用 |
| `web/src/pages/followup/FollowUpList.tsx` | 回访列表页 |
| `web/src/App.tsx` | 路由注册（追加） |
| `web/src/components/Layout.tsx` | 菜单配置（追加回访入口+徽标） |

## 8. 测试清单

### 后端
- `server/service/follow_up_test.go` — Service 层测试
- `server/handler/follow_up_test.go` — Handler 层测试
- 覆盖：CRUD、租户隔离、状态流转、权限校验、边界条件

### 前端
- `web/src/pages/followup/__tests__/FollowUpList.test.tsx` — 页面组件测试
- `web/src/api/__tests__/followUp.test.ts` — API 调用测试
- 覆盖：列表渲染、新增/编辑/删除、筛选、跳转链接、移动端适配、权限控制
