# 诊所禁用状态完整拦截 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 禁用诊所后，该诊所下所有 API 请求立即被拦截（包括登录、token 刷新、已认证请求），前端自动跳转登录页并提示。

**Architecture:** 新建独立 `TenantStatusMiddleware`（fail-closed），挂到 authOnly + authenticated 路由组。登录服务层增加 tenant.status 校验。前端 403 拦截器增加 `tenant_disabled` 分支。

**Tech Stack:** Go/Gin/GORM (后端), React/Axios/Antd (前端), testify + httptest (后端测试), vitest (前端测试)

**Spec:** `docs/superpowers/specs/2026-03-17-tenant-disable-enforcement-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `server/middleware/tenant_status.go` | TenantStatusMiddleware 中间件 |
| Create | `server/middleware/tenant_status_test.go` | 中间件单元测试 |
| Modify | `server/service/auth.go` | Login 增加 tenant.status 校验 |
| Modify | `server/handler/auth.go` | Login handler 处理 ErrTenantDisabled |
| Modify | `server/service/auth_test.go` | 新增 TestLogin_TenantDisabled |
| Modify | `server/router/router.go` | authOnly + authenticated 挂中间件 |
| Modify | `web/src/utils/request.ts` | 403 tenant_disabled 拦截 |

---

## Task 1: TenantStatusMiddleware — 测试

**Files:**
- Create: `server/middleware/tenant_status_test.go`

- [ ] **Step 1: 编写 4 个测试用例**

```go
package middleware_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestTenantStatusMiddleware_Enabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "ts-enabled")
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "user1", "pass", nil)

	r := gin.New()
	r.GET("/test",
		middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.TenantStatusMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestTenantStatusMiddleware_Disabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所B", "ts-disabled")
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "user2", "pass", nil)

	// Disable the tenant.
	db.Model(tenant).Update("status", 0)

	r := gin.New()
	r.GET("/test",
		middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.TenantStatusMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)

	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, "tenant_disabled", body["message"])
}

func TestTenantStatusMiddleware_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)

	r := gin.New()
	r.GET("/test",
		func(c *gin.Context) {
			// Simulate AuthMiddleware setting a non-existent tenant_id.
			c.Set("tenant_id", uint64(99999))
			c.Next()
		},
		middleware.TenantStatusMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)

	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	assert.Equal(t, "tenant_disabled", body["message"])
}

func TestTenantStatusMiddleware_ZeroTenantID(t *testing.T) {
	db := testutil.SetupTestDB(t)

	r := gin.New()
	// No AuthMiddleware → no tenant_id in context → should pass through.
	r.GET("/test",
		middleware.TenantStatusMiddleware(db),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && go test ./middleware/ -run TestTenantStatusMiddleware -v`
Expected: FAIL — `TenantStatusMiddleware` 未定义

---

## Task 2: TenantStatusMiddleware — 实现

**Files:**
- Create: `server/middleware/tenant_status.go`

- [ ] **Step 3: 编写中间件**

```go
package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// TenantStatusMiddleware checks that the authenticated user's tenant is enabled (status=1).
// Returns HTTP 403 with "tenant_disabled" if the tenant is disabled, not found, or on DB error (fail-closed).
func TenantStatusMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantID := GetTenantID(c)
		if tenantID == 0 {
			c.Next()
			return
		}

		var tenant struct{ Status int8 }
		err := db.Table("tenants").Select("status").Where("id = ?", tenantID).First(&tenant).Error
		if err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "tenant_disabled",
			})
			return
		}

		if tenant.Status != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "tenant_disabled",
			})
			return
		}

		c.Next()
	}
}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `cd server && go test ./middleware/ -run TestTenantStatusMiddleware -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add server/middleware/tenant_status.go server/middleware/tenant_status_test.go
git commit -m "feat: add TenantStatusMiddleware to block disabled tenants"
```

---

## Task 3: Login 增加 tenant.status 校验 — 测试

**Files:**
- Modify: `server/service/auth_test.go` — 新增测试
- Modify: `server/service/auth.go` — 新增 ErrTenantDisabled + Login 逻辑

- [ ] **Step 6: 在 auth_test.go 末尾添加测试**

```go
func TestLogin_TenantDisabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	testutil.SeedTestUser(t, db, tenant.ID, "doctor1", "pass123", nil)

	// Disable the tenant.
	db.Model(tenant).Update("status", 0)

	svc := service.NewAuthService(db)
	result, err := svc.Login("doctor1", "pass123")

	assert.Nil(t, result)
	assert.ErrorIs(t, err, service.ErrTenantDisabled)
}
```

- [ ] **Step 7: 运行测试确认失败**

Run: `cd server && go test ./service/ -run TestLogin_TenantDisabled -v`
Expected: FAIL — `ErrTenantDisabled` 未定义

---

## Task 4: Login 增加 tenant.status 校验 — 实现

**Files:**
- Modify: `server/service/auth.go`

- [ ] **Step 8: 在 auth.go 的 var block 中添加 ErrTenantDisabled**

在 `server/service/auth.go` 第 14 行（`ErrUsernameExists` 之后）添加：
```go
ErrTenantDisabled     = errors.New("该诊所已被禁用")
```

- [ ] **Step 9: 在 Login() 的密码校验之后、return &user 之前添加 tenant 状态校验**

在 `server/service/auth.go` Login() 方法中，`bcrypt.CompareHashAndPassword` 成功之后（第 48 行后）、`return &user, nil` 之前添加：

```go
	// Check that the user's tenant is active.
	var tenant struct{ Status int8 }
	if err := s.DB.Table("tenants").Select("status").Where("id = ?", user.TenantID).First(&tenant).Error; err == nil {
		if tenant.Status != 1 {
			return nil, ErrTenantDisabled
		}
	}
```

- [ ] **Step 10: 运行测试确认通过**

Run: `cd server && go test ./service/ -run TestLogin -v`
Expected: ALL PASS（包括 TestLogin_Success, TestLogin_WrongPassword, TestLogin_UserNotFound, TestLogin_Disabled, TestLogin_TenantDisabled）

- [ ] **Step 11: Commit**

```bash
git add server/service/auth.go server/service/auth_test.go
git commit -m "feat: block login when tenant is disabled"
```

---

## Task 5: Login Handler 处理 ErrTenantDisabled

**Files:**
- Modify: `server/handler/auth.go`

- [ ] **Step 12: 在 Login handler 的错误处理中增加 ErrTenantDisabled 分支**

在 `server/handler/auth.go` 的 Login() 方法中，现有的 `if errors.Is(err, service.ErrUserDisabled)` 之后添加 ErrTenantDisabled 处理。修改第 88-99 行的错误处理块：

```go
	user, err := h.authService.Login(req.Username, req.Password)
	if err != nil {
		if errors.Is(err, service.ErrTenantDisabled) {
			c.JSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "tenant_disabled",
			})
			return
		}
		status := http.StatusUnauthorized
		if errors.Is(err, service.ErrUserDisabled) {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{
			"code":    status,
			"message": err.Error(),
		})
		return
	}
```

- [ ] **Step 13: 运行后端全量测试**

Run: `cd server && go test ./... -count=1`
Expected: ALL PASS

- [ ] **Step 14: Commit**

```bash
git add server/handler/auth.go
git commit -m "feat: return tenant_disabled on login when tenant is disabled"
```

---

## Task 6: 路由注册中间件

**Files:**
- Modify: `server/router/router.go`

- [ ] **Step 15: 在 authOnly 路由组添加 TenantStatusMiddleware**

在 `server/router/router.go` 第 78 行（`authOnly.Use(middleware.AuthMiddleware(cfg.JWTSecret))` 之后）添加：

```go
	authOnly.Use(middleware.TenantStatusMiddleware(db))
```

- [ ] **Step 16: 在 authenticated 路由组添加 TenantStatusMiddleware**

在 `server/router/router.go` 第 86 行（`authenticated.Use(middleware.TokenVersionMiddleware(db))` 之后）添加：

```go
	authenticated.Use(middleware.TenantStatusMiddleware(db))
```

- [ ] **Step 17: 运行后端编译验证**

Run: `cd server && go build ./...`
Expected: 编译成功

- [ ] **Step 18: Commit**

```bash
git add server/router/router.go
git commit -m "feat: register TenantStatusMiddleware on all authenticated routes"
```

---

## Task 7: 前端请求拦截器

**Files:**
- Modify: `web/src/utils/request.ts`

- [ ] **Step 19: 在 403 处理逻辑中优先检查 tenant_disabled**

在 `web/src/utils/request.ts` 的响应拦截器中，在现有的 `if (error.response?.status === 403 && data?.required_permissions)` 检查（第 82 行）**之前**插入 tenant_disabled 检查：

```typescript
    // 403 tenant_disabled: clear token and redirect to login
    if (error.response?.status === 403 && data?.message === 'tenant_disabled') {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      message.error('该诊所已被禁用，请联系管理员');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
```

- [ ] **Step 20: 运行前端编译验证**

Run: `cd web && npm run build`
Expected: 编译成功

- [ ] **Step 21: Commit**

```bash
git add web/src/utils/request.ts
git commit -m "feat: handle tenant_disabled 403 in frontend request interceptor"
```

---

## Task 8: 全量验证

- [ ] **Step 22: 后端全量测试**

Run: `cd server && go test ./... -count=1`
Expected: ALL PASS

- [ ] **Step 23: 前端全量测试**

Run: `cd web && npm run test -- --run`
Expected: ALL PASS

- [ ] **Step 24: 前端编译**

Run: `cd web && npm run build`
Expected: 编译成功
