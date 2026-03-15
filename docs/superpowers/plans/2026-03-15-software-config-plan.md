# 软件配置页面 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "软件配置" page under system settings to manage all .env variables through the web UI.

**Architecture:** Backend service reads/writes the .env file directly (no database). Two API endpoints (GET/PUT) protected by `user:manage` permission. Frontend uses grouped Card forms with masked sensitive fields.

**Tech Stack:** Go/Gin (backend), React/TypeScript/Ant Design (frontend), Vitest + Testing Library (frontend tests), Go test + testify (backend tests)

**Spec:** `docs/superpowers/specs/2026-03-15-software-config-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `server/service/config.go` | .env 读写、掩码逻辑 |
| Create | `server/service/config_test.go` | service 层测试 |
| Create | `server/handler/config.go` | HTTP handler (GET/PUT) |
| Create | `server/handler/config_test.go` | handler 层测试 |
| Modify | `server/router/router.go` | 注册 config 路由 |
| Create | `web/src/api/config.ts` | 前端 API 调用 |
| Create | `web/src/pages/settings/SystemConfig.tsx` | 配置页面组件 |
| Create | `web/src/pages/settings/__tests__/SystemConfig.test.tsx` | 前端测试 |
| Modify | `web/src/App.tsx` | 注册路由 |
| Modify | `web/src/components/Layout.tsx` | 添加菜单项 |
| Modify | `docker-compose.yml` | api 服务挂载 .env |
| Modify | `docs/codebase.md` | 更新 API 文档 |

---

## Chunk 1: Backend Service Layer

### Task 1: Config Service — .env 读写与掩码

**Files:**
- Create: `server/service/config.go`
- Create: `server/service/config_test.go`

- [ ] **Step 1: Write failing tests for .env parsing**

```go
// server/service/config_test.go
package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseEnvFile(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")

	content := `# Database
DB_HOST=localhost
DB_PORT=3306
DB_PASSWORD=mysecretpass

# Empty value
DEEPSEEK_API_KEY=
`
	require.NoError(t, os.WriteFile(envPath, []byte(content), 0644))

	svc := NewConfigService(envPath)
	vars, err := svc.ReadEnvFile()
	require.NoError(t, err)

	assert.Equal(t, "localhost", vars["DB_HOST"])
	assert.Equal(t, "3306", vars["DB_PORT"])
	assert.Equal(t, "mysecretpass", vars["DB_PASSWORD"])
	assert.Equal(t, "", vars["DEEPSEEK_API_KEY"])
}

func TestParseEnvFile_NotFound(t *testing.T) {
	svc := NewConfigService("/nonexistent/.env")
	vars, err := svc.ReadEnvFile()
	assert.Error(t, err)
	assert.Nil(t, vars)
}

func TestMaskSensitiveValue(t *testing.T) {
	tests := []struct {
		value    string
		expected string
	}{
		{"mysecretpassword", "****word"},
		{"abcd", "****"},
		{"abc", "****"},
		{"", ""},
	}
	for _, tt := range tests {
		result := maskValue(tt.value)
		assert.Equal(t, tt.expected, result, "masking %q", tt.value)
	}
}

func TestIsMasked(t *testing.T) {
	assert.True(t, isMasked("****word"))
	assert.True(t, isMasked("****"))
	assert.False(t, isMasked("plaintext"))
	assert.False(t, isMasked(""))
	assert.False(t, isMasked("***x"))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./service/ -run "TestParseEnvFile|TestMaskSensitive|TestIsMasked" -v`
Expected: FAIL — `NewConfigService`, `maskValue`, `isMasked` not defined

- [ ] **Step 3: Implement ConfigService with read/mask logic**

```go
// server/service/config.go
package service

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// sensitiveKeys lists env vars that should be masked in GET responses.
var sensitiveKeys = map[string]bool{
	"DB_PASSWORD":      true,
	"JWT_SECRET":       true,
	"MINIO_ACCESS_KEY": true,
	"MINIO_SECRET_KEY": true,
	"DEEPSEEK_API_KEY": true,
	"QINIU_ACCESS_KEY": true,
	"QINIU_SECRET_KEY": true,
}

// knownKeys is the ordered list of all known config keys.
var knownKeys = []string{
	"SERVER_PORT",
	"DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME",
	"JWT_SECRET",
	"MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_BUCKET",
	"DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL",
	"QINIU_ACCESS_KEY", "QINIU_SECRET_KEY", "QINIU_BUCKET",
	"QINIU_KEY_PREFIX", "QINIU_DOMAIN", "QINIU_RETAIN_MYSQL", "QINIU_RETAIN_MINIO",
	"BACKUP_INTERVAL_MYSQL", "BACKUP_INTERVAL_MINIO",
}

// ConfigService handles reading and writing the .env file.
type ConfigService struct {
	envPath string
}

// NewConfigService creates a ConfigService for the given .env file path.
func NewConfigService(envPath string) *ConfigService {
	return &ConfigService{envPath: envPath}
}

// ReadEnvFile parses the .env file and returns all key-value pairs.
func (s *ConfigService) ReadEnvFile() (map[string]string, error) {
	f, err := os.Open(s.envPath)
	if err != nil {
		return nil, fmt.Errorf("open env file: %w", err)
	}
	defer f.Close()

	vars := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.Index(line, "=")
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		value := strings.TrimSpace(line[idx+1:])
		vars[key] = value
	}
	return vars, scanner.Err()
}

// GetConfig returns masked config for API response.
// Returns (config map, sensitiveSet list of sensitive keys that have values).
func (s *ConfigService) GetConfig() (map[string]string, []string, error) {
	vars, err := s.ReadEnvFile()
	if err != nil {
		return nil, nil, err
	}

	result := make(map[string]string)
	var sensitiveSet []string

	for _, key := range knownKeys {
		val := vars[key]
		if sensitiveKeys[key] {
			if val != "" {
				sensitiveSet = append(sensitiveSet, key)
				result[key] = maskValue(val)
			} else {
				result[key] = ""
			}
		} else {
			result[key] = val
		}
	}
	return result, sensitiveSet, nil
}

// UpdateConfig writes the new config values to the .env file.
// Masked values (****xxx) are preserved from the original file.
// Unknown keys in the original file are preserved.
func (s *ConfigService) UpdateConfig(newVals map[string]string) ([]string, error) {
	// Read original values for masked field preservation
	origVars, err := s.ReadEnvFile()
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read original env: %w", err)
	}
	if origVars == nil {
		origVars = make(map[string]string)
	}

	// Resolve masked values
	resolved := make(map[string]string)
	var changedKeys []string
	for key, val := range newVals {
		if isMasked(val) {
			resolved[key] = origVars[key]
		} else {
			resolved[key] = val
			if origVars[key] != val {
				changedKeys = append(changedKeys, key)
			}
		}
	}

	// Backup original file
	origContent, err := os.ReadFile(s.envPath)
	if err == nil {
		_ = os.WriteFile(s.envPath+".bak", origContent, 0644)
	}

	// Read original file line by line and update in-place
	lines, err := s.readLines()
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read lines: %w", err)
	}

	written := make(map[string]bool)
	var output []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			output = append(output, line)
			continue
		}
		idx := strings.Index(trimmed, "=")
		if idx < 0 {
			output = append(output, line)
			continue
		}
		key := strings.TrimSpace(trimmed[:idx])
		if val, ok := resolved[key]; ok {
			output = append(output, key+"="+val)
			written[key] = true
		} else {
			// Unknown key — preserve as-is
			output = append(output, line)
		}
	}

	// Append new keys that weren't in the original file
	for _, key := range knownKeys {
		if !written[key] {
			if val, ok := resolved[key]; ok {
				output = append(output, key+"="+val)
			}
		}
	}

	content := strings.Join(output, "\n") + "\n"
	if err := os.WriteFile(s.envPath, []byte(content), 0644); err != nil {
		return nil, fmt.Errorf("write env file: %w", err)
	}

	return changedKeys, nil
}

func (s *ConfigService) readLines() ([]string, error) {
	data, err := os.ReadFile(s.envPath)
	if err != nil {
		return nil, err
	}
	return strings.Split(strings.TrimRight(string(data), "\n"), "\n"), nil
}

// maskValue masks a sensitive value: "mysecret" → "****cret"
func maskValue(val string) string {
	if val == "" {
		return ""
	}
	if len(val) > 4 {
		return "****" + val[len(val)-4:]
	}
	return "****"
}

// isMasked checks if a value is a masked placeholder.
func isMasked(val string) bool {
	return len(val) >= 4 && val[:4] == "****"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./service/ -run "TestParseEnvFile|TestMaskSensitive|TestIsMasked" -v`
Expected: PASS

- [ ] **Step 5: Write failing tests for GetConfig and UpdateConfig**

```go
// Append to server/service/config_test.go

func TestGetConfig(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")

	content := `DB_HOST=localhost
DB_PORT=3306
DB_PASSWORD=mysecretpass
JWT_SECRET=abc
DEEPSEEK_API_KEY=
UNKNOWN_VAR=keepme
`
	require.NoError(t, os.WriteFile(envPath, []byte(content), 0644))

	svc := NewConfigService(envPath)
	cfg, sensitiveSet, err := svc.GetConfig()
	require.NoError(t, err)

	assert.Equal(t, "localhost", cfg["DB_HOST"])
	assert.Equal(t, "****pass", cfg["DB_PASSWORD"])
	assert.Equal(t, "****", cfg["JWT_SECRET"]) // len==3 → "****"
	assert.Equal(t, "", cfg["DEEPSEEK_API_KEY"])
	assert.Contains(t, sensitiveSet, "DB_PASSWORD")
	assert.Contains(t, sensitiveSet, "JWT_SECRET")
	assert.NotContains(t, sensitiveSet, "DEEPSEEK_API_KEY")
	// Unknown vars not in result
	assert.Empty(t, cfg["UNKNOWN_VAR"])
}

func TestUpdateConfig(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")

	original := `# Database
DB_HOST=localhost
DB_PASSWORD=oldpassword
UNKNOWN_VAR=keepme
`
	require.NoError(t, os.WriteFile(envPath, []byte(original), 0644))

	svc := NewConfigService(envPath)
	changedKeys, err := svc.UpdateConfig(map[string]string{
		"DB_HOST":     "newhost",
		"DB_PASSWORD": "****word", // masked → keep original
		"DB_PORT":     "3307",     // new key
	})
	require.NoError(t, err)
	assert.Contains(t, changedKeys, "DB_HOST")
	assert.Contains(t, changedKeys, "DB_PORT")
	assert.NotContains(t, changedKeys, "DB_PASSWORD")

	// Verify file content
	vars, err := svc.ReadEnvFile()
	require.NoError(t, err)
	assert.Equal(t, "newhost", vars["DB_HOST"])
	assert.Equal(t, "oldpassword", vars["DB_PASSWORD"]) // preserved
	assert.Equal(t, "3307", vars["DB_PORT"])
	assert.Equal(t, "keepme", vars["UNKNOWN_VAR"]) // preserved

	// Verify backup was created
	_, err = os.Stat(envPath + ".bak")
	assert.NoError(t, err)
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server && go test ./service/ -run "TestGetConfig|TestUpdateConfig" -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/service/config.go server/service/config_test.go
git commit -m "feat: add config service for .env file read/write"
```

---

## Chunk 2: Backend Handler & Router

### Task 2: Config Handler — HTTP endpoints

**Files:**
- Create: `server/handler/config.go`
- Create: `server/handler/config_test.go`

- [ ] **Step 1: Write failing handler tests**

```go
// server/handler/config_test.go
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
	content := `DB_HOST=localhost
DB_PASSWORD=secretpass
DEEPSEEK_API_KEY=
`
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
	content := `DB_HOST=localhost
DB_PASSWORD=secretpass
`
	require.NoError(t, os.WriteFile(envPath, []byte(content), 0644))

	r := setupConfigTestRouter(envPath)

	body, _ := json.Marshal(map[string]string{
		"DB_HOST":     "newhost",
		"DB_PASSWORD": "****pass", // masked — should preserve original
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/config", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify file was updated
	data, _ := os.ReadFile(envPath)
	assert.Contains(t, string(data), "DB_HOST=newhost")
	assert.Contains(t, string(data), "DB_PASSWORD=secretpass") // preserved
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./handler/ -run "TestConfigHandler" -v`
Expected: FAIL — `ConfigHandler` not defined

- [ ] **Step 3: Write the config handler implementation**

```go
// server/handler/config.go
package handler

import (
	"net/http"
	"os"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ConfigHandler handles system configuration endpoints.
type ConfigHandler struct {
	db      *gorm.DB
	envPath string
}

// NewConfigHandler creates a new ConfigHandler.
func NewConfigHandler(db *gorm.DB) *ConfigHandler {
	envPath := os.Getenv("ENV_FILE_PATH")
	if envPath == "" {
		envPath = ".env"
	}
	return &ConfigHandler{db: db, envPath: envPath}
}

// Get handles GET /api/v1/config — returns all config with sensitive fields masked.
func (h *ConfigHandler) Get(c *gin.Context) {
	svc := service.NewConfigService(h.envPath)
	cfg, sensitiveSet, err := svc.GetConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to read config",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"config":        cfg,
			"sensitive_set": sensitiveSet,
		},
	})
}

// Update handles PUT /api/v1/config — writes config to .env file.
func (h *ConfigHandler) Update(c *gin.Context) {
	var req map[string]string
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewConfigService(h.envPath)
	changedKeys, err := svc.UpdateConfig(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update config",
		})
		return
	}

	// Record operation log (only changed key names, no sensitive values)
	// resourceID=0 because system config is not a DB entity
	if len(changedKeys) > 0 && h.db != nil {
		middleware.LogOperation(h.db, c, "update", "system_config", 0, nil,
			map[string]interface{}{"changed_keys": changedKeys})
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}
```

- [ ] **Step 4: Run handler tests to verify they pass**

Run: `cd server && go test ./handler/ -run "TestConfigHandler" -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/handler/config.go server/handler/config_test.go
git commit -m "feat: add config handler for GET/PUT /api/v1/config"
```

### Task 3: Register config routes

**Files:**
- Modify: `server/router/router.go`

- [ ] **Step 1: Add config handler init and routes**

In `server/router/router.go`:

After line 57 (`followUpHandler := handler.NewFollowUpHandler(db)`), add:
```go
	configHandler := handler.NewConfigHandler(db)
```

After the existing route registrations (find the section with `user:manage` permission routes), add:
```go
	// System config routes (super admin only)
	configRoutes := authorized.Group("/config")
	{
		configRoutes.GET("", middleware.RequirePermission(db, "user:manage"), configHandler.Get)
		configRoutes.PUT("", middleware.RequirePermission(db, "user:manage"), configHandler.Update)
	}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd server && go build ./...`
Expected: SUCCESS

- [ ] **Step 3: Commit**

```bash
git add server/router/router.go
git commit -m "feat: register config API routes"
```

---

## Chunk 3: Frontend Implementation

### Task 4: Frontend API service

**Files:**
- Create: `web/src/api/config.ts`

- [ ] **Step 1: Create API service**

```typescript
// web/src/api/config.ts
import request from '../utils/request';

export function getConfig() {
  return request.get('/config');
}

export function updateConfig(data: Record<string, string>) {
  return request.put('/config', data);
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/api/config.ts
git commit -m "feat: add frontend config API service"
```

### Task 5: SystemConfig page component

**Files:**
- Create: `web/src/pages/settings/SystemConfig.tsx`

- [ ] **Step 1: Create the page component**

```tsx
// web/src/pages/settings/SystemConfig.tsx
import { useState, useEffect, useCallback } from 'react';
import { Card, Form, Input, InputNumber, Button, message, Spin, Space } from 'antd';
import { getConfig, updateConfig } from '../../api/config';
import useIsMobile from '../../hooks/useIsMobile';

interface ConfigGroup {
  title: string;
  fields: {
    key: string;
    label: string;
    type: 'input' | 'password' | 'number';
    placeholder?: string;
  }[];
}

const CONFIG_GROUPS: ConfigGroup[] = [
  {
    title: '服务器配置',
    fields: [
      { key: 'SERVER_PORT', label: '服务端口', type: 'number', placeholder: '8080' },
    ],
  },
  {
    title: '数据库配置',
    fields: [
      { key: 'DB_HOST', label: '数据库地址', type: 'input', placeholder: 'localhost' },
      { key: 'DB_PORT', label: '数据库端口', type: 'number', placeholder: '3306' },
      { key: 'DB_USER', label: '数据库用户名', type: 'input', placeholder: 'menzhen' },
      { key: 'DB_PASSWORD', label: '数据库密码', type: 'password', placeholder: 'menzhen123' },
      { key: 'DB_NAME', label: '数据库名', type: 'input', placeholder: 'menzhen' },
    ],
  },
  {
    title: 'JWT 配置',
    fields: [
      { key: 'JWT_SECRET', label: 'JWT 密钥', type: 'password', placeholder: 'change-me-in-production' },
    ],
  },
  {
    title: 'MinIO 文件存储',
    fields: [
      { key: 'MINIO_ENDPOINT', label: 'MinIO 地址', type: 'input', placeholder: 'localhost:9000' },
      { key: 'MINIO_ACCESS_KEY', label: 'Access Key', type: 'password', placeholder: 'minioadmin' },
      { key: 'MINIO_SECRET_KEY', label: 'Secret Key', type: 'password', placeholder: 'minioadmin' },
      { key: 'MINIO_BUCKET', label: '存储桶名', type: 'input', placeholder: 'menzhen' },
    ],
  },
  {
    title: 'DeepSeek AI',
    fields: [
      { key: 'DEEPSEEK_API_KEY', label: 'API 密钥', type: 'password', placeholder: '（选填）' },
      { key: 'DEEPSEEK_BASE_URL', label: 'API 地址', type: 'input', placeholder: '（选填）' },
      { key: 'DEEPSEEK_MODEL', label: '模型名称', type: 'input', placeholder: '（选填）' },
    ],
  },
  {
    title: '七牛云备份',
    fields: [
      { key: 'QINIU_ACCESS_KEY', label: 'Access Key', type: 'password', placeholder: '（选填）' },
      { key: 'QINIU_SECRET_KEY', label: 'Secret Key', type: 'password', placeholder: '（选填）' },
      { key: 'QINIU_BUCKET', label: '存储空间名', type: 'input', placeholder: '（选填）' },
      { key: 'QINIU_KEY_PREFIX', label: '上传路径前缀', type: 'input', placeholder: 'menzhen-backup/' },
      { key: 'QINIU_DOMAIN', label: '下载域名', type: 'input', placeholder: 'public.qnlinking.com' },
      { key: 'QINIU_RETAIN_MYSQL', label: 'MySQL 备份保留数', type: 'number', placeholder: '5' },
      { key: 'QINIU_RETAIN_MINIO', label: 'MinIO 备份保留数', type: 'number', placeholder: '5' },
    ],
  },
  {
    title: '备份间隔',
    fields: [
      { key: 'BACKUP_INTERVAL_MYSQL', label: 'MySQL 备份间隔(秒)', type: 'number', placeholder: '7200' },
      { key: 'BACKUP_INTERVAL_MINIO', label: 'MinIO 备份间隔(秒)', type: 'number', placeholder: '43200' },
    ],
  },
];

export default function SystemConfig() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await getConfig()) as unknown as {
        data: { config: Record<string, string>; sensitive_set: string[] };
      };
      form.setFieldsValue(res.data.config);
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      // Convert number fields to string for backend
      const data: Record<string, string> = {};
      for (const [key, val] of Object.entries(values)) {
        data[key] = val != null ? String(val) : '';
      }
      await updateConfig(data);
      message.success('配置已保存，需重启 Docker 容器后生效');
    } catch {
      message.error('保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: ConfigGroup['fields'][0]) => {
    switch (field.type) {
      case 'password':
        return <Input.Password placeholder={field.placeholder} />;
      case 'number':
        return <InputNumber placeholder={field.placeholder} style={{ width: '100%' }} />;
      default:
        return <Input placeholder={field.placeholder} />;
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Form form={form} layout="vertical">
        {CONFIG_GROUPS.map((group) => (
          <Card
            key={group.title}
            title={group.title}
            size={isMobile ? 'small' : 'default'}
            style={{ marginBottom: 16 }}
          >
            {group.fields.map((field) => (
              <Form.Item key={field.key} name={field.key} label={field.label}>
                {renderField(field)}
              </Form.Item>
            ))}
          </Card>
        ))}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Space>
            <Button type="primary" size="large" loading={saving} onClick={handleSave}>
              保存配置
            </Button>
          </Space>
        </div>
      </Form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/settings/SystemConfig.tsx
git commit -m "feat: add SystemConfig page component"
```

### Task 6: Register route and menu item

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Layout.tsx`

- [ ] **Step 1: Add route in App.tsx**

In `web/src/App.tsx`:

After the existing settings imports (line 16, `import TenantList ...`), add:
```typescript
import SystemConfig from './pages/settings/SystemConfig';
```

After line 92 (`<Route path="settings/tenants" ...>`), add:
```typescript
        <Route path="settings/config" element={<SystemConfig />} />
```

- [ ] **Step 2: Add menu item in Layout.tsx**

In `web/src/components/Layout.tsx`:

Add `ToolOutlined` to the icons import (line 4-28):
```typescript
import {
  // ... existing imports ...
  ToolOutlined,
} from '@ant-design/icons';
```

In the settings menu section (around line 248), update the condition to include `user:manage` and add the menu item. After line 246 (`const canManageTenants = hasPermission('tenant:manage');`), add:
```typescript
    const canManageConfig = hasPermission('user:manage');
```

Update the `if` condition (line 248) to include `canManageConfig`:
```typescript
    if (canManageUsers || canManageRoles || canManageTenants || canManageConfig) {
```

After the tenants menu item push block (around line 270), add:
```typescript
      if (canManageConfig) {
        settingsChildren.push({
          key: '/settings/config',
          icon: <ToolOutlined />,
          label: '软件配置',
        });
      }
```

- [ ] **Step 3: Add selectedKeys entry in Layout.tsx**

In the `selectedKeys` useMemo block (around line 291-311), add before the settings/roles line:
```typescript
    if (path.startsWith('/settings/config')) return ['/settings/config'];
```

- [ ] **Step 4: Build to verify compilation**

Run: `cd web && npm run build`
Expected: SUCCESS

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: register config route and menu item"
```

---

## Chunk 4: Frontend Tests

### Task 7: SystemConfig page tests

**Files:**
- Create: `web/src/pages/settings/__tests__/SystemConfig.test.tsx`

- [ ] **Step 1: Write tests**

```tsx
// web/src/pages/settings/__tests__/SystemConfig.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SystemConfig from '../SystemConfig';

// Mock the API
vi.mock('../../../api/config', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

// Mock useIsMobile (default export)
vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

import { getConfig, updateConfig } from '../../../api/config';

const mockConfig = {
  data: {
    config: {
      SERVER_PORT: '8080',
      DB_HOST: 'localhost',
      DB_PORT: '3306',
      DB_USER: 'menzhen',
      DB_PASSWORD: '****n123',
      DB_NAME: 'menzhen',
      JWT_SECRET: '****tion',
      MINIO_ENDPOINT: 'localhost:9000',
      MINIO_ACCESS_KEY: '****dmin',
      MINIO_SECRET_KEY: '****dmin',
      MINIO_BUCKET: 'menzhen',
      DEEPSEEK_API_KEY: '',
      DEEPSEEK_BASE_URL: '',
      DEEPSEEK_MODEL: '',
      QINIU_ACCESS_KEY: '',
      QINIU_SECRET_KEY: '',
      QINIU_BUCKET: '',
      QINIU_KEY_PREFIX: 'menzhen-backup/',
      QINIU_DOMAIN: 'public.qnlinking.com',
      QINIU_RETAIN_MYSQL: '5',
      QINIU_RETAIN_MINIO: '5',
      BACKUP_INTERVAL_MYSQL: '7200',
      BACKUP_INTERVAL_MINIO: '43200',
    },
    sensitive_set: ['DB_PASSWORD', 'JWT_SECRET', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'],
  },
};

describe('SystemConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConfig as ReturnType<typeof vi.fn>).mockResolvedValue(mockConfig);
    (updateConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
  });

  it('renders all config groups', async () => {
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByText('服务器配置')).toBeInTheDocument();
      expect(screen.getByText('数据库配置')).toBeInTheDocument();
      expect(screen.getByText('JWT 配置')).toBeInTheDocument();
      expect(screen.getByText('MinIO 文件存储')).toBeInTheDocument();
      expect(screen.getByText('DeepSeek AI')).toBeInTheDocument();
      expect(screen.getByText('七牛云备份')).toBeInTheDocument();
      expect(screen.getByText('备份间隔')).toBeInTheDocument();
    });
  });

  it('loads and displays config values', async () => {
    render(<SystemConfig />);
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledTimes(1);
    });
    // Verify non-sensitive values are displayed in form inputs
    const dbHostInput = screen.getByLabelText('数据库地址') as HTMLInputElement;
    expect(dbHostInput.value).toBe('localhost');
  });

  it('saves config on button click', async () => {
    const user = userEvent.setup();
    render(<SystemConfig />);
    await waitFor(() => {
      expect(screen.getByText('保存配置')).toBeInTheDocument();
    });
    await user.click(screen.getByText('保存配置'));
    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledTimes(1);
    });
  });

  it('handles load failure gracefully', async () => {
    (getConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    render(<SystemConfig />);
    // Should not crash; getConfig was called
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalledTimes(1);
    });
  });

  it('shows loading spinner initially', () => {
    render(<SystemConfig />);
    expect(document.querySelector('.ant-spin')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run frontend tests**

Run: `cd web && npx vitest run src/pages/settings/__tests__/SystemConfig.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/settings/__tests__/SystemConfig.test.tsx
git commit -m "test: add SystemConfig page tests"
```

---

## Chunk 5: Docker & Deploy & Docs

### Task 8: Docker volume mount

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add .env volume mount to api service**

In `docker-compose.yml`, after line 19 (`env_file: .env`), add:
```yaml
    volumes:
      - ./.env:/app/.env
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: mount .env file into api container for config management"
```

### Task 9: Update documentation

**Files:**
- Modify: `docs/codebase.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update codebase.md**

Add to the API routes section:
```markdown
### 系统配置
| GET | /api/v1/config | user:manage | 读取系统配置（敏感字段掩码） |
| PUT | /api/v1/config | user:manage | 更新系统配置（写入 .env） |
```

Add to the file structure:
```markdown
- server/service/config.go — .env 读写服务
- server/handler/config.go — 系统配置 API handler
- web/src/pages/settings/SystemConfig.tsx — 软件配置页面
- web/src/api/config.ts — 配置 API 调用
```

- [ ] **Step 2: Update CLAUDE.md**

Add to the permission codes list:
```
（软件配置复用 user:manage 权限，无新增权限码）
```

Add design doc link:
```markdown
- [软件配置设计](docs/superpowers/specs/2026-03-15-software-config-design.md)
- [软件配置实施计划](docs/superpowers/plans/2026-03-15-software-config-plan.md)
```

- [ ] **Step 3: Commit**

```bash
git add docs/codebase.md CLAUDE.md README.md
git commit -m "docs: update documentation for software config feature"
```

### Task 10: Full verification

- [ ] **Step 1: Run backend tests**

Run: `cd server && go test ./... -v`
Expected: ALL PASS

- [ ] **Step 2: Run frontend tests**

Run: `cd web && npm run test`
Expected: ALL PASS

- [ ] **Step 3: Build frontend**

Run: `cd web && npm run build`
Expected: SUCCESS

- [ ] **Step 4: Build backend**

Run: `cd server && go build ./...`
Expected: SUCCESS

- [ ] **Step 5: Deploy**

Run: `./deploy.sh`
Expected: SUCCESS
