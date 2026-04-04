package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/handler"
	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mustParseDateAdmin(t *testing.T, s string) time.Time {
	t.Helper()
	result, err := time.ParseInLocation("2006-01-02", s, time.Local)
	if err != nil {
		t.Fatalf("mustParseDateAdmin: invalid date %q: %v", s, err)
	}
	return result
}

func TestAdminStatsHandler_Forbidden(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "诊所X", "clinic-x")
	perm := testutil.SeedTestPermission(t, db, "statistics:read", "统计查看")
	role := testutil.SeedTestRole(t, db, tenant.ID, "staff", perm)
	staffUser, _ := testutil.SeedTestUser(t, db, tenant.ID, "staff1", "pass123", role)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewAdminStatisticsHandler(db)
	r.GET("/admin/statistics/global", func(c *gin.Context) {
		c.Set(middleware.CtxKeyUserID, staffUser.ID)
		h.GetGlobal(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/admin/statistics/global?start_date=2026-03-01&end_date=2026-03-31", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestAdminStatsHandler_MissingParams(t *testing.T) {
	db := testutil.SetupTestDB(t)
	_, adminUser, _ := testutil.SeedAdminUser(t, db)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewAdminStatisticsHandler(db)
	r.GET("/admin/statistics/global", func(c *gin.Context) {
		c.Set(middleware.CtxKeyUserID, adminUser.ID)
		h.GetGlobal(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/admin/statistics/global", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAdminStatsHandler_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)
	_, adminUser, _ := testutil.SeedAdminUser(t, db)
	t2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b2")
	db.Create(&model.DailyStats{
		TenantID: t2.ID, StatDate: mustParseDateAdmin(t, "2026-03-01"),
		Revenue: 2000, RecordCount: 20, NewPatientCount: 5, ReturningPatientCount: 15,
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewAdminStatisticsHandler(db)
	r.GET("/admin/statistics/global", func(c *gin.Context) {
		c.Set(middleware.CtxKeyUserID, adminUser.ID)
		h.GetGlobal(c)
	})

	req := httptest.NewRequest(http.MethodGet, "/admin/statistics/global?start_date=2026-03-01&end_date=2026-03-31", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	var resp struct {
		Code int `json:"code"`
		Data struct {
			Summary struct {
				TotalRevenue float64 `json:"total_revenue"`
			} `json:"summary"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, 0, resp.Code)
	assert.Equal(t, float64(2000), resp.Data.Summary.TotalRevenue)
}
