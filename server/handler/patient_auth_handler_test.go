package handler

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// setupPatientAuthRouter builds a minimal Gin engine covering:
//   - GET  /api/v1/patient/auth/tenant-list  (public)
//   - GET  /api/v1/tenant/patient-portal-config (authed, tenant:user:manage)
func setupPatientAuthRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	patientAuthSvc := service.NewPatientAuthService(db)
	authHandler := NewPatientAuthHandler(patientAuthSvc, testutil.TestJWTSecret, db)
	settingsHandler := NewPatientSettingsHandler(patientAuthSvc, db)

	v1 := r.Group("/api/v1")

	// Public routes
	patientPublic := v1.Group("/patient")
	patientPublic.GET("/auth/tenant-list", authHandler.ListTenantsByPhone)

	// Authenticated admin routes
	authed := v1.Group("")
	authed.Use(middleware.AuthMiddleware(testutil.TestJWTSecret))
	authed.GET("/tenant/patient-portal-config",
		middleware.RequirePermission(db, "tenant:user:manage"),
		settingsHandler.GetPortalConfig)

	return r
}

// seedPatientUser creates a patient_users row with the given phone under the given tenant.
func seedPatientUser(t *testing.T, db *gorm.DB, tenantID uint64, phone, name string) *model.PatientUser {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte(phone[len(phone)-4:]), bcrypt.MinCost)
	pu := model.PatientUser{
		TenantID:     tenantID,
		Phone:        phone,
		Name:         name,
		PasswordHash: string(hash),
	}
	require.NoError(t, db.Create(&pu).Error)
	return &pu
}

// doPublicGet sends a GET request without auth.
func doPublicGet(router *gin.Engine, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// doAuthedGet sends a GET request with a Bearer token.
func doAuthedGet(router *gin.Engine, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// ─── ListTenantsByPhone tests ──────────────────────────────────────────────

func TestListTenantsByPhone_MissingPhone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := setupPatientAuthRouter(db)

	w := doPublicGet(router, "/api/v1/patient/auth/tenant-list")

	assert.Equal(t, http.StatusBadRequest, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(400), body["code"])
	assert.Equal(t, "参数校验失败", body["message"])
}

func TestListTenantsByPhone_PhoneTooLong(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := setupPatientAuthRouter(db)

	longPhone := "123456789012345678901" // 21 chars
	w := doPublicGet(router, "/api/v1/patient/auth/tenant-list?phone="+longPhone)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(400), body["code"])
}

func TestListTenantsByPhone_WhitespacePhone(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := setupPatientAuthRouter(db)

	// URL-encoded spaces (%20%20%20) become "   " after query parsing;
	// TrimSpace reduces them to "", triggering the empty-phone 400 path.
	// A phone of "+++" (non-digits) passes length but fails regex — also 400.
	cases := []struct {
		name  string
		query string
	}{
		{"url-encoded spaces", "phone=%20%20%20"},
		{"plus signs (non-digit)", "phone=%2B%2B%2B"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := doPublicGet(router, "/api/v1/patient/auth/tenant-list?"+tc.query)
			assert.Equal(t, http.StatusBadRequest, w.Code)
			body := parseJSON(w)
			assert.Equal(t, float64(400), body["code"])
			assert.Equal(t, "参数校验失败", body["message"])
		})
	}
}

func TestListTenantsByPhone_PhoneNotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := setupPatientAuthRouter(db)

	// Seed a tenant but no patient_user with this phone
	testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")

	w := doPublicGet(router, "/api/v1/patient/auth/tenant-list?phone=13900000000")

	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	list, ok := body["data"].([]interface{})
	assert.True(t, ok, "data should be an array")
	assert.Len(t, list, 0)
}

func TestListTenantsByPhone_PhoneFoundInOneTenant(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := setupPatientAuthRouter(db)

	tenant := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	seedPatientUser(t, db, tenant.ID, "13800138000", "张三")

	w := doPublicGet(router, "/api/v1/patient/auth/tenant-list?phone=13800138000")

	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	list := body["data"].([]interface{})
	assert.Len(t, list, 1)

	item := list[0].(map[string]interface{})
	assert.Equal(t, "诊所B", item["tenant_name"])
	assert.Equal(t, "clinic-b", item["tenant_code"])
	assert.Equal(t, float64(tenant.ID), item["tenant_id"])
}

func TestListTenantsByPhone_PhoneFoundInMultipleTenants(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := setupPatientAuthRouter(db)

	tenant1 := testutil.SeedTestTenant(t, db, "诊所C", "clinic-c")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所D", "clinic-d")
	phone := "13700137000"
	seedPatientUser(t, db, tenant1.ID, phone, "李四")
	seedPatientUser(t, db, tenant2.ID, phone, "李四")

	w := doPublicGet(router, fmt.Sprintf("/api/v1/patient/auth/tenant-list?phone=%s", phone))

	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	list := body["data"].([]interface{})
	assert.Len(t, list, 2)
}

func TestListTenantsByPhone_InactiveTenantExcluded(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := setupPatientAuthRouter(db)

	// Inactive tenant (status=0)
	inactiveTenant := model.Tenant{Name: "停用诊所", Code: "inactive-clinic", Status: 0}
	require.NoError(t, db.Create(&inactiveTenant).Error)
	phone := "13600136000"
	seedPatientUser(t, db, inactiveTenant.ID, phone, "王五")

	w := doPublicGet(router, fmt.Sprintf("/api/v1/patient/auth/tenant-list?phone=%s", phone))

	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	list := body["data"].([]interface{})
	assert.Len(t, list, 0, "inactive tenant should be excluded")
}

// ─── GetPortalConfig tests ─────────────────────────────────────────────────

// seedAdminWithPermission creates a tenant + admin user who has tenant:user:manage.
func seedAdminWithPermission(t *testing.T, db *gorm.DB) (*model.Tenant, string) {
	t.Helper()
	tenant := testutil.SeedTestTenant(t, db, "配置诊所", "config-clinic")
	perm := testutil.SeedTestPermission(t, db, "tenant:user:manage", "诊所用户管理")
	role := testutil.SeedTestRole(t, db, tenant.ID, "admin", perm)
	_, token := testutil.SeedTestUser(t, db, tenant.ID, "cfgadmin", "pass123", role)
	return tenant, token
}

func TestGetPortalConfig_ReturnsTenantCode(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := setupPatientAuthRouter(db)
	tenant, token := seedAdminWithPermission(t, db)

	w := doAuthedGet(router, "/api/v1/tenant/patient-portal-config", token)

	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])
	data, ok := body["data"].(map[string]interface{})
	require.True(t, ok, "data should be an object")
	assert.Equal(t, tenant.Code, data["tenant_code"])
}

func TestGetPortalConfig_Unauthorized(t *testing.T) {
	db := testutil.SetupTestDB(t)
	router := setupPatientAuthRouter(db)

	w := doPublicGet(router, "/api/v1/tenant/patient-portal-config")

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
