# 排队设置页面 — 设计文档

## 概述

在系统设置下新增「排队设置」子菜单（`/settings/queue`），包含：
1. **排队叫号功能开关**（租户级别，默认开启）
2. **接诊医生配置**（卡片列表式，支持拖拽排序）

## 设计约束

1. 复用现有用户列表作为医生数据源，不新建医生实体
2. 接诊医生配置为租户级别，多租户隔离
3. 移动端兼容：卡片列表自适应，Modal 全宽显示
4. 排队看板 + 取号联动：只展示/选择已配置且启用的接诊医生
5. 功能关闭时：侧边栏隐藏排队菜单、患者列表页隐藏叫号条、排队看板不可访问

## 预览文件

| 文件 | 内容 |
|------|------|
| `.superpowers/brainstorm/53411-1774424901/queue-settings-page.html` | 排队设置页面布局（方案A卡片列表式） |
| `.superpowers/brainstorm/53411-1774424901/add-doctor-modal.html` | 添加医生弹窗（方案A简洁Modal） |

---

## 数据模型

### QueueDoctor（接诊医生配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uint | 主键 |
| tenant_id | uint | 租户ID |
| user_id | uint | 关联用户ID |
| room | string(50) | 诊室名称（如「诊室1」） |
| sort_order | int | 排序序号（拖拽排序） |
| enabled | bool | 是否出诊（true=出诊中，false=停诊） |
| created_at | time.Time | 创建时间 |
| updated_at | time.Time | 更新时间 |

索引：`(tenant_id, enabled)` 覆盖查询出诊医生、`UNIQUE (tenant_id, user_id)` 防重复

### Tenant 表扩展

新增字段：`queue_enabled bool default true` — 排队叫号功能开关

---

## API 设计

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/queue-doctors` | 获取接诊医生列表 | `queue:read` |
| POST | `/queue-doctors` | 添加接诊医生 | `tenant:user:manage` |
| PUT | `/queue-doctors/:id` | 编辑（诊室/状态） | `tenant:user:manage` |
| DELETE | `/queue-doctors/:id` | 删除接诊医生 | `tenant:user:manage` |
| PUT | `/queue-doctors/sort` | 批量更新排序 | `tenant:user:manage` |
| GET | `/tenant/queue-enabled` | 获取功能开关状态 | 登录即可 |
| PUT | `/tenant/queue-enabled` | 切换功能开关 | `tenant:user:manage` |

### 请求/响应示例

**POST /queue-doctors**
```json
{
  "user_id": 5,
  "room": "诊室1",
  "enabled": true
}
```

**PUT /queue-doctors/sort**
```json
{
  "orders": [
    {"id": 1, "sort_order": 0},
    {"id": 2, "sort_order": 1},
    {"id": 3, "sort_order": 2}
  ]
}
```

---

## 页面结构

### 桌面端

```
┌─ 页头 ──────────────────────────────────────────────┐
│ 排队设置                                              │
├─ 功能开关卡片 ────────────────────────────────────────┤
│ 排队叫号功能                              [████ 开] │
│ 关闭后：侧边栏隐藏排队菜单，患者列表页隐藏叫号条         │
├─ 接诊医生卡片 ────────────────────────────────────────┤
│ 接诊医生  配置出诊医生及对应诊室          [+ 添加医生] │
│                                                       │
│ ⠿  [张]  张明德  诊室1   [出诊中]     编辑  删除     │
│ ⠿  [李]  李秀芳  诊室2   [出诊中]     编辑  删除     │
│ ⠿  [王]  王大为  诊室3   [停  诊]     编辑  删除     │
│                                                       │
│ ⠿ 拖拽可调整排序 · 排队看板按此顺序展示医生卡片        │
└───────────────────────────────────────────────────────┘
```

### 移动端适配

- 页面整体单列布局，卡片全宽
- 医生卡片行：头像+姓名+诊室纵向排列，状态标签+操作按钮另起一行
- 拖拽排序改为长按拖动（或上下箭头按钮）
- 添加/编辑 Modal 全宽显示（`width: '95vw'`），底部按钮加大

### 添加医生 Modal

```
┌─ 添加接诊医生 ─────────────────── ✕ ┐
│                                      │
│ 选择医生 *                           │
│ [请选择用户              ▼]         │
│ 仅显示尚未配置为接诊医生的用户        │
│                                      │
│ 诊室名称 *                           │
│ [例如：诊室1               ]         │
│                                      │
│ 初始状态                             │
│ [■ 出诊中]  [□ 停诊]                │
│                                      │
│                    [取消]  [确定]     │
└──────────────────────────────────────┘
```

---

## 联动影响

### 排队看板页（/queue）

- **医生卡片**：只展示 `queue_doctors` 中 `enabled=true` 的医生（按 `sort_order`）
- **取号栏**：医生下拉框只显示已配置且启用的接诊医生，附带诊室信息
- **空状态**：未配置接诊医生时，显示引导「请先在 系统设置 > 排队设置 中配置接诊医生」

### 患者列表页（/patients）

- **叫号条**：功能关闭时隐藏
- **状态标签**：功能关闭时不显示

### 侧边栏

- **排队叫号菜单**：功能关闭时隐藏（`queue_enabled=false`）

### 功能开关 API 调用时机

前端启动时（Layout 组件 mount）调用 `GET /tenant/queue-enabled`，缓存到全局状态（auth store 或 context），各组件读取此状态决定显隐。

---

## 侧边栏菜单入口

在 Layout.tsx 的系统设置子菜单中新增：

```typescript
settingsChildren.push({
  key: '/settings/queue',
  icon: <SoundOutlined />,
  label: '排队设置',
});
```

权限要求：`tenant:user:manage`（与用户管理同级）

---

## 文件清单

### 新建文件

| 文件 | 说明 |
|------|------|
| `server/model/queue_doctor.go` | QueueDoctor 模型 |
| `server/service/queue_doctor.go` | QueueDoctor CRUD 服务 |
| `server/handler/queue_doctor.go` | QueueDoctor HTTP 处理器 |
| `server/service/queue_doctor_test.go` | 服务层测试 |
| `web/src/api/queue-doctor.ts` | 前端 API 服务 |
| `web/src/pages/settings/QueueSettings.tsx` | 排队设置页面 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/model/tenant.go` | 添加 `QueueEnabled` 字段 |
| `server/database/database.go` | AutoMigrate 注册 QueueDoctor |
| `server/router/router.go` | 注册路由 |
| `web/src/App.tsx` | 添加 `/settings/queue` 路由 |
| `web/src/components/Layout.tsx` | 添加菜单项 + 功能开关控制排队菜单显隐 |
| `web/src/store/auth.ts` | 添加 `queueEnabled` 全局状态 |
| `web/src/pages/queue/QueueDashboard.tsx` | 医生列表改为从 queue-doctors API 获取 |
