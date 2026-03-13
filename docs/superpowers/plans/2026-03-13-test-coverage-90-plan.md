# 测试覆盖率 90%+ 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前后端测试覆盖率提升至 90% 以上，过程中发现 bug 立即修复。

**Architecture:** 自底向上：先搭建测试基础设施，再从 middleware → model → service → handler（后端），request → auth → api → pages（前端）逐层补齐测试。后端使用真实 MySQL（Docker 容器）集成测试，前端使用 vi.mock()。排除 Three.js 3D 渲染组件。

**Tech Stack:** Go test + testify (后端), Vitest + Testing Library + vi.mock() (前端), Docker MySQL (测试 DB)

---

## Chunk 1: 后端测试基础设施 + Middleware 测试

### Task 1: 创建 testutil 测试工具包

**Files:**
- Create: `server/testutil/testutil.go`

- [ ] **Step 1: 创建 testutil 包**

```go
package testutil

import (
	"fmt"
	"math/rand"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// SetupTestDB creates a temporary test database and returns a *gorm.DB.
// The database is automatically dropped when the test finishes.
func SetupTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := getTestDSN()
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect to test MySQL: %v", err)
	}

	// Create a unique database for this test
	dbName := fmt.Sprintf("test_menzhen_%d_%d", time.Now().UnixNano(), rand.Intn(10000))
	if err := db.Exec("CREATE DATABASE " + dbName).Error; err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}

	// Connect to the new database
	testDSN := fmt.Sprintf("%s%s?charset=utf8mb4&parseTime=True&loc=Local", dsn, dbName)
	testDB, err := gorm.Open(mysql.Open(testDSN), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}

	// AutoMigrate all models
	err = testDB.AutoMigrate(
		&model.Tenant{},
		&model.User{},
		&model.Role{},
		&model.Permission{},
		&model.RolePermission{},
		&model.UserRole{},
		&model.Patient{},
		&model.MedicalRecord{},
		&model.RecordAttachment{},
		&model.OpLog{},
		&model.Herb{},
		&model.Formula{},
		&model.Prescription{},
		&model.PrescriptionItem{},
		&model.AIAnalysis{},
		&model.Pulse{},
		&model.MeridianResource{},
		&model.WuyunLiuqi{},
		&model.ClinicalExperience{},
		&model.InventoryDrug{},
	)
	if err != nil {
		t.Fatalf("failed to migrate test database: %v", err)
	}

	// Cleanup: drop database when test finishes
	t.Cleanup(func() {
		sqlDB, _ := testDB.DB()
		if sqlDB != nil {
			sqlDB.Close()
		}
		db.Exec("DROP DATABASE IF EXISTS " + dbName)
	})

	return testDB
}

func getTestDSN() string {
	// Default: connect to Docker MySQL
	// Override with TEST_DB_DSN env var
	dsn := "root:password@tcp(127.0.0.1:3306)/"
	if v := getEnv("TEST_DB_DSN"); v != "" {
		dsn = v
	}
	return dsn
}

func getEnv(key string) string {
	if v, ok := lookupEnv(key); ok {
		return v
	}
	return ""
}

// SeedTestTenant creates a test tenant and returns it.
func SeedTestTenant(t *testing.T, db *gorm.DB, name, code string) *model.Tenant {
	t.Helper()
	tenant := model.Tenant{Name: name, Code: code, Status: 1}
	if err := db.Create(&tenant).Error; err != nil {
		t.Fatalf("failed to seed test tenant: %v", err)
	}
	return &tenant
}

// SeedTestPermission creates a permission and returns it.
func SeedTestPermission(t *testing.T, db *gorm.DB, code, name string) *model.Permission {
	t.Helper()
	perm := model.Permission{Code: code, Name: name}
	if err := db.Create(&perm).Error; err != nil {
		t.Fatalf("failed to seed test permission: %v", err)
	}
	return &perm
}

// SeedTestRole creates a role with given permissions and returns it.
func SeedTestRole(t *testing.T, db *gorm.DB, tenantID uint64, name string, perms ...*model.Permission) *model.Role {
	t.Helper()
	role := model.Role{TenantID: tenantID, Name: name}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("failed to seed test role: %v", err)
	}
	for _, p := range perms {
		db.Create(&model.RolePermission{RoleID: role.ID, PermissionID: p.ID})
	}
	return &role
}

// SeedTestUser creates a user with role and returns user + JWT token.
func SeedTestUser(t *testing.T, db *gorm.DB, tenantID uint64, username, password string, role *model.Role) (*model.User, string) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	user := model.User{
		TenantID:     tenantID,
		Username:     username,
		PasswordHash: string(hash),
		RealName:     username,
		Status:       1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("failed to seed test user: %v", err)
	}
	if role != nil {
		db.Create(&model.UserRole{UserID: user.ID, RoleID: role.ID})
	}

	token, err := middleware.GenerateToken(user.ID, tenantID, username, TestJWTSecret)
	if err != nil {
		t.Fatalf("failed to generate test token: %v", err)
	}
	return &user, token
}

// SeedTestPatient creates a test patient and returns it.
func SeedTestPatient(t *testing.T, db *gorm.DB, tenantID, createdBy uint64, name string) *model.Patient {
	t.Helper()
	patient := model.Patient{
		TenantID:  tenantID,
		Name:      name,
		Gender:    1,
		Age:       30,
		CreatedBy: createdBy,
	}
	if err := db.Create(&patient).Error; err != nil {
		t.Fatalf("failed to seed test patient: %v", err)
	}
	return &patient
}

// TestJWTSecret is the JWT secret used in all tests.
const TestJWTSecret = "test-jwt-secret-for-testing"
```

- [ ] **Step 2: 添加 os.LookupEnv 导入**

在 testutil.go 中替换 `lookupEnv` 为 `os.LookupEnv`，添加 `"os"` 到 import。

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./testutil/...`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add server/testutil/
git commit -m "test: add testutil package for integration test infrastructure"
```

---

### Task 2: middleware/auth_test.go

**Files:**
- Create: `server/middleware/auth_test.go`

- [ ] **Step 1: 写 auth middleware 测试**

```go
package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
)

const testSecret = "test-secret-key"

func init() {
	gin.SetMode(gin.TestMode)
}

func setupAuthRouter() *gin.Engine {
	r := gin.New()
	r.GET("/protected", AuthMiddleware(testSecret), func(c *gin.Context) {
		c.JSON(200, gin.H{
			"user_id":   GetUserID(c),
			"tenant_id": GetTenantID(c),
			"username":  GetUsername(c),
		})
	})
	return r
}

func TestAuthMiddleware_ValidToken(t *testing.T) {
	token, err := GenerateToken(1, 10, "testuser", testSecret)
	assert.NoError(t, err)

	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, 200, w.Code)
}

func TestAuthMiddleware_NoToken(t *testing.T) {
	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, 401, w.Code)
}

func TestAuthMiddleware_InvalidFormat(t *testing.T) {
	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "InvalidFormat")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, 401, w.Code)
}

func TestAuthMiddleware_ExpiredToken(t *testing.T) {
	claims := Claims{
		UserID:   1,
		TenantID: 10,
		Username: "testuser",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString([]byte(testSecret))

	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, 401, w.Code)
}

func TestAuthMiddleware_WrongSecret(t *testing.T) {
	token, _ := GenerateToken(1, 10, "testuser", "wrong-secret")

	r := setupAuthRouter()
	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, 401, w.Code)
}

func TestGenerateToken_Success(t *testing.T) {
	token, err := GenerateToken(42, 100, "admin", testSecret)
	assert.NoError(t, err)
	assert.NotEmpty(t, token)
}

func TestGetUserID_NoContext(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	assert.Equal(t, uint64(0), GetUserID(c))
}

func TestGetTenantID_NoContext(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	assert.Equal(t, uint64(0), GetTenantID(c))
}

func TestGetUsername_NoContext(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	assert.Equal(t, "", GetUsername(c))
}

func TestContextHelpers_WithValues(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(CtxKeyUserID, uint64(42))
	c.Set(CtxKeyTenantID, uint64(100))
	c.Set(CtxKeyUsername, "admin")

	assert.Equal(t, uint64(42), GetUserID(c))
	assert.Equal(t, uint64(100), GetTenantID(c))
	assert.Equal(t, "admin", GetUsername(c))
}
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./middleware/ -run TestAuth -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add server/middleware/auth_test.go
git commit -m "test: add auth middleware tests"
```

---

### Task 3: middleware/tenant_test.go

**Files:**
- Create: `server/middleware/tenant_test.go`
- Uses: `server/testutil/testutil.go`

- [ ] **Step 1: 写 tenant scope 测试**

```go
package middleware_test

import (
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestTenantScope_FiltersCorrectly(t *testing.T) {
	db := testutil.SetupTestDB(t)

	// Create two tenants with patients
	tenantA := testutil.SeedTestTenant(t, db, "Clinic A", "clinic-a")
	tenantB := testutil.SeedTestTenant(t, db, "Clinic B", "clinic-b")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "userA", "pass", nil)
	userB, _ := testutil.SeedTestUser(t, db, tenantB.ID, "userB", "pass", nil)
	testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "Patient A")
	testutil.SeedTestPatient(t, db, tenantB.ID, userB.ID, "Patient B")

	// Query with tenant A scope
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxKeyTenantID, tenantA.ID)

	var patients []model.Patient
	err := db.Scopes(middleware.TenantScope(c)).Find(&patients).Error
	assert.NoError(t, err)
	assert.Len(t, patients, 1)
	assert.Equal(t, "Patient A", patients[0].Name)
}

func TestTenantScope_NoTenantID_ReturnsEmpty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenantA := testutil.SeedTestTenant(t, db, "Clinic A", "clinic-a")
	userA, _ := testutil.SeedTestUser(t, db, tenantA.ID, "userA", "pass", nil)
	testutil.SeedTestPatient(t, db, tenantA.ID, userA.ID, "Patient A")

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	// No tenant ID set — TenantScope uses tenant_id = 0

	var patients []model.Patient
	err := db.Scopes(middleware.TenantScope(c)).Find(&patients).Error
	assert.NoError(t, err)
	assert.Len(t, patients, 0)
}
```

注意：这个文件用 `package middleware_test` 以避免循环引用（需要 testutil 包）。

- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./middleware/ -run TestTenantScope -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add server/middleware/tenant_test.go
git commit -m "test: add tenant scope isolation tests"
```

---

### Task 4: middleware/rbac_test.go

**Files:**
- Create: `server/middleware/rbac_test.go`

- [ ] **Step 1: 写 RBAC middleware 测试**

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

func setupRBACRouter(db interface{ ... }) *gin.Engine {
	// 实际实现：创建 gin.Engine 带 auth + rbac middleware
}

func TestRBAC_HasPermission_Allowed(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test Clinic", "test-clinic")
	perm := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, db, tenant.ID, "doctor", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", role)

	r := gin.New()
	r.GET("/test", middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.RequirePermission(db, "patient:read"),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, 200, w.Code)
}

func TestRBAC_NoPermission_Forbidden(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test Clinic", "test-clinic")
	role := testutil.SeedTestRole(t, db, tenant.ID, "viewer") // no perms
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "viewer", "pass", role)

	r := gin.New()
	r.GET("/test", middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.RequirePermission(db, "patient:read"),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, 403, w.Code)
	var body map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &body)
	assert.Contains(t, body, "required_permissions")
}

func TestRBAC_MultiplePerms_AnyOneSuffices(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test Clinic", "test-clinic")
	perm := testutil.SeedTestPermission(t, db, "record:read", "查看记录")
	role := testutil.SeedTestRole(t, db, tenant.ID, "nurse", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "nurse", "pass", role)

	r := gin.New()
	r.GET("/test", middleware.AuthMiddleware(testutil.TestJWTSecret),
		middleware.RequirePermission(db, "patient:read", "record:read"), // OR logic
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, 200, w.Code)
}

func TestRBAC_NoUserID_Unauthorized(t *testing.T) {
	db := testutil.SetupTestDB(t)

	r := gin.New()
	// Skip AuthMiddleware — no user_id in context
	r.GET("/test", middleware.RequirePermission(db, "patient:read"),
		func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, 401, w.Code)
}
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./middleware/ -run TestRBAC -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add server/middleware/rbac_test.go
git commit -m "test: add RBAC permission middleware tests"
```

---

### Task 5: middleware/oplog_test.go

**Files:**
- Create: `server/middleware/oplog_test.go`

- [ ] **Step 1: 写 oplog 测试**

```go
package middleware_test

import (
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestLogOperation_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass", nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxKeyUserID, user.ID)
	c.Set(middleware.CtxKeyTenantID, tenant.ID)
	c.Set(middleware.CtxKeyUsername, "admin")

	middleware.LogOperation(db, c, "create", "patient", 1, nil, map[string]string{"name": "张三"})

	var log model.OpLog
	err := db.First(&log).Error
	assert.NoError(t, err)
	assert.Equal(t, tenant.ID, log.TenantID)
	assert.Equal(t, user.ID, log.UserID)
	assert.Equal(t, "create", log.Action)
	assert.Equal(t, "patient", log.ResourceType)
}

func TestLogOperation_UsesRealName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "admin", "pass", nil)
	// Set real name
	db.Model(user).Update("real_name", "管理员")

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxKeyUserID, user.ID)
	c.Set(middleware.CtxKeyTenantID, tenant.ID)
	c.Set(middleware.CtxKeyUsername, "admin")

	middleware.LogOperation(db, c, "update", "patient", 1, nil, nil)

	var log model.OpLog
	db.First(&log)
	assert.Equal(t, "管理员", log.UserName)
}
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./middleware/ -run TestLogOperation -v`
Expected: ALL PASS

- [ ] **Step 3: 运行全部 middleware 测试并检查覆盖率**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./middleware/ -cover -v`
Expected: ≥ 80% coverage

- [ ] **Step 4: Commit**

```bash
git add server/middleware/oplog_test.go
git commit -m "test: add operation logging middleware tests"
```

---

## Chunk 2: 后端 Service 测试（核心业务）

### Task 6: service/auth_test.go

**Files:**
- Create: `server/service/auth_test.go`

- [ ] **Step 1: 写 auth service 测试**

测试场景：
- Login 成功
- Login 用户名不存在 → ErrInvalidCredentials
- Login 密码错误 → ErrInvalidCredentials
- Login 用户被禁用 → ErrUserDisabled
- Register 成功
- Register 用户名重复 → ErrUsernameExists
- GetCurrentUser 成功（含权限列表）
- GetCurrentUser 用户不存在 → ErrUserNotFound
- ChangePassword 成功
- ChangePassword 旧密码错误 → ErrWrongOldPassword
- ChangePassword 用户不存在 → ErrUserNotFound

```go
package service

import (
	"testing"

	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func TestAuthService_Login_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	testutil.SeedTestUser(t, db, tenant.ID, "admin", "password123", nil)

	svc := NewAuthService(db)
	user, err := svc.Login("admin", "password123")
	assert.NoError(t, err)
	assert.Equal(t, "admin", user.Username)
}

func TestAuthService_Login_WrongPassword(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	testutil.SeedTestUser(t, db, tenant.ID, "admin", "password123", nil)

	svc := NewAuthService(db)
	_, err := svc.Login("admin", "wrong")
	assert.ErrorIs(t, err, ErrInvalidCredentials)
}

func TestAuthService_Login_UserNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewAuthService(db)
	_, err := svc.Login("nonexistent", "pass")
	assert.ErrorIs(t, err, ErrInvalidCredentials)
}

func TestAuthService_Login_Disabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "disabled", "pass", nil)
	db.Model(user).Update("status", 0)

	svc := NewAuthService(db)
	_, err := svc.Login("disabled", "pass")
	assert.ErrorIs(t, err, ErrUserDisabled)
}

func TestAuthService_Register_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")

	svc := NewAuthService(db)
	user, err := svc.Register(tenant.ID, "newuser", "pass123", "新用户", "13800000000")
	assert.NoError(t, err)
	assert.Equal(t, "newuser", user.Username)
	assert.Equal(t, tenant.ID, user.TenantID)
}

func TestAuthService_Register_DuplicateUsername(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	testutil.SeedTestUser(t, db, tenant.ID, "existing", "pass", nil)

	svc := NewAuthService(db)
	_, err := svc.Register(tenant.ID, "existing", "pass123", "重复", "")
	assert.ErrorIs(t, err, ErrUsernameExists)
}

func TestAuthService_GetCurrentUser_WithPermissions(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	perm := testutil.SeedTestPermission(t, db, "patient:read", "查看患者")
	role := testutil.SeedTestRole(t, db, tenant.ID, "doctor", perm)
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doc", "pass", role)

	svc := NewAuthService(db)
	u, perms, err := svc.GetCurrentUser(user.ID)
	assert.NoError(t, err)
	assert.Equal(t, "doc", u.Username)
	assert.Contains(t, perms, "patient:read")
}

func TestAuthService_GetCurrentUser_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewAuthService(db)
	_, _, err := svc.GetCurrentUser(99999)
	assert.ErrorIs(t, err, ErrUserNotFound)
}

func TestAuthService_ChangePassword_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "admin", "oldpass", nil)

	svc := NewAuthService(db)
	err := svc.ChangePassword(user.ID, "oldpass", "newpass")
	assert.NoError(t, err)

	// Verify new password works
	_, err = svc.Login("admin", "newpass")
	assert.NoError(t, err)
}

func TestAuthService_ChangePassword_WrongOld(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "Test", "test")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "admin", "correct", nil)

	svc := NewAuthService(db)
	err := svc.ChangePassword(user.ID, "wrong", "newpass")
	assert.ErrorIs(t, err, ErrWrongOldPassword)
}
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run TestAuthService -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add server/service/auth_test.go
git commit -m "test: add auth service tests (login/register/password)"
```

---

### Task 7: service/patient_test.go

**Files:**
- Create: `server/service/patient_test.go`

- [ ] **Step 1: 写 patient service 测试**

测试场景：
- CreatePatient 成功 + 中文名
- CreatePatient 带生日 → 自动计算年龄
- CreatePatient 无效生日格式 → error
- GetPatient 成功（含关联）
- GetPatient 跨租户 → ErrPatientNotFound
- ListPatients 分页
- ListPatients 按名字搜索
- ListPatients 空结果
- UpdatePatient 部分更新
- UpdatePatient 跨租户 → ErrPatientNotFound
- DeletePatient 成功（软删除）
- DeletePatient 跨租户 → ErrPatientNotFound

每个测试使用 `testutil.SetupTestDB(t)` 获取独立数据库。

- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run TestPatientService -v`

- [ ] **Step 3: Commit**

```bash
git add server/service/patient_test.go
git commit -m "test: add patient service tests (CRUD + tenant isolation)"
```

---

### Task 8: service/permission_test.go

**Files:**
- Create: `server/service/permission_test.go`

测试场景：
- GetUserPermissions 返回去重权限列表
- GetUserPermissions 无角色 → 空列表
- HasPermission 有权限 → true
- HasPermission 无权限 → false
- HasPermission 用户不存在 → false

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 9: service/tenant_test.go + service/user_test.go

**Files:**
- Create: `server/service/tenant_test.go`
- Create: `server/service/user_test.go`

**tenant 测试场景：** List, Create, Get, Update, Delete, 唯一 code 校验
**user 测试场景：** List (租户隔离), Update, Delete, AssignRoles

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 10: service/record_test.go + service/prescription_test.go

**Files:**
- Create: `server/service/record_test.go`
- Create: `server/service/prescription_test.go`

**record 测试场景：** CRUD + 租户隔离 + 关联患者 + 分页 + 附件
**prescription 测试场景：** CRUD + 药品组成 + 关联记录 + 租户隔离

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 11: 其余 service 测试

**Files:**
- Create: `server/service/herb_test.go`
- Create: `server/service/formula_test.go`
- Create: `server/service/inventory_drug_test.go`
- Create: `server/service/oplog_test.go`
- Create: `server/service/clinical_experience_test.go`
- Create: `server/service/pulse_test.go`
- Create: `server/service/meridian_resource_test.go`
- Create: `server/service/wuyun_liuqi_test.go`

每个 service 测试模板：
- CRUD 正常流程
- 空数据/无结果
- 分页测试
- 中文字符
- 租户隔离（如果有 tenantID）
- AI 相关用 httptest.NewServer mock（herb, formula, pulse）

herb/formula/pulse 的 AI fallback 测试：mock DeepSeek HTTP server，验证查询后保存到 DB。

- [ ] **Step 1: 按上述模板写所有 service 测试**
- [ ] **Step 2: 运行全部 service 测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -cover -v`
Expected: ≥ 85% coverage

- [ ] **Step 3: Commit**

```bash
git add server/service/*_test.go
git commit -m "test: add remaining service tests (herb/formula/inventory/oplog/clinical/pulse/meridian/wuyun)"
```

---

### Task 12: 检查后端 model + service 覆盖率

- [ ] **Step 1: 运行覆盖率报告**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./... -cover -coverprofile=coverage.out && go tool cover -func=coverage.out`

- [ ] **Step 2: 识别覆盖率不足的分支，补充测试**

- [ ] **Step 3: 修复测试过程中发现的 bug（TDD 流程）**

---

## Chunk 3: 后端 Handler 测试

### Task 13: handler 测试基础设施 + setupTestRouter

**Files:**
- Create: `server/handler/test_helpers_test.go`

- [ ] **Step 1: 创建 handler 测试帮助函数**

```go
package handler

import (
	"github.com/callmefisher/menzhen/server/config"
	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// setupTestRouter creates a gin.Engine with all handlers registered,
// using the test DB and test JWT secret.
func setupTestRouter(db *gorm.DB) *gin.Engine {
	r := gin.New()
	cfg := &config.Config{
		JWTSecret: testutil.TestJWTSecret,
	}

	authService := service.NewAuthService(db)
	authHandler := NewAuthHandler(authService, cfg.JWTSecret, db)
	patientHandler := NewPatientHandler(db)
	recordHandler := NewRecordHandler(db)
	oplogHandler := NewOpLogHandler(db)
	userHandler := NewUserHandler(db)
	roleHandler := NewRoleHandler(db)
	prescriptionHandler := NewPrescriptionHandler(db)
	tenantHandler := NewTenantHandler(db)
	clinicalExpHandler := NewClinicalExperienceHandler(db)
	inventoryDrugHandler := NewInventoryDrugHandler(db)

	// DeepSeek disabled in tests (no API key)
	deepSeekService := service.NewDeepSeekService(cfg)
	herbHandler := NewHerbHandler(db, deepSeekService)
	formulaHandler := NewFormulaHandler(db, deepSeekService)
	pulseHandler := NewPulseHandler(db, deepSeekService)

	v1 := r.Group("/api/v1")

	// Public
	auth := v1.Group("/auth")
	auth.POST("/login", authHandler.Login)
	auth.POST("/register", authHandler.Register)

	// Authenticated
	authed := v1.Group("")
	authed.Use(middleware.AuthMiddleware(cfg.JWTSecret))

	authed.POST("/auth/logout", authHandler.Logout)
	authed.GET("/auth/me", authHandler.Me)
	authed.POST("/auth/change-password", authHandler.ChangePassword)

	patients := authed.Group("/patients")
	patients.GET("", middleware.RequirePermission(db, "patient:read"), patientHandler.List)
	patients.POST("", middleware.RequirePermission(db, "patient:create"), patientHandler.Create)
	patients.GET("/:id", middleware.RequirePermission(db, "patient:read"), patientHandler.Detail)
	patients.PUT("/:id", middleware.RequirePermission(db, "patient:update"), patientHandler.Update)
	patients.DELETE("/:id", middleware.RequirePermission(db, "patient:delete"), patientHandler.Delete)

	records := authed.Group("/records")
	records.GET("", middleware.RequirePermission(db, "record:read"), recordHandler.List)
	records.POST("", middleware.RequirePermission(db, "record:create"), recordHandler.Create)
	records.GET("/:id", middleware.RequirePermission(db, "record:read"), recordHandler.Detail)
	records.PUT("/:id", middleware.RequirePermission(db, "record:update"), recordHandler.Update)
	records.DELETE("/:id", middleware.RequirePermission(db, "record:delete"), recordHandler.Delete)

	prescriptions := authed.Group("/prescriptions")
	prescriptions.POST("", middleware.RequirePermission(db, "prescription:create"), prescriptionHandler.Create)
	prescriptions.GET("/:id", middleware.RequirePermission(db, "prescription:read"), prescriptionHandler.Detail)
	records.GET("/:id/prescriptions", middleware.RequirePermission(db, "prescription:read"), prescriptionHandler.ListByRecord)

	herbs := authed.Group("/herbs")
	herbs.GET("", herbHandler.List)
	herbs.GET("/:id", herbHandler.Detail)

	formulas := authed.Group("/formulas")
	formulas.GET("", formulaHandler.List)
	formulas.GET("/:id", formulaHandler.Detail)

	pulses := authed.Group("/pulses")
	pulses.GET("", pulseHandler.List)
	pulses.GET("/:id", pulseHandler.Detail)

	users := authed.Group("/users")
	users.GET("", middleware.RequirePermission(db, "user:manage"), userHandler.List)
	users.PUT("/:id", middleware.RequirePermission(db, "user:manage"), userHandler.Update)
	users.DELETE("/:id", middleware.RequirePermission(db, "user:manage"), userHandler.Delete)

	roles := authed.Group("/roles")
	roles.GET("", middleware.RequirePermission(db, "role:manage"), roleHandler.List)
	roles.POST("", middleware.RequirePermission(db, "role:manage"), roleHandler.Create)

	tenants := authed.Group("/tenants")
	tenants.GET("", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.List)
	tenants.POST("", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.Create)

	oplogs := authed.Group("/oplogs")
	oplogs.GET("", middleware.RequirePermission(db, "oplog:read"), oplogHandler.ListOpLogs)

	clinicalExp := authed.Group("/clinical-experiences")
	clinicalExp.GET("", clinicalExpHandler.List)
	clinicalExp.GET("/:id", clinicalExpHandler.Detail)
	clinicalExp.POST("", middleware.RequirePermission(db, "role:manage"), clinicalExpHandler.Create)

	inventoryDrugs := authed.Group("/inventory/drugs")
	inventoryDrugs.GET("", middleware.RequirePermission(db, "inventory:read"), inventoryDrugHandler.List)
	inventoryDrugs.POST("", middleware.RequirePermission(db, "inventory:create"), inventoryDrugHandler.Create)

	return r
}

// seedFullUser creates a tenant + role with all permissions + user.
// Returns tenant, user, and JWT token.
func seedFullUser(t interface{ Helper(); Fatalf(string, ...interface{}) }, db *gorm.DB) (tenantID uint64, token string) {
	// Implementation: create tenant, all permissions, admin role, user
	// Returns tenantID and JWT token for the admin user
	return 0, ""
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./handler/...`

- [ ] **Step 3: Commit**

```bash
git add server/handler/test_helpers_test.go
git commit -m "test: add handler test infrastructure (setupTestRouter)"
```

---

### Task 14: handler/auth_test.go (扩展现有)

**Files:**
- Modify: `server/handler/handler_test.go` (已有 response 测试保留)
- Create: `server/handler/auth_handler_test.go`

测试场景：
- POST /auth/login 成功 → 200 + token
- POST /auth/login 密码错误 → 401
- POST /auth/login 参数缺失 → 400
- POST /auth/register 成功 → 201
- POST /auth/register 用户名重复 → 400
- GET /auth/me → 200 + user + permissions
- POST /auth/change-password 成功 → 200
- POST /auth/logout → 200

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 15: handler/patient_test.go

**Files:**
- Create: `server/handler/patient_handler_test.go`

测试场景（每个带 auth + permission）：
- GET /patients → 200 + 列表
- GET /patients?name=张 → 搜索
- POST /patients → 201
- POST /patients 参数不全 → 400
- GET /patients/:id → 200
- GET /patients/:id 不存在 → 404
- GET /patients/:id 跨租户 → 404
- PUT /patients/:id → 200
- DELETE /patients/:id → 200
- 无 token → 401
- 无权限 → 403

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 16: 其余 handler 测试

**Files:**
- Create: `server/handler/record_handler_test.go`
- Create: `server/handler/prescription_handler_test.go`
- Create: `server/handler/herb_handler_test.go`
- Create: `server/handler/formula_handler_test.go`
- Create: `server/handler/user_handler_test.go`
- Create: `server/handler/role_handler_test.go`
- Create: `server/handler/tenant_handler_test.go`
- Create: `server/handler/oplog_handler_test.go`
- Create: `server/handler/pulse_handler_test.go`
- Create: `server/handler/clinical_experience_handler_test.go`
- Create: `server/handler/inventory_drug_handler_test.go`
- Create: `server/handler/meridian_resource_handler_test.go`
- Create: `server/handler/wuyun_liuqi_handler_test.go`

每个 handler 测试遵循标准模板：正常请求、401、403、400、404、跨租户。
upload handler 和 ai_analysis handler 需要 mock 外部依赖（MinIO、DeepSeek）。

- [ ] **Step 1: 按模板写所有 handler 测试**
- [ ] **Step 2: 运行全部 handler 测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./handler/ -cover -v`

- [ ] **Step 3: Commit**

```bash
git add server/handler/*_test.go
git commit -m "test: add handler integration tests for all API endpoints"
```

---

### Task 17: 后端覆盖率验证 + Bug 修复

- [ ] **Step 1: 运行全量覆盖率**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./... -cover -coverprofile=coverage.out && go tool cover -func=coverage.out`

- [ ] **Step 2: 识别 < 90% 的包，补充测试**

- [ ] **Step 3: 修复测试中发现的 bug（TDD）**

- [ ] **Step 4: 再次运行确认 ≥ 90%**

- [ ] **Step 5: Commit**

```bash
git commit -am "test: achieve 90%+ backend coverage, fix discovered bugs"
```

---

## Chunk 4: 前端测试基础设施

### Task 18: 配置 vitest coverage + 排除 3D 组件

**Files:**
- Modify: `web/vitest.config.ts`
- Modify: `web/package.json`（添加 @vitest/coverage-v8）

- [ ] **Step 1: 安装 coverage 依赖**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm install -D @vitest/coverage-v8`

- [ ] **Step 2: 更新 vitest.config.ts**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      exclude: [
        'src/pages/meridians/MeridianView.tsx',
        'src/pages/meridians/MeridianScene.tsx',
        'src/pages/meridians/MeridianPath.tsx',
        'src/pages/meridians/AcupointMarker.tsx',
        'src/pages/meridians/HumanBodyModel.tsx',
        'src/pages/meridians/surfaceProjection.ts',
        'src/pages/meridians/data/**',
        'src/test/**',
        '**/*.d.ts',
        'src/main.tsx',
        'src/App.tsx',
      ],
    },
  },
});
```

- [ ] **Step 3: 运行验证**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx vitest run --coverage`

- [ ] **Step 4: Commit**

```bash
git add web/vitest.config.ts web/package.json web/package-lock.json
git commit -m "test: configure vitest coverage with 3D component exclusions"
```

---

### Task 19: utils/request.test.ts

**Files:**
- Create: `web/src/utils/__tests__/request.test.ts`

- [ ] **Step 1: 写 request 工具测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios before importing request
vi.mock('axios', () => {
  const interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };
  const instance = {
    interceptors,
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  return {
    default: { create: vi.fn(() => instance) },
  };
});

// Mock antd message
vi.mock('antd', () => ({
  message: { error: vi.fn() },
}));

describe('request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('creates axios instance with correct config', async () => {
    const axios = (await import('axios')).default;
    await import('../request');
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: '/api/v1',
        timeout: 30000,
      })
    );
  });

  it('attaches token from localStorage', async () => {
    const axios = (await import('axios')).default;
    await import('../request');
    const requestInterceptor = (axios.create as any)().interceptors.request.use.mock.calls[0][0];

    localStorage.setItem('token', 'test-jwt-token');
    const config = { headers: {} as Record<string, string> };
    const result = requestInterceptor(config);
    expect(result.headers.Authorization).toBe('Bearer test-jwt-token');
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx vitest run src/utils/__tests__/request.test.ts`

- [ ] **Step 3: Commit**

```bash
git add web/src/utils/__tests__/request.test.ts
git commit -m "test: add request utility tests (interceptors, error handling)"
```

---

### Task 20: store/auth.test.tsx

**Files:**
- Create: `web/src/store/__tests__/auth.test.tsx`

- [ ] **Step 1: 写 auth store 测试**

测试场景：
- AuthProvider 初始状态 loading=true
- 有 token 时自动调用 getMe 恢复 session
- getMe 失败 → 清除 token，user=null
- login 成功 → token 存 sessionStorage
- login with remember → token 存 localStorage
- logout → 清除 token + user
- hasPermission 正确检查
- useAuth 在 AuthProvider 外部使用 → throw Error

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../store/auth';

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
}));

function TestConsumer() {
  const { user, loading, permissions, hasPermission } = useAuth();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <span data-testid="user">{user?.username || 'none'}</span>
      <span data-testid="perms">{permissions.join(',')}</span>
      <span data-testid="has-patient">{String(hasPermission('patient:read'))}</span>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('restores session from stored token', async () => {
    localStorage.setItem('token', 'saved-token');
    const { getMe } = await import('../../api/auth');
    (getMe as any).mockResolvedValue({
      data: {
        user: { id: 1, username: 'admin', real_name: '管理员', tenant_id: 1 },
        permissions: ['patient:read'],
      },
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('admin');
    });
    expect(screen.getByTestId('has-patient').textContent).toBe('true');
  });

  it('clears token on getMe failure', async () => {
    localStorage.setItem('token', 'expired-token');
    const { getMe } = await import('../../api/auth');
    (getMe as any).mockRejectedValue(new Error('401'));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('none');
    });
    expect(localStorage.getItem('token')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx vitest run src/store/__tests__/auth.test.tsx`

- [ ] **Step 3: Commit**

```bash
git add web/src/store/__tests__/auth.test.tsx
git commit -m "test: add auth store tests (login/logout/session restore)"
```

---

### Task 21: utils/sse.test.ts

**Files:**
- Create: `web/src/utils/__tests__/sse.test.ts`

测试场景：
- parseSSEStream 正确解析 chunk/done/cached/error 事件
- fetchSSE 正确发送请求、附加 Authorization header
- streamWuyunLiuqiQuery 返回 AbortController
- streamAiAnalysis 返回 AbortController
- HTTP 错误响应调用 onError
- AbortError 被静默处理

使用全局 fetch mock。

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

## Chunk 5: 前端 API Services + 核心页面测试

### Task 22: API services 测试（16 个文件）

**Files:**
- Create: `web/src/api/__tests__/auth.test.ts`
- Create: `web/src/api/__tests__/patient.test.ts`
- Create: `web/src/api/__tests__/record.test.ts`
- Create: `web/src/api/__tests__/prescription.test.ts`
- Create: `web/src/api/__tests__/herb.test.ts`
- Create: `web/src/api/__tests__/formula.test.ts`
- Create: `web/src/api/__tests__/user.test.ts`
- Create: `web/src/api/__tests__/role.test.ts`
- Create: `web/src/api/__tests__/tenant.test.ts`
- Create: `web/src/api/__tests__/inventory.test.ts`
- Create: `web/src/api/__tests__/upload.test.ts`
- Create: `web/src/api/__tests__/oplog.test.ts`
- Create: `web/src/api/__tests__/pulse.test.ts`
- Create: `web/src/api/__tests__/clinicalExperience.test.ts`
- Create: `web/src/api/__tests__/meridian.test.ts`
- Create: `web/src/api/__tests__/wuyunLiuqi.test.ts`

每个 API 测试模板：

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import request from '../../utils/request';
import { listPatients, getPatient, createPatient } from '../patient';

describe('patient API', () => {
  it('listPatients calls GET /patients with params', async () => {
    (request.get as any).mockResolvedValue({ data: [] });
    await listPatients({ page: 1, size: 10, name: '张' });
    expect(request.get).toHaveBeenCalledWith('/patients', {
      params: { page: 1, size: 10, name: '张' },
    });
  });

  it('getPatient calls GET /patients/:id', async () => {
    (request.get as any).mockResolvedValue({ data: {} });
    await getPatient(42);
    expect(request.get).toHaveBeenCalledWith('/patients/42');
  });

  it('createPatient calls POST /patients', async () => {
    const data = { name: '张三', gender: 1 };
    (request.post as any).mockResolvedValue({ data: {} });
    await createPatient(data);
    expect(request.post).toHaveBeenCalledWith('/patients', data);
  });
});
```

- [ ] **Step 1: 写所有 16 个 API service 测试文件**
- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx vitest run src/api/`

- [ ] **Step 3: Commit**

```bash
git add web/src/api/__tests__/
git commit -m "test: add all 16 API service tests"
```

---

### Task 23: PatientList + PatientDetail + PatientForm 测试

**Files:**
- Create: `web/src/pages/patients/__tests__/PatientList.test.tsx`
- Create: `web/src/pages/patients/__tests__/PatientDetail.test.tsx`
- Create: `web/src/pages/patients/__tests__/PatientForm.test.tsx`

测试模式：mock API + auth store + react-router

```tsx
vi.mock('../../../api/patient');
vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    user: { id: 1, tenant_id: 1 },
    hasPermission: () => true,
  }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: '1' }) };
});
```

每个页面测试覆盖：渲染、CRUD 操作、搜索/筛选、分页、空状态、错误处理。

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 24: RecordList + RecordForm 测试

**Files:**
- Create: `web/src/pages/records/__tests__/RecordList.test.tsx`
- Create: `web/src/pages/records/__tests__/RecordForm.test.tsx`

RecordForm (1440行) 分段测试：
- 基本信息区域渲染
- 主诉/脉象/舌象表单
- AI 分析触发（mock streamAiAnalysis）
- 处方关联
- 表单提交

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 25: DrugList + InventoryAlert 测试

**Files:**
- Create: `web/src/pages/inventory/__tests__/DrugList.test.tsx`
- Create: `web/src/pages/inventory/__tests__/InventoryAlert.test.tsx`

DrugList (948行) 测试重点：
- 列表渲染 + 搜索 + 分页
- 新增/编辑药品 modal
- 库存入库操作
- 预警标记

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

## Chunk 6: 前端剩余页面 + 组件测试

### Task 26: Login + Register 测试

**Files:**
- Create: `web/src/pages/auth/__tests__/Login.test.tsx`
- Create: `web/src/pages/auth/__tests__/Register.test.tsx`

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 27: 设置页面测试（UserList + RoleList + TenantList + OpLogList）

**Files:**
- Create: `web/src/pages/settings/__tests__/UserList.test.tsx`
- Create: `web/src/pages/settings/__tests__/RoleList.test.tsx`
- Create: `web/src/pages/settings/__tests__/TenantList.test.tsx`
- Create: `web/src/pages/settings/__tests__/OpLogList.test.tsx`

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 28: 参考数据页面测试（PulseList + ClinicalExperienceList）

**Files:**
- Create: `web/src/pages/pulses/__tests__/PulseList.test.tsx`
- Create: `web/src/pages/clinical/__tests__/ClinicalExperienceList.test.tsx`

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 29: WuyunLiuqi + NotesPanel 测试

**Files:**
- Create: `web/src/pages/wuyun/__tests__/WuyunLiuqi.test.tsx`
- Create: `web/src/pages/wuyun/__tests__/NotesPanel.test.tsx`

WuyunLiuqi: mock streamWuyunLiuqiQuery，测试流式显示
NotesPanel: 测试 localStorage 持久化、Markdown 编辑

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 30: Layout + FileUpload + HerbDetailModal 测试

**Files:**
- Create: `web/src/components/__tests__/Layout.test.tsx`
- Create: `web/src/components/__tests__/FileUpload.test.tsx`
- Create: `web/src/components/__tests__/HerbDetailModal.test.tsx`

Layout: 导航渲染、菜单权限控制、移动端适配
FileUpload: 上传触发、文件类型校验

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 31: 经络 UI 组件测试（非 3D）

**Files:**
- Create: `web/src/pages/meridians/__tests__/MeridianDetailDrawer.test.tsx`
- Create: `web/src/pages/meridians/__tests__/MeridianPanel.test.tsx`
- Create: `web/src/pages/meridians/__tests__/AcupointInfoCard.test.tsx`
- Create: `web/src/pages/meridians/__tests__/AcupointDetailPanel.test.tsx`

Mock 3D 相关导入，只测试纯 UI 逻辑。

- [ ] **Step 1-3: 写测试 → 运行 → commit**

---

### Task 32: 扩展已有前端测试覆盖率

**Files:**
- Modify: `web/src/components/__tests__/PrescriptionModal.test.tsx`
- Modify: `web/src/components/__tests__/PrescriptionPrint.test.tsx`
- Modify: `web/src/pages/herbs/__tests__/HerbSearch.test.tsx`
- Modify: `web/src/pages/formulas/__tests__/FormulaSearch.test.tsx`

扩展测试：
- 错误处理场景
- 空数据/无结果
- 移动端适配（useIsMobile mock）
- 分页操作

- [ ] **Step 1-3: 扩展测试 → 运行 → commit**

---

### Task 33: 前端覆盖率验证 + Bug 修复

- [ ] **Step 1: 运行完整覆盖率报告**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx vitest run --coverage`

- [ ] **Step 2: 识别 < 90% 的文件，补充测试**

- [ ] **Step 3: 修复发现的 bug（TDD）**

- [ ] **Step 4: 确认全部 ≥ 90%**

- [ ] **Step 5: Commit**

```bash
git commit -am "test: achieve 90%+ frontend coverage, fix discovered bugs"
```

---

## Chunk 7: 最终验证 + 文档更新

### Task 34: 全量覆盖率验证

- [ ] **Step 1: 后端覆盖率**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./... -cover -coverprofile=coverage.out
go tool cover -func=coverage.out | grep total
```

Expected: total ≥ 90%

- [ ] **Step 2: 前端覆盖率**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npx vitest run --coverage
```

Expected: statements/branches/functions/lines ≥ 90%

- [ ] **Step 3: 前端构建验证**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npm run build
```

Expected: 构建成功

---

### Task 35: 更新文档

- [ ] **Step 1: 更新 CLAUDE.md**
- 添加测试覆盖率达成记录
- 添加测试过程中的经验教训

- [ ] **Step 2: 更新 docs/codebase.md**
- 添加测试文件结构
- 添加覆盖率配置说明

- [ ] **Step 3: 更新 README.md**
- 添加运行测试的命令

- [ ] **Step 4: Commit**

```bash
git commit -am "docs: update documentation with test coverage achievement"
```
