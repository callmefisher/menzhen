package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoad_FromEnvFile(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	content := "DB_HOST=filehost\nDB_PORT=3307\nDB_USER=fileuser\nDB_PASSWORD=filepass\nDB_NAME=filedb\nJWT_SECRET=filejwt\nSERVER_PORT=9090\n"
	require.NoError(t, os.WriteFile(envPath, []byte(content), 0644))

	t.Setenv("ENV_FILE_PATH", envPath)
	// Clear any existing env vars to ensure file takes precedence
	t.Setenv("DB_HOST", "")
	t.Setenv("DB_PORT", "")

	cfg := Load()
	assert.Equal(t, "filehost", cfg.DBHost)
	assert.Equal(t, "3307", cfg.DBPort)
	assert.Equal(t, "fileuser", cfg.DBUser)
	assert.Equal(t, "filepass", cfg.DBPassword)
	assert.Equal(t, "filedb", cfg.DBName)
	assert.Equal(t, "filejwt", cfg.JWTSecret)
	assert.Equal(t, "9090", cfg.ServerPort)
}

func TestLoad_EnvVarOverridesDefault(t *testing.T) {
	// Point to non-existent file so file vars are nil
	t.Setenv("ENV_FILE_PATH", "/nonexistent/.env")
	t.Setenv("DB_HOST", "envhost")
	t.Setenv("SERVER_PORT", "7777")

	cfg := Load()
	assert.Equal(t, "envhost", cfg.DBHost)
	assert.Equal(t, "7777", cfg.ServerPort)
}

func TestLoad_FileOverridesEnvVar(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	require.NoError(t, os.WriteFile(envPath, []byte("DB_HOST=fromfile\n"), 0644))

	t.Setenv("ENV_FILE_PATH", envPath)
	t.Setenv("DB_HOST", "fromenv")

	cfg := Load()
	// File takes precedence over env var
	assert.Equal(t, "fromfile", cfg.DBHost)
}

func TestLoad_FallbackDefaults(t *testing.T) {
	t.Setenv("ENV_FILE_PATH", "/nonexistent/.env")
	// Clear all env vars
	t.Setenv("DB_HOST", "")
	t.Setenv("DB_PORT", "")
	t.Setenv("DB_USER", "")
	t.Setenv("DB_PASSWORD", "")
	t.Setenv("SERVER_PORT", "")

	cfg := Load()
	assert.Equal(t, "localhost", cfg.DBHost)
	assert.Equal(t, "3306", cfg.DBPort)
	assert.Equal(t, "menzhen", cfg.DBUser)
	assert.Equal(t, "menzhen123", cfg.DBPassword)
	assert.Equal(t, "8080", cfg.ServerPort)
}

func TestLoad_EmptyEnvFile(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	require.NoError(t, os.WriteFile(envPath, []byte(""), 0644))

	t.Setenv("ENV_FILE_PATH", envPath)
	t.Setenv("DB_HOST", "")

	cfg := Load()
	// Should use defaults when file is empty and env vars unset
	assert.Equal(t, "localhost", cfg.DBHost)
}

func TestLoad_CommentsAndBlankLines(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	content := "# This is a comment\n\nDB_HOST=myhost\n# Another comment\nDB_PORT=5555\n"
	require.NoError(t, os.WriteFile(envPath, []byte(content), 0644))

	t.Setenv("ENV_FILE_PATH", envPath)

	cfg := Load()
	assert.Equal(t, "myhost", cfg.DBHost)
	assert.Equal(t, "5555", cfg.DBPort)
}

func TestLoad_DeepSeekConfig(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	content := "DEEPSEEK_API_KEY=sk-test123\nDEEPSEEK_BASE_URL=https://api.example.com\nDEEPSEEK_MODEL=deepseek-v3\n"
	require.NoError(t, os.WriteFile(envPath, []byte(content), 0644))

	t.Setenv("ENV_FILE_PATH", envPath)

	cfg := Load()
	assert.Equal(t, "sk-test123", cfg.DeepSeekAPIKey)
	assert.Equal(t, "https://api.example.com", cfg.DeepSeekBaseURL)
	assert.Equal(t, "deepseek-v3", cfg.DeepSeekModel)
}
