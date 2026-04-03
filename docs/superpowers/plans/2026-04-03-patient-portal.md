# 患者端 (Patient Portal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有门诊系统中新增患者端移动端入口，支持登录/注册、在线预约、快捷取号（到院）、病历/处方/收费只读查看，以及管理端5个功能开关。

**Architecture:** 同一 React 应用新增 `/patient/*` 路由分支 + 独立 PatientLayout（底部导航）。后端新增 `/api/v1/patient/` 路由组，PatientUser 独立表，JWT `user_type=patient` 隔离患者与员工权限。患者登录用手机号+姓名，密码透明设为 `last4(phone)`，自动关联或创建患者档案。

**Tech Stack:** Go + Gin + GORM（后端）, React 19 + TypeScript + Ant Design 6（前端）, JWT HS256, bcrypt

---

## 文件结构总览

**新建（后端）:**
- `server/model/patient_user.go` — PatientUser 模型
- `server/model/patient_portal_config.go` — PatientPortalConfig 模型（5开关）
- `server/middleware/patient_auth.go` — PatientClaims + GeneratePatientToken + PatientAuthMiddleware
- `server/service/patient_auth.go` — 患者登录/注册逻辑（auto-link/auto-create）
- `server/handler/patient_auth.go` — POST /patient/auth/login + GET /patient/me
- `server/handler/patient_settings.go` — GET/PUT /tenant/patient-portal-config
- `server/handler/patient_portal.go` — 预约/取号/病历/收费处理器

**修改（后端）:**
- `server/database/database.go` — AutoMigrate 加入2个新模型
- `server/router/router.go` — 新增 /api/v1/patient/ 路由组 + 管理端开关路由

**新建（前端）:**
- `web/src/utils/patientRequest.ts` — 患者专用 axios 实例（独立 token 键 + 401→/patient/login）
- `web/src/api/patientAuth.ts` — login API
- `web/src/api/patientPortal.ts` — 预约/取号/病历/收费/开关 API
- `web/src/store/patientAuth.tsx` — 患者认证 Context + usePatientAuth
- `web/src/components/PatientLayout.tsx` — 移动端底部导航布局
- `web/src/pages/patient/PatientLogin.tsx`
- `web/src/pages/patient/PatientHome.tsx`
- `web/src/pages/patient/PatientAppointment.tsx`
- `web/src/pages/patient/PatientQueue.tsx`
- `web/src/pages/patient/PatientRecords.tsx`
- `web/src/pages/patient/PatientRecordDetail.tsx`
- `web/src/pages/patient/PatientBilling.tsx`
- `web/src/pages/settings/PatientPortalSettings.tsx`

**修改（前端）:**
- `web/src/App.tsx` — 新增 /patient/* 路由分支
- `web/src/components/Layout.tsx` — 侧边栏「设置」分组下新增「患者端管理」菜单项

---

## Task 1: 后端数据模型 + DB Migration

**Files:**
- Create: `server/model/patient_user.go`
- Create: `server/model/patient_portal_config.go`
- Modify: `server/database/database.go`

- [ ] **Step 1: 创建 PatientUser 模型**

```go
// server/model/patient_user.go
package model

import "time"

// PatientUser 是患者端门户账号，独立于诊所员工的 User 模型。
// password = bcrypt(last4(phone))，前端永不展示密码字段。
type PatientUser struct {
	ID           uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID     uint64    `gorm:"column:tenant_id;not null;index;uniqueIndex:idx_pu_tenant_phone" json:"tenant_id"`
	Phone        string    `gorm:"column:phone;type:varchar(20);not null;uniqueIndex:idx_pu_tenant_phone" json:"phone"`
	Name         string    `gorm:"column:name;type:varchar(50);not null" json:"name"`
	PasswordHash string    `gorm:"column:password_hash;type:varchar(255);not null" json:"-"`
	PatientID    *uint64   `gorm:"column:patient_id;index" json:"patient_id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (PatientUser) TableName() string { return "patient_users" }
```

- [ ] **Step 2: 创建 PatientPortalConfig 模型**

```go
// server/model/patient_portal_config.go
package model

// PatientPortalConfig 存储每个租户的患者端功能开关。
// 每租户一行（TenantID 为主键），行不存在时默认全部开启。
type PatientPortalConfig struct {
	TenantID           uint64 `gorm:"primaryKey" json:"tenant_id"`
	LoginEnabled       bool   `gorm:"column:login_enabled;not null;default:true" json:"login_enabled"`
	RegisterEnabled    bool   `gorm:"column:register_enabled;not null;default:true" json:"register_enabled"`
	AppointmentEnabled bool   `gorm:"column:appointment_enabled;not null;default:true" json:"appointment_enabled"`
	QueueEnabled       bool   `gorm:"column:queue_enabled;not null;default:true" json:"queue_enabled"`
	RecordsEnabled     bool   `gorm:"column:records_enabled;not null;default:true" json:"records_enabled"`
}

func (PatientPortalConfig) TableName() string { return "patient_portal_configs" }
```

- [ ] **Step 3: 加入 AutoMigrate**

在 `server/database/database.go` 的 `db.AutoMigrate(...)` 调用末尾追加：
```go
&model.PatientUser{},
&model.PatientPortalConfig{},
```

- [ ] **Step 4: 验证编译通过**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go build ./...
```
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add server/model/patient_user.go server/model/patient_portal_config.go server/database/database.go
git commit -m "feat: add PatientUser and PatientPortalConfig models"
```

---

## Task 2: 患者 JWT 中间件

**Files:**
- Create: `server/middleware/patient_auth.go`

- [ ] **Step 1: 创建文件**

```go
// server/middleware/patient_auth.go
package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const (
	CtxKeyPatientUserID = "patient_user_id"
	CtxKeyPatientID     = "patient_id"
	CtxKeyPatientTenantID = "patient_tenant_id"
)

// PatientClaims holds JWT payload for patient portal tokens.
type PatientClaims struct {
	PatientUserID uint64  `json:"patient_user_id"`
	PatientID     *uint64 `json:"patient_id"`
	TenantID      uint64  `json:"tenant_id"`
	UserType      string  `json:"user_type"` // always "patient"
	jwt.RegisteredClaims
}

// GeneratePatientToken signs a 30-day JWT for a patient user.
func GeneratePatientToken(patientUserID uint64, patientID *uint64, tenantID uint64, secret string) (string, error) {
	claims := PatientClaims{
		PatientUserID: patientUserID,
		PatientID:     patientID,
		TenantID:      tenantID,
		UserType:      "patient",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// PatientAuthMiddleware validates patient JWT and rejects staff tokens.
func PatientAuthMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "missing authorization header"})
			return
		}
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "invalid authorization header format"})
			return
		}
		claims := &PatientClaims{}
		token, err := jwt.ParseWithClaims(parts[1], claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid || claims.UserType != "patient" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "invalid or expired token"})
			return
		}
		c.Set(CtxKeyPatientUserID, claims.PatientUserID)
		c.Set(CtxKeyPatientID, claims.PatientID)
		c.Set(CtxKeyPatientTenantID, claims.TenantID)
		c.Next()
	}
}

// GetPatientUserID extracts patient_user_id from context.
func GetPatientUserID(c *gin.Context) uint64 {
	v, _ := c.Get(CtxKeyPatientUserID)
	id, _ := v.(uint64)
	return id
}

// GetPatientTenantID extracts tenant_id from patient context.
func GetPatientTenantID(c *gin.Context) uint64 {
	v, _ := c.Get(CtxKeyPatientTenantID)
	id, _ := v.(uint64)
	return id
}

// GetPatientIDFromCtx extracts the patient_id pointer from context.
// May be nil if the patient_user has no linked patient record.
func GetPatientIDFromCtx(c *gin.Context) *uint64 {
	v, _ := c.Get(CtxKeyPatientID)
	id, _ := v.(*uint64)
	return id
}
```

- [ ] **Step 2: 编译验证**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add server/middleware/patient_auth.go
git commit -m "feat: add PatientAuthMiddleware and GeneratePatientToken"
```

---

## Task 3: 患者认证 Service

**Files:**
- Create: `server/service/patient_auth.go`
- Create: `server/service/patient_auth_test.go`

- [ ] **Step 1: 先写测试（TDD RED）**

```go
// server/service/patient_auth_test.go
package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPatientAuthService_Login_NewUser_AutoCreatesPatient(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	// Tenant must exist
	tenant := model.Tenant{Name: "测试诊所", Code: "test001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	pu, err := svc.Login(uint64(tenant.ID), "13800138001", "张三")
	require.NoError(t, err)
	assert.Equal(t, "13800138001", pu.Phone)
	assert.Equal(t, "张三", pu.Name)
	assert.NotNil(t, pu.PatientID, "should auto-create patient record")

	// Patient record should exist
	var patient model.Patient
	require.NoError(t, db.First(&patient, *pu.PatientID).Error)
	assert.Equal(t, "张三", patient.Name)
}

func TestPatientAuthService_Login_ExistingPatientLinked(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	tenant := model.Tenant{Name: "联动诊所", Code: "link001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	// Pre-existing patient record with matching phone
	existing := model.Patient{TenantID: uint64(tenant.ID), Name: "李四", Phone: "13900139002", Gender: 1, CreatedBy: 1}
	require.NoError(t, db.Create(&existing).Error)

	pu, err := svc.Login(uint64(tenant.ID), "13900139002", "李四")
	require.NoError(t, err)
	require.NotNil(t, pu.PatientID)
	assert.Equal(t, existing.ID, *pu.PatientID, "should link to existing patient")
}

func TestPatientAuthService_Login_ExistingUser_WrongName(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	tenant := model.Tenant{Name: "安全诊所", Code: "sec001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	// First login creates the account
	_, err := svc.Login(uint64(tenant.ID), "13700137003", "王五")
	require.NoError(t, err)

	// Second login with wrong name
	_, err = svc.Login(uint64(tenant.ID), "13700137003", "错误姓名")
	assert.ErrorIs(t, err, service.ErrPatientWrongCredentials)
}

func TestPatientAuthService_Login_LoginDisabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	tenant := model.Tenant{Name: "关闭诊所", Code: "off001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	cfg := model.PatientPortalConfig{TenantID: uint64(tenant.ID), LoginEnabled: false, RegisterEnabled: true, AppointmentEnabled: true, QueueEnabled: true, RecordsEnabled: true}
	require.NoError(t, db.Create(&cfg).Error)

	_, err := svc.Login(uint64(tenant.ID), "13600136004", "赵六")
	assert.ErrorIs(t, err, service.ErrPatientLoginDisabled)
}

func TestPatientAuthService_Login_RegisterDisabled_NewUser(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := service.NewPatientAuthService(db)

	tenant := model.Tenant{Name: "禁注诊所", Code: "noreg001", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)

	cfg := model.PatientPortalConfig{TenantID: uint64(tenant.ID), LoginEnabled: true, RegisterEnabled: false, AppointmentEnabled: true, QueueEnabled: true, RecordsEnabled: true}
	require.NoError(t, db.Create(&cfg).Error)

	_, err := svc.Login(uint64(tenant.ID), "13500135005", "新用户")
	assert.ErrorIs(t, err, service.ErrPatientRegisterDisabled)
}
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run TestPatientAuthService -v 2>&1 | head -30
```
Expected: 编译失败 "undefined: service.NewPatientAuthService"

- [ ] **Step 3: 实现 PatientAuthService**

```go
// server/service/patient_auth.go
package service

import (
	"errors"
	"strings"

	"github.com/callmefisher/menzhen/server/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrPatientLoginDisabled    = errors.New("patient login disabled")
	ErrPatientRegisterDisabled = errors.New("patient register disabled")
	ErrPatientWrongCredentials = errors.New("invalid phone or name")
)

// PatientAuthService handles patient portal authentication.
type PatientAuthService struct {
	db *gorm.DB
}

// NewPatientAuthService creates a new PatientAuthService.
func NewPatientAuthService(db *gorm.DB) *PatientAuthService {
	return &PatientAuthService{db: db}
}

// Login authenticates a patient or registers a new one.
// The password is transparently set to last4(phone) — never exposed to the user.
// On new registration, auto-links to existing patient record by phone, or creates one.
func (s *PatientAuthService) Login(tenantID uint64, phone, name string) (*model.PatientUser, error) {
	phone = strings.TrimSpace(phone)
	name = strings.TrimSpace(name)

	// Load portal config; if absent, defaults to all-enabled.
	cfg := model.PatientPortalConfig{
		LoginEnabled:    true,
		RegisterEnabled: true,
	}
	s.db.Where("tenant_id = ?", tenantID).First(&cfg)

	if !cfg.LoginEnabled {
		return nil, ErrPatientLoginDisabled
	}

	password := last4digits(phone)

	var pu model.PatientUser
	err := s.db.Where("tenant_id = ? AND phone = ?", tenantID, phone).First(&pu).Error
	if err == nil {
		// Existing user — verify name matches.
		if pu.Name != name {
			return nil, ErrPatientWrongCredentials
		}
		if bcryptErr := bcrypt.CompareHashAndPassword([]byte(pu.PasswordHash), []byte(password)); bcryptErr != nil {
			return nil, ErrPatientWrongCredentials
		}
		return &pu, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// New user — check register switch.
	if !cfg.RegisterEnabled {
		return nil, ErrPatientRegisterDisabled
	}

	hash, hashErr := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if hashErr != nil {
		return nil, hashErr
	}

	pu = model.PatientUser{
		TenantID:     tenantID,
		Phone:        phone,
		Name:         name,
		PasswordHash: string(hash),
	}

	// Auto-link to existing patient record by phone match.
	var patient model.Patient
	if s.db.Where("tenant_id = ? AND phone = ? AND deleted_at IS NULL", tenantID, phone).First(&patient).Error == nil {
		pu.PatientID = &patient.ID
	} else {
		// Auto-create a new patient record.
		newPatient := model.Patient{
			TenantID:  tenantID,
			Name:      name,
			Phone:     phone,
			Gender:    0,
			CreatedBy: 0, // 0 = system-created via patient self-registration
		}
		if createErr := s.db.Create(&newPatient).Error; createErr != nil {
			return nil, createErr
		}
		pu.PatientID = &newPatient.ID
	}

	if createErr := s.db.Create(&pu).Error; createErr != nil {
		return nil, createErr
	}
	return &pu, nil
}

// GetPatientPortalConfig returns the portal config for a tenant.
// Returns all-enabled defaults when no config row exists.
func (s *PatientAuthService) GetPortalConfig(tenantID uint64) model.PatientPortalConfig {
	cfg := model.PatientPortalConfig{
		TenantID:           tenantID,
		LoginEnabled:       true,
		RegisterEnabled:    true,
		AppointmentEnabled: true,
		QueueEnabled:       true,
		RecordsEnabled:     true,
	}
	s.db.Where("tenant_id = ?", tenantID).First(&cfg)
	return cfg
}

// SavePortalConfig upserts the portal config for a tenant.
func (s *PatientAuthService) SavePortalConfig(cfg model.PatientPortalConfig) error {
	return s.db.Save(&cfg).Error
}

// last4digits returns the last 4 characters of a phone number.
func last4digits(phone string) string {
	if len(phone) >= 4 {
		return phone[len(phone)-4:]
	}
	return phone
}
```

- [ ] **Step 4: 运行测试确认 GREEN**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run TestPatientAuthService -v
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/service/patient_auth.go server/service/patient_auth_test.go
git commit -m "feat: add PatientAuthService with auto-link patient registration"
```

---

## Task 4: 患者认证 Handler + 管理端开关 Handler

**Files:**
- Create: `server/handler/patient_auth.go`
- Create: `server/handler/patient_settings.go`

- [ ] **Step 1: 创建患者认证 handler**

```go
// server/handler/patient_auth.go
package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PatientLoginRequest is the JSON body for POST /api/v1/patient/auth/login.
type PatientLoginRequest struct {
	TenantCode string `json:"tenant_code" binding:"required,max=50"`
	Phone      string `json:"phone" binding:"required,max=20"`
	Name       string `json:"name" binding:"required,max=50"`
}

// PatientLoginResponse is returned on successful patient login.
type PatientLoginResponse struct {
	Token       string          `json:"token"`
	PatientUser PatientUserDTO  `json:"patient_user"`
}

// PatientUserDTO is a safe patient user representation (no password).
type PatientUserDTO struct {
	ID        uint64  `json:"id"`
	Phone     string  `json:"phone"`
	Name      string  `json:"name"`
	TenantID  uint64  `json:"tenant_id"`
	PatientID *uint64 `json:"patient_id"`
}

// PatientAuthHandler handles patient portal authentication.
type PatientAuthHandler struct {
	patientAuthSvc *service.PatientAuthService
	jwtSecret      string
	db             *gorm.DB
}

// NewPatientAuthHandler creates a new PatientAuthHandler.
func NewPatientAuthHandler(svc *service.PatientAuthService, jwtSecret string, db *gorm.DB) *PatientAuthHandler {
	return &PatientAuthHandler{patientAuthSvc: svc, jwtSecret: jwtSecret, db: db}
}

// Login handles POST /api/v1/patient/auth/login.
func (h *PatientAuthHandler) Login(c *gin.Context) {
	var req PatientLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}
	req.TenantCode = strings.TrimSpace(req.TenantCode)
	req.Phone = strings.TrimSpace(req.Phone)
	req.Name = strings.TrimSpace(req.Name)

	// Look up tenant by code.
	var tenant model.Tenant
	if err := h.db.Where("code = ? AND status = 1", req.TenantCode).First(&tenant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "诊所不存在或已禁用"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "服务错误"})
		return
	}

	pu, err := h.patientAuthSvc.Login(uint64(tenant.ID), req.Phone, req.Name)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrPatientLoginDisabled):
			c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "患者登录暂未开放"})
		case errors.Is(err, service.ErrPatientRegisterDisabled):
			c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "患者注册暂未开放"})
		case errors.Is(err, service.ErrPatientWrongCredentials):
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "手机号或姓名不匹配"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "登录失败，请稍后重试"})
		}
		return
	}

	token, err := middleware.GeneratePatientToken(pu.ID, pu.PatientID, pu.TenantID, h.jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": PatientLoginResponse{
			Token: token,
			PatientUser: PatientUserDTO{
				ID:        pu.ID,
				Phone:     pu.Phone,
				Name:      pu.Name,
				TenantID:  pu.TenantID,
				PatientID: pu.PatientID,
			},
		},
	})
}

// Me handles GET /api/v1/patient/me.
func (h *PatientAuthHandler) Me(c *gin.Context) {
	patientUserID := middleware.GetPatientUserID(c)
	if patientUserID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "unauthorized"})
		return
	}
	var pu model.PatientUser
	if err := h.db.First(&pu, patientUserID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "patient user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": PatientUserDTO{
			ID:        pu.ID,
			Phone:     pu.Phone,
			Name:      pu.Name,
			TenantID:  pu.TenantID,
			PatientID: pu.PatientID,
		},
	})
}
```

- [ ] **Step 2: 创建管理端开关 handler**

```go
// server/handler/patient_settings.go
package handler

import (
	"net/http"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
)

// PatientSettingsHandler handles admin-side patient portal config.
type PatientSettingsHandler struct {
	patientAuthSvc *service.PatientAuthService
}

// NewPatientSettingsHandler creates a new PatientSettingsHandler.
func NewPatientSettingsHandler(svc *service.PatientAuthService) *PatientSettingsHandler {
	return &PatientSettingsHandler{patientAuthSvc: svc}
}

// GetPortalConfig handles GET /api/v1/tenant/patient-portal-config.
func (h *PatientSettingsHandler) GetPortalConfig(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	cfg := h.patientAuthSvc.GetPortalConfig(tenantID)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": cfg})
}

// UpdatePortalConfig handles PUT /api/v1/tenant/patient-portal-config.
func (h *PatientSettingsHandler) UpdatePortalConfig(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	var req model.PatientPortalConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}
	req.TenantID = tenantID
	if err := h.patientAuthSvc.SavePortalConfig(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "保存失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": req})
}
```

- [ ] **Step 3: 编译验证**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add server/handler/patient_auth.go server/handler/patient_settings.go
git commit -m "feat: add PatientAuthHandler and PatientSettingsHandler"
```

---

## Task 5: 患者门户 Handler（预约/取号/病历/收费）

**Files:**
- Create: `server/handler/patient_portal.go`

```go
// server/handler/patient_portal.go
package handler

import (
	"net/http"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PatientPortalHandler handles patient-facing data endpoints.
type PatientPortalHandler struct {
	db             *gorm.DB
	patientAuthSvc *service.PatientAuthService
}

// NewPatientPortalHandler creates a new PatientPortalHandler.
func NewPatientPortalHandler(db *gorm.DB, svc *service.PatientAuthService) *PatientPortalHandler {
	return &PatientPortalHandler{db: db, patientAuthSvc: svc}
}

// portalEnabled is a helper that aborts if a specific feature switch is off.
func (h *PatientPortalHandler) portalEnabled(c *gin.Context, check func(model.PatientPortalConfig) bool) bool {
	tenantID := middleware.GetPatientTenantID(c)
	cfg := h.patientAuthSvc.GetPortalConfig(tenantID)
	if !check(cfg) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "message": "该功能暂未开放"})
		return false
	}
	return true
}

// ---------- Doctors (shared for appointments and queue) ----------

// ListDoctors handles GET /api/v1/patient/doctors.
func (h *PatientPortalHandler) ListDoctors(c *gin.Context) {
	tenantID := middleware.GetPatientTenantID(c)
	var doctors []model.QueueDoctor
	h.db.Where("tenant_id = ? AND enabled = true", tenantID).Order("sort_order").Find(&doctors)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": doctors})
}

// ---------- Appointments ----------

// ListAppointments handles GET /api/v1/patient/appointments.
func (h *PatientPortalHandler) ListAppointments(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	if patientID == nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": []model.Appointment{}})
		return
	}
	var appts []model.Appointment
	h.db.Where("tenant_id = ? AND patient_id = ?", tenantID, *patientID).
		Order("appoint_date DESC, slot_start DESC").
		Limit(50).Find(&appts)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": appts})
}

// CreateAppointmentRequest is the body for POST /api/v1/patient/appointments.
type CreateAppointmentRequest struct {
	DoctorID    uint   `json:"doctor_id" binding:"required"`
	AppointDate string `json:"appoint_date" binding:"required"` // "2024-03-27"
	SlotStart   string `json:"slot_start" binding:"required"`   // "09:30"
	SlotEnd     string `json:"slot_end" binding:"required"`
}

// CreateAppointment handles POST /api/v1/patient/appointments.
func (h *PatientPortalHandler) CreateAppointment(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientUserID := middleware.GetPatientUserID(c)
	patientID := middleware.GetPatientIDFromCtx(c)

	var req CreateAppointmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}

	// Get patient name from PatientUser.
	var pu model.PatientUser
	if err := h.db.First(&pu, patientUserID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "患者信息获取失败"})
		return
	}

	// Get doctor info.
	var doctor model.QueueDoctor
	if err := h.db.Where("id = ? AND tenant_id = ?", req.DoctorID, tenantID).First(&doctor).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "医生不存在"})
		return
	}

	// Check slot availability: count non-cancelled appointments for this slot.
	var slotCfg model.AppointmentSlotConfig
	h.db.Where("tenant_id = ? AND doctor_id = ? AND slot_start = ?", tenantID, req.DoctorID, req.SlotStart).First(&slotCfg)
	maxCount := 1
	if slotCfg.MaxCount > 0 {
		maxCount = slotCfg.MaxCount
	}

	var existingCount int64
	h.db.Model(&model.Appointment{}).
		Where("tenant_id = ? AND doctor_id = ? AND appoint_date = ? AND slot_start = ? AND status != ?",
			tenantID, req.DoctorID, req.AppointDate, req.SlotStart, model.AppointmentStatusCancelled).
		Count(&existingCount)

	if int(existingCount) >= maxCount {
		c.JSON(http.StatusConflict, gin.H{"code": 409, "message": "该时段已满，请选择其他时段"})
		return
	}

	var patientIDPtr *uint
	if patientID != nil {
		v := uint(*patientID)
		patientIDPtr = &v
	}

	appt := model.Appointment{
		TenantID:    uint(tenantID),
		PatientID:   patientIDPtr,
		PatientName: pu.Name,
		DoctorID:    req.DoctorID,
		DoctorName:  doctor.DoctorName,
		Room:        doctor.Room,
		AppointDate: req.AppointDate,
		SlotStart:   req.SlotStart,
		SlotEnd:     req.SlotEnd,
		Status:      model.AppointmentStatusPending,
	}
	if err := h.db.Create(&appt).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "预约失败，请稍后重试"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"code": 0, "message": "预约成功", "data": appt})
}

// GetAppointmentSlots handles GET /api/v1/patient/appointments/slots?doctor_id=&date=.
func (h *PatientPortalHandler) GetAppointmentSlots(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	doctorID := c.Query("doctor_id")
	date := c.Query("date")
	if doctorID == "" || date == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "doctor_id 和 date 必填"})
		return
	}

	// Get slot configs for this doctor.
	var slotConfigs []model.AppointmentSlotConfig
	h.db.Where("tenant_id = ? AND doctor_id = ?", tenantID, doctorID).Find(&slotConfigs)

	type SlotInfo struct {
		SlotStart   string `json:"slot_start"`
		SlotEnd     string `json:"slot_end"`
		MaxCount    int    `json:"max_count"`
		BookedCount int64  `json:"booked_count"`
		Available   bool   `json:"available"`
	}

	slots := make([]SlotInfo, 0, len(slotConfigs))
	for _, sc := range slotConfigs {
		var booked int64
		h.db.Model(&model.Appointment{}).
			Where("tenant_id = ? AND doctor_id = ? AND appoint_date = ? AND slot_start = ? AND status != ?",
				tenantID, doctorID, date, sc.SlotStart, model.AppointmentStatusCancelled).
			Count(&booked)
		slots = append(slots, SlotInfo{
			SlotStart:   sc.SlotStart,
			SlotEnd:     sc.SlotEnd,
			MaxCount:    sc.MaxCount,
			BookedCount: booked,
			Available:   booked < int64(sc.MaxCount),
		})
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": slots})
}

// CancelAppointment handles POST /api/v1/patient/appointments/:id/cancel.
func (h *PatientPortalHandler) CancelAppointment(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.AppointmentEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	id := c.Param("id")

	query := h.db.Model(&model.Appointment{}).
		Where("id = ? AND tenant_id = ? AND status = ?", id, tenantID, model.AppointmentStatusPending)
	if patientID != nil {
		v := uint(*patientID)
		query = query.Where("patient_id = ?", v)
	}

	result := query.Update("status", model.AppointmentStatusCancelled)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "取消失败"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "预约不存在或无法取消"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "预约已取消"})
}

// ---------- Queue (take number) ----------

// TakeQueueNumberRequest is the body for POST /api/v1/patient/queue/take.
type TakeQueueNumberRequest struct {
	DoctorID uint `json:"doctor_id" binding:"required"`
}

// TakeNumber handles POST /api/v1/patient/queue/take.
func (h *PatientPortalHandler) TakeNumber(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.QueueEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientUserID := middleware.GetPatientUserID(c)
	patientID := middleware.GetPatientIDFromCtx(c)

	var req TakeQueueNumberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "参数校验失败"})
		return
	}

	// Get patient name.
	var pu model.PatientUser
	if err := h.db.First(&pu, patientUserID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "患者信息获取失败"})
		return
	}

	// Get doctor info.
	var doctor model.QueueDoctor
	if err := h.db.Where("id = ? AND tenant_id = ?", req.DoctorID, tenantID).First(&doctor).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "医生不存在"})
		return
	}

	today := time.Now().Format("2006-01-02")

	// Atomically get + increment sequence number.
	var entry model.QueueEntry
	err := h.db.Transaction(func(tx *gorm.DB) error {
		var seq model.QueueSeq
		result := tx.Where("tenant_id = ? AND queue_date = ?", tenantID, today).First(&seq)
		if result.Error != nil {
			seq = model.QueueSeq{TenantID: uint(tenantID), QueueDate: today, LastSeq: 0}
			if createErr := tx.Create(&seq).Error; createErr != nil {
				return createErr
			}
		}
		seq.LastSeq++
		if saveErr := tx.Save(&seq).Error; saveErr != nil {
			return saveErr
		}

		var patientIDUint *uint
		if patientID != nil {
			v := uint(*patientID)
			patientIDUint = &v
		}
		now := time.Now()
		entry = model.QueueEntry{
			TenantID:    uint(tenantID),
			PatientID:   patientIDUint,
			PatientName: pu.Name,
			DoctorID:    req.DoctorID,
			DoctorName:  doctor.DoctorName,
			Room:        doctor.Room,
			SeqNumber:   seq.LastSeq,
			Status:      model.QueueStatusWaiting,
			Source:      "patient_portal",
			QueueDate:   today,
			ArrivalTime: &now,
		}
		return tx.Create(&entry).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": "取号失败，请稍后重试"})
		return
	}

	// Count waiting patients ahead.
	var waitingAhead int64
	h.db.Model(&model.QueueEntry{}).
		Where("tenant_id = ? AND doctor_id = ? AND queue_date = ? AND status = ? AND seq_number < ?",
			tenantID, req.DoctorID, today, model.QueueStatusWaiting, entry.SeqNumber).
		Count(&waitingAhead)

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "取号成功",
		"data": gin.H{
			"queue_entry":   entry,
			"waiting_ahead": waitingAhead,
		},
	})
}

// GetMyQueueStatus handles GET /api/v1/patient/queue/my-status.
func (h *PatientPortalHandler) GetMyQueueStatus(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.QueueEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientUserID := middleware.GetPatientUserID(c)

	var pu model.PatientUser
	if err := h.db.First(&pu, patientUserID).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": nil})
		return
	}

	today := time.Now().Format("2006-01-02")
	var entry model.QueueEntry
	err := h.db.Where("tenant_id = ? AND patient_name = ? AND queue_date = ? AND status IN ?",
		tenantID, pu.Name, today, []string{model.QueueStatusWaiting, model.QueueStatusSeeing}).
		Order("created_at DESC").First(&entry).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": nil})
		return
	}

	var waitingAhead int64
	h.db.Model(&model.QueueEntry{}).
		Where("tenant_id = ? AND doctor_id = ? AND queue_date = ? AND status = ? AND seq_number < ?",
			tenantID, entry.DoctorID, today, model.QueueStatusWaiting, entry.SeqNumber).
		Count(&waitingAhead)

	c.JSON(http.StatusOK, gin.H{
		"code": 0, "message": "success",
		"data": gin.H{"queue_entry": entry, "waiting_ahead": waitingAhead},
	})
}

// ---------- Medical Records (read-only) ----------

// ListRecords handles GET /api/v1/patient/records.
func (h *PatientPortalHandler) ListRecords(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.RecordsEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	if patientID == nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": []model.MedicalRecord{}})
		return
	}
	var records []model.MedicalRecord
	h.db.Where("tenant_id = ? AND patient_id = ?", tenantID, *patientID).
		Order("visit_date DESC").Limit(100).Find(&records)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": records})
}

// GetRecord handles GET /api/v1/patient/records/:id.
func (h *PatientPortalHandler) GetRecord(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.RecordsEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	id := c.Param("id")

	var record model.MedicalRecord
	query := h.db.Where("id = ? AND tenant_id = ?", id, tenantID)
	if patientID != nil {
		query = query.Where("patient_id = ?", *patientID)
	}
	if err := query.First(&record).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "记录不存在"})
		return
	}

	// Preload prescriptions and items.
	var prescriptions []model.Prescription
	h.db.Where("record_id = ?", record.ID).Find(&prescriptions)
	for i := range prescriptions {
		var items []model.PrescriptionItem
		h.db.Where("prescription_id = ?", prescriptions[i].ID).Find(&items)
		prescriptions[i].Items = items
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0, "message": "success",
		"data": gin.H{"record": record, "prescriptions": prescriptions},
	})
}

// ---------- Billing (read-only) ----------

// ListBillings handles GET /api/v1/patient/billings.
func (h *PatientPortalHandler) ListBillings(c *gin.Context) {
	if !h.portalEnabled(c, func(cfg model.PatientPortalConfig) bool { return cfg.RecordsEnabled }) {
		return
	}
	tenantID := middleware.GetPatientTenantID(c)
	patientID := middleware.GetPatientIDFromCtx(c)
	if patientID == nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": []model.Billing{}})
		return
	}

	// Get record IDs for this patient.
	var recordIDs []uint64
	h.db.Model(&model.MedicalRecord{}).
		Where("tenant_id = ? AND patient_id = ?", tenantID, *patientID).
		Pluck("id", &recordIDs)

	if len(recordIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": []model.Billing{}})
		return
	}

	var billings []model.Billing
	h.db.Where("tenant_id = ? AND record_id IN ?", tenantID, recordIDs).
		Order("created_at DESC").Limit(100).Find(&billings)
	c.JSON(http.StatusOK, gin.H{"code": 0, "message": "success", "data": billings})
}
```

- [ ] **编译验证**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go build ./...
```

- [ ] **Commit**

```bash
git add server/handler/patient_portal.go
git commit -m "feat: add PatientPortalHandler (appointments, queue, records, billing)"
```

---

## Task 6: Router 接线（后端完整）

**Files:**
- Modify: `server/router/router.go`

在 `SetupRouter` 函数中，在已有路由组之后追加：

```go
// ---------- Patient portal handlers ----------
patientAuthSvc := service.NewPatientAuthService(db)
patientAuthHandler := handler.NewPatientAuthHandler(patientAuthSvc, cfg.JWTSecret, db)
patientSettingsHandler := handler.NewPatientSettingsHandler(patientAuthSvc)
patientPortalHandler := handler.NewPatientPortalHandler(db, patientAuthSvc)

// Public patient auth route (no JWT required).
patientPublic := v1.Group("/patient")
{
    patientPublic.POST("/auth/login", patientAuthHandler.Login)
}

// Authenticated patient routes (patient JWT required).
patientAuth := v1.Group("/patient")
patientAuth.Use(middleware.PatientAuthMiddleware(cfg.JWTSecret))
{
    patientAuth.GET("/me", patientAuthHandler.Me)
    patientAuth.GET("/doctors", patientPortalHandler.ListDoctors)

    // Appointments
    patientAuth.GET("/appointments", patientPortalHandler.ListAppointments)
    patientAuth.POST("/appointments", patientPortalHandler.CreateAppointment)
    patientAuth.GET("/appointments/slots", patientPortalHandler.GetAppointmentSlots)
    patientAuth.POST("/appointments/:id/cancel", patientPortalHandler.CancelAppointment)

    // Queue
    patientAuth.POST("/queue/take", patientPortalHandler.TakeNumber)
    patientAuth.GET("/queue/my-status", patientPortalHandler.GetMyQueueStatus)

    // Records (read-only)
    patientAuth.GET("/records", patientPortalHandler.ListRecords)
    patientAuth.GET("/records/:id", patientPortalHandler.GetRecord)

    // Billing (read-only)
    patientAuth.GET("/billings", patientPortalHandler.ListBillings)
}

// Admin: patient portal config (tenant:user:manage required).
authenticated.GET("/tenant/patient-portal-config",
    middleware.RequirePermission(db, "tenant:user:manage"),
    patientSettingsHandler.GetPortalConfig)
authenticated.PUT("/tenant/patient-portal-config",
    middleware.RequirePermission(db, "tenant:user:manage"),
    patientSettingsHandler.UpdatePortalConfig)
```

- [ ] **编译并运行完整后端测试**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go build ./... && go test ./... 2>&1 | tail -20
```
Expected: 所有测试 PASS，无编译错误

- [ ] **Commit**

```bash
git add server/router/router.go
git commit -m "feat: wire patient portal routes in router"
```

---

## Task 7: 前端基础设施（patient request + store + API）

**Files:**
- Create: `web/src/utils/patientRequest.ts`
- Create: `web/src/api/patientAuth.ts`
- Create: `web/src/api/patientPortal.ts`
- Create: `web/src/store/patientAuth.tsx`

- [ ] **Step 1: 创建患者专用 axios 实例**

```typescript
// web/src/utils/patientRequest.ts
import axios from 'axios';
import { message } from 'antd';

const patientRequest = axios.create({
  baseURL: '/api/v1/patient',
  timeout: 30000,
});

// Attach patient JWT (stored under 'patient_token').
patientRequest.interceptors.request.use((config) => {
  const token = localStorage.getItem('patient_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

patientRequest.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('patient_token');
      if (!window.location.pathname.startsWith('/patient/login')) {
        window.location.href = '/patient/login';
      }
      return Promise.reject(error);
    }
    const msg = error.response?.data?.message || '请求失败';
    message.error(msg);
    return Promise.reject(error);
  }
);

export default patientRequest;
```

- [ ] **Step 2: 创建患者认证 API**

```typescript
// web/src/api/patientAuth.ts
import patientRequest from '../utils/patientRequest';

export interface PatientUserDTO {
  id: number;
  phone: string;
  name: string;
  tenant_id: number;
  patient_id: number | null;
}

export interface PatientLoginResponse {
  token: string;
  patient_user: PatientUserDTO;
}

export function patientLogin(data: {
  tenant_code: string;
  phone: string;
  name: string;
}): Promise<{ code: number; data: PatientLoginResponse }> {
  return patientRequest.post('/auth/login', data) as Promise<{ code: number; data: PatientLoginResponse }>;
}

export function getPatientMe(): Promise<{ code: number; data: PatientUserDTO }> {
  return patientRequest.get('/me') as Promise<{ code: number; data: PatientUserDTO }>;
}
```

- [ ] **Step 3: 创建患者门户 API**

```typescript
// web/src/api/patientPortal.ts
import patientRequest from '../utils/patientRequest';

// --- Types ---
export interface Doctor {
  id: number;
  doctor_name: string;
  room: string;
  sort_order: number;
}

export interface Appointment {
  id: number;
  patient_name: string;
  doctor_id: number;
  doctor_name: string;
  room: string;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
  status: string;
  created_at: string;
}

export interface SlotInfo {
  slot_start: string;
  slot_end: string;
  max_count: number;
  booked_count: number;
  available: boolean;
}

export interface QueueEntry {
  id: number;
  seq_number: number;
  status: string;
  doctor_name: string;
  room: string;
  queue_date: string;
}

export interface MedicalRecord {
  id: number;
  visit_date: string;
  diagnosis: string;
  treatment: string;
  chief_complaint: string;
  notes: string;
}

export interface Billing {
  id: number;
  record_id: number;
  consultation_fee: number;
  drug_cost_total: number;
  total_amount: number;
  actual_paid: number;
  created_at: string;
}

export interface PatientPortalConfig {
  tenant_id: number;
  login_enabled: boolean;
  register_enabled: boolean;
  appointment_enabled: boolean;
  queue_enabled: boolean;
  records_enabled: boolean;
}

// --- API calls ---
export const listDoctors = () =>
  patientRequest.get('/doctors') as Promise<{ data: Doctor[] }>;

export const listAppointments = () =>
  patientRequest.get('/appointments') as Promise<{ data: Appointment[] }>;

export const createAppointment = (data: {
  doctor_id: number;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
}) => patientRequest.post('/appointments', data);

export const getAppointmentSlots = (doctorId: number, date: string) =>
  patientRequest.get('/appointments/slots', { params: { doctor_id: doctorId, date } }) as Promise<{ data: SlotInfo[] }>;

export const cancelAppointment = (id: number) =>
  patientRequest.post(`/appointments/${id}/cancel`);

export const takeQueueNumber = (doctorId: number) =>
  patientRequest.post('/queue/take', { doctor_id: doctorId });

export const getMyQueueStatus = () =>
  patientRequest.get('/queue/my-status');

export const listRecords = () =>
  patientRequest.get('/records') as Promise<{ data: MedicalRecord[] }>;

export const getRecord = (id: number) =>
  patientRequest.get(`/records/${id}`);

export const listBillings = () =>
  patientRequest.get('/billings') as Promise<{ data: Billing[] }>;

// Admin portal config (uses main request instance)
import request from '../utils/request';
export const getPatientPortalConfig = () =>
  request.get('/tenant/patient-portal-config') as Promise<{ data: PatientPortalConfig }>;
export const updatePatientPortalConfig = (data: Partial<PatientPortalConfig>) =>
  request.put('/tenant/patient-portal-config', data);
```

- [ ] **Step 4: 创建患者认证 Store**

```typescript
// web/src/store/patientAuth.tsx
import {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import type { ReactNode } from 'react';
import { patientLogin, getPatientMe } from '../api/patientAuth';
import type { PatientUserDTO } from '../api/patientAuth';

interface PatientAuthState {
  user: PatientUserDTO | null;
  token: string | null;
  loading: boolean;
}

interface PatientAuthContextValue extends PatientAuthState {
  login: (tenantCode: string, phone: string, name: string) => Promise<void>;
  logout: () => void;
}

const PatientAuthContext = createContext<PatientAuthContextValue | null>(null);

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PatientAuthState>({
    user: null,
    token: localStorage.getItem('patient_token'),
    loading: true,
  });

  useEffect(() => {
    if (state.token) {
      getPatientMe()
        .then((res) => {
          setState((prev) => ({ ...prev, user: res.data, loading: false }));
        })
        .catch(() => {
          localStorage.removeItem('patient_token');
          setState({ user: null, token: null, loading: false });
        });
    } else {
      setState((prev) => ({ ...prev, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (tenantCode: string, phone: string, name: string) => {
    const res = await patientLogin({ tenant_code: tenantCode, phone, name });
    localStorage.setItem('patient_token', res.data.token);
    setState({ user: res.data.patient_user, token: res.data.token, loading: false });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('patient_token');
    setState({ user: null, token: null, loading: false });
  }, []);

  return (
    <PatientAuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </PatientAuthContext.Provider>
  );
}

export function usePatientAuth(): PatientAuthContextValue {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider');
  return ctx;
}
```

- [ ] **编译验证**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -20
```

- [ ] **Commit**

```bash
git add web/src/utils/patientRequest.ts web/src/api/patientAuth.ts web/src/api/patientPortal.ts web/src/store/patientAuth.tsx
git commit -m "feat: add patient frontend infrastructure (request, API, auth store)"
```

---

## Task 8: PatientLayout + PatientRoute + 所有页面 + App.tsx 路由

**Files:**
- Create: `web/src/components/PatientLayout.tsx`
- Create: `web/src/pages/patient/PatientLogin.tsx`
- Create: `web/src/pages/patient/PatientHome.tsx`
- Create: `web/src/pages/patient/PatientAppointment.tsx`
- Create: `web/src/pages/patient/PatientQueue.tsx`
- Create: `web/src/pages/patient/PatientRecords.tsx`
- Create: `web/src/pages/patient/PatientRecordDetail.tsx`
- Create: `web/src/pages/patient/PatientBilling.tsx`
- Modify: `web/src/App.tsx`

### PatientLayout（底部导航）

```typescript
// web/src/components/PatientLayout.tsx
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { CalendarOutlined, NumberOutlined, FileTextOutlined, UserOutlined, HomeOutlined } from '@ant-design/icons';

const TABS = [
  { path: '/patient/home', icon: <HomeOutlined />, label: '首页' },
  { path: '/patient/appointments', icon: <CalendarOutlined />, label: '预约' },
  { path: '/patient/queue', icon: <NumberOutlined />, label: '取号' },
  { path: '/patient/me', icon: <UserOutlined />, label: '我的' },
];

export default function PatientLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f7fa' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 56 }}>
        <Outlet />
      </div>
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480,
        display: 'flex', background: '#fff',
        borderTop: '1px solid #f0f0f0',
        zIndex: 100,
      }}>
        {TABS.map((tab) => {
          const active = location.pathname.startsWith(tab.path);
          return (
            <div
              key={tab.path}
              onClick={() => navigate(tab.path)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '6px 0 4px', cursor: 'pointer',
                color: active ? '#52C41A' : '#aaa',
                fontSize: 20,
              }}
            >
              {tab.icon}
              <span style={{ fontSize: 10, marginTop: 2 }}>{tab.label}</span>
              {active && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#52C41A', marginTop: 2 }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### PatientLogin

```typescript
// web/src/pages/patient/PatientLogin.tsx
import { useState, useEffect } from 'react';
import { Form, Input, Button, message } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePatientAuth } from '../../store/patientAuth';

export default function PatientLogin() {
  const [loading, setLoading] = useState(false);
  const { login, token } = usePatientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();

  // Pre-fill tenant code from URL query ?code=
  useEffect(() => {
    const code = searchParams.get('code');
    if (code) form.setFieldValue('tenant_code', code);
  }, [searchParams, form]);

  // Redirect if already logged in
  useEffect(() => {
    if (token) navigate('/patient/home', { replace: true });
  }, [token, navigate]);

  const onFinish = async (values: { tenant_code: string; phone: string; name: string }) => {
    setLoading(true);
    try {
      await login(values.tenant_code, values.phone, values.name);
      message.success('登录成功');
      navigate('/patient/home', { replace: true });
    } catch {
      // error handled by interceptor
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #f6ffed 0%, #fff 55%)' }}>
      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, #52C41A, #389E0D)',
        padding: '32px 20px 48px', color: '#fff', position: 'relative',
      }}>
        <div style={{ fontSize: 36 }}>🌿</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>患者服务中心</div>
        <div style={{
          position: 'absolute', bottom: -20, left: 0, right: 0, height: 40,
          background: '#fff', borderRadius: '50% 50% 0 0',
        }} />
      </div>

      {/* Form */}
      <div style={{ padding: '32px 20px 20px' }}>
        <Form form={form} onFinish={onFinish} layout="vertical" size="large">
          <Form.Item
            name="tenant_code"
            label="诊所代码"
            rules={[{ required: true, message: '请输入诊所代码' }]}
          >
            <Input prefix="🏥" placeholder="由诊所提供（扫码自动填写）" />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' },
            ]}
          >
            <Input prefix="📱" placeholder="请输入手机号" />
          </Form.Item>
          <Form.Item
            name="name"
            label="真实姓名"
            rules={[{ required: true, message: '请输入真实姓名' }]}
          >
            <Input prefix="👤" placeholder="请输入就诊时使用的真实姓名" />
          </Form.Item>
          <Form.Item style={{ marginTop: 8 }}>
            <Button
              type="primary" htmlType="submit" block loading={loading}
              style={{ background: '#52C41A', borderColor: '#52C41A', height: 44, fontSize: 16 }}
            >
              登录 / 注册
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 8 }}>
          首次使用自动注册 · 无需设置密码
        </div>
      </div>
    </div>
  );
}
```

### PatientHome

```typescript
// web/src/pages/patient/PatientHome.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, List, Tag, Spin } from 'antd';
import { CalendarOutlined, NumberOutlined, FileTextOutlined, DollarOutlined } from '@ant-design/icons';
import { usePatientAuth } from '../../store/patientAuth';
import { listAppointments, listRecords } from '../../api/patientPortal';
import type { Appointment, MedicalRecord } from '../../api/patientPortal';

const QUICK_ACTIONS = [
  { icon: <CalendarOutlined style={{ fontSize: 24, color: '#52C41A' }} />, label: '在线预约', sub: '选医生选时段', path: '/patient/appointments', primary: true },
  { icon: <NumberOutlined style={{ fontSize: 24, color: '#1890ff' }} />, label: '快捷取号', sub: '到院后自助取号', path: '/patient/queue' },
  { icon: <FileTextOutlined style={{ fontSize: 24, color: '#722ed1' }} />, label: '我的病历', sub: '历次就诊记录', path: '/patient/records' },
  { icon: <DollarOutlined style={{ fontSize: 24, color: '#fa8c16' }} />, label: '收费明细', sub: '账单记录', path: '/patient/billing' },
];

export default function PatientHome() {
  const { user } = usePatientAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listAppointments().catch(() => ({ data: [] as Appointment[] })),
      listRecords().catch(() => ({ data: [] as MedicalRecord[] })),
    ]).then(([apptRes, recRes]) => {
      setAppointments(apptRes.data.slice(0, 3));
      setRecords(recRes.data.slice(0, 3));
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin /></div>;

  const upcomingAppt = appointments.find(a => a.status === 'pending');

  return (
    <div>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #52C41A, #389E0D)', padding: '16px 16px 24px', color: '#fff' }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>你好，</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{user?.name} 👋</div>
        {user?.patient_id && (
          <Tag style={{ marginTop: 6, background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: 11 }}>
            🔗 档案已关联
          </Tag>
        )}
      </div>

      <div style={{ padding: '0 12px', marginTop: -12 }}>
        {/* Upcoming appointment notice */}
        {upcomingAppt && (
          <Card
            size="small"
            style={{ marginBottom: 12, borderLeft: '3px solid #52C41A', cursor: 'pointer' }}
            onClick={() => navigate('/patient/appointments')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>📅</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{upcomingAppt.appoint_date} {upcomingAppt.slot_start} · {upcomingAppt.doctor_name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>预约已确认，请准时到诊</div>
              </div>
              <span style={{ color: '#52C41A' }}>›</span>
            </div>
          </Card>
        )}

        {/* Quick actions grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {QUICK_ACTIONS.map((action) => (
            <Card
              key={action.path}
              size="small"
              hoverable
              onClick={() => navigate(action.path)}
              style={{ textAlign: 'center', background: action.primary ? 'linear-gradient(135deg, #f6ffed, #d9f7be)' : '#fff' }}
            >
              {action.icon}
              <div style={{ fontWeight: 600, marginTop: 4, fontSize: 13 }}>{action.label}</div>
              <div style={{ fontSize: 11, color: '#aaa' }}>{action.sub}</div>
            </Card>
          ))}
        </div>

        {/* Recent records */}
        {records.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 8, textTransform: 'uppercase' }}>最近就诊</div>
            <List
              dataSource={records}
              renderItem={(r) => (
                <Card
                  size="small"
                  style={{ marginBottom: 8, borderLeft: '3px solid #52C41A', cursor: 'pointer' }}
                  onClick={() => navigate(`/patient/records/${r.id}`)}
                >
                  <div style={{ fontSize: 11, color: '#aaa' }}>{r.visit_date?.slice(0, 10)}</div>
                  <div style={{ fontWeight: 600 }}>{r.diagnosis || '无诊断记录'}</div>
                </Card>
              )}
            />
          </>
        )}
      </div>
    </div>
  );
}
```

### PatientAppointment

```typescript
// web/src/pages/patient/PatientAppointment.tsx
import { useEffect, useState } from 'react';
import { List, Card, Tag, Button, Modal, Select, DatePicker, message, Empty, Spin } from 'antd';
import dayjs from 'dayjs';
import { listAppointments, listDoctors, getAppointmentSlots, createAppointment, cancelAppointment } from '../../api/patientPortal';
import type { Appointment, Doctor, SlotInfo } from '../../api/patientPortal';

export default function PatientAppointment() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = () => {
    setLoading(true);
    Promise.all([listAppointments(), listDoctors()]).then(([apptRes, docRes]) => {
      setAppointments(apptRes.data);
      setDoctors(docRes.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (selectedDoctor && selectedDate) {
      getAppointmentSlots(selectedDoctor, selectedDate).then((res) => setSlots(res.data));
    }
  }, [selectedDoctor, selectedDate]);

  const handleBook = async () => {
    if (!selectedDoctor || !selectedDate || !selectedSlot) {
      message.warning('请选择医生、日期和时段');
      return;
    }
    setSubmitting(true);
    try {
      await createAppointment({
        doctor_id: selectedDoctor,
        appoint_date: selectedDate,
        slot_start: selectedSlot.slot_start,
        slot_end: selectedSlot.slot_end,
      });
      message.success('预约成功');
      setModalOpen(false);
      setSelectedDoctor(null); setSelectedDate(null); setSelectedSlot(null); setSlots([]);
      fetchData();
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor: Record<string, string> = { pending: 'blue', queued: 'green', cancelled: 'default', no_show: 'red' };
  const statusLabel: Record<string, string> = { pending: '已预约', queued: '已入队', cancelled: '已取消', no_show: '未到' };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ padding: '16px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>我的预约</div>
        <Button type="primary" onClick={() => setModalOpen(true)} style={{ background: '#52C41A', borderColor: '#52C41A' }}>
          + 新建预约
        </Button>
      </div>

      {appointments.length === 0 ? (
        <Empty description="暂无预约记录" />
      ) : (
        <List
          dataSource={appointments}
          renderItem={(a) => (
            <Card size="small" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.appoint_date} {a.slot_start}–{a.slot_end}</div>
                  <div style={{ color: '#888', fontSize: 13 }}>{a.doctor_name} · {a.room}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <Tag color={statusColor[a.status]}>{statusLabel[a.status] ?? a.status}</Tag>
                  {a.status === 'pending' && (
                    <Button
                      size="small" danger
                      onClick={() => cancelAppointment(a.id).then(() => { message.success('已取消'); fetchData(); })}
                    >取消</Button>
                  )}
                </div>
              </div>
            </Card>
          )}
        />
      )}

      <Modal
        title="新建预约" open={modalOpen} onOk={handleBook}
        onCancel={() => { setModalOpen(false); setSelectedDoctor(null); setSelectedDate(null); setSelectedSlot(null); setSlots([]); }}
        okText="确认预约" confirmLoading={submitting}
        okButtonProps={{ style: { background: '#52C41A', borderColor: '#52C41A' } }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
          <Select
            placeholder="选择医生"
            style={{ width: '100%' }}
            onChange={setSelectedDoctor}
            options={doctors.map(d => ({ value: d.id, label: `${d.doctor_name}${d.room ? ` · ${d.room}` : ''}` }))}
          />
          <DatePicker
            style={{ width: '100%' }}
            disabledDate={(d) => d.isBefore(dayjs(), 'day')}
            onChange={(_, ds) => { setSelectedDate(ds as string); setSelectedSlot(null); }}
          />
          {slots.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>选择时段</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {slots.map((s) => (
                  <div
                    key={s.slot_start}
                    onClick={() => s.available && setSelectedSlot(s)}
                    style={{
                      border: `1px solid ${!s.available ? '#e8e8e8' : selectedSlot?.slot_start === s.slot_start ? '#52C41A' : '#b7eb8f'}`,
                      borderRadius: 6, padding: '6px 4px', textAlign: 'center',
                      background: !s.available ? '#f5f5f5' : selectedSlot?.slot_start === s.slot_start ? '#52C41A' : '#f6ffed',
                      color: !s.available ? '#ccc' : selectedSlot?.slot_start === s.slot_start ? '#fff' : '#389E0D',
                      cursor: s.available ? 'pointer' : 'not-allowed',
                      fontSize: 12, fontWeight: 600,
                    }}
                  >
                    {s.slot_start}<br />
                    <span style={{ fontSize: 10, fontWeight: 400 }}>{!s.available ? '已满' : `剩${s.max_count - s.booked_count}位`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
```

### PatientQueue

```typescript
// web/src/pages/patient/PatientQueue.tsx
import { useEffect, useState } from 'react';
import { Card, Button, Select, message, Spin, Tag } from 'antd';
import { takeQueueNumber, getMyQueueStatus, listDoctors } from '../../api/patientPortal';
import type { Doctor, QueueEntry } from '../../api/patientPortal';

export default function PatientQueue() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<number | null>(null);
  const [myEntry, setMyEntry] = useState<{ queue_entry: QueueEntry; waiting_ahead: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [taking, setTaking] = useState(false);

  useEffect(() => {
    Promise.all([
      listDoctors().catch(() => ({ data: [] as Doctor[] })),
      (getMyQueueStatus() as Promise<{ data: { queue_entry: QueueEntry; waiting_ahead: number } | null }>).catch(() => ({ data: null })),
    ]).then(([docRes, statusRes]) => {
      setDoctors(docRes.data);
      setMyEntry(statusRes.data);
    }).finally(() => setLoading(false));
  }, []);

  const handleTake = async () => {
    if (!selectedDoctor) { message.warning('请先选择医生'); return; }
    setTaking(true);
    try {
      const res = await takeQueueNumber(selectedDoctor) as { data: { queue_entry: QueueEntry; waiting_ahead: number } };
      setMyEntry(res.data);
      message.success('取号成功！');
    } finally {
      setTaking(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  if (myEntry && (myEntry.queue_entry.status === 'waiting' || myEntry.queue_entry.status === 'seeing')) {
    const { queue_entry: e, waiting_ahead } = myEntry;
    return (
      <div style={{ padding: '20px 16px' }}>
        <div style={{
          background: 'linear-gradient(135deg, #389E0D, #237804)', borderRadius: 16,
          padding: '24px 20px', color: '#fff', textAlign: 'center', marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, opacity: 0.85 }}>您的号码</div>
          <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1 }}>{e.seq_number}</div>
          <div style={{ fontSize: 14 }}>{e.doctor_name} {e.room && `· ${e.room}`}</div>
          {e.status === 'seeing' && <Tag color="gold" style={{ marginTop: 8 }}>就诊中</Tag>}
        </div>
        <Card size="small" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ color: '#888' }}>前方等候</span>
            <span style={{ fontWeight: 600 }}>{waiting_ahead} 人</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ color: '#888' }}>状态</span>
            <Tag color={e.status === 'seeing' ? 'gold' : 'blue'}>{e.status === 'seeing' ? '就诊中' : '等候中'}</Tag>
          </div>
        </Card>
        <Card size="small" style={{ background: '#f6ffed', border: '1px solid #d9f7be', textAlign: 'center', fontSize: 13, color: '#389E0D' }}>
          📢 叫到您时诊所将叫号，请在候诊区等待
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 16px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>快捷取号</div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12, color: '#888', fontSize: 13 }}>选择就诊医生</div>
        <Select
          style={{ width: '100%' }}
          placeholder="请选择医生"
          onChange={setSelectedDoctor}
          options={doctors.map(d => ({ value: d.id, label: `${d.doctor_name}${d.room ? ` · ${d.room}` : ''}` }))}
        />
      </Card>
      <Button
        type="primary" block size="large" onClick={handleTake} loading={taking}
        style={{ background: '#52C41A', borderColor: '#52C41A', height: 52, fontSize: 16, borderRadius: 10 }}
      >
        🎫 立即取号入队
      </Button>
      <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 12 }}>
        请确认已到达诊所后再取号
      </div>
    </div>
  );
}
```

### PatientRecords

```typescript
// web/src/pages/patient/PatientRecords.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Card, Empty, Spin } from 'antd';
import { listRecords } from '../../api/patientPortal';
import type { MedicalRecord } from '../../api/patientPortal';

export default function PatientRecords() {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    listRecords().then((res) => setRecords(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ padding: '16px 12px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>我的病历</div>
      {records.length === 0 ? <Empty description="暂无就诊记录" /> : (
        <List
          dataSource={records}
          renderItem={(r) => (
            <Card
              key={r.id}
              size="small"
              hoverable
              style={{ marginBottom: 10, borderLeft: '3px solid #52C41A', cursor: 'pointer' }}
              onClick={() => navigate(`/patient/records/${r.id}`)}
            >
              <div style={{ fontSize: 12, color: '#aaa' }}>{r.visit_date?.slice(0, 10)}</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{r.diagnosis || '无诊断记录'}</div>
              {r.chief_complaint && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>主诉：{r.chief_complaint}</div>}
            </Card>
          )}
        />
      )}
    </div>
  );
}
```

### PatientRecordDetail

```typescript
// web/src/pages/patient/PatientRecordDetail.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Tag, Spin, Button, Divider } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { getRecord } from '../../api/patientPortal';

interface PrescriptionItem {
  herb_name: string;
  dosage: string;
  unit: string;
}
interface Prescription {
  id: number;
  type: string;
  doses: number;
  instructions: string;
  items: PrescriptionItem[];
}
interface RecordDetail {
  record: {
    id: number;
    visit_date: string;
    diagnosis: string;
    treatment: string;
    chief_complaint: string;
    notes: string;
  };
  prescriptions: Prescription[];
}

export default function PatientRecordDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<RecordDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getRecord(Number(id))
      .then((res: unknown) => setData((res as { data: RecordDetail }).data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  if (!data) return <div style={{ padding: 20, color: '#888' }}>记录不存在</div>;

  const { record, prescriptions } = data;

  return (
    <div style={{ padding: '12px' }}>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>
        返回
      </Button>
      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ color: '#888', fontSize: 12 }}>{record.visit_date?.slice(0, 10)}</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{record.diagnosis}</div>
        {record.chief_complaint && <div style={{ marginTop: 6 }}><Tag color="blue">主诉</Tag> {record.chief_complaint}</div>}
        {record.treatment && <div style={{ marginTop: 6 }}><Tag color="green">治法</Tag> {record.treatment}</div>}
        {record.notes && <div style={{ marginTop: 6, color: '#888', fontSize: 13 }}>{record.notes}</div>}
      </Card>

      {prescriptions.map((p) => (
        <Card key={p.id} size="small" title={`处方 ${p.type === 'herb' ? '草药' : '中成药'}`} style={{ marginBottom: 10 }}>
          {p.doses > 0 && <div style={{ marginBottom: 6, color: '#888', fontSize: 12 }}>共 {p.doses} 付</div>}
          {p.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #f5f5f5' }}>
              <span>{item.herb_name}</span>
              <span style={{ color: '#888' }}>{item.dosage}{item.unit}</span>
            </div>
          ))}
          {p.instructions && (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <div style={{ fontSize: 12, color: '#888' }}>医嘱：{p.instructions}</div>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
```

### PatientBilling

```typescript
// web/src/pages/patient/PatientBilling.tsx
import { useEffect, useState } from 'react';
import { List, Card, Empty, Spin, Statistic } from 'antd';
import { listBillings } from '../../api/patientPortal';
import type { Billing } from '../../api/patientPortal';

export default function PatientBilling() {
  const [billings, setBillings] = useState<Billing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listBillings().then((res) => setBillings(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ padding: '16px 12px' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>收费明细</div>
      {billings.length === 0 ? <Empty description="暂无收费记录" /> : (
        <List
          dataSource={billings}
          renderItem={(b) => (
            <Card key={b.id} size="small" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#aaa' }}>{b.created_at?.slice(0, 10)}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                    诊费 ¥{b.consultation_fee?.toFixed(2)} + 药费 ¥{b.drug_cost_total?.toFixed(2)}
                  </div>
                </div>
                <Statistic
                  value={b.actual_paid}
                  precision={2}
                  prefix="¥"
                  valueStyle={{ fontSize: 18, color: '#52C41A', fontWeight: 700 }}
                />
              </div>
            </Card>
          )}
        />
      )}
    </div>
  );
}
```

### App.tsx 更新（加入患者端路由）

在 `web/src/App.tsx` 中：
1. 在 imports 区加入：
```typescript
import { PatientAuthProvider } from './store/patientAuth';
import PatientLayout from './components/PatientLayout';
import PatientLogin from './pages/patient/PatientLogin';
import PatientHome from './pages/patient/PatientHome';
import PatientAppointment from './pages/patient/PatientAppointment';
import PatientQueue from './pages/patient/PatientQueue';
import PatientRecords from './pages/patient/PatientRecords';
import PatientRecordDetail from './pages/patient/PatientRecordDetail';
import PatientBilling from './pages/patient/PatientBilling';
```

2. 在 `function AppRoutes()` 的 `<Routes>` 内，在现有路由之后、`<Route path="*">` 之前加入：
```typescript
{/* Patient portal routes */}
<Route
  path="/patient"
  element={
    <PatientAuthProvider>
      <Routes>
        <Route path="login" element={<PatientLogin />} />
        <Route element={<PatientLayout />}>
          <Route path="home" element={<PatientHome />} />
          <Route path="appointments" element={<PatientAppointment />} />
          <Route path="queue" element={<PatientQueue />} />
          <Route path="records" element={<PatientRecords />} />
          <Route path="records/:id" element={<PatientRecordDetail />} />
          <Route path="billing" element={<PatientBilling />} />
          <Route index element={<Navigate to="home" replace />} />
        </Route>
      </Routes>
    </PatientAuthProvider>
  }
/>
```

3. 修改 `path="*"` 路由，仅对非患者端路径重定向：  
```typescript
<Route path="*" element={
  window.location.pathname.startsWith('/patient') 
    ? <Navigate to="/patient/login" replace />
    : <Navigate to="/patients" replace />
} />
```

- [ ] **编译验证**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -20
```
Expected: 无 TypeScript 错误

- [ ] **Commit**

```bash
git add web/src/components/PatientLayout.tsx web/src/pages/patient/ web/src/App.tsx
git commit -m "feat: add patient portal frontend pages and routing"
```

---

## Task 9: 管理端「患者端管理」设置页面

**Files:**
- Create: `web/src/pages/settings/PatientPortalSettings.tsx`
- Modify: `web/src/components/Layout.tsx` (侧边栏加菜单项)
- Modify: `web/src/App.tsx` (加路由)

### PatientPortalSettings 页面

```typescript
// web/src/pages/settings/PatientPortalSettings.tsx
import { useEffect, useState } from 'react';
import { Card, Switch, message, Spin, Typography, Alert } from 'antd';
import { getPatientPortalConfig, updatePatientPortalConfig } from '../../api/patientPortal';
import type { PatientPortalConfig } from '../../api/patientPortal';

const { Title } = Typography;

const SWITCHES = [
  { key: 'login_enabled' as keyof PatientPortalConfig, label: '开放患者登录', desc: '关闭后患者端所有功能不可用', icon: '🔑', section: '账号管理' },
  { key: 'register_enabled' as keyof PatientPortalConfig, label: '开放患者注册', desc: '关闭后只允许已注册患者登录，新用户无法注册', icon: '📝', section: '账号管理' },
  { key: 'appointment_enabled' as keyof PatientPortalConfig, label: '开放在线预约', desc: '患者可自助预约医生时段', icon: '📅', section: '就诊功能' },
  { key: 'queue_enabled' as keyof PatientPortalConfig, label: '开放快捷取号', desc: '患者到院后可自助取号入队', icon: '🎫', section: '就诊功能' },
  { key: 'records_enabled' as keyof PatientPortalConfig, label: '开放病历与收费查看', desc: '患者可查看自己的病历、处方、账单（只读）', icon: '📋', section: '记录查看' },
];

export default function PatientPortalSettings() {
  const [config, setConfig] = useState<PatientPortalConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPatientPortalConfig()
      .then((res) => setConfig(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (key: keyof PatientPortalConfig, value: boolean) => {
    if (!config) return;
    const updated = { ...config, [key]: value };
    setConfig(updated);
    try {
      await updatePatientPortalConfig(updated);
      message.success('已保存');
    } catch {
      setConfig(config); // revert on error
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  if (!config) return null;

  const sections = [...new Set(SWITCHES.map(s => s.section))];

  return (
    <div style={{ padding: '24px', maxWidth: 600 }}>
      <Title level={4}>患者端管理</Title>
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        message="以下开关仅影响患者端，不影响诊所员工的管理后台功能"
        showIcon
      />
      {sections.map(section => (
        <Card key={section} title={section} size="small" style={{ marginBottom: 12 }}>
          {SWITCHES.filter(s => s.section === section).map(sw => (
            <div
              key={sw.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', borderBottom: '1px solid #f9f9f9',
              }}
            >
              <span style={{ fontSize: 20 }}>{sw.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{sw.label}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{sw.desc}</div>
              </div>
              <Switch
                checked={config[sw.key] as boolean}
                onChange={(v) => handleToggle(sw.key, v)}
                style={{ background: (config[sw.key] as boolean) ? '#52C41A' : undefined }}
              />
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
```

### Layout.tsx 侧边栏修改

在 `web/src/components/Layout.tsx` 中，找到「设置」分组的 `children` 数组，在现有最后一个 children 条目之后追加：

```typescript
{
  key: '/settings/patient-portal',
  icon: <MobileOutlined />,
  label: '患者端管理',
},
```

同时在 imports 中加入 `MobileOutlined`：
```typescript
import { ..., MobileOutlined } from '@ant-design/icons';
```

### App.tsx 加入路由

在 `web/src/App.tsx` 的设置路由区域（`settings/*` 路由集合内）追加：

```typescript
import PatientPortalSettings from './pages/settings/PatientPortalSettings';
// ...
<Route path="settings/patient-portal" element={<PatientPortalSettings />} />
```

- [ ] **编译验证**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -20
```

- [ ] **Commit**

```bash
git add web/src/pages/settings/PatientPortalSettings.tsx web/src/components/Layout.tsx web/src/App.tsx
git commit -m "feat: add PatientPortalSettings admin page and sidebar menu item"
```

---

## Task 10: 全量验证 & 部署

- [ ] **后端全量测试**

```bash
cd /Users/xiayanji/qbox/menzhen/server && go test ./... 2>&1
```
Expected: 所有测试 PASS

- [ ] **前端全量构建**

```bash
cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -10
```
Expected: 无错误

- [ ] **部署**

```bash
cd /Users/xiayanji/qbox/menzhen && bash deploy.sh
```

- [ ] **Commit & 打标签**

```bash
git add -A && git commit -m "feat: complete patient portal implementation"
```
