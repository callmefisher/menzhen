package service

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

type LicenseService struct {
	DB *gorm.DB
}

func NewLicenseService(db *gorm.DB) *LicenseService {
	return &LicenseService{DB: db}
}

const ExpectedPublicKeyMD5 = "e795fca8f9c01eb8d0947c508d0ace34"

func ValidatePublicKeyMD5(publicKeyPEM string) error {
	if publicKeyPEM == "" {
		return fmt.Errorf("公钥为空，无法校验")
	}
	hash := md5.Sum([]byte(publicKeyPEM))
	actual := fmt.Sprintf("%x", hash)
	if actual != ExpectedPublicKeyMD5 {
		log.Printf("[license] public key MD5 mismatch: expected=%s, actual=%s", ExpectedPublicKeyMD5, actual)
		return fmt.Errorf("公钥MD5校验失败: 期望 %s, 实际 %s", ExpectedPublicKeyMD5, actual)
	}
	log.Printf("[license] public key MD5 validated: %s", actual)
	return nil
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
	SiteID     string   `json:"site_id"`
	MachineID  string   `json:"machine_id"`
	ClinicCode string   `json:"clinic_code,omitempty"`
	Method     string   `json:"method"`
	Duration   int      `json:"duration"`
	Features   []string `json:"features"`
	Amount     float64  `json:"amount"`
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
	LicenseType  string   `json:"license_type"`
	ClinicCode   string   `json:"clinic_code"`
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
	LicenseType  string   `json:"license_type"`
	ClinicCode   string   `json:"clinic_code"`
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

func (s *LicenseService) CreateSiteLicense(req CreateLicenseRequest, creator string, privateKeyPEM string) (*model.License, error) {
	if req.LicenseType == "" {
		req.LicenseType = "site"
	} else if req.LicenseType != "site" && req.LicenseType != "clinic" {
		return nil, fmt.Errorf("invalid license_type: %s, must be 'site' or 'clinic'", req.LicenseType)
	}

	if req.LicenseType == "clinic" && req.ClinicCode == "" {
		return nil, fmt.Errorf("clinic license requires clinic_code")
	}

	publicKeyPEM := LoadPublicKey()
	if publicKeyPEM != "" {
		if err := ValidatePublicKeyMD5(publicKeyPEM); err != nil {
			log.Printf("[license] CreateSiteLicense rejected: public key MD5 validation failed: %v", err)
			return nil, fmt.Errorf("公钥校验失败，拒绝生成license: %w", err)
		}
		log.Printf("[license] public key MD5 validated before license creation")
	} else {
		log.Printf("[license] WARNING: no public key loaded, skipping MD5 validation (test mode)")
	}

	var authDate, expiryDate *time.Time
	if req.AuthDate != "" {
		loc, _ := time.LoadLocation("Asia/Shanghai")
		t, err := time.ParseInLocation("2006-01-02", req.AuthDate, loc)
		if err != nil {
			return nil, fmt.Errorf("invalid auth_date: %w", err)
		}
		authDate = &t
	} else {
		now := time.Now()
		authDate = &now
	}

	if req.Method == "permanent" {
		loc, _ := time.LoadLocation("Asia/Shanghai")
		far := time.Date(2099, 12, 31, 23, 59, 59, 0, loc)
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

	claims := LicenseClaims{
		ClinicCode: req.ClinicCode,
		SiteID:     req.SiteID,
		MachineID:  req.MachineID,
		Method:     req.Method,
		Duration:   req.Duration,
		Features:   req.Features,
		Amount:     req.Amount,
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
			log.Printf("[license] WARNING: failed to sign license JWT: %v", err)
		} else {
			jwtToken = signed
		}
	}

	var tenantID uint64
	if req.ClinicCode != "" {
		s.DB.Table("tenants").Where("code = ?", req.ClinicCode).Select("id").Scan(&tenantID)
		log.Printf("[license] resolved clinic_code=%s to tenant_id=%d", req.ClinicCode, tenantID)
	}

	if jwtToken != "" {
		var sameTokenLicense model.License
		sameTokenQuery := s.DB.Where("jwt_token = ?", jwtToken)
		if err := sameTokenQuery.First(&sameTokenLicense).Error; err == nil {
			sameTokenLicense.TenantID = tenantID
			sameTokenLicense.LicenseType = req.LicenseType
			sameTokenLicense.ClinicCode = req.ClinicCode
			sameTokenLicense.SiteID = req.SiteID
			sameTokenLicense.MachineID = req.MachineID
			sameTokenLicense.Method = req.Method
			sameTokenLicense.Duration = req.Duration
			sameTokenLicense.AuthDate = authDate
			sameTokenLicense.ExpiryDate = expiryDate
			sameTokenLicense.Features = string(featuresJSON)
			sameTokenLicense.Amount = req.Amount
			sameTokenLicense.Status = "active"
			sameTokenLicense.Remark = req.Remark
			sameTokenLicense.CreatedBy = creator
			s.DB.Save(&sameTokenLicense)
			log.Printf("[license] same JWT token, updated existing license: id=%d, type=%s, clinic_code=%s, site_id=%s", sameTokenLicense.ID, sameTokenLicense.LicenseType, sameTokenLicense.ClinicCode, sameTokenLicense.SiteID)
			return &sameTokenLicense, nil
		}
	}

	if req.LicenseType == "clinic" {
		now := time.Now()
		s.DB.Model(&model.License{}).
			Where("license_type = 'clinic' AND clinic_code = ? AND site_id = ? AND machine_id = ? AND status = 'active' AND (expiry_date IS NULL OR expiry_date > ?)",
				req.ClinicCode, req.SiteID, req.MachineID, now).
			Update("status", "superseded")
	} else if req.LicenseType == "site" {
		now := time.Now()
		s.DB.Model(&model.License{}).
			Where("license_type = 'site' AND site_id = ? AND machine_id = ? AND status = 'active' AND (expiry_date IS NULL OR expiry_date > ?)",
				req.SiteID, req.MachineID, now).
			Update("status", "superseded")
	}

	lic := model.License{
		TenantID:    tenantID,
		LicenseType: req.LicenseType,
		ClinicCode:  req.ClinicCode,
		SiteID:      req.SiteID,
		MachineID:   req.MachineID,
		Method:      req.Method,
		Duration:    req.Duration,
		AuthDate:    authDate,
		ExpiryDate:  expiryDate,
		Features:    string(featuresJSON),
		Amount:      req.Amount,
		JWTToken:    jwtToken,
		Status:      "active",
		Remark:      req.Remark,
		CreatedBy:   creator,
	}

	if err := s.DB.Create(&lic).Error; err != nil {
		return nil, fmt.Errorf("create license: %w", err)
	}
	log.Printf("[license] created license: id=%d, type=%s, clinic_code=%s, site_id=%s, method=%s", lic.ID, lic.LicenseType, lic.ClinicCode, lic.SiteID, lic.Method)
	return &lic, nil
}

func (s *LicenseService) UpdateLicense(id uint64, req UpdateLicenseRequest, privateKeyPEM string) (*model.License, error) {
	var lic model.License
	if err := s.DB.First(&lic, id).Error; err != nil {
		return nil, fmt.Errorf("license not found")
	}

	if req.LicenseToken != "" {
		var existingSameToken model.License
		if err := s.DB.Where("jwt_token = ? AND id != ?", req.LicenseToken, id).First(&existingSameToken).Error; err == nil {
			if existingSameToken.ExpiryDate != nil {
				loc, _ := time.LoadLocation("Asia/Shanghai")
				nowCST := time.Now().In(loc)
				expCST := existingSameToken.ExpiryDate.In(loc)
				if expCST.Before(nowCST) {
					return nil, fmt.Errorf("授权码已过期（过期时间: %s），无法更新", expCST.Format("2006-01-02 15:04:05"))
				}
			}
			existingSameToken.Status = "active"
			if lic.Status == "active" {
				lic.Status = "superseded"
				s.DB.Save(&lic)
				log.Printf("[license] current license superseded due to same JWT token re-activation: id=%d", lic.ID)
			}
			s.DB.Save(&existingSameToken)
			log.Printf("[license] re-activated existing license with same JWT token: id=%d", existingSameToken.ID)
			return &existingSameToken, nil
		}

		lic.JWTToken = req.LicenseToken

		publicKeyPEM := LoadPublicKey()
		if publicKeyPEM != "" {
			if decodedClaims, err := VerifyLicense(publicKeyPEM, req.LicenseToken); err == nil {
				if decodedClaims.ExpiresAt != nil {
					loc, _ := time.LoadLocation("Asia/Shanghai")
					nowCST := time.Now().In(loc)
					expCST := decodedClaims.ExpiresAt.Time.In(loc)
					if expCST.Before(nowCST) {
						return nil, fmt.Errorf("授权码已过期（过期时间: %s），无法更新", expCST.Format("2006-01-02 15:04:05"))
					}
				}
				if decodedClaims.ClinicCode != "" {
					lic.ClinicCode = decodedClaims.ClinicCode
					lic.LicenseType = "clinic"
				}
				if decodedClaims.SiteID != "" {
					lic.SiteID = decodedClaims.SiteID
				}
				if decodedClaims.MachineID != "" {
					lic.MachineID = decodedClaims.MachineID
				}
				if decodedClaims.Method != "" {
					lic.Method = decodedClaims.Method
				}
				if decodedClaims.Duration > 0 {
					lic.Duration = decodedClaims.Duration
				}
				if len(decodedClaims.Features) > 0 {
					featuresJSON, _ := json.Marshal(decodedClaims.Features)
					lic.Features = string(featuresJSON)
				}
				lic.Amount = decodedClaims.Amount

				if decodedClaims.ExpiresAt != nil {
					exp := decodedClaims.ExpiresAt.Time
					lic.ExpiryDate = &exp
				}
				if decodedClaims.IssuedAt != nil {
					auth := decodedClaims.IssuedAt.Time
					lic.AuthDate = &auth
				}
				log.Printf("[license] decoded JWT token for license update: id=%d, clinic_code=%s, site_id=%s", lic.ID, decodedClaims.ClinicCode, decodedClaims.SiteID)
			}
		}

		if lic.Method == "permanent" {
			loc, _ := time.LoadLocation("Asia/Shanghai")
			far := time.Date(2099, 12, 31, 23, 59, 59, 0, loc)
			lic.ExpiryDate = &far
			lic.Duration = 0
		}

		lic.Status = "active"
	} else {
		if req.ClinicCode != "" {
			lic.ClinicCode = req.ClinicCode
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
			loc, _ := time.LoadLocation("Asia/Shanghai")
			t, err := time.ParseInLocation("2006-01-02", req.AuthDate, loc)
			if err == nil {
				lic.AuthDate = &t
			}
		}

		if lic.Method == "permanent" {
			loc, _ := time.LoadLocation("Asia/Shanghai")
			far := time.Date(2099, 12, 31, 23, 59, 59, 0, loc)
			lic.ExpiryDate = &far
			lic.Duration = 0
		} else if lic.AuthDate != nil && lic.Duration > 0 {
			exp := s.calcExpiry(*lic.AuthDate, lic.Method, lic.Duration)
			lic.ExpiryDate = &exp
		}

		var features []string
		json.Unmarshal([]byte(lic.Features), &features)
		claims := LicenseClaims{
			ClinicCode: lic.ClinicCode,
			SiteID:     lic.SiteID,
			MachineID:  lic.MachineID,
			Method:     lic.Method,
			Duration:   lic.Duration,
			Features:   features,
			Amount:     lic.Amount,
			RegisteredClaims: jwt.RegisteredClaims{
				IssuedAt:  jwt.NewNumericDate(*lic.AuthDate),
				ExpiresAt: jwt.NewNumericDate(*lic.ExpiryDate),
			},
		}
		if privateKeyPEM != "" {
			signed, err := s.SignLicense(privateKeyPEM, claims)
			if err == nil {
				lic.JWTToken = signed
			}
		}
	}

	if lic.LicenseType == "clinic" && lic.ClinicCode != "" {
		var newTenantID uint64
		s.DB.Table("tenants").Where("code = ?", lic.ClinicCode).Select("id").Scan(&newTenantID)
		lic.TenantID = newTenantID
	}

	if lic.Status == "active" {
		now := time.Now()
		if lic.LicenseType == "clinic" && lic.ClinicCode != "" {
			s.DB.Model(&model.License{}).
				Where("license_type = 'clinic' AND clinic_code = ? AND site_id = ? AND machine_id = ? AND status = 'active' AND id != ? AND (expiry_date IS NULL OR expiry_date > ?)",
					lic.ClinicCode, lic.SiteID, lic.MachineID, lic.ID, now).
				Update("status", "superseded")
		} else if lic.LicenseType == "site" {
			s.DB.Model(&model.License{}).
				Where("license_type = 'site' AND site_id = ? AND machine_id = ? AND status = 'active' AND id != ? AND (expiry_date IS NULL OR expiry_date > ?)",
					lic.SiteID, lic.MachineID, lic.ID, now).
				Update("status", "superseded")
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

func (s *LicenseService) GetSiteActiveLicense(siteID, machineID string) (*model.License, error) {
	var lic model.License
	now := time.Now()
	q := s.DB.Where("license_type = 'site' AND status = 'active' AND (expiry_date IS NULL OR expiry_date > ?)", now)
	if siteID != "" {
		q = q.Where("site_id = ?", siteID)
	}
	if machineID != "" {
		q = q.Where("machine_id = ?", machineID)
	}
	if err := q.First(&lic).Error; err != nil {
		log.Printf("[license] GetSiteActiveLicense: no active site license found for site_id=%s, machine_id=%s, err=%v", siteID, machineID, err)
		return nil, err
	}
	log.Printf("[license] GetSiteActiveLicense: found active site license id=%d for site_id=%s", lic.ID, siteID)
	return &lic, nil
}

func (s *LicenseService) GetSiteLatestLicense(siteID, machineID string) (*model.License, error) {
	var lic model.License
	q := s.DB.Where("license_type = 'site'")
	if siteID != "" {
		q = q.Where("site_id = ?", siteID)
	}
	if machineID != "" {
		q = q.Where("machine_id = ?", machineID)
	}
	if err := q.Order("created_at DESC").First(&lic).Error; err != nil {
		return nil, err
	}
	return &lic, nil
}

func (s *LicenseService) GetClinicActiveLicense(clinicCode, siteID, machineID string) (*model.License, error) {
	var lic model.License
	now := time.Now()
	q := s.DB.Where("license_type = 'clinic' AND clinic_code = ? AND status = 'active' AND (expiry_date IS NULL OR expiry_date > ?)", clinicCode, now)
	if siteID != "" {
		q = q.Where("site_id = ?", siteID)
	}
	if machineID != "" {
		q = q.Where("machine_id = ?", machineID)
	}
	if err := q.First(&lic).Error; err != nil {
		return nil, err
	}
	return &lic, nil
}

func (s *LicenseService) GetClinicLatestLicense(clinicCode, siteID, machineID string) (*model.License, error) {
	var lic model.License
	q := s.DB.Where("license_type = 'clinic' AND clinic_code = ?", clinicCode)
	if siteID != "" {
		q = q.Where("site_id = ?", siteID)
	}
	if machineID != "" {
		q = q.Where("machine_id = ?", machineID)
	}
	if err := q.Order("created_at DESC").First(&lic).Error; err != nil {
		return nil, err
	}
	return &lic, nil
}

func (s *LicenseService) HasAnyClinicLicense(clinicCode string) (bool, error) {
	var count int64
	if err := s.DB.Model(&model.License{}).Where("license_type = 'clinic' AND clinic_code = ?", clinicCode).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *LicenseService) ResolveTenantCode(tenantID uint64) string {
	var code string
	s.DB.Table("tenants").Where("id = ?", tenantID).Select("code").Scan(&code)
	return code
}

func (s *LicenseService) ResolveTenantName(tenantID uint64) string {
	var name string
	s.DB.Table("tenants").Where("id = ?", tenantID).Select("name").Scan(&name)
	return name
}

func (s *LicenseService) ListLicenses(tenantID uint64) ([]model.License, error) {
	var licenses []model.License
	q := s.DB.Where("tenant_id = ?", tenantID)
	if err := q.Order("created_at DESC").Find(&licenses).Error; err != nil {
		return nil, err
	}
	return licenses, nil
}

func (s *LicenseService) ListAllLicenses(search string) ([]model.License, error) {
	var licenses []model.License
	q := s.DB.Order("auth_date DESC, created_at DESC")
	if search != "" {
		var tenantIDs []uint64
		s.DB.Table("tenants").Where("name LIKE ?", "%"+search+"%").Pluck("id", &tenantIDs)
		if len(tenantIDs) > 0 {
			q = q.Where("tenant_id IN ? OR site_id LIKE ? OR remark LIKE ?", tenantIDs, "%"+search+"%", "%"+search+"%")
		} else {
			q = q.Where("site_id LIKE ? OR remark LIKE ?", "%"+search+"%", "%"+search+"%")
		}
	}
	if err := q.Find(&licenses).Error; err != nil {
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
	loc, _ := time.LoadLocation("Asia/Shanghai")
	startCST := start.In(loc)
	var expiry time.Time
	switch method {
	case "day":
		expiry = startCST.AddDate(0, 0, duration)
	case "week":
		expiry = startCST.AddDate(0, 0, duration*7)
	case "month":
		expiry = startCST.AddDate(0, duration, 0)
	case "year":
		expiry = startCST.AddDate(duration, 0, 0)
	default:
		expiry = startCST.AddDate(0, duration, 0)
	}
	return time.Date(expiry.Year(), expiry.Month(), expiry.Day(), 23, 59, 59, 0, loc)
}

func CheckExpiredLicenses(db *gorm.DB) int {
	var licenses []model.License
	loc, _ := time.LoadLocation("Asia/Shanghai")
	nowCST := time.Now().In(loc)
	if err := db.Where("status = 'active' AND expiry_date < ?", nowCST).Find(&licenses).Error; err != nil {
		log.Printf("[license] expiry check error: %v", err)
		return 0
	}
	for _, lic := range licenses {
		lic.Status = "expired"
		db.Save(&lic)
		log.Printf("[license] license expired: id=%d, tenant_id=%d, type=%s, clinic_code=%s, site_id=%s", lic.ID, lic.TenantID, lic.LicenseType, lic.ClinicCode, lic.SiteID)
	}
	return len(licenses)
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
