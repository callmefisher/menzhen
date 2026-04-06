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
	r.GET("/disk/fs", h.BrowseFS)
	r.PUT("/disk/interval", h.SetInterval)
	return r
}

func TestBrowseFS_InvalidPath(t *testing.T) {
	r := setupDiskRouter(t)

	// path traversal must be rejected or return empty list — NOT expose /etc contents
	req := httptest.NewRequest("GET", "/disk/fs?path=../../etc", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code == http.StatusOK {
		var resp map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
		data, _ := resp["data"].([]interface{})
		for _, entry := range data {
			m, _ := entry.(map[string]interface{})
			path, _ := m["path"].(string)
			assert.False(t, strings.Contains(path, "etc"),
				"path traversal must not expose /etc: %s", path)
		}
	} else {
		assert.Equal(t, http.StatusBadRequest, w.Code)
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

func TestBrowseFS_RootPath(t *testing.T) {
	r := setupDiskRouter(t)
	// In test environment /hostfs likely doesn't exist → should return 200 with empty list, not 500
	req := httptest.NewRequest("GET", "/disk/fs?path=/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.NotEqual(t, http.StatusInternalServerError, w.Code)
}
