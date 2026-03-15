package service

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

var sensitiveKeys = map[string]bool{
	"DB_PASSWORD": true, "JWT_SECRET": true,
	"MINIO_ACCESS_KEY": true, "MINIO_SECRET_KEY": true,
	"DEEPSEEK_API_KEY": true, "QINIU_ACCESS_KEY": true, "QINIU_SECRET_KEY": true,
}

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

type ConfigService struct {
	envPath string
}

func NewConfigService(envPath string) *ConfigService {
	return &ConfigService{envPath: envPath}
}

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

func (s *ConfigService) UpdateConfig(newVals map[string]string) ([]string, error) {
	origVars, err := s.ReadEnvFile()
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read original env: %w", err)
	}
	if origVars == nil {
		origVars = make(map[string]string)
	}
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
	origContent, err := os.ReadFile(s.envPath)
	if err == nil {
		_ = os.WriteFile(s.envPath+".bak", origContent, 0644)
	}
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
			output = append(output, line)
		}
	}
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

func maskValue(val string) string {
	if val == "" {
		return ""
	}
	if len(val) > 4 {
		return "****" + val[len(val)-4:]
	}
	return "****"
}

func isMasked(val string) bool {
	return len(val) >= 4 && val[:4] == "****"
}
