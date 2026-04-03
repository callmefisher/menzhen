package handler_test

import (
	"bytes"
	"encoding/json"
	"fmt"
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

func TestPowerAdminHandler_List_Empty(t *testing.T) {
	db := testutil.SetupTestDB(t)
	h := handler.NewPowerAdminHandler(db)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.CtxKeyUserID, uint64(1))
		c.Set(middleware.CtxKeyUsername, "admin")
		c.Next()
	})
	r.GET("/api/v1/settings/power-admins", h.List)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/settings/power-admins", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, 200, w.Code)
	var body map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, float64(0), body["code"])
}

func TestPowerAdminHandler_AssignGroups(t *testing.T) {
	db := testutil.SetupTestDB(t)

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
	r.PUT("/api/v1/settings/power-admins/:id/groups", h.AssignGroups)
	r.GET("/api/v1/settings/power-admins", h.List)

	// Assign groups
	groupBody := map[string]interface{}{"groups": []string{"华北分组", "华南分组"}}
	gb, _ := json.Marshal(groupBody)
	w := httptest.NewRecorder()
	idStr := fmt.Sprintf("/api/v1/settings/power-admins/%d/groups", targetUser.ID)
	req, _ := http.NewRequest("PUT", idStr, bytes.NewReader(gb))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, 200, w.Code)

	// List should show 1 powerAdmin with 2 groups
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("GET", "/api/v1/settings/power-admins", nil)
	r.ServeHTTP(w2, req2)
	assert.Equal(t, 200, w2.Code)
	var listBody map[string]interface{}
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &listBody))
	data := listBody["data"].([]interface{})
	assert.Len(t, data, 1)
}

func TestPowerAdminHandler_Delete(t *testing.T) {
	db := testutil.SetupTestDB(t)

	tenant := model.Tenant{Name: "T", Code: "htest2", Status: 1}
	require.NoError(t, db.Create(&tenant).Error)
	targetUser := model.User{TenantID: tenant.ID, Username: "pa_del", PasswordHash: "x", RealName: "PD", Status: 1}
	require.NoError(t, db.Create(&targetUser).Error)

	h := handler.NewPowerAdminHandler(db)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.CtxKeyUserID, uint64(1))
		c.Set(middleware.CtxKeyUsername, "admin")
		c.Next()
	})
	r.PUT("/api/v1/settings/power-admins/:id/groups", h.AssignGroups)
	r.DELETE("/api/v1/settings/power-admins/:id", h.Delete)
	r.GET("/api/v1/settings/power-admins", h.List)

	// First assign groups
	gb, _ := json.Marshal(map[string]interface{}{"groups": []string{"华北"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", fmt.Sprintf("/api/v1/settings/power-admins/%d/groups", targetUser.ID), bytes.NewReader(gb))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, 200, w.Code)

	// Delete (revoke)
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("DELETE", fmt.Sprintf("/api/v1/settings/power-admins/%d", targetUser.ID), nil)
	r.ServeHTTP(w2, req2)
	assert.Equal(t, 200, w2.Code)

	// List should be empty
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest("GET", "/api/v1/settings/power-admins", nil)
	r.ServeHTTP(w3, req3)
	assert.Equal(t, 200, w3.Code)
	var listBody map[string]interface{}
	require.NoError(t, json.Unmarshal(w3.Body.Bytes(), &listBody))
	data := listBody["data"].([]interface{})
	assert.Len(t, data, 0)
}
