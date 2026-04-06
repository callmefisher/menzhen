package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/callmefisher/menzhen/server/handler"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupDiskRouter(t *testing.T) *gin.Engine {
	t.Helper()
	db := testutil.SetupTestDB(t)
	h := handler.NewDiskHandler(db)
	t.Cleanup(h.Shutdown)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/disk/volumes", h.ListVolumes)
	r.PUT("/disk/interval", h.SetInterval)
	r.POST("/disk/migrate", h.StartMigrate)
	r.POST("/disk/backup-dir", h.ChangeBackupDir)
	return r
}

func TestListVolumes_ReturnsJSONNotPanic(t *testing.T) {
	r := setupDiskRouter(t)
	// Docker socket is unavailable in CI — expect 200 or 500, never a panic or empty response.
	req := httptest.NewRequest("GET", "/disk/volumes", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Contains(t, []int{http.StatusOK, http.StatusInternalServerError}, w.Code)
	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	_, hasCode := resp["code"]
	_, hasError := resp["error"]
	assert.True(t, hasCode || hasError, "response must have 'code' or 'error' field")
}

func TestStartMigrate_Validation(t *testing.T) {
	r := setupDiskRouter(t)

	cases := []struct {
		name     string
		body     map[string]string
		wantCode int
	}{
		{"unknown target", map[string]string{"target": "redis", "new_path": "vol"}, http.StatusBadRequest},
		{"empty new_path", map[string]string{"target": "mysql", "new_path": ""}, http.StatusBadRequest},
		{"missing target field", map[string]string{"new_path": "vol"}, http.StatusBadRequest},
	}

	for _, tc := range cases {
		b, err := json.Marshal(tc.body)
		require.NoError(t, err)
		req := httptest.NewRequest("POST", "/disk/migrate", strings.NewReader(string(b)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, tc.wantCode, w.Code, "case: %s", tc.name)
	}
}

func TestChangeBackupDir_Validation(t *testing.T) {
	r := setupDiskRouter(t)

	cases := []struct {
		name     string
		body     string
		wantCode int
	}{
		{"empty new_path value", `{"new_path":""}`, http.StatusBadRequest},
		{"missing new_path field", `{"other":"x"}`, http.StatusBadRequest},
		{"whitespace only", `{"new_path":"   "}`, http.StatusBadRequest},
	}

	for _, tc := range cases {
		req := httptest.NewRequest("POST", "/disk/backup-dir", strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, tc.wantCode, w.Code, "case: %s", tc.name)
	}
}

func TestSetInterval_ValidValues(t *testing.T) {
	r := setupDiskRouter(t)

	cases := []struct {
		interval int
		wantCode int
	}{
		{60, http.StatusOK},
		{600, http.StatusOK},
		{3600, http.StatusOK},
		{59, http.StatusBadRequest},   // below min (60s)
		{3601, http.StatusBadRequest}, // above max (3600s)
		{0, http.StatusBadRequest},
	}

	for _, tc := range cases {
		b, err := json.Marshal(map[string]int{"interval": tc.interval})
		require.NoError(t, err)
		req := httptest.NewRequest("PUT", "/disk/interval", strings.NewReader(string(b)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, tc.wantCode, w.Code,
			"interval=%d expected %d got %d", tc.interval, tc.wantCode, w.Code)
	}
}
