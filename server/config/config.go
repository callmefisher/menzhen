package config

import (
	"bufio"
	"os"
	"strings"
)

type Config struct {
	DBHost         string
	DBPort         string
	DBUser         string
	DBPassword     string
	DBName         string
	JWTSecret      string
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOBucket    string
	ServerPort     string

	// DeepSeek AI configuration
	DeepSeekAPIKey  string
	DeepSeekBaseURL string
	DeepSeekModel   string
}

// fileVars caches values read from .env file at startup.
var fileVars map[string]string

func Load() *Config {
	fileVars = loadEnvFile()
	return &Config{
		DBHost:         getVal("DB_HOST", "localhost"),
		DBPort:         getVal("DB_PORT", "3306"),
		DBUser:         getVal("DB_USER", "menzhen"),
		DBPassword:     getVal("DB_PASSWORD", "menzhen123"),
		DBName:         getVal("DB_NAME", "menzhen"),
		JWTSecret:      getVal("JWT_SECRET", "change-me-in-production"),
		MinIOEndpoint:  getVal("MINIO_ENDPOINT", "localhost:9000"),
		MinIOAccessKey: getVal("MINIO_ACCESS_KEY", "minioadmin"),
		MinIOSecretKey: getVal("MINIO_SECRET_KEY", "minioadmin"),
		MinIOBucket:    getVal("MINIO_BUCKET", "menzhen"),
		ServerPort:     getVal("SERVER_PORT", "8080"),

		DeepSeekAPIKey:  getVal("DEEPSEEK_API_KEY", ""),
		DeepSeekBaseURL: getVal("DEEPSEEK_BASE_URL", ""),
		DeepSeekModel:   getVal("DEEPSEEK_MODEL", ""),
	}
}

// getVal reads from .env file first, then os env, then fallback.
func getVal(key, fallback string) string {
	if v, ok := fileVars[key]; ok && v != "" {
		return v
	}
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// loadEnvFile reads the .env file from the working directory.
func loadEnvFile() map[string]string {
	path := os.Getenv("ENV_FILE_PATH")
	if path == "" {
		path = ".env"
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
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
		vars[strings.TrimSpace(line[:idx])] = strings.TrimSpace(line[idx+1:])
	}
	return vars
}
