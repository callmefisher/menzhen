# 排队设置（接诊医生配置 + 功能开关）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在系统设置下新增「排队设置」页面，支持排队叫号功能开关 + 接诊医生配置（卡片列表式、拖拽排序），并联动排队看板页。

**Architecture:** 后端新增 QueueDoctor 模型 + Service + Handler，扩展 Tenant 模型增加 queue_enabled 字段。前端新增 QueueSettings 页面（Ant Design Switch + 卡片列表 + dnd-kit 拖拽），auth store 增加 queueEnabled 全局状态，Layout/QueueDashboard 读取配置控制显隐和医生来源。

**Tech Stack:** Go + Gin + GORM + MySQL | React + TypeScript + Ant Design | dnd-kit (拖拽) | Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-03-25-queue-settings-design.md`

---

## File Structure

### New Backend Files
- `server/model/queue_doctor.go` — QueueDoctor 模型
- `server/service/queue_doctor.go` — QueueDoctor CRUD + 排序服务
- `server/service/queue_doctor_test.go` — 服务层测试
- `server/handler/queue_doctor.go` — HTTP 处理器（CRUD + toggle）

### New Frontend Files
- `web/src/api/queue-doctor.ts` — 接诊医生 API 服务
- `web/src/pages/settings/QueueSettings.tsx` — 排队设置页面

### Modify Files
- `server/model/tenant.go` — 添加 QueueEnabled 字段
- `server/database/database.go` — AutoMigrate 注册 QueueDoctor
- `server/router/router.go` — 注册新路由
- `web/src/App.tsx` — 添加 /settings/queue 路由
- `web/src/components/Layout.tsx` — 添加菜单项 + 功能开关控制排队菜单显隐
- `web/src/store/auth.tsx` — 添加 queueEnabled 全局状态 + fetchQueueEnabled（Context API 模式）
- `web/src/pages/queue/QueueDashboard.tsx` — 医生列表改为从 queue-doctors API 获取

---

## Task 1: QueueDoctor 模型 + Tenant 扩展 + 迁移

**Files:**
- Create: `server/model/queue_doctor.go`
- Modify: `server/model/tenant.go`
- Modify: `server/database/database.go`

- [ ] **Step 1: 创建 QueueDoctor 模型**

```go
// server/model/queue_doctor.go
package model

import "time"

// QueueDoctor 接诊医生配置（租户级别）
type QueueDoctor struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID  uint      `gorm:"column:tenant_id;not null;uniqueIndex:idx_qd_tenant_user" json:"tenant_id"`
	UserID    uint      `gorm:"column:user_id;not null;uniqueIndex:idx_qd_tenant_user" json:"user_id"`
	Room      string    `gorm:"column:room;type:varchar(50);not null" json:"room"`
	SortOrder int       `gorm:"column:sort_order;not null;default:0" json:"sort_order"`
	Enabled   bool      `gorm:"column:enabled;not null;default:true;index:idx_qd_tenant_enabled" json:"enabled"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Join fields (populated by handler, not stored)
	UserName string `gorm:"-" json:"user_name,omitempty"`
}

func (QueueDoctor) TableName() string { return "queue_doctors" }
```

- [ ] **Step 2: 扩展 Tenant 模型**

在 `server/model/tenant.go` 的 Tenant struct 中添加：

```go
QueueEnabled *bool `gorm:"column:queue_enabled;default:true" json:"queue_enabled"`
```

使用 `*bool` 指针类型，确保默认值 `true` 在 GORM 中正确处理。

- [ ] **Step 3: 注册 AutoMigrate**

在 `server/database/database.go` 的 `AutoMigrate` 调用中添加 `&model.QueueDoctor{}`。

- [ ] **Step 4: 编译验证**

```bash
cd server && go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add server/model/queue_doctor.go server/model/tenant.go server/database/database.go
git commit -m "feat: add QueueDoctor model + Tenant.QueueEnabled field"
```

---

## Task 2: QueueDoctor Service

**Files:**
- Create: `server/service/queue_doctor.go`

- [ ] **Step 1: 创建 service**

```go
// server/service/queue_doctor.go
package service

import (
	"errors"

	"menzhen/server/model"

	"gorm.io/gorm"
)

var (
	ErrQueueDoctorNotFound  = errors.New("queue doctor not found")
	ErrQueueDoctorDuplicate = errors.New("该用户已配置为接诊医生")
)

type QueueDoctorService struct {
	DB *gorm.DB
}

func NewQueueDoctorService(db *gorm.DB) *QueueDoctorService {
	return &QueueDoctorService{DB: db}
}

// List 获取租户下所有接诊医生（按 sort_order 排序）
func (s *QueueDoctorService) List(tenantID uint) ([]model.QueueDoctor, error) {
	var doctors []model.QueueDoctor
	if err := s.DB.Where("tenant_id = ?", tenantID).
		Order("sort_order ASC, id ASC").Find(&doctors).Error; err != nil {
		return nil, err
	}
	return doctors, nil
}

// ListEnabled 获取租户下已启用的接诊医生（排队看板用）
func (s *QueueDoctorService) ListEnabled(tenantID uint) ([]model.QueueDoctor, error) {
	var doctors []model.QueueDoctor
	if err := s.DB.Where("tenant_id = ? AND enabled = ?", tenantID, true).
		Order("sort_order ASC, id ASC").Find(&doctors).Error; err != nil {
		return nil, err
	}
	return doctors, nil
}

// Create 添加接诊医生
func (s *QueueDoctorService) Create(doc *model.QueueDoctor) error {
	// 查重
	var count int64
	s.DB.Model(&model.QueueDoctor{}).
		Where("tenant_id = ? AND user_id = ?", doc.TenantID, doc.UserID).
		Count(&count)
	if count > 0 {
		return ErrQueueDoctorDuplicate
	}
	// 自动设置 sort_order 为最后
	var maxSort int
	s.DB.Model(&model.QueueDoctor{}).
		Where("tenant_id = ?", doc.TenantID).
		Select("COALESCE(MAX(sort_order), -1)").Scan(&maxSort)
	doc.SortOrder = maxSort + 1
	return s.DB.Create(doc).Error
}

// Update 编辑接诊医生（诊室/状态）
func (s *QueueDoctorService) Update(tenantID, id uint, room string, enabled bool) (*model.QueueDoctor, error) {
	var doc model.QueueDoctor
	if err := s.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&doc).Error; err != nil {
		return nil, ErrQueueDoctorNotFound
	}
	doc.Room = room
	doc.Enabled = enabled
	if err := s.DB.Save(&doc).Error; err != nil {
		return nil, err
	}
	return &doc, nil
}

// Delete 删除接诊医生
func (s *QueueDoctorService) Delete(tenantID, id uint) error {
	result := s.DB.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&model.QueueDoctor{})
	if result.RowsAffected == 0 {
		return ErrQueueDoctorNotFound
	}
	return result.Error
}

// UpdateSort 批量更新排序
func (s *QueueDoctorService) UpdateSort(tenantID uint, orders []SortOrder) error {
	return s.DB.Transaction(func(tx *gorm.DB) error {
		for _, o := range orders {
			if err := tx.Model(&model.QueueDoctor{}).
				Where("id = ? AND tenant_id = ?", o.ID, tenantID).
				Update("sort_order", o.SortOrder).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

type SortOrder struct {
	ID        uint `json:"id"`
	SortOrder int  `json:"sort_order"`
}

// GetQueueEnabled 获取租户排队功能开关
func (s *QueueDoctorService) GetQueueEnabled(tenantID uint) (bool, error) {
	var tenant model.Tenant
	if err := s.DB.Select("queue_enabled").First(&tenant, tenantID).Error; err != nil {
		return false, err
	}
	if tenant.QueueEnabled == nil {
		return true, nil // 默认开启
	}
	return *tenant.QueueEnabled, nil
}

// SetQueueEnabled 设置租户排队功能开关
func (s *QueueDoctorService) SetQueueEnabled(tenantID uint, enabled bool) error {
	return s.DB.Model(&model.Tenant{}).Where("id = ?", tenantID).
		Update("queue_enabled", enabled).Error
}
```

- [ ] **Step 2: 编译验证**

```bash
cd server && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add server/service/queue_doctor.go
git commit -m "feat: add queue doctor service (CRUD + sort + toggle)"
```

---

## Task 3: QueueDoctor Service 测试

**Files:**
- Create: `server/service/queue_doctor_test.go`

- [ ] **Step 1: 写测试**

测试场景：
1. `TestQueueDoctorCreate` — 正常创建 + sort_order 自动递增
2. `TestQueueDoctorCreateDuplicate` — 重复用户应报错
3. `TestQueueDoctorList` — 按 sort_order 排序
4. `TestQueueDoctorListEnabled` — 只返回 enabled=true
5. `TestQueueDoctorUpdate` — 修改诊室和状态
6. `TestQueueDoctorUpdateNotFound` — 不存在的 ID
7. `TestQueueDoctorDelete` — 正常删除
8. `TestQueueDoctorDeleteNotFound` — 不存在的 ID
9. `TestQueueDoctorUpdateSort` — 批量排序
10. `TestQueueDoctorTenantIsolation` — 不同租户数据隔离
11. `TestQueueEnabled` — 获取/设置功能开关
12. `TestQueueEnabledDefault` — 默认值为 true

使用 `testutil.SetupTestDB(t)` + `testutil.SeedTestTenant` 模式。

- [ ] **Step 2: 运行测试确认通过**

```bash
cd server && go test ./service/ -run TestQueueDoctor -v
cd server && go test ./service/ -run TestQueueEnabled -v
```

- [ ] **Step 3: Commit**

```bash
git add server/service/queue_doctor_test.go
git commit -m "test: add queue doctor service tests"
```

---

## Task 4: QueueDoctor Handler + 路由

**Files:**
- Create: `server/handler/queue_doctor.go`
- Modify: `server/router/router.go`

- [ ] **Step 1: 创建 handler**

```go
// server/handler/queue_doctor.go
package handler

import (
	"net/http"
	"strconv"

	"menzhen/server/middleware"
	"menzhen/server/model"
	"menzhen/server/service"

	"github.com/gin-gonic/gin"
)

type QueueDoctorHandler struct {
	svc *service.QueueDoctorService
}

func NewQueueDoctorHandler(svc *service.QueueDoctorService) *QueueDoctorHandler {
	return &QueueDoctorHandler{svc: svc}
}

// List GET /queue-doctors
func (h *QueueDoctorHandler) List(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	doctors, err := h.svc.List(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取接诊医生失败"})
		return
	}
	// 填充 user_name（JOIN users 表）
	// ...通过 DB 查询 users 获取 real_name
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"list": doctors}})
}

// Create POST /queue-doctors
func (h *QueueDoctorHandler) Create(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	var req struct {
		UserID  uint   `json:"user_id" binding:"required"`
		Room    string `json:"room" binding:"required"`
		Enabled *bool  `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	doc := &model.QueueDoctor{
		TenantID: tenantID,
		UserID:   req.UserID,
		Room:     req.Room,
		Enabled:  enabled,
	}
	if err := h.svc.Create(doc); err != nil {
		if err == service.ErrQueueDoctorDuplicate {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "添加失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": doc})
}

// Update PUT /queue-doctors/:id
func (h *QueueDoctorHandler) Update(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var req struct {
		Room    string `json:"room" binding:"required"`
		Enabled bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	doc, err := h.svc.Update(tenantID, uint(id), req.Room, req.Enabled)
	if err != nil {
		if err == service.ErrQueueDoctorNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "未找到该接诊医生"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": doc})
}

// Delete DELETE /queue-doctors/:id
func (h *QueueDoctorHandler) Delete(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	if err := h.svc.Delete(tenantID, uint(id)); err != nil {
		if err == service.ErrQueueDoctorNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "未找到该接诊医生"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": "ok"})
}

// UpdateSort PUT /queue-doctors/sort
func (h *QueueDoctorHandler) UpdateSort(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	var req struct {
		Orders []service.SortOrder `json:"orders" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.svc.UpdateSort(tenantID, req.Orders); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "排序更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": "ok"})
}

// GetQueueEnabled GET /tenant/queue-enabled
func (h *QueueDoctorHandler) GetQueueEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	enabled, err := h.svc.GetQueueEnabled(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": enabled}})
}

// SetQueueEnabled PUT /tenant/queue-enabled
func (h *QueueDoctorHandler) SetQueueEnabled(c *gin.Context) {
	tenantID := uint(middleware.GetTenantID(c))
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}
	if err := h.svc.SetQueueEnabled(tenantID, req.Enabled); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "设置失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"enabled": req.Enabled}})
}
```

- [ ] **Step 2: 注册路由**

在 `server/router/router.go` 中注册（queue 路由组附近）：

```go
qdSvc := service.NewQueueDoctorService(db)
qdHandler := handler.NewQueueDoctorHandler(qdSvc)

// 接诊医生配置
qd := authenticated.Group("/queue-doctors")
{
    qd.GET("", middleware.RequirePermission(db, "queue:read"), qdHandler.List)
    qd.POST("", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.Create)
    qd.PUT("/sort", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.UpdateSort)
    qd.PUT("/:id", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.Update)
    qd.DELETE("/:id", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.Delete)
}

// 排队功能开关
authenticated.GET("/tenant/queue-enabled", qdHandler.GetQueueEnabled)
authenticated.PUT("/tenant/queue-enabled", middleware.RequirePermission(db, "tenant:user:manage"), qdHandler.SetQueueEnabled)
```

注意：`PUT /sort` 必须在 `PUT /:id` 之前注册，否则 "sort" 会被当作 `:id` 匹配。

- [ ] **Step 3: handler 中填充 user_name**

List handler 需要 JOIN users 表获取 real_name。在 handler.List 方法中：

```go
// 批量获取 user_name
userIDs := make([]uint, len(doctors))
for i, d := range doctors {
    userIDs[i] = d.UserID
}
var users []model.User
h.svc.DB.Select("id, real_name, username").Where("id IN ?", userIDs).Find(&users)
nameMap := make(map[uint]string)
for _, u := range users {
    name := u.RealName
    if name == "" {
        name = u.Username
    }
    nameMap[u.ID] = name
}
for i := range doctors {
    doctors[i].UserName = nameMap[doctors[i].UserID]
}
```

- [ ] **Step 4: 编译验证 + 全量后端测试**

```bash
cd server && go build ./... && go test ./...
```

- [ ] **Step 5: Commit**

```bash
git add server/handler/queue_doctor.go server/router/router.go
git commit -m "feat: add queue doctor handler + routes + queue toggle API"
```

---

## Task 5: 前端 API Service

**Files:**
- Create: `web/src/api/queue-doctor.ts`

- [ ] **Step 1: 创建 API service**

```typescript
// web/src/api/queue-doctor.ts
import request from '../utils/request';

export interface QueueDoctor {
  id: number;
  tenant_id: number;
  user_id: number;
  user_name: string;
  room: string;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const listQueueDoctors = () =>
  request.get('/queue-doctors');

export const createQueueDoctor = (data: { user_id: number; room: string; enabled?: boolean }) =>
  request.post('/queue-doctors', data);

export const updateQueueDoctor = (id: number, data: { room: string; enabled: boolean }) =>
  request.put(`/queue-doctors/${id}`, data);

export const deleteQueueDoctor = (id: number) =>
  request.delete(`/queue-doctors/${id}`);

export const updateQueueDoctorSort = (orders: { id: number; sort_order: number }[]) =>
  request.put('/queue-doctors/sort', { orders });

export const getQueueEnabled = () =>
  request.get('/tenant/queue-enabled');

export const setQueueEnabled = (enabled: boolean) =>
  request.put('/tenant/queue-enabled', { enabled });
```

- [ ] **Step 2: 编译验证**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/api/queue-doctor.ts
git commit -m "feat: add queue doctor + toggle API service"
```

---

## Task 6: Auth Store 扩展（queueEnabled 全局状态）

**Files:**
- Modify: `web/src/store/auth.tsx`

**注意**：auth store 使用 React Context + useState 模式（非 Zustand），修改需遵循此模式。

- [ ] **Step 1: 添加 queueEnabled 状态**

在 `AuthState` interface 中添加：
```typescript
queueEnabled: boolean;
```

在 `AuthProvider` 的 `useState` 初始值中设置 `queueEnabled: true`（默认开启）。

- [ ] **Step 2: 添加 fetchQueueEnabled 方法**

在 `AuthContextValue` interface 中添加：
```typescript
fetchQueueEnabled: () => Promise<void>;
```

在 `AuthProvider` 组件内实现：
```typescript
const fetchQueueEnabled = useCallback(async () => {
  try {
    const res = await getQueueEnabled();
    const body = res as any;
    setState(prev => ({ ...prev, queueEnabled: body.data?.enabled ?? true }));
  } catch {
    setState(prev => ({ ...prev, queueEnabled: true }));
  }
}, []);
```

在文件顶部导入 `import { getQueueEnabled } from '../api/queue-doctor';`

- [ ] **Step 3: 在会话恢复时调用**

在现有 `useEffect`（restore session on mount）中，`getMe()` 成功后调用 `fetchQueueEnabled()`。

- [ ] **Step 4: 将 fetchQueueEnabled 加入 context value**

在 `AuthContext.Provider` 的 value 中加入 `fetchQueueEnabled`。

- [ ] **Step 5: 编译验证**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add web/src/store/auth.tsx
git commit -m "feat: add queueEnabled global state in auth store"
```

---

## Task 7: QueueSettings 页面

**Files:**
- Create: `web/src/pages/settings/QueueSettings.tsx`

- [ ] **Step 1: 安装 dnd-kit（如未安装）**

```bash
cd web && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: 创建 QueueSettings 页面**

页面结构：
1. 功能开关卡片（Switch 组件）
2. 接诊医生卡片列表（dnd-kit 拖拽排序）
3. 添加医生 Modal（Select 用户 + Input 诊室 + Radio 状态）

关键实现点：
- 开关：调用 `setQueueEnabled` API + 更新 auth store 的 `queueEnabled`
- 医生列表：`listQueueDoctors` 获取，卡片式展示（头像+姓名+诊室+状态+编辑/删除）
- 添加：Modal 内 Select 只显示未配置的用户（`listUsers` 减去已配置的 `user_id`）
- 编辑：复用 Modal，回填数据
- 拖拽排序：dnd-kit `SortableContext` + `DndContext`，拖拽结束调用 `updateQueueDoctorSort`
- 移动端：用 `useIsMobile()` 检测，卡片全宽，Modal `width: '95vw'`，拖拽手柄加大

- [ ] **Step 3: 编译验证**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/settings/QueueSettings.tsx
git commit -m "feat: add queue settings page (toggle + doctor config)"
```

---

## Task 8: 路由 + 菜单集成

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Layout.tsx`

- [ ] **Step 1: App.tsx 添加路由**

```typescript
import QueueSettings from './pages/settings/QueueSettings';
// 在 settings routes 中添加：
<Route path="settings/queue" element={<QueueSettings />} />
```

- [ ] **Step 2: Layout.tsx 添加菜单项**

在 settingsChildren（约 line 395 附近，`软件配置` 之后）添加：

```typescript
settingsChildren.push({
  key: '/settings/queue',
  icon: <SoundOutlined />,
  label: '排队设置',
});
```

- [ ] **Step 3: Layout.tsx 功能开关控制排队菜单显隐**

从 auth store 读取 `queueEnabled`，控制侧边栏「排队叫号」菜单项（约 line 244-255）的显隐。

在 Layout 组件初始化时调用 `fetchQueueEnabled()`（如果 store 中还未加载）。

排队叫号菜单项外层包裹条件判断：
```typescript
if (hasPermission('queue:read') && queueEnabled) {
  // 显示排队叫号菜单
}
```

- [ ] **Step 4: Layout.tsx 面包屑导航**

在 selectedKeys 匹配逻辑中添加：
```typescript
if (path.startsWith('/settings/queue')) return ['/settings/queue'];
```

- [ ] **Step 5: 编译验证**

```bash
cd web && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: integrate queue settings route + menu + feature toggle"
```

---

## Task 9: QueueDashboard 联动改造

**Files:**
- Modify: `web/src/pages/queue/QueueDashboard.tsx`

- [ ] **Step 1: 医生来源改为 queue-doctors API**

替换当前 `listUsers` 调用（约 line 62-80）为 `listQueueDoctors`：

```typescript
import { listQueueDoctors, type QueueDoctor as QueueDoctorConfig } from '../../api/queue-doctor';

// 替换原有 useEffect
useEffect(() => {
  (async () => {
    try {
      const res = await listQueueDoctors();
      const body = res as any;
      const list: QueueDoctorConfig[] = body.data?.list || [];
      const docs: DoctorOption[] = list
        .filter(d => d.enabled)
        .map(d => ({ id: d.user_id, name: d.user_name, room: d.room }));
      setDoctors(docs);
    } catch {
      /* fallback: derive from queue data */
    }
  })();
}, []);
```

- [ ] **Step 2: 空状态引导**

当 `doctors.length === 0 && doctorGroups.length === 0` 时，显示引导：

```typescript
<div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
  <p>暂未配置接诊医生</p>
  <Button type="link" onClick={() => navigate('/settings/queue')}>
    前往排队设置配置接诊医生
  </Button>
</div>
```

- [ ] **Step 3: 取号栏医生下拉附带诊室**

修改 doctorOptions 的 label 显示：

```typescript
options={doctorOptions.map(d => ({
  value: d.id,
  label: d.room ? `${d.name}（${d.room}）` : d.name,
}))}
```

- [ ] **Step 4: 编译验证**

```bash
cd web && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/queue/QueueDashboard.tsx
git commit -m "feat: queue dashboard reads doctors from queue-doctors config"
```

---

## Task 10: 全面测试

**Files:**
- Exists: `server/service/queue_doctor_test.go` (Task 3)
- May modify: `web/src/pages/settings/__tests__/QueueSettings.test.tsx` (新建)

- [ ] **Step 1: 后端全量测试**

```bash
cd server && go test ./... -v
```

确认所有已有测试 + 新增测试通过。

- [ ] **Step 2: 前端编译验证**

```bash
cd web && npm run build
```

- [ ] **Step 3: 前端全量测试**

```bash
cd web && npm run test
```

- [ ] **Step 4: Commit（如有修复）**

```bash
git commit -m "test: add queue settings tests + fix issues"
```

---

## Task 11: Review + 部署

- [ ] **Step 1: 第一轮 review** — 代码审查（安全/质量/模式）
- [ ] **Step 2: 修复 review 问题**
- [ ] **Step 3: 第二轮 review** — 确认修复
- [ ] **Step 4: 全量测试通过**

```bash
cd server && go test ./... && cd ../web && npm run build && npm run test
```

- [ ] **Step 5: 部署**

```bash
./deploy.sh
```
