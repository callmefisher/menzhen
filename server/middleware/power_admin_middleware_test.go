package middleware_test

import (
	"fmt"
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

func TestSuperAdminTenantOverride_PowerAdmin_AllowedGroup(t *testing.T) {
	db := testutil.SetupTestDB(t)
	gin.SetMode(gin.TestMode)

	t1 := model.Tenant{Name: "T1", Code: "ov_t1", Status: 1, GroupName: "华北分组"}
	t2 := model.Tenant{Name: "T2", Code: "ov_t2", Status: 1, GroupName: "华北分组"}
	require.NoError(t, db.Create(&t1).Error)
	require.NoError(t, db.Create(&t2).Error)

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.CtxKeyUserID, uint64(99))
		c.Set(middleware.CtxKeyUsername, "pa_user")
		c.Set(middleware.CtxKeyTenantID, t1.ID)
		c.Set(middleware.CtxKeyManagedGroups, []string{"华北分组"})
		c.Next()
	})
	r.Use(middleware.SuperAdminTenantOverrideMiddleware(db))
	r.GET("/test", func(c *gin.Context) {
		tid := middleware.GetTenantID(c)
		c.JSON(200, gin.H{"tenant_id": tid})
	})

	// Switch to t2 (same group) — should succeed
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", fmt.Sprintf("/test?tenant_id=%d", t2.ID), nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, 200, w.Code)
}

func TestSuperAdminTenantOverride_PowerAdmin_ForbiddenGroup(t *testing.T) {
	db := testutil.SetupTestDB(t)
	gin.SetMode(gin.TestMode)

	t1 := model.Tenant{Name: "T1", Code: "ov_t3", Status: 1, GroupName: "华北分组"}
	t3 := model.Tenant{Name: "T3", Code: "ov_t4", Status: 1, GroupName: "华南分组"}
	require.NoError(t, db.Create(&t1).Error)
	require.NoError(t, db.Create(&t3).Error)

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.CtxKeyUserID, uint64(100))
		c.Set(middleware.CtxKeyUsername, "pa_user2")
		c.Set(middleware.CtxKeyTenantID, t1.ID)
		c.Set(middleware.CtxKeyManagedGroups, []string{"华北分组"})
		c.Next()
	})
	r.Use(middleware.SuperAdminTenantOverrideMiddleware(db))
	r.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true})
	})

	// Switch to t3 (different group) — should be 403
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", fmt.Sprintf("/test?tenant_id=%d", t3.ID), nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, 403, w.Code)
}
