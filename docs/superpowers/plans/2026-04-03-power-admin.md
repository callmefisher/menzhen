# PowerAdmin 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 powerAdmin 角色——只能操作被授权的诊所分组，并在全局统计中看到所授权分组的汇总数据。

**Architecture:** 分两个阶段：① 给 Tenant 加 `group_name` 字段 + 新增 `TenantGroup` 概念（仅字符串标签，不建独立表）；② 新增 `UserManagedGroup` 表记录 powerAdmin 与分组的关联，JWT 中携带 `ManagedGroups []string`，后端中间件/handler 按分组过滤，前端按 `managedGroups` 判断 isPowerAdmin。全程 TDD，不修改 superAdmin 原有逻辑。

**Tech Stack:** Go 1.21 · Gin · GORM · MySQL · React 18 · TypeScript · Ant Design 6 · Vitest

---

## 文件结构

### 新建文件
| 文件 | 职责 |
|------|------|
| `server/model/user_managed_group.go` | `UserManagedGroup` model (user_id, group_name) |
| `server/handler/power_admin.go` | CRUD handler：列表/新增/删除 powerAdmin，分配分组 |
| `server/service/power_admin.go` | powerAdmin 业务逻辑：查询、分配、撤销分组 |
| `server/handler/power_admin_test.go` | handler 层测试 |
| `server/service/power_admin_test.go` | service 层测试 |
| `web/src/api/powerAdmin.ts` | 前端 API：CRUD powerAdmin + 分配分组 |
| `web/src/pages/settings/PowerAdminList.tsx` | 超级管理员管理页（表格 + 穿梭框弹框） |

### 修改文件
| 文件 | 改动 |
|------|------|
| `server/model/tenant.go` | 新增 `GroupName string` 字段，默认 `"default"` |
| `server/middleware/auth.go` | Claims 加 `ManagedGroups []string`；`SuperAdminTenantOverrideMiddleware` 加 powerAdmin 分支 |
| `server/handler/auth.go` | `LoginResponse` 加 `ManagedGroups`；Login/RefreshToken 查询并写入 managed_groups |
| `server/service/admin_statistics.go` | `GetGlobalStats` 加可选 `groupNames []string` 过滤参数 |
| `server/handler/admin_statistics.go` | `GetGlobal` 允许 powerAdmin 访问（用自己的分组过滤） |
| `server/database/database.go` | AutoMigrate 加 `UserManagedGroup` 和 Tenant 新字段 |
| `server/testutil/testutil.go` | AutoMigrate 同步加 `UserManagedGroup` |
| `server/database/seed.go` | 新增 `power_admin:manage` 权限码 |
| `server/router/router.go` | 注册 powerAdmin CRUD 路由；`/admin/statistics/global` 改为允许 powerAdmin |
| `web/src/store/auth.tsx` | 加 `managedGroups: string[]`、`isPowerAdmin` 派生值，login/restore 解析 |
| `web/src/api/statistics.ts` | `getGlobalStats` 加可选 `groups?: string[]` 参数 |
| `web/src/pages/statistics/StatsDashboard.tsx` | 全局总览 tab 对 `isPowerAdmin` 也显示 |
| `web/src/pages/statistics/components/GlobalStatsPanel.tsx` | 接收 `managedGroups` prop，过滤请求 |
| `web/src/pages/settings/TenantList.tsx` | 新增/编辑 Modal 加 `group_name` 字段（默认 default，autocomplete）|
| `web/src/api/tenant.ts` | `createTenant`/`updateTenant` 请求体加 `group_name` |
| `web/src/components/Layout.tsx` | 侧边栏加「超级管理员」菜单项（需 `power_admin:manage` 权限）|

---

## Task 1：Tenant 加 group_name 字段（后端）

**Files:**
- Modify: `server/model/tenant.go`
- Modify: `server/database/database.go`
- Modify: `server/testutil/testutil.go`

- [ ] **Step 1: 写失败测试**

新建文件 `server/model/tenant_group_test.go`：

```go
package model_test

import (
    "testing"
    "github.com/callmefisher/menzhen/server/testutil"
    "github.com/callmefisher/menzhen/server/model"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestTenantGroupName_DefaultIsDefault(t *testing.T) {
    db := testutil.SetupTestDB(t)

    tenant := model.Tenant{
        Name:   "测试诊所",
        Code:   "test001",
        Status: 1,
        // GroupName 不填，应默认为 "default"
    }
    require.NoError(t, db.Create(&tenant).Error)

    var loaded model.Tenant
    require.NoError(t, db.First(&loaded, tenant.ID).Error)
    assert.Equal(t, "default", loaded.GroupName)
}

func TestTenantGroupName_CanSetCustomGroup(t *testing.T) {
    db := testutil.SetupTestDB(t)

    tenant := model.Tenant{
        Name:      "华北诊所",
        Code:      "north001",
        Status:    1,
        GroupName: "华北分组",
    }
    require.NoError(t, db.Create(&tenant).Error)

    var loaded model.Tenant
    require.NoError(t, db.First(&loaded, tenant.ID).Error)
    assert.Equal(t, "华北分组", loaded.GroupName)
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && go test ./model/... -run TestTenantGroupName -v
```

预期：FAIL — `model.Tenant` 没有 `GroupName` 字段。

- [ ] **Step 3: 修改 Tenant model**

编辑 `server/model/tenant.go`，在 `CreatedAt` 之前添加一行：

```go
GroupName    string    `gorm:"column:group_name;type:varchar(100);not null;default:'default'" json:"group_name"`
```

完整字段列表（只展示变更位置）：

```go
type Tenant struct {
    ID           uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
    Name         string    `gorm:"column:name;type:varchar(100);not null" json:"name"`
    Code         string    `gorm:"column:code;type:varchar(50);uniqueIndex;not null" json:"code"`
    Status       int8      `gorm:"column:status;type:tinyint;default:1;not null;comment:1=enabled 0=disabled" json:"status"`
    GroupName    string    `gorm:"column:group_name;type:varchar(100);not null;default:'default'" json:"group_name"`
    // ... 其余字段不变 ...
    QueueEnabled              *bool `gorm:"column:queue_enabled;default:true" json:"queue_enabled"`
    // ... 省略其余字段，保持原样 ...
    CreatedAt    time.Time `json:"created_at"`
    Users []User `gorm:"foreignKey:TenantID" json:"users,omitempty"`
    Roles []Role `gorm:"foreignKey:TenantID" json:"roles,omitempty"`
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd server && go test ./model/... -run TestTenantGroupName -v
```

预期：PASS

- [ ] **Step 5: 确认编译通过**

```bash
cd server && go build ./...
```

预期：无错误

- [ ] **Step 6: Commit**

```bash
cd server
git add model/tenant.go model/tenant_group_test.go
git commit -m "feat: add group_name field to Tenant model, default 'default'"
```

---

## Task 2：UserManagedGroup model + AutoMigrate

**Files:**
- Create: `server/model/user_managed_group.go`
- Modify: `server/database/database.go`
- Modify: `server/testutil/testutil.go`

- [ ] **Step 1: 写失败测试**

新建 `server/model/user_managed_group_test.go`：

```go
package model_test

import (
    "testing"
    "github.com/callmefisher/menzhen/server/testutil"
    "github.com/callmefisher/menzhen/server/model"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestUserManagedGroup_CreateAndQuery(t *testing.T) {
    db := testutil.SetupTestDB(t)

    // 先创建 user
    tenant := model.Tenant{Name: "T1", Code: "t1", Status: 1}
    require.NoError(t, db.Create(&tenant).Error)
    user := model.User{TenantID: tenant.ID, Username: "pa1", PasswordHash: "x", RealName: "PA", Status: 1}
    require.NoError(t, db.Create(&user).Error)

    // 创建 managed group 记录
    mg := model.UserManagedGroup{UserID: user.ID, GroupName: "华北分组"}
    require.NoError(t, db.Create(&mg).Error)

    var groups []model.UserManagedGroup
    require.NoError(t, db.Where("user_id = ?", user.ID).Find(&groups).Error)
    require.Len(t, groups, 1)
    assert.Equal(t, "华北分组", groups[0].GroupName)
}

func TestUserManagedGroup_UniqueConstraint(t *testing.T) {
    db := testutil.SetupTestDB(t)

    tenant := model.Tenant{Name: "T2", Code: "t2", Status: 1}
    require.NoError(t, db.Create(&tenant).Error)
    user := model.User{TenantID: tenant.ID, Username: "pa2", PasswordHash: "x", RealName: "PA2", Status: 1}
    require.NoError(t, db.Create(&user).Error)

    mg1 := model.UserManagedGroup{UserID: user.ID, GroupName: "华南分组"}
    require.NoError(t, db.Create(&mg1).Error)

    // 重复插入同一 (user_id, group_name) 应报错
    mg2 := model.UserManagedGroup{UserID: user.ID, GroupName: "华南分组"}
    err := db.Create(&mg2).Error
    assert.Error(t, err, "duplicate (user_id, group_name) should fail")
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && go test ./model/... -run TestUserManagedGroup -v
```

预期：FAIL — `model.UserManagedGroup` 未定义。

- [ ] **Step 3: 创建 model 文件**

新建 `server/model/user_managed_group.go`：

```go
package model

// UserManagedGroup records which tenant groups a powerAdmin user is authorized to manage.
// One row per (user, group) pair — i.e. a user with 3 groups has 3 rows.
type UserManagedGroup struct {
    ID        uint64 `gorm:"primaryKey;autoIncrement" json:"id"`
    UserID    uint64 `gorm:"column:user_id;not null;index;uniqueIndex:idx_user_group" json:"user_id"`
    GroupName string `gorm:"column:group_name;type:varchar(100);not null;uniqueIndex:idx_user_group" json:"group_name"`
}

func (UserManagedGroup) TableName() string {
    return "user_managed_groups"
}
```

- [ ] **Step 4: 在 database.go AutoMigrate 中添加**

在 `server/database/database.go` 的 `db.AutoMigrate(...)` 调用中，在 `&model.PatientPortalConfig{}` 之后追加：

```go
&model.UserManagedGroup{},
```

- [ ] **Step 5: 在 testutil.go AutoMigrate 中添加**

在 `server/testutil/testutil.go` 的 `testDB.AutoMigrate(...)` 调用中，在 `&model.PatientPortalConfig{}` 之后追加：

```go
&model.UserManagedGroup{},
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd server && go test ./model/... -run TestUserManagedGroup -v
```

预期：PASS

- [ ] **Step 7: Commit**

```bash
cd server
git add model/user_managed_group.go model/user_managed_group_test.go \
        database/database.go testutil/testutil.go
git commit -m "feat: add UserManagedGroup model for powerAdmin group authorization"
```

---

## Task 3：seed.go 新增 power_admin:manage 权限码

**Files:**
- Modify: `server/database/seed.go`

- [ ] **Step 1: 在 seedPermissions 的 permissions 切片末尾追加**

在 `server/database/seed.go` 中 `permissions := []model.Permission{...}` 的最后一项 `appointment:checkin` 之后追加：

```go
{Code: "power_admin:manage", Name: "超级管理员管理", Description: "管理 powerAdmin 账号及其授权分组"},
```

- [ ] **Step 2: 编译验证**

```bash
cd server && go build ./...
```

预期：无错误

- [ ] **Step 3: Commit**

```bash
cd server
git add database/seed.go
git commit -m "feat: add power_admin:manage permission code"
```

---

## Task 4：PowerAdmin Service 层

**Files:**
- Create: `server/service/power_admin.go`
- Create: `server/service/power_admin_test.go`

- [ ] **Step 1: 写失败测试**

新建 `server/service/power_admin_test.go`：

```go
package service_test

import (
    "testing"
    "github.com/callmefisher/menzhen/server/model"
    "github.com/callmefisher/menzhen/server/service"
    "github.com/callmefisher/menzhen/server/testutil"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

// helper: create a tenant with group
func createTenantWithGroup(t *testing.T, db interface{ Create(interface{}) interface{ Error error } }, code, group string) model.Tenant {
    // Use gorm.DB directly via testutil
    return model.Tenant{}
}

func setupPAService(t *testing.T) (*service.PowerAdminService, interface{}) {
    db := testutil.SetupTestDB(t)
    return service.NewPowerAdminService(db), db
}

func TestPowerAdminService_AssignGroups(t *testing.T) {
    svc, dbRaw := setupPAService(t)
    db := dbRaw.(interface {
        Create(interface{}) interface{ Error error }
    })
    _ = db

    // Use gorm.DB properly
    import_db := testutil.SetupTestDB(t)
    svc2 := service.NewPowerAdminService(import_db)

    // Create tenant + user
    tenant := model.Tenant{Name: "T", Code: "tc1", Status: 1}
    require.NoError(t, import_db.Create(&tenant).Error)
    user := model.User{TenantID: tenant.ID, Username: "pa_test", PasswordHash: "x", RealName: "PA", Status: 1}
    require.NoError(t, import_db.Create(&user).Error)

    // Assign groups
    err := svc2.AssignGroups(user.ID, []string{"华北分组", "华南分组"})
    require.NoError(t, err)

    groups, err := svc2.GetManagedGroups(user.ID)
    require.NoError(t, err)
    assert.ElementsMatch(t, []string{"华北分组", "华南分组"}, groups)
}

func TestPowerAdminService_AssignGroups_Replace(t *testing.T) {
    db := testutil.SetupTestDB(t)
    svc := service.NewPowerAdminService(db)

    tenant := model.Tenant{Name: "T2", Code: "tc2", Status: 1}
    require.NoError(t, db.Create(&tenant).Error)
    user := model.User{TenantID: tenant.ID, Username: "pa_replace", PasswordHash: "x", RealName: "PA2", Status: 1}
    require.NoError(t, db.Create(&user).Error)

    require.NoError(t, svc.AssignGroups(user.ID, []string{"A", "B", "C"}))
    // Re-assign with different groups — should replace, not append
    require.NoError(t, svc.AssignGroups(user.ID, []string{"X", "Y"}))

    groups, err := svc.GetManagedGroups(user.ID)
    require.NoError(t, err)
    assert.ElementsMatch(t, []string{"X", "Y"}, groups)
}

func TestPowerAdminService_AssignGroups_Empty(t *testing.T) {
    db := testutil.SetupTestDB(t)
    svc := service.NewPowerAdminService(db)

    tenant := model.Tenant{Name: "T3", Code: "tc3", Status: 1}
    require.NoError(t, db.Create(&tenant).Error)
    user := model.User{TenantID: tenant.ID, Username: "pa_empty", PasswordHash: "x", RealName: "PA3", Status: 1}
    require.NoError(t, db.Create(&user).Error)

    require.NoError(t, svc.AssignGroups(user.ID, []string{"A"}))
    // Clear all
    require.NoError(t, svc.AssignGroups(user.ID, []string{}))

    groups, err := svc.GetManagedGroups(user.ID)
    require.NoError(t, err)
    assert.Empty(t, groups)
}

func TestPowerAdminService_ListPowerAdmins(t *testing.T) {
    db := testutil.SetupTestDB(t)
    svc := service.NewPowerAdminService(db)

    tenant := model.Tenant{Name: "T4", Code: "tc4", Status: 1}
    require.NoError(t, db.Create(&tenant).Error)
    u1 := model.User{TenantID: tenant.ID, Username: "pa1", PasswordHash: "x", RealName: "PA1", Status: 1}
    u2 := model.User{TenantID: tenant.ID, Username: "pa2", PasswordHash: "x", RealName: "PA2", Status: 0}
    require.NoError(t, db.Create(&u1).Error)
    require.NoError(t, db.Create(&u2).Error)

    require.NoError(t, svc.AssignGroups(u1.ID, []string{"华北"}))
    require.NoError(t, svc.AssignGroups(u2.ID, []string{"华南"}))

    list, err := svc.ListPowerAdmins()
    require.NoError(t, err)
    assert.Len(t, list, 2)
}

func TestPowerAdminService_GetAllGroups(t *testing.T) {
    db := testutil.SetupTestDB(t)
    svc := service.NewPowerAdminService(db)

    for i, code := range []string{"g1", "g2", "g3"} {
        g := []string{"华北", "华南", "西南"}[i]
        t := model.Tenant{Name: "T" + code, Code: code, Status: 1, GroupName: g}
        db.Create(&t)
    }
    // Also one "default"
    db.Create(&model.Tenant{Name: "T_def", Code: "tdef", Status: 1})

    groups, err := svc.GetAllGroups()
    require.NoError(t, err)
    assert.Contains(t, groups, "华北")
    assert.Contains(t, groups, "华南")
    assert.Contains(t, groups, "西南")
    assert.Contains(t, groups, "default")
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && go test ./service/... -run TestPowerAdminService -v
```

预期：FAIL — `service.PowerAdminService` 未定义。

- [ ] **Step 3: 实现 PowerAdminService**

新建 `server/service/power_admin.go`：

```go
package service

import (
    "fmt"

    "github.com/callmefisher/menzhen/server/model"
    "gorm.io/gorm"
)

// PowerAdminItem is returned by ListPowerAdmins.
type PowerAdminItem struct {
    UserID    uint64   `json:"user_id"`
    Username  string   `json:"username"`
    RealName  string   `json:"real_name"`
    Status    int8     `json:"status"`
    Groups    []string `json:"groups"`
    CreatedAt string   `json:"created_at"`
}

// PowerAdminService manages powerAdmin authorization.
type PowerAdminService struct {
    db *gorm.DB
}

// NewPowerAdminService creates a new PowerAdminService.
func NewPowerAdminService(db *gorm.DB) *PowerAdminService {
    return &PowerAdminService{db: db}
}

// GetManagedGroups returns all group names a user is authorized to manage.
func (s *PowerAdminService) GetManagedGroups(userID uint64) ([]string, error) {
    var records []model.UserManagedGroup
    if err := s.db.Where("user_id = ?", userID).Find(&records).Error; err != nil {
        return nil, fmt.Errorf("get managed groups: %w", err)
    }
    groups := make([]string, len(records))
    for i, r := range records {
        groups[i] = r.GroupName
    }
    return groups, nil
}

// AssignGroups replaces the full set of managed groups for a user (transaction).
// Passing an empty slice removes all groups.
func (s *PowerAdminService) AssignGroups(userID uint64, groups []string) error {
    return s.db.Transaction(func(tx *gorm.DB) error {
        if err := tx.Where("user_id = ?", userID).Delete(&model.UserManagedGroup{}).Error; err != nil {
            return fmt.Errorf("delete old groups: %w", err)
        }
        for _, g := range groups {
            mg := model.UserManagedGroup{UserID: userID, GroupName: g}
            if err := tx.Create(&mg).Error; err != nil {
                return fmt.Errorf("insert group %q: %w", g, err)
            }
        }
        // Bump token_version so JWT is refreshed on next request
        if err := tx.Model(&model.User{}).Where("id = ?", userID).
            UpdateColumn("token_version", gorm.Expr("token_version + 1")).Error; err != nil {
            return fmt.Errorf("bump token_version: %w", err)
        }
        return nil
    })
}

// ListPowerAdmins returns all users that have at least one managed group.
func (s *PowerAdminService) ListPowerAdmins() ([]PowerAdminItem, error) {
    // Get all user_ids that appear in user_managed_groups
    var records []model.UserManagedGroup
    if err := s.db.Find(&records).Error; err != nil {
        return nil, fmt.Errorf("list managed groups: %w", err)
    }

    // Build map: userID → groups
    groupsByUser := make(map[uint64][]string)
    userIDs := make([]uint64, 0)
    for _, r := range records {
        if _, exists := groupsByUser[r.UserID]; !exists {
            userIDs = append(userIDs, r.UserID)
        }
        groupsByUser[r.UserID] = append(groupsByUser[r.UserID], r.GroupName)
    }

    if len(userIDs) == 0 {
        return []PowerAdminItem{}, nil
    }

    var users []model.User
    if err := s.db.Where("id IN ?", userIDs).Find(&users).Error; err != nil {
        return nil, fmt.Errorf("list users: %w", err)
    }

    items := make([]PowerAdminItem, len(users))
    for i, u := range users {
        items[i] = PowerAdminItem{
            UserID:    u.ID,
            Username:  u.Username,
            RealName:  u.RealName,
            Status:    u.Status,
            Groups:    groupsByUser[u.ID],
            CreatedAt: u.CreatedAt.Format("2006-01-02 15:04:05"),
        }
    }
    return items, nil
}

// GetAllGroups returns all distinct group names from the tenants table.
func (s *PowerAdminService) GetAllGroups() ([]string, error) {
    var groups []string
    if err := s.db.Model(&model.Tenant{}).
        Distinct("group_name").
        Pluck("group_name", &groups).Error; err != nil {
        return nil, fmt.Errorf("get all groups: %w", err)
    }
    return groups, nil
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd server && go test ./service/... -run TestPowerAdminService -v
```

预期：PASS（4条测试）

- [ ] **Step 5: Commit**

```bash
cd server
git add service/power_admin.go service/power_admin_test.go
git commit -m "feat: add PowerAdminService (assign groups, list, get all groups)"
```

---

## Task 5：PowerAdmin Handler + 路由

**Files:**
- Create: `server/handler/power_admin.go`
- Create: `server/handler/power_admin_test.go`
- Modify: `server/router/router.go`

- [ ] **Step 1: 写失败测试**

新建 `server/handler/power_admin_test.go`：

```go
package handler_test

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/callmefisher/menzhen/server/handler"
    "github.com/callmefisher/menzhen/server/middleware"
    "github.com/callmefisher/menzhen/server/model"
    "github.com/callmefisher/menzhen/server/testutil"
    "github.com/gin-gonic/gin"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func setupPARouter(t *testing.T) (*gin.Engine, *testutil.TestContext) {
    db := testutil.SetupTestDB(t)
    tc := testutil.NewTestContext(t, db)
    h := handler.NewPowerAdminHandler(db)
    gin.SetMode(gin.TestMode)
    r := gin.New()
    g := r.Group("/api/v1/settings/power-admins")
    g.Use(func(c *gin.Context) {
        c.Set(middleware.CtxKeyUserID, tc.AdminUserID)
        c.Set(middleware.CtxKeyUsername, "admin")
        c.Next()
    })
    g.GET("", h.List)
    g.POST("", h.Create)
    g.DELETE("/:id", h.Delete)
    g.PUT("/:id/groups", h.AssignGroups)
    g.GET("/groups", h.ListAllGroups)
    return r, tc
}

func TestPowerAdminHandler_List_Empty(t *testing.T) {
    r, _ := setupPARouter(t)
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("GET", "/api/v1/settings/power-admins", nil)
    r.ServeHTTP(w, req)
    assert.Equal(t, 200, w.Code)
    var body map[string]interface{}
    require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
    assert.Equal(t, float64(0), body["code"])
}

func TestPowerAdminHandler_Create_And_AssignGroups(t *testing.T) {
    db := testutil.SetupTestDB(t)

    // Create a target user
    tenant := model.Tenant{Name: "T", Code: "htest1", Status: 1}
    require.NoError(t, db.Create(&tenant).Error)
    targetUser := model.User{TenantID: tenant.ID, Username: "pa_target", PasswordHash: "x", RealName: "PA", Status: 1}
    require.NoError(t, db.Create(&targetUser).Error)

    h := handler.NewPowerAdminHandler(db)
    gin.SetMode(gin.TestMode)
    r := gin.New()
    r.Use(func(c *gin.Context) {
        c.Set(middleware.CtxKeyUserID, uint64(1))
        c.Set(middleware.CtxKeyUsername, "admin")
        c.Next()
    })
    r.POST("/api/v1/settings/power-admins", h.Create)
    r.PUT("/api/v1/settings/power-admins/:id/groups", h.AssignGroups)
    r.GET("/api/v1/settings/power-admins", h.List)

    // Create powerAdmin
    body := map[string]interface{}{"user_id": targetUser.ID}
    b, _ := json.Marshal(body)
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("POST", "/api/v1/settings/power-admins", bytes.NewReader(b))
    req.Header.Set("Content-Type", "application/json")
    r.ServeHTTP(w, req)
    assert.Equal(t, 201, w.Code)

    // Assign groups
    groupBody := map[string]interface{}{"groups": []string{"华北分组", "华南分组"}}
    gb, _ := json.Marshal(groupBody)
    w2 := httptest.NewRecorder()
    idStr := fmt.Sprintf("/api/v1/settings/power-admins/%d/groups", targetUser.ID)
    req2, _ := http.NewRequest("PUT", idStr, bytes.NewReader(gb))
    req2.Header.Set("Content-Type", "application/json")
    r.ServeHTTP(w2, req2)
    assert.Equal(t, 200, w2.Code)

    // List should show 1 powerAdmin with 2 groups
    w3 := httptest.NewRecorder()
    req3, _ := http.NewRequest("GET", "/api/v1/settings/power-admins", nil)
    r.ServeHTTP(w3, req3)
    assert.Equal(t, 200, w3.Code)
    var listBody map[string]interface{}
    require.NoError(t, json.Unmarshal(w3.Body.Bytes(), &listBody))
    data := listBody["data"].([]interface{})
    assert.Len(t, data, 1)
    item := data[0].(map[string]interface{})
    assert.Equal(t, 2, len(item["groups"].([]interface{})))
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && go test ./handler/... -run TestPowerAdminHandler -v
```

预期：FAIL — `handler.PowerAdminHandler` 未定义。

- [ ] **Step 3: 实现 handler**

新建 `server/handler/power_admin.go`：

```go
package handler

import (
    "net/http"
    "strconv"

    "github.com/callmefisher/menzhen/server/service"
    "github.com/gin-gonic/gin"
    "gorm.io/gorm"
)

// PowerAdminHandler manages powerAdmin CRUD and group assignment.
type PowerAdminHandler struct {
    svc *service.PowerAdminService
}

// NewPowerAdminHandler creates a new PowerAdminHandler.
func NewPowerAdminHandler(db *gorm.DB) *PowerAdminHandler {
    return &PowerAdminHandler{svc: service.NewPowerAdminService(db)}
}

// List GET /api/v1/settings/power-admins
func (h *PowerAdminHandler) List(c *gin.Context) {
    items, err := h.svc.ListPowerAdmins()
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "查询失败"})
        return
    }
    c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": items})
}

// Create POST /api/v1/settings/power-admins
// Body: {"user_id": 123}
// Creates initial empty group assignment (caller must then call AssignGroups).
func (h *PowerAdminHandler) Create(c *gin.Context) {
    var req struct {
        UserID uint64 `json:"user_id" binding:"required"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
        return
    }
    // Assign empty groups to register the user as a powerAdmin
    if err := h.svc.AssignGroups(req.UserID, []string{}); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "创建失败"})
        return
    }
    c.JSON(http.StatusCreated, gin.H{"code": 0, "message": "success"})
}

// Delete DELETE /api/v1/settings/power-admins/:id
// Removes all group assignments for the user (revokes powerAdmin).
func (h *PowerAdminHandler) Delete(c *gin.Context) {
    idStr := c.Param("id")
    userID, err := strconv.ParseUint(idStr, 10, 64)
    if err != nil || userID == 0 {
        c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "无效的用户ID"})
        return
    }
    if err := h.svc.AssignGroups(userID, []string{}); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "删除失败"})
        return
    }
    c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success"})
}

// AssignGroups PUT /api/v1/settings/power-admins/:id/groups
// Body: {"groups": ["华北分组", "华南分组"]}
func (h *PowerAdminHandler) AssignGroups(c *gin.Context) {
    idStr := c.Param("id")
    userID, err := strconv.ParseUint(idStr, 10, 64)
    if err != nil || userID == 0 {
        c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "无效的用户ID"})
        return
    }
    var req struct {
        Groups []string `json:"groups" binding:"required"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数错误"})
        return
    }
    if err := h.svc.AssignGroups(userID, req.Groups); err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "分配失败"})
        return
    }
    c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success"})
}

// ListAllGroups GET /api/v1/settings/power-admins/groups
// Returns all distinct group names from tenants table (for autocomplete in UI).
func (h *PowerAdminHandler) ListAllGroups(c *gin.Context) {
    groups, err := h.svc.GetAllGroups()
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "查询失败"})
        return
    }
    c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": groups})
}
```

- [ ] **Step 4: 注册路由**

在 `server/router/router.go` 找到 `// Admin statistics routes` 块（约行 441）之前，添加：

```go
// PowerAdmin management routes (superAdmin only).
powerAdminHandler := handler.NewPowerAdminHandler(db)
powerAdmins := authenticated.Group("/settings/power-admins")
{
    powerAdmins.GET("", middleware.RequirePermission(db, "power_admin:manage"), powerAdminHandler.List)
    powerAdmins.POST("", middleware.RequirePermission(db, "power_admin:manage"), powerAdminHandler.Create)
    powerAdmins.DELETE("/:id", middleware.RequirePermission(db, "power_admin:manage"), powerAdminHandler.Delete)
    powerAdmins.PUT("/:id/groups", middleware.RequirePermission(db, "power_admin:manage"), powerAdminHandler.AssignGroups)
    powerAdmins.GET("/groups", middleware.RequirePermission(db, "power_admin:manage"), powerAdminHandler.ListAllGroups)
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd server && go test ./handler/... -run TestPowerAdminHandler -v
cd server && go build ./...
```

预期：PASS + 无编译错误

- [ ] **Step 6: Commit**

```bash
cd server
git add handler/power_admin.go handler/power_admin_test.go router/router.go
git commit -m "feat: add PowerAdmin handler and routes (CRUD + group assignment)"
```

---

## Task 6：JWT 携带 ManagedGroups + 中间件 powerAdmin 租户切换

**Files:**
- Modify: `server/middleware/auth.go`
- Modify: `server/handler/auth.go`
- Modify: `server/service/auth.go`（新增 GetManagedGroupsForUser）

- [ ] **Step 1: 写失败测试**

新建 `server/middleware/power_admin_middleware_test.go`：

```go
package middleware_test

import (
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/callmefisher/menzhen/server/middleware"
    "github.com/callmefisher/menzhen/server/model"
    "github.com/callmefisher/menzhen/server/testutil"
    "github.com/gin-gonic/gin"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestSuperAdminTenantOverride_PowerAdmin(t *testing.T) {
    db := testutil.SetupTestDB(t)
    gin.SetMode(gin.TestMode)

    // Create two tenants in same group
    t1 := model.Tenant{Name: "T1", Code: "ov1", Status: 1, GroupName: "华北分组"}
    t2 := model.Tenant{Name: "T2", Code: "ov2", Status: 1, GroupName: "华北分组"}
    require.NoError(t, db.Create(&t1).Error)
    require.NoError(t, db.Create(&t2).Error)

    // Create powerAdmin user belonging to t1
    paUser := model.User{TenantID: t1.ID, Username: "pa_mw", PasswordHash: "x", RealName: "PA", Status: 1}
    require.NoError(t, db.Create(&paUser).Error)
    // Give managed group
    require.NoError(t, db.Create(&model.UserManagedGroup{UserID: paUser.ID, GroupName: "华北分组"}).Error)

    r := gin.New()
    r.Use(func(c *gin.Context) {
        c.Set(middleware.CtxKeyUserID, paUser.ID)
        c.Set(middleware.CtxKeyUsername, paUser.Username)
        c.Set(middleware.CtxKeyTenantID, t1.ID)
        c.Set(middleware.CtxKeyManagedGroups, []string{"华北分组"})
        c.Next()
    })
    r.Use(middleware.SuperAdminTenantOverrideMiddleware(db))
    r.GET("/test", func(c *gin.Context) {
        tid := middleware.GetTenantID(c)
        c.JSON(200, gin.H{"tenant_id": tid})
    })

    // powerAdmin switching to t2 (same group) should succeed
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("GET", "/test?tenant_id="+fmt.Sprintf("%d", t2.ID), nil)
    r.ServeHTTP(w, req)
    assert.Equal(t, 200, w.Code)

    // powerAdmin switching to a tenant NOT in their group should be 403
    t3 := model.Tenant{Name: "T3", Code: "ov3", Status: 1, GroupName: "华南分组"}
    require.NoError(t, db.Create(&t3).Error)
    w2 := httptest.NewRecorder()
    req2, _ := http.NewRequest("GET", "/test?tenant_id="+fmt.Sprintf("%d", t3.ID), nil)
    r.ServeHTTP(w2, req2)
    assert.Equal(t, 403, w2.Code)
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && go test ./middleware/... -run TestSuperAdminTenantOverride_PowerAdmin -v
```

预期：FAIL — `CtxKeyManagedGroups` 未定义。

- [ ] **Step 3: 修改 middleware/auth.go**

**3a.** 在常量块中追加：
```go
CtxKeyManagedGroups = "managed_groups"
```

**3b.** Claims 加字段（在 `TokenVersion` 之后）：
```go
ManagedGroups []string `json:"managed_groups,omitempty"`
```

**3c.** `GenerateToken` 签名变更（加 `managedGroups []string` 参数）：
```go
func GenerateToken(userID uint64, tenantID uint64, username string, tokenVersion int64, managedGroups []string, secret string) (string, error) {
    claims := Claims{
        UserID:        userID,
        TenantID:      tenantID,
        Username:      username,
        TokenVersion:  tokenVersion,
        ManagedGroups: managedGroups,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString([]byte(secret))
}
```

**3d.** `AuthMiddleware` 中解析完 claims 后，在 `c.Set(CtxKeyTokenVersion, ...)` 之后追加：
```go
c.Set(CtxKeyManagedGroups, claims.ManagedGroups)
```

**3e.** 新增 helper 函数（文件末尾）：
```go
// GetManagedGroups extracts the powerAdmin's managed group names from context.
func GetManagedGroups(c *gin.Context) []string {
    v, _ := c.Get(CtxKeyManagedGroups)
    groups, _ := v.([]string)
    return groups
}
```

**3f.** 修改 `SuperAdminTenantOverrideMiddleware`，在 `if GetUsername(c) != "admin"` 的 else 分支后添加 powerAdmin 分支：

```go
func SuperAdminTenantOverrideMiddleware(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        username := GetUsername(c)

        // superAdmin: can switch to any tenant
        if username == "admin" {
            tid := c.Query("tenant_id")
            if tid == "" {
                c.Next()
                return
            }
            parsed, err := strconv.ParseUint(tid, 10, 64)
            if err != nil || parsed == 0 {
                c.Next()
                return
            }
            var count int64
            if err := db.Model(&model.Tenant{}).Where("id = ?", parsed).Count(&count).Error; err != nil || count == 0 {
                c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"code": 404, "message": "诊所不存在"})
                return
            }
            c.Set(CtxKeyTenantID, parsed)
            c.Next()
            return
        }

        // powerAdmin: can switch only within their managed groups
        managedGroups := GetManagedGroups(c)
        if len(managedGroups) == 0 {
            c.Next()
            return
        }
        tid := c.Query("tenant_id")
        if tid == "" {
            c.Next()
            return
        }
        parsed, err := strconv.ParseUint(tid, 10, 64)
        if err != nil || parsed == 0 {
            c.Next()
            return
        }
        // Verify the target tenant belongs to one of the managed groups
        var tenant model.Tenant
        if err := db.Select("id, group_name").First(&tenant, parsed).Error; err != nil {
            c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"code": 404, "message": "诊所不存在"})
            return
        }
        allowed := false
        for _, g := range managedGroups {
            if g == tenant.GroupName {
                allowed = true
                break
            }
        }
        if !allowed {
            c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "message": "无权访问该诊所"})
            return
        }
        c.Set(CtxKeyTenantID, parsed)
        c.Next()
    }
}
```

- [ ] **Step 4: 修改所有 GenerateToken 调用（auth handler）**

在 `server/handler/auth.go` 中，所有调用 `middleware.GenerateToken(...)` 的地方，都需要在 `user.TokenVersion` 之后插入 `managedGroups` 参数。

**Login handler（约行 113）：**

在 `Login` 函数中，在 `token, err := middleware.GenerateToken(...)` 之前，先获取 managedGroups：

```go
// Fetch managed groups for powerAdmin
managedGroups, _ := h.powerAdminSvc.GetManagedGroupsForUser(user.ID)

token, err := middleware.GenerateToken(user.ID, user.TenantID, user.Username, user.TokenVersion, managedGroups, h.jwtSecret)
```

**同步修改 `LoginResponse` struct（在 `Permissions` 之后加字段）：**
```go
type LoginResponse struct {
    Token         string       `json:"token"`
    User          UserBriefDTO `json:"user"`
    Permissions   []string     `json:"permissions"`
    ManagedGroups []string     `json:"managed_groups"`
}
```

**Login 的 `c.JSON` 响应（约行 135）加 ManagedGroups：**
```go
c.JSON(http.StatusOK, gin.H{
    "code":    0,
    "message": "success",
    "data": LoginResponse{
        Token: token,
        User: UserBriefDTO{...},
        Permissions:   permissions,
        ManagedGroups: managedGroups,
    },
})
```

**RefreshToken handler（约行 347）同样修改：**
```go
managedGroups, _ := h.powerAdminSvc.GetManagedGroupsForUser(user.ID)
token, err := middleware.GenerateToken(user.ID, user.TenantID, user.Username, user.TokenVersion, managedGroups, h.jwtSecret)
// ... c.JSON 中同样包含 ManagedGroups: managedGroups
```

**AuthHandler struct 加字段：**
```go
type AuthHandler struct {
    authService    *service.AuthService
    powerAdminSvc  *service.PowerAdminService
    jwtSecret      string
    db             *gorm.DB
}

func NewAuthHandler(authService *service.AuthService, jwtSecret string, db *gorm.DB) *AuthHandler {
    return &AuthHandler{
        authService:   authService,
        powerAdminSvc: service.NewPowerAdminService(db),
        jwtSecret:     jwtSecret,
        db:            db,
    }
}
```

**在 PowerAdminService 新增 GetManagedGroupsForUser 函数（`server/service/power_admin.go` 中已有 GetManagedGroups，这是别名）：**

在 `power_admin.go` 末尾追加：
```go
// GetManagedGroupsForUser is an alias used by auth handler.
// Returns empty slice (not nil) on any error, so JWT always embeds a valid array.
func (s *PowerAdminService) GetManagedGroupsForUser(userID uint64) ([]string, error) {
    groups, err := s.GetManagedGroups(userID)
    if err != nil || groups == nil {
        return []string{}, err
    }
    return groups, nil
}
```

- [ ] **Step 5: 编译并运行测试**

```bash
cd server && go build ./...
cd server && go test ./middleware/... -run TestSuperAdminTenantOverride -v
cd server && go test ./handler/... -run TestAuth -v
```

预期：全部 PASS，无编译错误

- [ ] **Step 6: Commit**

```bash
cd server
git add middleware/auth.go middleware/power_admin_middleware_test.go \
        handler/auth.go service/power_admin.go
git commit -m "feat: embed ManagedGroups in JWT; powerAdmin tenant-switch middleware"
```

---

## Task 7：全局统计支持 powerAdmin 过滤

**Files:**
- Modify: `server/service/admin_statistics.go`
- Modify: `server/handler/admin_statistics.go`

- [ ] **Step 1: 写失败测试**

新建 `server/service/admin_statistics_group_test.go`：

```go
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

func TestGetGlobalStats_FilteredByGroups(t *testing.T) {
    db := testutil.SetupTestDB(t)

    // Create tenants in different groups
    t1 := model.Tenant{Name: "北京诊所", Code: "bj1", Status: 1, GroupName: "华北分组"}
    t2 := model.Tenant{Name: "上海诊所", Code: "sh1", Status: 1, GroupName: "华东分组"}
    require.NoError(t, db.Create(&t1).Error)
    require.NoError(t, db.Create(&t2).Error)

    // Insert DailyStats for both tenants
    day := time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)
    require.NoError(t, db.Create(&model.DailyStats{
        TenantID: t1.ID, StatDate: day,
        Revenue: 1000, RecordCount: 10,
        NewPatientCount: 3, ReturningPatientCount: 7,
    }).Error)
    require.NoError(t, db.Create(&model.DailyStats{
        TenantID: t2.ID, StatDate: day,
        Revenue: 2000, RecordCount: 20,
        NewPatientCount: 5, ReturningPatientCount: 15,
    }).Error)

    svc := service.NewAdminStatisticsService(db)

    // Unfiltered: should see both
    all, err := svc.GetGlobalStats(day, day, 1, 50, nil)
    require.NoError(t, err)
    assert.Equal(t, 2, all.Total)

    // Filtered by 华北分组: only t1
    filtered, err := svc.GetGlobalStats(day, day, 1, 50, []string{"华北分组"})
    require.NoError(t, err)
    assert.Equal(t, 1, filtered.Total)
    assert.Equal(t, "北京诊所", filtered.Tenants[0].TenantName)
    assert.Equal(t, float64(1000), filtered.Summary.TotalRevenue)
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && go test ./service/... -run TestGetGlobalStats_FilteredByGroups -v
```

预期：FAIL — `GetGlobalStats` 签名不匹配（目前没有 groups 参数）。

- [ ] **Step 3: 修改 AdminStatisticsService**

在 `server/service/admin_statistics.go` 中：

**修改 `GetGlobalStats` 签名**（加 `groupNames []string` 最后一个参数）：

```go
func (s *AdminStatisticsService) GetGlobalStats(startDate, endDate time.Time, page, size int, groupNames []string) (*GlobalStatsResult, error) {
```

**缓存 key 变更**（加入 groups 信息）：
```go
groupKey := strings.Join(groupNames, ",")
cacheKey := fmt.Sprintf("%s:%s:%d:%d:%s",
    startDate.Format("2006-01-02"), endDate.Format("2006-01-02"), page, size, groupKey)
```

**在两个查询（Count + Scan）的 Where 链后，条件性 Join tenants 过滤**：

Count 查询：
```go
q := s.db.Model(&model.DailyStats{}).
    Where("stat_date >= ? AND stat_date <= ?", startDate, endDate)
if len(groupNames) > 0 {
    q = q.Joins("JOIN tenants ON tenants.id = daily_stats.tenant_id").
        Where("tenants.group_name IN ?", groupNames)
}
var totalCount int64
if err := q.Distinct("daily_stats.tenant_id").Count(&totalCount).Error; err != nil {
    return nil, fmt.Errorf("count tenants: %w", err)
}
```

Scan 查询（tenants 列表）：
```go
q2 := s.db.Model(&model.DailyStats{}).
    Select("daily_stats.tenant_id, tenants.name AS tenant_name, "+
        "SUM(daily_stats.revenue) AS revenue, "+
        "SUM(daily_stats.record_count) AS records, "+
        "SUM(daily_stats.new_patient_count + daily_stats.returning_patient_count) AS patients").
    Joins("JOIN tenants ON tenants.id = daily_stats.tenant_id").
    Where("daily_stats.stat_date >= ? AND daily_stats.stat_date <= ?", startDate, endDate)
if len(groupNames) > 0 {
    q2 = q2.Where("tenants.group_name IN ?", groupNames)
}
var rows []row
if err := q2.Group("daily_stats.tenant_id, tenants.name").
    Order("revenue DESC").
    Limit(size).Offset(offset).
    Scan(&rows).Error; err != nil {
    return nil, fmt.Errorf("query tenants: %w", err)
}
```

Totals 查询：
```go
q3 := s.db.Model(&model.DailyStats{}).
    Select("SUM(revenue) AS total_revenue, SUM(record_count) AS total_records, "+
        "SUM(new_patient_count + returning_patient_count) AS total_patients").
    Where("stat_date >= ? AND stat_date <= ?", startDate, endDate)
if len(groupNames) > 0 {
    q3 = q3.Joins("JOIN tenants ON tenants.id = daily_stats.tenant_id").
        Where("tenants.group_name IN ?", groupNames)
}
var totals totalRow
if err := q3.Scan(&totals).Error; err != nil {
    return nil, fmt.Errorf("query totals: %w", err)
}
```

记得在文件顶部 import 中添加 `"strings"`。

- [ ] **Step 4: 修改 AdminStatisticsHandler.GetGlobal**

在 `server/handler/admin_statistics.go` 中：

```go
func (h *AdminStatisticsHandler) GetGlobal(c *gin.Context) {
    userID := middleware.GetUserID(c)

    var groupNames []string
    if service.IsProtectedAdminAccount(h.db, userID) {
        // superAdmin: no filter, sees all tenants
        groupNames = nil
    } else {
        // Check if powerAdmin
        managedGroups := middleware.GetManagedGroups(c)
        if len(managedGroups) == 0 {
            c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "仅超级管理员或授权管理员可访问全局统计"})
            return
        }
        groupNames = managedGroups
    }

    // ... 参数解析不变 ...

    result, err := h.svc.GetGlobalStats(startDate, endDate, page, size, groupNames)
    // ... 其余不变 ...
}
```

同时修改路由 `router.go` 中的权限：将 `/admin/statistics/global` 路由的 `RequirePermission` 改为允许 `user:manage` OR `power_admin:manage`（或移除中间件，在 handler 内部判断）。

最简单的方式：去掉 `middleware.RequirePermission(db, "user:manage")`，仅在 handler 内部判断：

```go
// router.go 中
adminStats.GET("/global", adminStatsHandler.GetGlobal)
```

（handler 内部已有 superAdmin 和 powerAdmin 的双重检查）

- [ ] **Step 5: 运行测试**

```bash
cd server && go test ./service/... -run TestGetGlobalStats -v
cd server && go build ./...
```

预期：PASS + 无编译错误

- [ ] **Step 6: Commit**

```bash
cd server
git add service/admin_statistics.go service/admin_statistics_group_test.go \
        handler/admin_statistics.go router/router.go
git commit -m "feat: filter global stats by managed groups for powerAdmin"
```

---

## Task 8：Tenant 新增/编辑 API 支持 group_name

**Files:**
- Modify: `server/handler/tenant.go`（找到 createTenant / updateTenant 相关 handler）

- [ ] **Step 1: 找到 tenant handler 文件**

```bash
ls server/handler/tenant*.go
```

- [ ] **Step 2: 修改创建/更新 tenant 的请求 struct，加 GroupName 字段**

找到 `CreateTenantRequest`（或等效命名），加字段：

```go
GroupName string `json:"group_name" binding:"max=100"`
```

在 handler 创建 `model.Tenant` 时，赋值：
```go
tenant := model.Tenant{
    Name:      req.Name,
    Code:      req.Code,
    GroupName: req.GroupName,
}
if tenant.GroupName == "" {
    tenant.GroupName = "default"
}
```

编辑时同样更新 GroupName 字段。

- [ ] **Step 3: 编译验证**

```bash
cd server && go build ./...
```

- [ ] **Step 4: Commit**

```bash
cd server
git add handler/tenant.go
git commit -m "feat: support group_name in tenant create/update API"
```

---

## Task 9：全量后端测试

- [ ] **Step 1: 运行所有后端测试**

```bash
cd server && go test ./... -v 2>&1 | tail -50
```

预期：全部 PASS，无 FAIL

- [ ] **Step 2: 编译确认**

```bash
cd server && go build ./...
```

- [ ] **Step 3: 若有失败，排查并修复，再次运行直到全绿**

---

## Task 10：前端 — auth store 加 managedGroups + isPowerAdmin

**Files:**
- Modify: `web/src/store/auth.tsx`

- [ ] **Step 1: 写失败测试**

新建 `web/src/store/__tests__/auth.test.tsx`（或追加到已有文件）：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, useAuth } from '../auth'
import * as authApi from '../../api/auth'

describe('isPowerAdmin', () => {
  it('should be false when managedGroups is empty', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      data: {
        token: 'tok',
        user: { id: 1, username: 'lisi', real_name: 'LS', tenant_id: 1 },
        permissions: ['user:manage'],
        managed_groups: [],
      },
    } as never)

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    })
    await act(async () => {
      await result.current.login('lisi', 'pass')
    })
    expect(result.current.isPowerAdmin).toBe(false)
  })

  it('should be true when managedGroups is non-empty and not superAdmin', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({
      data: {
        token: 'tok',
        user: { id: 2, username: 'wangwu', real_name: 'WW', tenant_id: 1 },
        permissions: [],
        managed_groups: ['华北分组', '华南分组'],
      },
    } as never)

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    })
    await act(async () => {
      await result.current.login('wangwu', 'pass')
    })
    expect(result.current.isPowerAdmin).toBe(true)
    expect(result.current.managedGroups).toEqual(['华北分组', '华南分组'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd web && npx vitest run src/store/__tests__/auth.test.tsx
```

预期：FAIL — `isPowerAdmin`、`managedGroups` 不存在。

- [ ] **Step 3: 修改 auth.tsx**

**AuthState 加字段：**
```typescript
interface AuthState {
  user: User | null;
  permissions: string[];
  token: string | null;
  loading: boolean;
  queueEnabled: boolean;
  appointmentEnabled: boolean;
  managedGroups: string[];   // NEW
}
```

**AuthContextValue 加字段：**
```typescript
interface AuthContextValue extends AuthState {
  // ...已有字段不变...
  isPowerAdmin: boolean;   // NEW: managedGroups.length > 0 && !isSuperAdmin
}
```

**useState 初始值加 `managedGroups: []`：**
```typescript
const [state, setState] = useState<AuthState>({
  // ...
  managedGroups: [],
})
```

**login callback 中，解析 managed_groups：**
```typescript
const body = res as unknown as {
  data: { token: string; user: User; permissions: string[]; managed_groups: string[] };
};
// ...
setState({
  // ...
  managedGroups: body.data.managed_groups || [],
})
```

**getMe 恢复 session 时（useEffect 内）**，`/auth/me` 接口若返回了 managed_groups，也需要解析（如果 /me 不返回，则在 RefreshToken 时会更新）。由于 `/auth/me` 目前不返回 managed_groups，先从 login response 和 refresh response 恢复：

在 useEffect 中，解析 getMe 返回：
```typescript
// getMe 目前返回 MeResponse，不含 managed_groups
// managedGroups 只能从存储的 token 中恢复，或在 refresh 时更新
// 简单方案：getMe 后调用一次 refreshToken 来获取最新 managed_groups
// （TokenVersionMiddleware 不会阻止，因为版本一致）
// 实际上最简单：在 auth handler 的 Me 接口也返回 managed_groups
```

**最简方案**：修改后端 `Me` handler（`server/handler/auth.go`）的 `MeResponse` 也携带 `ManagedGroups`，并在 Me handler 中查询：

```go
// MeResponse
type MeResponse struct {
    User          UserBriefDTO `json:"user"`
    Permissions   []string     `json:"permissions"`
    ManagedGroups []string     `json:"managed_groups"`
}

// Me handler，在 c.JSON 之前：
managedGroups, _ := h.powerAdminSvc.GetManagedGroupsForUser(user.ID)

c.JSON(http.StatusOK, gin.H{
    "code":    0,
    "message": "success",
    "data": MeResponse{
        User:          UserBriefDTO{...},
        Permissions:   permissions,
        ManagedGroups: managedGroups,
    },
})
```

然后前端 `useEffect` 的 getMe 解析：
```typescript
const body = res as unknown as {
  data: { user: User; permissions: string[]; managed_groups: string[] };
};
setState(prev => ({
  ...prev,
  user: body.data.user,
  permissions: body.data.permissions || [],
  managedGroups: body.data.managed_groups || [],
  loading: false,
}))
```

**派生值：**
```typescript
const isGlobalAdmin = state.permissions.includes('user:manage');
const isSuperAdmin = state.user?.username === 'admin' && isGlobalAdmin;
const isPowerAdmin = (state.managedGroups?.length ?? 0) > 0 && !isSuperAdmin;  // NEW
```

**Provider value 加 isPowerAdmin：**
```typescript
<AuthContext.Provider value={{
  ...state,
  login, logout, hasPermission,
  isGlobalAdmin, isSuperAdmin, isPowerAdmin,  // NEW
  fetchQueueEnabled, fetchAppointmentEnabled,
}}>
```

**logout 清空 managedGroups：**
```typescript
setState({
  // ...
  managedGroups: [],
})
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd web && npx vitest run src/store/__tests__/auth.test.tsx
```

预期：PASS

- [ ] **Step 5: Commit**

```bash
cd web
git add src/store/auth.tsx src/store/__tests__/auth.test.tsx
git commit -m "feat: add managedGroups and isPowerAdmin to auth store"
```

---

## Task 11：前端 — 全局统计支持 managedGroups 过滤

**Files:**
- Modify: `web/src/api/statistics.ts`
- Modify: `web/src/pages/statistics/components/GlobalStatsPanel.tsx`
- Modify: `web/src/pages/statistics/StatsDashboard.tsx`

- [ ] **Step 1: 修改 getGlobalStats API**

在 `web/src/api/statistics.ts` 中，修改 `getGlobalStats`：

```typescript
export function getGlobalStats(
  startDate: string,
  endDate: string,
  page = 1,
  size = 50,
  groups?: string[],
) {
  return request.get<{ code: number; data: GlobalStatsData }>(
    '/admin/statistics/global',
    {
      params: {
        start_date: startDate,
        end_date: endDate,
        page,
        size,
        ...(groups && groups.length > 0 ? { groups: groups.join(',') } : {}),
      },
    },
  );
}
```

**注意**：后端 `GetGlobal` handler 需要解析 `groups` query 参数（逗号分隔字符串）。在 `server/handler/admin_statistics.go` 的 powerAdmin 分支中，`managedGroups` 已从 JWT context 取出，不需要前端传 groups 参数——前端传 groups 是冗余的。因此前端**不需要**传 groups 参数，后端从 JWT context 自动识别。

修改 `getGlobalStats` 去掉 groups 参数，保持现有签名即可：

```typescript
// 不需要改 getGlobalStats 签名
// 后端从 JWT 的 managed_groups 自动判断
```

- [ ] **Step 2: 修改 GlobalStatsPanel — 增加 info banner**

在 `web/src/pages/statistics/components/GlobalStatsPanel.tsx` 中，在组件顶部获取 auth 信息：

```typescript
import { useAuth } from '../../../store/auth';

// 在 GlobalStatsPanel 组件内：
const { isPowerAdmin, managedGroups } = useAuth();
```

在数据区域顶部，当 `isPowerAdmin` 为 true 时显示 banner：

```typescript
{isPowerAdmin && (
  <Alert
    type="info"
    showIcon
    style={{ marginBottom: 16 }}
    message={`当前显示您管理的 ${managedGroups.length} 个分组的汇总数据（${managedGroups.join('、')}）`}
  />
)}
```

- [ ] **Step 3: 修改 StatsDashboard — isPowerAdmin 也显示全局总览 tab**

在 `web/src/pages/statistics/StatsDashboard.tsx` 中：

```typescript
const { isSuperAdmin, isPowerAdmin } = useAuth();

// tabItems 中：
...((isSuperAdmin || isPowerAdmin) ? [{
  key: 'global',
  label: (
    <span>
      全局总览{' '}
      {isSuperAdmin && (
        <span style={{ display: 'inline-block', background: '#ff4d4f', color: '#fff', fontSize: 9, borderRadius: 8, padding: '1px 4px', marginLeft: 2, verticalAlign: 'middle' }}>
          Admin
        </span>
      )}
    </span>
  ),
  children: (
    <GlobalStatsPanel
      startDate={startDateStr}
      endDate={endDateStr}
      onViewDetail={handleViewDetail}
    />
  ),
}] : []),
```

- [ ] **Step 4: 编译验证**

```bash
cd web && npm run build 2>&1 | tail -20
```

预期：无 TypeScript 错误

- [ ] **Step 5: Commit**

```bash
cd web
git add src/api/statistics.ts \
        src/pages/statistics/components/GlobalStatsPanel.tsx \
        src/pages/statistics/StatsDashboard.tsx
git commit -m "feat: show global stats tab for powerAdmin with managed-group banner"
```

---

## Task 12：前端 — PowerAdminList 页面

**Files:**
- Create: `web/src/api/powerAdmin.ts`
- Create: `web/src/pages/settings/PowerAdminList.tsx`
- Modify: `web/src/components/Layout.tsx`

- [ ] **Step 1: 新建 API 文件**

新建 `web/src/api/powerAdmin.ts`：

```typescript
import request from '../utils/request';

export interface PowerAdminItem {
  user_id: number;
  username: string;
  real_name: string;
  status: number;
  groups: string[];
  created_at: string;
}

export function listPowerAdmins() {
  return request.get<{ code: number; data: PowerAdminItem[] }>(
    '/settings/power-admins',
  );
}

export interface CreatePowerAdminRequest {
  user_id: number;
}

export function createPowerAdmin(data: CreatePowerAdminRequest) {
  return request.post('/settings/power-admins', data);
}

export function deletePowerAdmin(userId: number) {
  return request.delete(`/settings/power-admins/${userId}`);
}

export function assignPowerAdminGroups(userId: number, groups: string[]) {
  return request.put(`/settings/power-admins/${userId}/groups`, { groups });
}

export function listAllGroups() {
  return request.get<{ code: number; data: string[] }>(
    '/settings/power-admins/groups',
  );
}
```

- [ ] **Step 2: 创建 PowerAdminList 页面**

新建 `web/src/pages/settings/PowerAdminList.tsx`：

```typescript
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table, Button, Space, Popconfirm, message, Card,
  Modal, Form, Select, Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  listPowerAdmins, createPowerAdmin, deletePowerAdmin,
  assignPowerAdminGroups, listAllGroups, type PowerAdminItem,
} from '../../api/powerAdmin';
import { listUsers } from '../../api/user'; // 已有的用户列表 API

export default function PowerAdminList() {
  const [data, setData] = useState<PowerAdminItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [allGroups, setAllGroups] = useState<string[]>([]);

  // Create modal
  const [createVisible, setCreateVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [createLoading, setCreateLoading] = useState(false);
  const [userOptions, setUserOptions] = useState<{ label: string; value: number }[]>([]);

  // Assign groups modal
  const [assignVisible, setAssignVisible] = useState(false);
  const [assignTarget, setAssignTarget] = useState<PowerAdminItem | null>(null);
  const [assignForm] = Form.useForm();
  const [assignLoading, setAssignLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listPowerAdmins();
      const body = res as unknown as { code: number; data: PowerAdminItem[] };
      setData(body.data || []);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listAllGroups();
      const body = res as unknown as { code: number; data: string[] };
      setAllGroups(body.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchData();
    fetchGroups();
  }, [fetchData, fetchGroups]);

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreateLoading(true);
      await createPowerAdmin({ user_id: values.user_id });
      message.success('创建成功，请分配授权分组');
      setCreateVisible(false);
      createForm.resetFields();
      fetchData();
    } catch { /* validation or API error */ } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async (userId: number) => {
    try {
      await deletePowerAdmin(userId);
      message.success('已撤销超级管理员权限');
      fetchData();
    } catch { /* handled */ }
  };

  const openAssign = (record: PowerAdminItem) => {
    setAssignTarget(record);
    assignForm.setFieldsValue({ groups: record.groups });
    setAssignVisible(true);
  };

  const handleAssign = async () => {
    if (!assignTarget) return;
    try {
      const values = await assignForm.validateFields();
      setAssignLoading(true);
      await assignPowerAdminGroups(assignTarget.user_id, values.groups || []);
      message.success('分配成功');
      setAssignVisible(false);
      fetchData();
    } catch { /* validation or API error */ } finally {
      setAssignLoading(false);
    }
  };

  const columns = useMemo<ColumnsType<PowerAdminItem>>(() => [
    {
      title: '用户名 / 姓名',
      key: 'user',
      render: (_, record) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: record.status === 1 ? '#52c41a' : '#ff4d4f',
              boxShadow: record.status === 1
                ? '0 0 0 3px rgba(82,196,26,.15)'
                : '0 0 0 3px rgba(255,77,79,.12)',
              flexShrink: 0,
            }}
          />
          <span>
            <strong style={{ color: record.status !== 1 ? '#ff4d4f' : undefined }}>
              {record.username}
            </strong>
            <span style={{ color: '#999', fontSize: 12, marginLeft: 5 }}>
              {record.real_name}
            </span>
            {record.status !== 1 && (
              <span style={{ fontSize: 11, color: '#ff4d4f', background: '#fff2f0', padding: '0 5px', borderRadius: 3, marginLeft: 4 }}>
                已禁用
              </span>
            )}
          </span>
        </span>
      ),
    },
    {
      title: '授权分组',
      key: 'groups',
      render: (_, record) => (
        record.groups.length === 0
          ? <Tag color="default">暂未分配</Tag>
          : (
            <span>
              {record.groups.map(g => <Tag key={g} color="purple">{g}</Tag>)}
            </span>
          )
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openAssign(record)}>
            ⊞ 分配分组
          </Button>
          <Popconfirm
            title="确定撤销此用户的超级管理员权限？"
            onConfirm={() => handleDelete(record.user_id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>✕ 删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], []);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button
          type="primary"
          onClick={() => {
            createForm.resetFields();
            setCreateVisible(true);
          }}
        >
          ＋ 新增管理员
        </Button>
      </div>

      <Table
        rowKey="user_id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={false}
      />

      {/* Create Modal */}
      <Modal
        title="新增超级管理员"
        open={createVisible}
        onOk={handleCreate}
        onCancel={() => { setCreateVisible(false); createForm.resetFields(); }}
        confirmLoading={createLoading}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="user_id"
            label="选择用户账号"
            rules={[{ required: true, message: '请选择用户' }]}
          >
            <Select
              showSearch
              placeholder="请选择已有用户"
              options={userOptions}
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              onFocus={async () => {
                if (userOptions.length > 0) return;
                try {
                  const res = await listUsers({ page: 1, size: 200 });
                  const body = res as unknown as { data: { list: { id: number; username: string; real_name: string }[] } };
                  setUserOptions((body.data?.list || []).map(u => ({
                    value: u.id,
                    label: `${u.username}（${u.real_name}）`,
                  })));
                } catch { /* ignore */ }
              }}
            />
          </Form.Item>
          <div style={{ color: '#999', fontSize: 12, marginTop: -12 }}>
            从现有用户中选择，创建后请分配授权分组
          </div>
        </Form>
      </Modal>

      {/* Assign Groups Modal */}
      <Modal
        title={`分配分组 — ${assignTarget?.real_name}（${assignTarget?.username}）`}
        open={assignVisible}
        onOk={handleAssign}
        onCancel={() => { setAssignVisible(false); assignForm.resetFields(); }}
        confirmLoading={assignLoading}
        width={560}
        destroyOnClose
      >
        {assignTarget && (
          <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 14px', marginBottom: 18, fontSize: 13, color: '#666' }}>
            创建时间：<strong style={{ color: '#333' }}>{assignTarget.created_at}</strong>
          </div>
        )}
        <Form form={assignForm} layout="vertical">
          <Form.Item
            name="groups"
            label="授权分组"
            rules={[{ required: false }]}
          >
            <Select
              mode="multiple"
              placeholder="选择或输入分组名（不存在的分组请先在诊所管理中创建）"
              options={allGroups.map(g => ({ value: g, label: g }))}
              allowClear
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: '#1677ff', marginTop: -12 }}>
            ℹ 修改授权后，该用户下次操作时将自动刷新 Token，无需重新登录。分组内新增诊所自动继承权限。
          </div>
        </Form>
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 3: 在 Layout 侧边栏加菜单项**

在 `web/src/components/Layout.tsx` 中，找到「诊所管理」菜单项所在的 settings 子菜单构建代码（约行 394）。

在 `canManageTenants` 条件之后，添加：

```typescript
const canManagePowerAdmin = hasPermission('power_admin:manage');

// settingsChildren 中，在 canManageConfig 条件之后：
if (canManagePowerAdmin) {
  settingsChildren.push({
    key: '/settings/power-admins',
    icon: <ApiOutlined />,
    label: '超级管理员',
  });
}
```

在文件顶部 icons import 中加 `ApiOutlined`（若未导入）：
```typescript
import { ..., ApiOutlined } from '@ant-design/icons';
```

- [ ] **Step 4: 注册路由**

在前端路由文件（通常是 `web/src/App.tsx` 或 `web/src/router/index.tsx`）中，找到 `/settings/tenants` 路由，仿照添加：

```typescript
import PowerAdminList from './pages/settings/PowerAdminList';

// 路由配置中：
{ path: '/settings/power-admins', element: <PowerAdminList /> },
```

- [ ] **Step 5: 编译验证**

```bash
cd web && npm run build 2>&1 | tail -20
```

预期：无 TypeScript 错误

- [ ] **Step 6: Commit**

```bash
cd web
git add src/api/powerAdmin.ts \
        src/pages/settings/PowerAdminList.tsx \
        src/components/Layout.tsx \
        src/App.tsx  # 或路由文件
git commit -m "feat: add PowerAdminList page with group assignment modal"
```

---

## Task 13：前端 — Tenant 新增/编辑加 group_name 字段

**Files:**
- Modify: `web/src/pages/settings/TenantList.tsx`
- Modify: `web/src/api/tenant.ts`

- [ ] **Step 1: 修改 tenant API**

在 `web/src/api/tenant.ts` 中，找到 `createTenant` 和 `updateTenant` 的请求类型，加 `group_name` 字段：

```typescript
export interface CreateTenantRequest {
  name: string;
  code: string;
  group_name?: string;   // NEW, 默认 "default"
}

export interface UpdateTenantRequest {
  name?: string;
  code?: string;
  status?: number;
  group_name?: string;   // NEW
}
```

- [ ] **Step 2: 修改 TenantList.tsx 表单**

在 `TenantItem` interface 中加 `group_name: string`。

在新增/编辑 Modal 的 `Form` 中，在 `code` 字段之后加：

```typescript
<Form.Item
  name="group_name"
  label="所属分组"
  rules={[{ required: true, message: '请输入分组名' }]}
>
  <AutoComplete
    placeholder="默认为 default，输入新名称自动创建分组"
    options={groupOptions}
    onSearch={handleGroupSearch}
    filterOption={false}
  />
</Form.Item>
```

新增 state 和逻辑（在组件内）：

```typescript
const [groupOptions, setGroupOptions] = useState<{ value: string }[]>([]);

const handleGroupSearch = useCallback(async (val: string) => {
  try {
    const res = await listAllGroups(); // 从 powerAdmin API 复用
    const body = res as unknown as { code: number; data: string[] };
    const filtered = (body.data || [])
      .filter(g => g.includes(val))
      .map(g => ({ value: g }));
    if (val && !body.data.includes(val)) {
      filtered.push({ value: val }); // allow creating new group
    }
    setGroupOptions(filtered);
  } catch { /* ignore */ }
}, []);
```

编辑时 `form.setFieldsValue` 加 `group_name: record.group_name`。

表格列中加 `group_name` 列（在 `code` 列之前）：

```typescript
{
  title: '分组',
  dataIndex: 'group_name',
  key: 'group_name',
  width: 100,
  render: (val: string) => (
    <Tag color={val === 'default' ? 'default' : 'purple'}>{val || 'default'}</Tag>
  ),
},
```

**handleOpenModal 中的默认值**：

```typescript
form.resetFields();
form.setFieldValue('group_name', 'default'); // 默认填充 default
```

- [ ] **Step 3: handleSubmit 中传 group_name**

```typescript
// 新增时：
await createTenant({
  name: values.name,
  code: values.code,
  group_name: values.group_name || 'default',
});

// 编辑时：
await updateTenant(editingTenant.id, {
  name: values.name,
  code: values.code,
  status: values.status,
  group_name: values.group_name,
});
```

- [ ] **Step 4: 编译**

```bash
cd web && npm run build 2>&1 | tail -20
```

预期：无错误

- [ ] **Step 5: Commit**

```bash
cd web
git add src/pages/settings/TenantList.tsx src/api/tenant.ts
git commit -m "feat: add group_name field to tenant create/edit UI"
```

---

## Task 14：全量前端测试

- [ ] **Step 1: 运行全部前端测试**

```bash
cd web && npm run test
```

预期：全部 PASS，无 FAIL

- [ ] **Step 2: 若有失败，查看错误，修复后重新运行**

常见问题：
- `useAuth` mock 未包含 `managedGroups` / `isPowerAdmin` 字段 → 在相关测试的 `vi.mock` 中补全
- `listAllGroups` API mock 缺失 → 在 MSW handler 或 `vi.mock` 中加 mock

- [ ] **Step 3: 构建确认**

```bash
cd web && npm run build
```

---

## Task 15：部署

- [ ] **Step 1: 运行 deploy.sh**

```bash
bash deploy.sh
```

- [ ] **Step 2: 验收检查清单**

1. superAdmin（admin 账号）登录 → 「超级管理员」菜单可见
2. 创建一个 powerAdmin 用户，分配「华北分组」
3. 以该 powerAdmin 登录 → 统计概览显示「全局总览」tab
4. 全局总览显示 info banner「当前显示您管理的 1 个分组的汇总数据（华北分组）」
5. 头部租户切换下拉按分组排列，只显示华北分组下的诊所
6. 切换到华北分组外的诊所 → 403
7. superAdmin 切换任意诊所 → 正常
8. 诊所管理 → 新增诊所，分组默认填 default，可输入新分组名
9. 修改 powerAdmin 分组后，该用户下一次请求自动刷新 token（无需重登录）

---

*计划结束。共 15 个 Task，约 90 个 Steps。*
