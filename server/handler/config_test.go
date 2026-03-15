package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupConfigTestRouter(envPath string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := &ConfigHandler{db: nil, envPath: envPath}
	r.GET("/config", h.Get)
	r.PUT("/config", h.Update)
	return r
}

func TestConfigHandler_Get(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	content := "DB_HOST=localhost\nDB_PASSWORD=secretpass\nDEEPSEEK_API_KEY=\n"
	require.NoError(t, os.WriteFile(envPath, []byte(content), 0644))
	r := setupConfigTestRouter(envPath)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/config", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, float64(0), resp["code"])
	data := resp["data"].(map[string]interface{})
	cfg := data["config"].(map[string]interface{})
	assert.Equal(t, "localhost", cfg["DB_HOST"])
	assert.Equal(t, "****pass", cfg["DB_PASSWORD"])
	assert.Equal(t, "", cfg["DEEPSEEK_API_KEY"])
}

func TestConfigHandler_Update(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	content := "DB_HOST=localhost\nDB_PASSWORD=secretpass\n"
	require.NoError(t, os.WriteFile(envPath, []byte(content), 0644))
	r := setupConfigTestRouter(envPath)
	body, _ := json.Marshal(map[string]string{
		"DB_HOST":     "newhost",
		"DB_PASSWORD": "****pass",
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/config", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	data, _ := os.ReadFile(envPath)
	assert.Contains(t, string(data), "DB_HOST=newhost")
	assert.Contains(t, string(data), "DB_PASSWORD=secretpass")
}

func TestConfigHandler_Get_FileNotFound(t *testing.T) {
	r := setupConfigTestRouter("/nonexistent/.env")
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/config", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestConfigHandler_Update_InvalidBody(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	require.NoError(t, os.WriteFile(envPath, []byte("DB_HOST=localhost\n"), 0644))
	r := setupConfigTestRouter(envPath)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/config", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}
