package handler

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/config"
	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// setupTestRouter creates a gin.Engine with all handlers and routes registered.
func setupTestRouter(db *gorm.DB) *gin.Engine {
	r := gin.New()
	cfg := &config.Config{JWTSecret: testutil.TestJWTSecret}

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
	meridianResourceHandler := NewMeridianResourceHandler(db)
	wuyunLiuqiHandler := NewWuyunLiuqiHandler(db, nil)
	solarTermHandler := NewSolarTermHandler(db)
	hexagramHandler := NewHexagramHandler(db)

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
	records.GET("/:id/prescriptions", middleware.RequirePermission(db, "prescription:read"), prescriptionHandler.ListByRecord)

	prescriptions := authed.Group("/prescriptions")
	prescriptions.POST("", middleware.RequirePermission(db, "prescription:create"), prescriptionHandler.Create)
	prescriptions.GET("/:id", middleware.RequirePermission(db, "prescription:read"), prescriptionHandler.Detail)

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

	authed.GET("/permissions", middleware.RequirePermission(db, "role:manage"), roleHandler.ListPermissions)

	tenants := authed.Group("/tenants")
	tenants.GET("", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.List)
	tenants.POST("", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.Create)
	tenants.PUT("/:id", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.Update)
	tenants.DELETE("/:id", middleware.RequirePermission(db, "tenant:manage"), tenantHandler.Delete)

	oplogs := authed.Group("/oplogs")
	oplogs.GET("", middleware.RequirePermission(db, "oplog:read"), oplogHandler.ListOpLogs)

	clinicalExp := authed.Group("/clinical-experiences")
	clinicalExp.GET("", clinicalExpHandler.List)
	clinicalExp.GET("/:id", clinicalExpHandler.Detail)
	clinicalExp.POST("", middleware.RequirePermission(db, "role:manage"), clinicalExpHandler.Create)

	inventoryDrugs := authed.Group("/inventory/drugs")
	inventoryDrugs.GET("", middleware.RequirePermission(db, "inventory:read"), inventoryDrugHandler.List)
	inventoryDrugs.POST("", middleware.RequirePermission(db, "inventory:create"), inventoryDrugHandler.Create)
	inventoryDrugs.PUT("/:id", middleware.RequirePermission(db, "inventory:update"), inventoryDrugHandler.Update)
	inventoryDrugs.DELETE("/:id", middleware.RequirePermission(db, "inventory:delete"), inventoryDrugHandler.Delete)
	inventoryDrugs.POST("/:id/stock-in", middleware.RequirePermission(db, "inventory:update"), inventoryDrugHandler.StockIn)
	inventoryDrugs.POST("/batch-stock-in", middleware.RequirePermission(db, "inventory:create"), inventoryDrugHandler.BatchStockIn)

	meridianRes := authed.Group("/meridians")
	meridianRes.GET("/:id/resource", meridianResourceHandler.Get)

	wuyunLiuqi := authed.Group("/wuyun-liuqi")
	wuyunLiuqi.GET("", wuyunLiuqiHandler.Get)

	solarTerms := authed.Group("/solar-terms")
	solarTerms.GET("", solarTermHandler.List)
	solarTerms.PUT("/:id", middleware.RequirePermission(db, "role:manage"), solarTermHandler.Update)
	solarTerms.DELETE("/:id/content", middleware.RequirePermission(db, "role:manage"), solarTermHandler.DeleteContent)

	hexagrams := authed.Group("/hexagrams")
	hexagrams.GET("", hexagramHandler.List)
	hexagrams.GET("/trigrams", hexagramHandler.Trigrams)
	hexagrams.GET("/:id", hexagramHandler.Detail)
	hexagrams.POST("", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Create)
	hexagrams.PUT("/:id", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Update)
	hexagrams.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Delete)

	return r
}

// testEnv holds all test infrastructure for handler integration tests.
type testEnv struct {
	DB       *gorm.DB
	Router   *gin.Engine
	Tenant   *model.Tenant
	User     *model.User
	Token    string
	TenantID uint64
}

// setupTestEnv creates a full test environment with admin user and all permissions.
func setupTestEnv(t *testing.T) *testEnv {
	t.Helper()
	db := testutil.SetupTestDB(t)
	tenant, user, token := testutil.SeedAdminUser(t, db)
	router := setupTestRouter(db)
	return &testEnv{
		DB:       db,
		Router:   router,
		Tenant:   tenant,
		User:     user,
		Token:    token,
		TenantID: tenant.ID,
	}
}

// doRequest performs an HTTP request against the test router.
func (e *testEnv) doRequest(method, path string, body interface{}) *httptest.ResponseRecorder {
	var reqBody *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reqBody = bytes.NewReader(b)
	} else {
		reqBody = bytes.NewReader(nil)
	}

	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	if e.Token != "" {
		req.Header.Set("Authorization", "Bearer "+e.Token)
	}
	w := httptest.NewRecorder()
	e.Router.ServeHTTP(w, req)
	return w
}

// doRequestNoAuth performs an HTTP request without Authorization header.
func (e *testEnv) doRequestNoAuth(method, path string, body interface{}) *httptest.ResponseRecorder {
	var reqBody *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reqBody = bytes.NewReader(b)
	} else {
		reqBody = bytes.NewReader(nil)
	}

	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.Router.ServeHTTP(w, req)
	return w
}

// parseJSON decodes the response body into a map.
func parseJSON(w *httptest.ResponseRecorder) map[string]interface{} {
	var result map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &result)
	return result
}

// getData extracts the "data" field from the response.
func getData(w *httptest.ResponseRecorder) map[string]interface{} {
	body := parseJSON(w)
	if data, ok := body["data"].(map[string]interface{}); ok {
		return data
	}
	return nil
}

// getDataList extracts the "data" field as a list from the response.
func getDataList(w *httptest.ResponseRecorder) []interface{} {
	body := parseJSON(w)
	if data, ok := body["data"].([]interface{}); ok {
		return data
	}
	return nil
}
