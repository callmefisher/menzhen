package config

import "os"

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

func Load() *Config {
	return &Config{
		DBHost:         getEnv("DB_HOST", "localhost"),
		DBPort:         getEnv("DB_PORT", "3306"),
		DBUser:         getEnv("DB_USER", "menzhen"),
		DBPassword:     getEnv("DB_PASSWORD", "menzhen123"),
		DBName:         getEnv("DB_NAME", "menzhen"),
		JWTSecret:      getEnv("JWT_SECRET", "change-me-in-production"),
		MinIOEndpoint:  getEnv("MINIO_ENDPOINT", "localhost:9000"),
		MinIOAccessKey: getEnv("MINIO_ACCESS_KEY", "minioadmin"),
		MinIOSecretKey: getEnv("MINIO_SECRET_KEY", "minioadmin"),
		MinIOBucket:    getEnv("MINIO_BUCKET", "menzhen"),
		ServerPort:     getEnv("SERVER_PORT", "8080"),

		DeepSeekAPIKey:  getEnv("DEEPSEEK_API_KEY", ""),
		DeepSeekBaseURL: getEnv("DEEPSEEK_BASE_URL", "https://api.qnaigc.com/v1/messages"),
		DeepSeekModel:   getEnv("DEEPSEEK_MODEL", "deepseek/deepseek-v3.2-251201"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
