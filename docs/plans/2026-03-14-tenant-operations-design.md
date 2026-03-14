# 诊所运营角色 — 租户级用户/角色管理设计

> 日期: 2026-03-14
> 状态: 设计完成

## 背景

当前系统的 `user:manage` / `role:manage` 是全局管理权限，拥有者可跨诊所管理所有用户和角色。需要新增「诊所运营」角色，使其仅能管理**本诊所**的用户和角色，实现严格的租户隔离。

## 需求摘要

1. 新增 `tenant:user:manage` 和 `tenant:role:manage` 两个权限码
2. 拥有这些权限的角色能看到「系统设置」菜单，但只有「用户管理」和「角色管理」两个子项
3. 用户管理页面只显示本诊所的注册用户
4. 角色管理页面只显示本诊所的角色，且可分配的权限**排除**全局管理权限
5. 严格的租户隔离：任何操作都不能越权访问其他诊所的数据

## 权限码设计

### 新增权限码（2 个）

| 权限码 | 名称 | 描述 |
|--------|------|------|
| `tenant:user:manage` | 诊所用户管理 | 查看、编辑、启用/禁用本诊所用户，分配本诊所角色 |
| `tenant:role:manage` | 诊所角色管理 | 创建、编辑本诊所角色，分配非全局权限 |

### 权限层级关系

- `user:manage`（全局）→ 可管理所有诊所用户，自动兼容 tenant 端点
- `tenant:user:manage`（租户级）→ 仅管理本诊所用户
- `role:manage` / `tenant:role:manage` 同理

### 不可分配的权限码（全局管理类）

通过 `GET /api/v1/tenant/permissions` 返回的权限列表将排除：

- `user:manage`
- `role:manage`
- `tenant:manage`

这确保诊所运营人员无法通过创建角色来提权获取全局管理能力。

## API 设计

### 新增端点（Tenant-scoped）

所有端点均需 JWT 认证，并从 token 中提取 `tenant_id` 进行过滤。

#### 用户管理（需 `tenant:user:manage` 或 `user:manage`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/tenant/users` | 列出本诊所用户（分页） |
| PUT | `/api/v1/tenant/users/:id` | 编辑本诊所用户（real_name, phone, status, notes） |
| DELETE | `/api/v1/tenant/users/:id` | 禁用本诊所用户（设 status=0） |
| POST | `/api/v1/tenant/users/:id/roles` | 为本诊所用户分配角色 |

#### 角色管理（需 `tenant:role:manage` 或 `role:manage`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/tenant/roles` | 列出本诊所角色 |
| POST | `/api/v1/tenant/roles` | 创建本诊所角色 |
| PUT | `/api/v1/tenant/roles/:id` | 编辑本诊所角色 |
| GET | `/api/v1/tenant/permissions` | 列出可分配权限（排除全局管理权限） |

### 现有端点不变

`/api/v1/users`、`/api/v1/roles`、`/api/v1/permissions` 保持原有行为，仅 `user:manage` / `role:manage` 可访问。

## 租户隔离验证

每个 tenant-scoped handler 必须执行以下检查：

1. **查询过滤**: `WHERE tenant_id = ?`（从 JWT 提取）
2. **写操作验证**: 目标对象的 `tenant_id` 必须等于当前用户的 `tenant_id`
3. **角色分配验证**: 被分配的角色的 `tenant_id` 必须等于目标用户的 `tenant_id`
4. **不允许修改 tenant_id**: PUT 接口不接受 `tenant_id` 字段

### 安全约束

- 诊所运营人员**不能**创建新用户（新用户通过注册页面自行注册）
- 诊所运营人员**不能**将用户移到其他诊所
- 诊所运营人员**不能**分配 `user:manage`、`role:manage`、`tenant:manage` 权限
- 跨诊所请求返回 403 Forbidden

## 前端设计

### 菜单逻辑

「系统设置」菜单的显示条件（满足任一即显示）：
- `user:manage` OR `tenant:user:manage`
- `role:manage` OR `tenant:role:manage`
- `tenant:manage`

子菜单项：

| 子项 | 显示条件 | 路由 |
|------|----------|------|
| 用户管理 | `user:manage` OR `tenant:user:manage` | `/settings/users` |
| 角色管理 | `role:manage` OR `tenant:role:manage` | `/settings/roles` |
| 诊所管理 | `tenant:manage` | `/settings/tenants` |

### 页面行为差异

**UserList 页面**：
- 拥有 `user:manage` → 调用 `GET /api/v1/users`，显示所有诊所用户，含「所属诊所」列
- 仅有 `tenant:user:manage` → 调用 `GET /api/v1/tenant/users`，仅本诊所用户，隐藏「所属诊所」列，PUT/DELETE/角色分配也用 tenant 端点

**RoleList 页面**：
- 拥有 `role:manage` → 调用 `GET /api/v1/roles` + `GET /api/v1/permissions`
- 仅有 `tenant:role:manage` → 调用 `GET /api/v1/tenant/roles` + `GET /api/v1/tenant/permissions`（排除全局管理权限）

### API 切换逻辑

前端通过 `hasPermission` 判断使用哪套 API：
```typescript
const isGlobalAdmin = hasPermission('user:manage')
const apiBase = isGlobalAdmin ? '/api/v1' : '/api/v1/tenant'
```

## Seed 数据变更

### 新增权限码

在 `seedPermissions()` 中新增：
```
tenant:user:manage — 诊所用户管理
tenant:role:manage — 诊所角色管理
```

### 新增默认角色

在默认诊所下新增「诊所运营」角色：
```
Name: "诊所运营"
Description: "诊所运营管理，可管理本诊所的用户和角色"
Permissions: [tenant:user:manage, tenant:role:manage]
```

### 管理员角色更新

管理员角色的权限集自动包含新增的 2 个权限码（seed 已有 "all permissions" 逻辑）。

## 测试策略

### 后端测试

1. **租户隔离**: 用户 A（诊所 1）不能通过 tenant API 访问诊所 2 的用户/角色
2. **权限检查**: 无权限用户访问 tenant API 返回 403
3. **权限兼容**: `user:manage` 用户也能访问 tenant API
4. **权限过滤**: `GET /api/v1/tenant/permissions` 不返回全局管理权限
5. **写操作验证**: PUT/DELETE 操作验证目标对象同 tenant

### 前端测试

1. **菜单显示**: 不同权限组合下菜单项的显示/隐藏
2. **API 切换**: 全局管理员 vs 诊所运营分别调用不同 API
3. **列显示**: 诊所运营不显示「所属诊所」列

## 文件变更清单

### 后端

| 文件 | 变更 |
|------|------|
| `server/database/seed.go` | 新增 2 个权限码 + 诊所运营角色 |
| `server/handler/tenant_admin.go` | 新增 tenant-scoped 用户/角色 handler |
| `server/service/tenant_admin.go` | 新增 tenant-scoped 用户/角色 service |
| `server/router/router.go` | 注册 tenant admin 路由 |

### 前端

| 文件 | 变更 |
|------|------|
| `web/src/components/Layout.tsx` | 更新菜单显示逻辑 |
| `web/src/api/tenant-admin.ts` | 新增 tenant API 调用 |
| `web/src/pages/settings/UserList.tsx` | 支持 tenant 模式 |
| `web/src/pages/settings/RoleList.tsx` | 支持 tenant 模式 |

### 测试

| 文件 | 说明 |
|------|------|
| `server/handler/tenant_admin_test.go` | handler 层测试 |
| `server/service/tenant_admin_test.go` | service 层测试 |
| `web/src/api/__tests__/tenant-admin.test.ts` | API 层测试 |
| `web/src/pages/settings/__tests__/UserList.test.tsx` | 页面测试更新 |
| `web/src/pages/settings/__tests__/RoleList.test.tsx` | 页面测试更新 |
