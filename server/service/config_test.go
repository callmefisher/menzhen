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
	content := "# Database\nDB_HOST=localhost\nDB_PORT=3306\nDB_PASSWORD=mysecretpass\n\n# Empty value\nDEEPSEEK_API_KEY=\n"
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
	tests := []struct{ value, expected string }{
		{"mysecretpassword", "****word"},
		{"abcd", "****"},
		{"abc", "****"},
		{"", ""},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.expected, maskValue(tt.value), "masking %q", tt.value)
	}
}

func TestIsMasked(t *testing.T) {
	assert.True(t, isMasked("****word"))
	assert.True(t, isMasked("****"))
	assert.False(t, isMasked("plaintext"))
	assert.False(t, isMasked(""))
	assert.False(t, isMasked("***x"))
}

func TestGetConfig(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	content := "DB_HOST=localhost\nDB_PORT=3306\nDB_PASSWORD=mysecretpass\nJWT_SECRET=abc\nDEEPSEEK_API_KEY=\nUNKNOWN_VAR=keepme\n"
	require.NoError(t, os.WriteFile(envPath, []byte(content), 0644))
	svc := NewConfigService(envPath)
	cfg, sensitiveSet, err := svc.GetConfig()
	require.NoError(t, err)
	assert.Equal(t, "localhost", cfg["DB_HOST"])
	assert.Equal(t, "****pass", cfg["DB_PASSWORD"])
	assert.Equal(t, "****", cfg["JWT_SECRET"])
	assert.Equal(t, "", cfg["DEEPSEEK_API_KEY"])
	assert.Contains(t, sensitiveSet, "DB_PASSWORD")
	assert.Contains(t, sensitiveSet, "JWT_SECRET")
	assert.NotContains(t, sensitiveSet, "DEEPSEEK_API_KEY")
	assert.Empty(t, cfg["UNKNOWN_VAR"])
}

func TestUpdateConfig(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	original := "# Database\nDB_HOST=localhost\nDB_PASSWORD=oldpassword\nUNKNOWN_VAR=keepme\n"
	require.NoError(t, os.WriteFile(envPath, []byte(original), 0644))
	svc := NewConfigService(envPath)
	changedKeys, err := svc.UpdateConfig(map[string]string{
		"DB_HOST":     "newhost",
		"DB_PASSWORD": "****word",
		"DB_PORT":     "3307",
	})
	require.NoError(t, err)
	assert.Contains(t, changedKeys, "DB_HOST")
	assert.Contains(t, changedKeys, "DB_PORT")
	assert.NotContains(t, changedKeys, "DB_PASSWORD")
	vars, err := svc.ReadEnvFile()
	require.NoError(t, err)
	assert.Equal(t, "newhost", vars["DB_HOST"])
	assert.Equal(t, "oldpassword", vars["DB_PASSWORD"])
	assert.Equal(t, "3307", vars["DB_PORT"])
	assert.Equal(t, "keepme", vars["UNKNOWN_VAR"])
	_, err = os.Stat(envPath + ".bak")
	assert.NoError(t, err)
}
