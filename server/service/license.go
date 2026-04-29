package service

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

type LicenseService struct {
	DB *gorm.DB
}

func NewLicenseService(db *gorm.DB) *LicenseService {
	return &LicenseService{DB: db}
}

const machineIDFile = "/data/machine-id"

func EnsureMachineID() string {
	data, err := os.ReadFile(machineIDFile)
	if err == nil && len(strings.TrimSpace(string(data))) > 0 {
		return strings.TrimSpace(string(data))
	}
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 6)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		b[i] = charset[n.Int64()]
	}
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	machineID := string(b) + "_" + timestamp
	dir := filepath.Dir(machineIDFile)
	os.MkdirAll(dir, 0755)
	if err := os.WriteFile(machineIDFile, []byte(machineID), 0644); err != nil {
		log.Printf("WARNING: failed to persist machine-id to %s: %v", machineIDFile, err)
	}
	return machineID
}

func GetSiteID() string {
	if v := os.Getenv("SITE_ID"); v != "" {
		return v
	}
	data, err := os.ReadFile(".env")
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "SITE_ID=") {
				return strings.TrimSpace(strings.TrimPrefix(line, "SITE_ID="))
			}
		}
	}
	return ""
}

type LicenseClaims struct {
	SiteID    string   `json:"site_id"`
	MachineID string   `json:"machine_id"`
	Method    string   `json:"method"`
	Duration  int      `json:"duration"`
	Features  []string `json:"features"`
	Amount    float64  `json:"amount"`
	TenantID  uint64   `json:"tenant_id"`
	jwt.RegisteredClaims
}

func (s *LicenseService) SignLicense(privateKeyPEM string, claims LicenseClaims) (string, error) {
	key, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(privateKeyPEM))
	if err != nil {
		return "", fmt.Errorf("parse private key: %w", err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(key)
}

func VerifyLicense(publicKeyPEM string, tokenStr string) (*LicenseClaims, error) {
	key, err := jwt.ParseRSAPublicKeyFromPEM([]byte(publicKeyPEM))
	if err != nil {
		return nil, fmt.Errorf("parse public key: %w", err)
	}
	token, err := jwt.ParseWithClaims(tokenStr, &LicenseClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return key, nil
	})
	if err != nil {
		return nil, fmt.Errorf("verify token: %w", err)
	}
	claims, ok := token.Claims.(*LicenseClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

type CreateLicenseRequest struct {
	TenantID     uint64   `json:"tenant_id" binding:"required"`
	SiteID       string   `json:"site_id" binding:"required"`
	MachineID    string   `json:"machine_id" binding:"required"`
	Method       string   `json:"method" binding:"required"`
	Duration     int      `json:"duration"`
	AuthDate     string   `json:"auth_date"`
	Features     []string `json:"features"`
	Amount       float64  `json:"amount"`
	Remark       string   `json:"remark"`
	LicenseToken string   `json:"license_token"`
}

type UpdateLicenseRequest struct {
	SiteID       string   `json:"site_id"`
	MachineID    string   `json:"machine_id"`
	Method       string   `json:"method"`
	Duration     int      `json:"duration"`
	AuthDate     string   `json:"auth_date"`
	Features     []string `json:"features"`
	Amount       float64  `json:"amount"`
	Remark       string   `json:"remark"`
	LicenseToken string   `json:"license_token"`
}

func (s *LicenseService) CreateLicense(req CreateLicenseRequest, creator string, privateKeyPEM string) (*model.License, error) {
	var authDate, expiryDate *time.Time
	if req.AuthDate != "" {
		t, err := time.Parse("2006-01-02", req.AuthDate)
		if err != nil {
			return nil, fmt.Errorf("invalid auth_date: %w", err)
		}
		authDate = &t
	} else {
		now := time.Now()
		authDate = &now
	}

	if req.Method == "permanent" {
		far := time.Date(2099, 12, 31, 23, 59, 59, 0, time.Local)
		expiryDate = &far
		req.Duration = 0
	} else {
		if req.Duration <= 0 {
			req.Duration = 1
		}
		exp := s.calcExpiry(*authDate, req.Method, req.Duration)
		expiryDate = &exp
	}

	featuresJSON, _ := json.Marshal(req.Features)

	var existingActive model.License
	if err := s.DB.Where("tenant_id = ? AND status = 'active'", req.TenantID).First(&existingActive).Error; err == nil {
		existingActive.Status = "superseded"
		s.DB.Save(&existingActive)
	}

	claims := LicenseClaims{
		SiteID:    req.SiteID,
		MachineID: req.MachineID,
		Method:    req.Method,
		Duration:  req.Duration,
		Features:  req.Features,
		Amount:    req.Amount,
		TenantID:  req.TenantID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(*authDate),
			ExpiresAt: jwt.NewNumericDate(*expiryDate),
		},
	}

	jwtToken := ""
	if req.LicenseToken != "" {
		jwtToken = req.LicenseToken
	} else if privateKeyPEM != "" {
		signed, err := s.SignLicense(privateKeyPEM, claims)
		if err != nil {
			log.Printf("WARNING: failed to sign license JWT: %v", err)
		} else {
			jwtToken = signed
		}
	}

	lic := model.License{
		TenantID:   req.TenantID,
		SiteID:     req.SiteID,
		MachineID:  req.MachineID,
		Method:     req.Method,
		Duration:   req.Duration,
		AuthDate:   authDate,
		ExpiryDate: expiryDate,
		Features:   string(featuresJSON),
		Amount:     req.Amount,
		JWTToken:   jwtToken,
		Status:     "active",
		Remark:     req.Remark,
		CreatedBy:  creator,
	}

	if err := s.DB.Create(&lic).Error; err != nil {
		return nil, fmt.Errorf("create license: %w", err)
	}
	return &lic, nil
}

func (s *LicenseService) UpdateLicense(id uint64, req UpdateLicenseRequest, privateKeyPEM string) (*model.License, error) {
	var lic model.License
	if err := s.DB.First(&lic, id).Error; err != nil {
		return nil, fmt.Errorf("license not found")
	}

	if req.SiteID != "" {
		lic.SiteID = req.SiteID
	}
	if req.MachineID != "" {
		lic.MachineID = req.MachineID
	}
	if req.Method != "" {
		lic.Method = req.Method
	}
	if req.Duration > 0 {
		lic.Duration = req.Duration
	}
	if req.Features != nil {
		featuresJSON, _ := json.Marshal(req.Features)
		lic.Features = string(featuresJSON)
	}
	lic.Amount = req.Amount
	if req.Remark != "" {
		lic.Remark = req.Remark
	}

	if req.AuthDate != "" {
		t, err := time.Parse("2006-01-02", req.AuthDate)
		if err == nil {
			lic.AuthDate = &t
		}
	}

	if lic.Method == "permanent" {
		far := time.Date(2099, 12, 31, 23, 59, 59, 0, time.Local)
		lic.ExpiryDate = &far
		lic.Duration = 0
	} else if lic.AuthDate != nil && lic.Duration > 0 {
		exp := s.calcExpiry(*lic.AuthDate, lic.Method, lic.Duration)
		lic.ExpiryDate = &exp
	}

	var features []string
	json.Unmarshal([]byte(lic.Features), &features)
	claims := LicenseClaims{
		SiteID:    lic.SiteID,
		MachineID: lic.MachineID,
		Method:    lic.Method,
		Duration:  lic.Duration,
		Features:  features,
		Amount:    lic.Amount,
		TenantID:  lic.TenantID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(*lic.AuthDate),
			ExpiresAt: jwt.NewNumericDate(*lic.ExpiryDate),
		},
	}
	if req.LicenseToken != "" {
		lic.JWTToken = req.LicenseToken
	} else if privateKeyPEM != "" {
		signed, err := s.SignLicense(privateKeyPEM, claims)
		if err == nil {
			lic.JWTToken = signed
		}
	}

	s.DB.Save(&lic)
	return &lic, nil
}

func (s *LicenseService) GetLicense(id uint64) (*model.License, error) {
	var lic model.License
	if err := s.DB.First(&lic, id).Error; err != nil {
		return nil, fmt.Errorf("license not found")
	}
	return &lic, nil
}

func (s *LicenseService) GetActiveLicense(tenantID uint64) (*model.License, error) {
	var lic model.License
	if err := s.DB.Where("tenant_id = ? AND status = 'active'", tenantID).First(&lic).Error; err != nil {
		return nil, err
	}
	return &lic, nil
}

func (s *LicenseService) ListLicenses(tenantID uint64) ([]model.License, error) {
	var licenses []model.License
	q := s.DB.Where("tenant_id = ?", tenantID)
	if err := q.Order("created_at DESC").Find(&licenses).Error; err != nil {
		return nil, err
	}
	return licenses, nil
}

func (s *LicenseService) ListAllLicenses() ([]model.License, error) {
	var licenses []model.License
	if err := s.DB.Order("created_at DESC").Find(&licenses).Error; err != nil {
		return nil, err
	}
	return licenses, nil
}

func (s *LicenseService) DeleteLicense(id uint64) error {
	return s.DB.Delete(&model.License{}, id).Error
}

type LicenseStats struct {
	TotalAmount   float64            `json:"total_amount"`
	TotalCount    int64              `json:"total_count"`
	ByMethod      map[string]float64 `json:"by_method"`
	ByFeature     map[string]float64 `json:"by_feature"`
	MonthlyAmount []MonthlyAmount    `json:"monthly_amount"`
}

type MonthlyAmount struct {
	Month  string  `json:"month"`
	Amount float64 `json:"amount"`
	Basic  float64 `json:"basic"`
	AI     float64 `json:"ai"`
	Cloud  float64 `json:"cloud"`
}

func (s *LicenseService) GetStats(startDate, endDate string) (*LicenseStats, error) {
	stats := &LicenseStats{
		ByMethod:  make(map[string]float64),
		ByFeature: make(map[string]float64),
	}

	q := s.DB.Model(&model.License{})
	if startDate != "" {
		q = q.Where("auth_date >= ?", startDate)
	}
	if endDate != "" {
		q = q.Where("auth_date <= ?", endDate+" 23:59:59")
	}

	var licenses []model.License
	if err := q.Find(&licenses).Error; err != nil {
		return nil, err
	}

	for _, lic := range licenses {
		stats.TotalAmount += lic.Amount
		stats.TotalCount++
		stats.ByMethod[lic.Method] += lic.Amount

		var features []string
		json.Unmarshal([]byte(lic.Features), &features)
		for _, f := range features {
			stats.ByFeature[f] += lic.Amount / float64(len(features))
		}
	}

	return stats, nil
}

func (s *LicenseService) GetMonthlyStats(startDate, endDate string) ([]MonthlyAmount, error) {
	var results []MonthlyAmount
	query := `
		SELECT 
			DATE_FORMAT(auth_date, '%Y-%m') AS month,
			SUM(amount) AS amount,
			SUM(CASE WHEN JSON_CONTAINS(features, '"basic"') THEN amount / JSON_LENGTH(features) ELSE 0 END) AS basic,
			SUM(CASE WHEN JSON_CONTAINS(features, '"ai"') THEN amount / JSON_LENGTH(features) ELSE 0 END) AS ai,
			SUM(CASE WHEN JSON_CONTAINS(features, '"cloud"') THEN amount / JSON_LENGTH(features) ELSE 0 END) AS cloud
		FROM licenses
		WHERE deleted_at IS NULL
	`
	args := []interface{}{}
	if startDate != "" {
		query += " AND auth_date >= ?"
		args = append(args, startDate)
	}
	if endDate != "" {
		query += " AND auth_date <= ?"
		args = append(args, endDate+" 23:59:59")
	}
	query += " GROUP BY DATE_FORMAT(auth_date, '%Y-%m') ORDER BY month"

	if err := s.DB.Raw(query, args...).Scan(&results).Error; err != nil {
		return nil, err
	}
	return results, nil
}

func (s *LicenseService) calcExpiry(start time.Time, method string, duration int) time.Time {
	switch method {
	case "day":
		return start.AddDate(0, 0, duration)
	case "week":
		return start.AddDate(0, 0, duration*7)
	case "month":
		return start.AddDate(0, duration, 0)
	case "year":
		return start.AddDate(duration, 0, 0)
	default:
		return start.AddDate(0, duration, 0)
	}
}

func CheckExpiredLicenses(db *gorm.DB) {
	var licenses []model.License
	now := time.Now()
	if err := db.Where("status = 'active' AND expiry_date < ?", now).Find(&licenses).Error; err != nil {
		log.Printf("license expiry check error: %v", err)
		return
	}
	for _, lic := range licenses {
		lic.Status = "expired"
		db.Save(&lic)
		log.Printf("license %d (tenant %d) expired", lic.ID, lic.TenantID)
	}
}

func (s *LicenseService) GetMachineIdentity() (string, string) {
	machineID := EnsureMachineID()
	siteID := GetSiteID()

	var mi model.MachineIdentity
	if err := s.DB.Where("machine_id = ?", machineID).First(&mi).Error; err != nil {
		mi = model.MachineIdentity{
			MachineID: machineID,
			SiteID:    siteID,
		}
		s.DB.Create(&mi)
	} else {
		if siteID != "" && mi.SiteID != siteID {
			mi.SiteID = siteID
			s.DB.Save(&mi)
		}
	}
	if mi.SiteID == "" && siteID != "" {
		mi.SiteID = siteID
		s.DB.Save(&mi)
	}
	return mi.SiteID, mi.MachineID
}

func (s *LicenseService) UpdateMachineIdentity(siteID string) error {
	machineID := EnsureMachineID()
	var mi model.MachineIdentity
	if err := s.DB.Where("machine_id = ?", machineID).First(&mi).Error; err != nil {
		mi = model.MachineIdentity{
			MachineID: machineID,
			SiteID:    siteID,
		}
		return s.DB.Create(&mi).Error
	}
	mi.SiteID = siteID
	return s.DB.Save(&mi).Error
}

func LoadPublicKey() string {
	paths := []string{"scripts/public.pem", "/app/scripts/public.pem", "public.pem"}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err == nil {
			return string(data)
		}
	}
	return ""
}

func LoadPrivateKey() string {
	paths := []string{"scripts/private.pem", "/app/scripts/private.pem", "private.pem"}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err == nil {
			return string(data)
		}
	}
	return ""
}
