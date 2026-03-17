# 诊所禁用状态完整拦截 — 设计文档

## 背景

当前系统中，诊所（tenant）的 `status` 字段仅在**注册**时校验。禁用诊所后：
- 已登录用户不受影响（JWT 有效期内可继续操作）
- 新登录不校验诊所状态
- 中间件不检查诊所状态

需要补全拦截逻辑，使禁用诊所后所有 API 请求立即被阻止。

## 方案

采用**独立中间件方案**：新建 `TenantStatusMiddleware`，职责单一，不修改现有中间件。

## 请求链路

```
AuthMiddleware → TokenVersionMiddleware → TenantStatusMiddleware → 业务逻辑
                                              ↓
                                         status != 1 → HTTP 403
                                         {"code": 403, "message": "tenant_disabled"}
```

## 变更清单

### 1. 后端：新建 TenantStatusMiddleware

**文件**: `server/middleware/tenant_status.go`

```go
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
            // tenant 不存在 → 403（数据不一致，不应放行）
            // 其他 DB 错误 → 也返回 403（安全优先，fail-closed）
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

**设计决策 — fail-closed**：DB 查询出错（包括 tenant 不存在）时返回 403 而非放行。这是安全关键功能，宁可误阻也不能漏放。与 `TokenVersionMiddleware` 的 fail-open 风格不同，因为禁用诊所是明确的安全操作。

### 2. 后端：路由注册

**文件**: `server/router/router.go`

在 `authenticated` 路由组和 `authOnly` 路由组中均添加 `TenantStatusMiddleware`：

```go
// authOnly 组（/auth/refresh）— 防止禁用诊所的用户刷新 token
authOnly.Use(middleware.AuthMiddleware(cfg.JWTSecret))
authOnly.Use(middleware.TenantStatusMiddleware(db))  // 新增

// authenticated 组 — 所有已认证路由
authenticated.Use(middleware.AuthMiddleware(cfg.JWTSecret))
authenticated.Use(middleware.TokenVersionMiddleware(db))
authenticated.Use(middleware.TenantStatusMiddleware(db))  // 新增
```

### 3. 后端：登录时校验诊所状态

**文件**: `server/service/auth.go`

新增错误变量：
```go
var ErrTenantDisabled = errors.New("该诊所已被禁用")
```

在 `Login()` 方法中，密码验证通过后、返回 user 前，查询 tenant.status：
```go
var tenant struct{ Status int8 }
if err := s.DB.Table("tenants").Select("status").Where("id = ?", user.TenantID).First(&tenant).Error; err == nil {
    if tenant.Status != 1 {
        return nil, ErrTenantDisabled
    }
}
```

**文件**: `server/handler/auth.go`

Login handler 中增加对 `ErrTenantDisabled` 的处理：
```go
if errors.Is(err, service.ErrTenantDisabled) {
    c.JSON(http.StatusForbidden, gin.H{
        "code":    403,
        "message": "tenant_disabled",
    })
    return
}
```

**注意**：handler 返回的 message 是 `"tenant_disabled"`（英文标识符），而非 `err.Error()` 的中文文本。前端根据此标识符显示对应的中文提示。这保证了前端拦截器可以统一匹配 `message === "tenant_disabled"`。

### 4. 前端：请求拦截器

**文件**: `web/src/utils/request.ts`

在 403 处理逻辑中，**优先**检查 `message === "tenant_disabled"`（在现有 `required_permissions` 检查之前）：
- 清除 token
- 跳转登录页
- 显示"该诊所已被禁用，请联系管理员"

```typescript
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

### 5. 前端：登录页

登录 API 返回 403 + `tenant_disabled` 时，由请求拦截器统一处理，显示"该诊所已被禁用，请联系管理员"提示。无需修改登录页组件。

## 测试计划

### 后端

| 测试文件 | 测试用例 | 场景 |
|---------|---------|------|
| `middleware/tenant_status_test.go` | `TestTenantStatusMiddleware_Enabled` | 启用状态 → 放行 |
| `middleware/tenant_status_test.go` | `TestTenantStatusMiddleware_Disabled` | 禁用状态 → 403 |
| `middleware/tenant_status_test.go` | `TestTenantStatusMiddleware_NotFound` | tenant 不存在 → 403 |
| `middleware/tenant_status_test.go` | `TestTenantStatusMiddleware_ZeroTenantID` | tenantID=0 → 放行 |
| `service/auth_test.go` | `TestLogin_TenantDisabled` | 诊所禁用 → ErrTenantDisabled |
| `handler/auth_test.go` | `TestLoginHandler_TenantDisabled_Returns403` | handler 返回 403 + "tenant_disabled" |

### 前端

| 测试文件 | 测试用例 | 场景 |
|---------|---------|------|
| `utils/__tests__/request.test.ts` | 403 tenant_disabled | 清 token + 跳登录 |

## 错误处理边界

- 中间件查 DB 出错（含 tenant 不存在）→ 返回 403（fail-closed，安全优先）
- tenantID = 0 → 放行（不应发生，但兜底处理）
- handler 返回 `"tenant_disabled"` 标识符，非中文 error 文本

## 不涉及的变更

- 注册逻辑已有校验，不需修改
- Tenant model 不需修改
- 前端 TenantList 诊所管理页面不需修改
- 公开路由（`/api/v1/files/*key`）不受影响 — 文件访问无需认证，禁用诊所后已有文件仍可访问（如已渲染的图片）
