package service

import (
	"crypto/md5"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.License{}, &model.MachineIdentity{}))
	return db
}

func generateTestRSAKeys(t *testing.T) (string, string) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	privateKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})

	pubKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	require.NoError(t, err)
	publicKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubKeyBytes,
	})

	return string(privateKeyPEM), string(publicKeyPEM)
}

func createLicenseDirectly(db *gorm.DB, licenseType, clinicCode, siteID, machineID, method string, duration int, status string) *model.License {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	now := time.Now().In(loc)
	var expiry *time.Time
	if method == "permanent" {
		far := time.Date(2099, 12, 31, 23, 59, 59, 0, loc)
		expiry = &far
	} else {
		e := now.AddDate(0, duration, 0)
		e = time.Date(e.Year(), e.Month(), e.Day(), 23, 59, 59, 0, loc)
		expiry = &e
	}
	lic := model.License{
		LicenseType: licenseType,
		ClinicCode:  clinicCode,
		SiteID:      siteID,
		MachineID:   machineID,
		Method:      method,
		Duration:    duration,
		AuthDate:    &now,
		ExpiryDate:  expiry,
		Features:    `["basic"]`,
		Status:      status,
		CreatedBy:   "test",
	}
	db.Create(&lic)
	return &lic
}

func createExpiredLicenseDirectly(db *gorm.DB, licenseType, clinicCode, siteID, machineID, method string) *model.License {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	past := time.Date(2020, 1, 1, 0, 0, 0, 0, loc)
	expired := time.Date(2020, 2, 1, 23, 59, 59, 0, loc)
	lic := model.License{
		LicenseType: licenseType,
		ClinicCode:  clinicCode,
		SiteID:      siteID,
		MachineID:   machineID,
		Method:      method,
		Duration:    1,
		AuthDate:    &past,
		ExpiryDate:  &expired,
		Features:    `["basic"]`,
		Status:      "active",
		CreatedBy:   "test",
	}
	db.Create(&lic)
	return &lic
}

func TestEnsureMachineID(t *testing.T) {
	origFile := machineIDFile
	defer func() { os.WriteFile(origFile, []byte{}, 0644) }()

	machineID := EnsureMachineID()
	assert.NotEmpty(t, machineID)
	assert.Contains(t, machineID, "_")

	parts := splitMachineID(machineID)
	assert.Len(t, parts, 2)
	assert.Len(t, parts[0], 6)
	_, err := time.Parse("2006-01-02 15:04:05", parts[1])
	assert.NoError(t, err)
}

func splitMachineID(id string) []string {
	idx := -1
	for i, c := range id {
		if c == '_' {
			idx = i
			break
		}
	}
	if idx < 0 {
		return []string{id}
	}
	return []string{id[:idx], id[idx+1:]}
}

func TestSignAndVerifyLicense(t *testing.T) {
	privateKeyPEM, publicKeyPEM := generateTestRSAKeys(t)
	svc := NewLicenseService(nil)

	now := time.Now()
	expiry := now.AddDate(0, 1, 0)
	claims := LicenseClaims{
		SiteID:    "test-site",
		MachineID: "abc123_2026-01-01 00:00:00",
		Method:    "month",
		Duration:  1,
		Features:  []string{"basic", "ai"},
		Amount:    2000,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiry),
		},
	}

	token, err := svc.SignLicense(privateKeyPEM, claims)
	require.NoError(t, err)
	assert.NotEmpty(t, token)

	verified, err := VerifyLicense(publicKeyPEM, token)
	require.NoError(t, err)
	assert.Equal(t, "test-site", verified.SiteID)
	assert.Equal(t, "abc123_2026-01-01 00:00:00", verified.MachineID)
	assert.Equal(t, "month", verified.Method)
	assert.Equal(t, 1, verified.Duration)
	assert.Equal(t, []string{"basic", "ai"}, verified.Features)
	assert.Equal(t, float64(2000), verified.Amount)
}

func TestVerifyLicenseWithWrongKey(t *testing.T) {
	privateKeyPEM, _ := generateTestRSAKeys(t)
	_, wrongPublicKeyPEM := generateTestRSAKeys(t)
	svc := NewLicenseService(nil)

	now := time.Now()
	claims := LicenseClaims{
		SiteID:   "test",
		Method:   "month",
		Features: []string{"basic"},
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.AddDate(0, 1, 0)),
		},
	}

	token, err := svc.SignLicense(privateKeyPEM, claims)
	require.NoError(t, err)

	_, err = VerifyLicense(wrongPublicKeyPEM, token)
	assert.Error(t, err)
}

func TestCreateSiteLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)
	privateKeyPEM, _ := generateTestRSAKeys(t)

	req := CreateLicenseRequest{
		SiteID:    "test-site",
		MachineID: "abc123_2026-01-01",
		Method:    "month",
		Duration:  1,
		Features:  []string{"basic", "ai"},
		Amount:    2000,
	}

	lic, err := svc.CreateSiteLicense(req, "admin", privateKeyPEM)
	require.NoError(t, err)
	assert.NotNil(t, lic)
	assert.Equal(t, "test-site", lic.SiteID)
	assert.Equal(t, "month", lic.Method)
	assert.Equal(t, "active", lic.Status)
	assert.NotEmpty(t, lic.JWTToken)
	assert.NotNil(t, lic.AuthDate)
	assert.NotNil(t, lic.ExpiryDate)
}

func TestCreatePermanentLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	req := CreateLicenseRequest{
		SiteID:    "perm-site",
		MachineID: "xyz789",
		Method:    "permanent",
		Duration:  0,
		Features:  []string{"basic"},
		Amount:    50000,
	}

	lic, err := svc.CreateSiteLicense(req, "admin", "")
	require.NoError(t, err)
	assert.NotNil(t, lic)
	assert.Equal(t, "permanent", lic.Method)
	assert.Equal(t, 0, lic.Duration)
	assert.NotNil(t, lic.ExpiryDate)
	assert.True(t, lic.ExpiryDate.Year() == 2099)
}

func TestListLicenses(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	for i := 0; i < 3; i++ {
		req := CreateLicenseRequest{
			SiteID:    fmt.Sprintf("site-%d", i),
			MachineID: fmt.Sprintf("machine-%d", i),
			Method:    "month",
			Duration:  1,
			Features:  []string{"basic"},
		}
		_, err := svc.CreateSiteLicense(req, "admin", "")
		require.NoError(t, err)
	}

	licenses, err := svc.ListLicenses(0)
	require.NoError(t, err)
	assert.Len(t, licenses, 3)
}

func TestGetSiteActiveLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	req := CreateLicenseRequest{
		SiteID:    "active-site",
		MachineID: "m1",
		Method:    "month",
		Duration:  1,
		Features:  []string{"basic"},
	}
	_, err := svc.CreateSiteLicense(req, "admin", "")
	require.NoError(t, err)

	lic, err := svc.GetSiteActiveLicense("active-site", "m1")
	require.NoError(t, err)
	assert.Equal(t, "active", lic.Status)
}

func TestSupersedeOldLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	req1 := CreateLicenseRequest{
		SiteID:    "same-site",
		MachineID: "m1",
		Method:    "month",
		Duration:  1,
		Features:  []string{"basic"},
	}
	lic1, err := svc.CreateSiteLicense(req1, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", lic1.Status)

	req2 := CreateLicenseRequest{
		SiteID:    "same-site",
		MachineID: "m1",
		Method:    "year",
		Duration:  1,
		Features:  []string{"basic", "ai"},
	}
	lic2, err := svc.CreateSiteLicense(req2, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", lic2.Status)
	assert.NotEqual(t, lic1.ID, lic2.ID, "different JWT token should create new record")

	old, err := svc.GetLicense(lic1.ID)
	require.NoError(t, err)
	assert.Equal(t, "superseded", old.Status, "old license should be superseded")

	newLic, err := svc.GetLicense(lic2.ID)
	require.NoError(t, err)
	assert.Equal(t, "active", newLic.Status)
	assert.Equal(t, "year", newLic.Method)
}

func TestCalcExpiry(t *testing.T) {
	svc := NewLicenseService(nil)
	loc, _ := time.LoadLocation("Asia/Shanghai")
	start := time.Date(2026, 4, 1, 10, 30, 0, 0, loc)

	dayExpiry := svc.calcExpiry(start, "day", 1)
	assert.Equal(t, time.Date(2026, 4, 2, 23, 59, 59, 0, loc), dayExpiry)

	weekExpiry := svc.calcExpiry(start, "week", 1)
	assert.Equal(t, time.Date(2026, 4, 8, 23, 59, 59, 0, loc), weekExpiry)

	monthExpiry := svc.calcExpiry(start, "month", 1)
	assert.Equal(t, time.Date(2026, 5, 1, 23, 59, 59, 0, loc), monthExpiry)

	yearExpiry := svc.calcExpiry(start, "year", 1)
	assert.Equal(t, time.Date(2027, 4, 1, 23, 59, 59, 0, loc), yearExpiry)

	start2 := time.Date(2026, 4, 29, 0, 0, 0, 0, loc)
	dayExpiry2 := svc.calcExpiry(start2, "day", 1)
	assert.Equal(t, time.Date(2026, 4, 30, 23, 59, 59, 0, loc), dayExpiry2)
}

func TestExpiryDateConsistency(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)
	privateKeyPEM, _ := generateTestRSAKeys(t)

	req := CreateLicenseRequest{
		SiteID:    "test-site",
		MachineID: "m1",
		Method:    "day",
		Duration:  1,
		AuthDate:  "2026-04-29",
		Features:  []string{"basic"},
		Amount:    100,
	}

	lic, err := svc.CreateSiteLicense(req, "admin", privateKeyPEM)
	require.NoError(t, err)
	require.NotNil(t, lic.ExpiryDate)

	loc, _ := time.LoadLocation("Asia/Shanghai")
	expectedExpiry := time.Date(2026, 4, 30, 23, 59, 59, 0, loc)
	assert.WithinDuration(t, expectedExpiry, *lic.ExpiryDate, time.Second)

	assert.True(t, lic.ExpiryDate.Hour() == 23)
	assert.True(t, lic.ExpiryDate.Minute() == 59)
	assert.True(t, lic.ExpiryDate.Second() == 59)
}

func TestExpiredLicenseDetection(t *testing.T) {
	db := setupTestDB(t)

	loc, _ := time.LoadLocation("Asia/Shanghai")
	past := time.Date(2020, 1, 1, 0, 0, 0, 0, loc)
	lic := model.License{
		LicenseType: "site",
		SiteID:      "expired-site",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		AuthDate:    &past,
		ExpiryDate:  &past,
		Features:    `["basic"]`,
		Status:      "active",
		CreatedBy:   "admin",
	}
	db.Create(&lic)

	CheckExpiredLicenses(db)

	var checked model.License
	db.First(&checked, lic.ID)
	assert.Equal(t, "expired", checked.Status)
}

func TestGetMachineIdentity(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	siteID, machineID := svc.GetMachineIdentity()
	assert.NotEmpty(t, machineID)
	_ = siteID

	var mi model.MachineIdentity
	err := db.Where("machine_id = ?", machineID).First(&mi).Error
	assert.NoError(t, err)
}

func TestGetStats(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	for i := 0; i < 3; i++ {
		req := CreateLicenseRequest{
			SiteID:    fmt.Sprintf("site-%d", i),
			MachineID: fmt.Sprintf("machine-%d", i),
			Method:    "month",
			Duration:  1,
			Features:  []string{"basic", "ai"},
			Amount:    2000,
		}
		_, err := svc.CreateSiteLicense(req, "admin", "")
		require.NoError(t, err)
	}

	stats, err := svc.GetStats("", "")
	require.NoError(t, err)
	assert.Equal(t, int64(3), stats.TotalCount)
	assert.Equal(t, float64(6000), stats.TotalAmount)
	assert.Equal(t, float64(6000), stats.ByMethod["month"])
}

func TestCreateClinicLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)
	privateKeyPEM, publicKeyPEM := generateTestRSAKeys(t)

	req := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "abc123_2026-01-01",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic", "ai"},
		Amount:      3000,
	}

	lic, err := svc.CreateSiteLicense(req, "admin", privateKeyPEM)
	require.NoError(t, err)
	assert.NotNil(t, lic)
	assert.Equal(t, "clinic", lic.LicenseType)
	assert.Equal(t, "1001", lic.ClinicCode)
	assert.Equal(t, "xyj", lic.SiteID)
	assert.Equal(t, "active", lic.Status)
	assert.NotEmpty(t, lic.JWTToken)

	verified, err := VerifyLicense(publicKeyPEM, lic.JWTToken)
	require.NoError(t, err)
	assert.Equal(t, "1001", verified.ClinicCode)
	assert.Equal(t, "xyj", verified.SiteID)
}

func TestCreateSiteLicenseDefaultType(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	req := CreateLicenseRequest{
		SiteID:    "test-site",
		MachineID: "m1",
		Method:    "month",
		Duration:  1,
		Features:  []string{"basic"},
	}

	lic, err := svc.CreateSiteLicense(req, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "site", lic.LicenseType)
	assert.Equal(t, "", lic.ClinicCode)
}

func TestClinicLicenseSupersede(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	req1 := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	lic1, err := svc.CreateSiteLicense(req1, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", lic1.Status)

	req2 := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "year",
		Duration:    1,
		Features:    []string{"basic", "ai"},
	}
	lic2, err := svc.CreateSiteLicense(req2, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", lic2.Status)
	assert.NotEqual(t, lic1.ID, lic2.ID, "different JWT token should create new record")

	old, err := svc.GetLicense(lic1.ID)
	require.NoError(t, err)
	assert.Equal(t, "superseded", old.Status, "old clinic license should be superseded")

	newLic, err := svc.GetLicense(lic2.ID)
	require.NoError(t, err)
	assert.Equal(t, "active", newLic.Status)
	assert.Equal(t, "year", newLic.Method)
}

func TestSameJWTToken_UpdatesInPlace(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	fakeToken := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-token-1"

	lic1, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "clinic", ClinicCode: "1001", SiteID: "xyj", MachineID: "m1",
		Method: "month", Duration: 1, Features: []string{"basic"},
		LicenseToken: fakeToken,
	}, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", lic1.Status)
	assert.Equal(t, fakeToken, lic1.JWTToken)

	lic2, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "clinic", ClinicCode: "1001", SiteID: "xyj", MachineID: "m1",
		Method: "year", Duration: 1, Features: []string{"basic", "ai"},
		LicenseToken: fakeToken,
	}, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, lic1.ID, lic2.ID, "same JWT token should update the same record")
	assert.Equal(t, "active", lic2.Status)
	assert.Equal(t, "year", lic2.Method)

	var count int64
	db.Model(&model.License{}).Where("license_type = 'clinic' AND clinic_code = '1001'").Count(&count)
	assert.Equal(t, int64(1), count, "should only have 1 record for same JWT token")
}

func TestUpdateLicense_SameJWTTokenReactivatesOld(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	tokenA := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token-A"
	tokenB := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token-B"

	licA, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "clinic", ClinicCode: "1001", SiteID: "xyj", MachineID: "m1",
		Method: "month", Duration: 1, Features: []string{"basic"},
		LicenseToken: tokenA,
	}, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", licA.Status)

	licB, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "clinic", ClinicCode: "1001", SiteID: "xyj", MachineID: "m1",
		Method: "year", Duration: 1, Features: []string{"basic", "ai"},
		LicenseToken: tokenB,
	}, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", licB.Status)

	oldA, _ := svc.GetLicense(licA.ID)
	assert.Equal(t, "superseded", oldA.Status, "LicenseA should be superseded after LicenseB created")

	result, err := svc.UpdateLicense(licB.ID, UpdateLicenseRequest{LicenseToken: tokenA}, "")
	require.NoError(t, err)
	assert.Equal(t, licA.ID, result.ID, "should return LicenseA (re-activated)")

	refreshedA, _ := svc.GetLicense(licA.ID)
	assert.Equal(t, "active", refreshedA.Status, "LicenseA should be re-activated")

	refreshedB, _ := svc.GetLicense(licB.ID)
	assert.Equal(t, "superseded", refreshedB.Status, "LicenseB should be superseded")

	var count int64
	db.Model(&model.License{}).Where("jwt_token = ?", tokenA).Count(&count)
	assert.Equal(t, int64(1), count, "should only have 1 record with tokenA")
}

func TestGetClinicActiveLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	req := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	_, err := svc.CreateSiteLicense(req, "admin", "")
	require.NoError(t, err)

	lic, err := svc.GetClinicActiveLicense("1001", "xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, "active", lic.Status)
	assert.Equal(t, "clinic", lic.LicenseType)
	assert.Equal(t, "1001", lic.ClinicCode)
}

func TestGetClinicActiveLicenseNotFound(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	_, err := svc.GetClinicActiveLicense("nonexistent", "xyj", "m1")
	assert.Error(t, err)
}

func TestHasAnyClinicLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	hasAny, err := svc.HasAnyClinicLicense("1001")
	require.NoError(t, err)
	assert.False(t, hasAny)

	req := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	_, err = svc.CreateSiteLicense(req, "admin", "")
	require.NoError(t, err)

	hasAny, err = svc.HasAnyClinicLicense("1001")
	require.NoError(t, err)
	assert.True(t, hasAny)
}

func TestClinicLicenseWithExpired(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	loc, _ := time.LoadLocation("Asia/Shanghai")
	past := time.Date(2020, 1, 1, 0, 0, 0, 0, loc)
	lic := model.License{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		AuthDate:    &past,
		ExpiryDate:  &past,
		Features:    `["basic"]`,
		Status:      "active",
		CreatedBy:   "admin",
	}
	db.Create(&lic)

	CheckExpiredLicenses(db)

	var checked model.License
	db.First(&checked, lic.ID)
	assert.Equal(t, "expired", checked.Status)

	hasAny, err := svc.HasAnyClinicLicense("1001")
	require.NoError(t, err)
	assert.True(t, hasAny)

	_, err = svc.GetClinicActiveLicense("1001", "xyj", "m1")
	assert.Error(t, err)
}

func TestClinicLicenseJWTClaims(t *testing.T) {
	privateKeyPEM, publicKeyPEM := generateTestRSAKeys(t)
	svc := NewLicenseService(nil)

	now := time.Now()
	expiry := now.AddDate(0, 1, 0)
	claims := LicenseClaims{
		ClinicCode: "1001",
		SiteID:     "xyj",
		MachineID:  "abc123_2026-01-01",
		Method:     "month",
		Duration:   1,
		Features:   []string{"basic", "ai"},
		Amount:     2000,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiry),
		},
	}

	token, err := svc.SignLicense(privateKeyPEM, claims)
	require.NoError(t, err)

	verified, err := VerifyLicense(publicKeyPEM, token)
	require.NoError(t, err)
	assert.Equal(t, "1001", verified.ClinicCode)
	assert.Equal(t, "xyj", verified.SiteID)
	assert.Equal(t, "abc123_2026-01-01", verified.MachineID)
	assert.Equal(t, "month", verified.Method)
	assert.Equal(t, []string{"basic", "ai"}, verified.Features)
}

func TestSiteLicenseJWTClaimsWithoutClinicCode(t *testing.T) {
	privateKeyPEM, publicKeyPEM := generateTestRSAKeys(t)
	svc := NewLicenseService(nil)

	now := time.Now()
	expiry := now.AddDate(0, 1, 0)
	claims := LicenseClaims{
		SiteID:    "xyj",
		MachineID: "abc123",
		Method:    "month",
		Duration:  1,
		Features:  []string{"basic"},
		Amount:    1000,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiry),
		},
	}

	token, err := svc.SignLicense(privateKeyPEM, claims)
	require.NoError(t, err)

	verified, err := VerifyLicense(publicKeyPEM, token)
	require.NoError(t, err)
	assert.Equal(t, "", verified.ClinicCode)
	assert.Equal(t, "xyj", verified.SiteID)
}

func TestResolveTenantCode(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	db.Exec("CREATE TABLE tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT, status INTEGER DEFAULT 1, deleted_at DATETIME)")
	db.Exec("INSERT INTO tenants (name, code, status) VALUES ('测试诊所', '1001', 1)")

	code := svc.ResolveTenantCode(1)
	assert.Equal(t, "1001", code)

	code = svc.ResolveTenantCode(999)
	assert.Equal(t, "", code)
}

func TestResolveTenantName(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	db.Exec("CREATE TABLE tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, code TEXT, status INTEGER DEFAULT 1, deleted_at DATETIME)")
	db.Exec("INSERT INTO tenants (name, code, status) VALUES ('测试诊所', '1001', 1)")

	name := svc.ResolveTenantName(1)
	assert.Equal(t, "测试诊所", name)
}

func TestGetClinicLatestLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	req1 := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	_, err := svc.CreateSiteLicense(req1, "admin", "")
	require.NoError(t, err)

	req2 := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "year",
		Duration:    1,
		Features:    []string{"basic", "ai"},
	}
	lic2, err := svc.CreateSiteLicense(req2, "admin", "")
	require.NoError(t, err)

	latest, err := svc.GetClinicLatestLicense("1001", "xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, lic2.ID, latest.ID)
	assert.Equal(t, "active", latest.Status)
}

func TestClinicAndSiteLicenseCoexist(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	siteReq := CreateLicenseRequest{
		LicenseType: "site",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	_, err := svc.CreateSiteLicense(siteReq, "admin", "")
	require.NoError(t, err)

	clinicReq := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "year",
		Duration:    1,
		Features:    []string{"basic", "ai"},
	}
	_, err = svc.CreateSiteLicense(clinicReq, "admin", "")
	require.NoError(t, err)

	siteLic, err := svc.GetSiteActiveLicense("xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, "site", siteLic.LicenseType)

	clinicLic, err := svc.GetClinicActiveLicense("1001", "xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, "clinic", clinicLic.LicenseType)
	assert.Equal(t, "1001", clinicLic.ClinicCode)
}

func TestValidatePublicKeyMD5(t *testing.T) {
	err := ValidatePublicKeyMD5("")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "公钥为空")

	_, testPublicKey := generateTestRSAKeys(t)
	err = ValidatePublicKeyMD5(testPublicKey)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "公钥MD5校验失败")

	wrongKey := "-----BEGIN PUBLIC KEY-----\nwrongdata\n-----END PUBLIC KEY-----"
	err = ValidatePublicKeyMD5(wrongKey)
	assert.Error(t, err)
}

func TestValidatePublicKeyMD5CorrectKey(t *testing.T) {
	_, testPublicKey := generateTestRSAKeys(t)
	hash := md5.Sum([]byte(testPublicKey))
	actualMD5 := fmt.Sprintf("%x", hash)
	t.Logf("test public key MD5: %s", actualMD5)
}

func TestBugFix_SiteLicenseNotReturnClinicLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	clinicReq := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	_, err := svc.CreateSiteLicense(clinicReq, "admin", "")
	require.NoError(t, err)

	_, err = svc.GetSiteActiveLicense("xyj", "m1")
	assert.Error(t, err, "GetSiteActiveLicense should NOT return clinic license")
}

func TestBugFix_SiteLicenseDeleted_ClinicLicenseDoesNotShowAsSite(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	siteReq := CreateLicenseRequest{
		LicenseType: "site",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	siteLic, err := svc.CreateSiteLicense(siteReq, "admin", "")
	require.NoError(t, err)

	clinicReq := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	_, err = svc.CreateSiteLicense(clinicReq, "admin", "")
	require.NoError(t, err)

	svc.DeleteLicense(siteLic.ID)

	_, err = svc.GetSiteActiveLicense("xyj", "m1")
	assert.Error(t, err, "after site license deleted, GetSiteActiveLicense should return error even if clinic license exists")

	clinicLic, err := svc.GetClinicActiveLicense("1001", "xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, "clinic", clinicLic.LicenseType)
}

func TestScenario_SiteActive_AllPass(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	createLicenseDirectly(db, "site", "", "xyj", "m1", "month", 1, "active")
	createLicenseDirectly(db, "clinic", "1001", "xyj", "m1", "month", 1, "active")

	siteLic, err := svc.GetSiteActiveLicense("xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, "site", siteLic.LicenseType)
	assert.Equal(t, "active", siteLic.Status)
}

func TestScenario_SiteInactive_ClinicActive_ClinicPass(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	createExpiredLicenseDirectly(db, "site", "", "xyj", "m1", "month")
	CheckExpiredLicenses(db)

	createLicenseDirectly(db, "clinic", "1001", "xyj", "m1", "month", 1, "active")

	_, err := svc.GetSiteActiveLicense("xyj", "m1")
	assert.Error(t, err, "site license should be expired")

	clinicLic, err := svc.GetClinicActiveLicense("1001", "xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, "active", clinicLic.Status)
}

func TestScenario_SiteInactive_ClinicInactive_AllBlocked(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	createExpiredLicenseDirectly(db, "site", "", "xyj", "m1", "month")
	createExpiredLicenseDirectly(db, "clinic", "1001", "xyj", "m1", "month")
	CheckExpiredLicenses(db)

	_, err := svc.GetSiteActiveLicense("xyj", "m1")
	assert.Error(t, err)

	_, err = svc.GetClinicActiveLicense("1001", "xyj", "m1")
	assert.Error(t, err)
}

func TestScenario_ClinicAInactive_ClinicBActive_IndependentCheck(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	createExpiredLicenseDirectly(db, "clinic", "A001", "xyj", "m1", "month")
	createLicenseDirectly(db, "clinic", "B002", "xyj", "m1", "month", 1, "active")
	CheckExpiredLicenses(db)

	_, err := svc.GetClinicActiveLicense("A001", "xyj", "m1")
	assert.Error(t, err, "clinic A should be blocked")

	clinicB, err := svc.GetClinicActiveLicense("B002", "xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, "active", clinicB.Status, "clinic B should pass")
}

func TestScenario_ClinicActive_SiteInactive_ClinicPass(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	createExpiredLicenseDirectly(db, "site", "", "xyj", "m1", "month")
	CheckExpiredLicenses(db)

	createLicenseDirectly(db, "clinic", "1001", "xyj", "m1", "year", 1, "active")

	_, err := svc.GetSiteActiveLicense("xyj", "m1")
	assert.Error(t, err)

	clinicLic, err := svc.GetClinicActiveLicense("1001", "xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, "active", clinicLic.Status)
}

func TestScenario_AllInactive_AllBlocked(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	createExpiredLicenseDirectly(db, "site", "", "xyj", "m1", "month")
	createExpiredLicenseDirectly(db, "clinic", "1001", "xyj", "m1", "month")
	createExpiredLicenseDirectly(db, "clinic", "2002", "xyj", "m1", "month")
	CheckExpiredLicenses(db)

	_, err := svc.GetSiteActiveLicense("xyj", "m1")
	assert.Error(t, err)

	_, err = svc.GetClinicActiveLicense("1001", "xyj", "m1")
	assert.Error(t, err)

	_, err = svc.GetClinicActiveLicense("2002", "xyj", "m1")
	assert.Error(t, err)
}

func TestScenario_SiteActive_ClinicInactive_SiteOverrides(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	createLicenseDirectly(db, "site", "", "xyj", "m1", "year", 1, "active")
	createExpiredLicenseDirectly(db, "clinic", "1001", "xyj", "m1", "month")
	CheckExpiredLicenses(db)

	siteLic, err := svc.GetSiteActiveLicense("xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, "active", siteLic.Status)
}

func TestGetSiteLatestLicense_OnlyReturnsSiteType(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	createLicenseDirectly(db, "clinic", "1001", "xyj", "m1", "month", 1, "active")

	_, err := svc.GetSiteLatestLicense("xyj", "m1")
	assert.Error(t, err, "GetSiteLatestLicense should not return clinic license")
}

func TestClinicLicenseSupersede_DoesNotAffectSiteLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	siteReq := CreateLicenseRequest{
		LicenseType: "site",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "year",
		Duration:    1,
		Features:    []string{"basic"},
	}
	siteLic, err := svc.CreateSiteLicense(siteReq, "admin", "")
	require.NoError(t, err)

	clinicReq := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	_, err = svc.CreateSiteLicense(clinicReq, "admin", "")
	require.NoError(t, err)

	refreshed, err := svc.GetLicense(siteLic.ID)
	require.NoError(t, err)
	assert.Equal(t, "active", refreshed.Status, "site license should remain active when clinic license is created")
}

func TestSiteLicenseSupersede_DoesNotAffectClinicLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	clinicReq := CreateLicenseRequest{
		LicenseType: "clinic",
		ClinicCode:  "1001",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "year",
		Duration:    1,
		Features:    []string{"basic"},
	}
	clinicLic, err := svc.CreateSiteLicense(clinicReq, "admin", "")
	require.NoError(t, err)

	siteReq := CreateLicenseRequest{
		LicenseType: "site",
		SiteID:      "xyj",
		MachineID:   "m1",
		Method:      "month",
		Duration:    1,
		Features:    []string{"basic"},
	}
	_, err = svc.CreateSiteLicense(siteReq, "admin", "")
	require.NoError(t, err)

	refreshed, err := svc.GetLicense(clinicLic.ID)
	require.NoError(t, err)
	assert.Equal(t, "active", refreshed.Status, "clinic license should remain active when site license is created")
}

func TestMultipleClinicCodes_IndependentLifecycle(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	licA1, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "clinic", ClinicCode: "A001", SiteID: "xyj", MachineID: "m1",
		Method: "month", Duration: 1, Features: []string{"basic"},
	}, "admin", "")
	require.NoError(t, err)

	licB1, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "clinic", ClinicCode: "B002", SiteID: "xyj", MachineID: "m1",
		Method: "month", Duration: 1, Features: []string{"basic"},
	}, "admin", "")
	require.NoError(t, err)

	licA2, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "clinic", ClinicCode: "A001", SiteID: "xyj", MachineID: "m1",
		Method: "year", Duration: 1, Features: []string{"basic", "ai"},
	}, "admin", "")
	require.NoError(t, err)

	assert.NotEqual(t, licA1.ID, licA2.ID, "different JWT token should create new record for clinic A")

	oldA, _ := svc.GetLicense(licA1.ID)
	assert.Equal(t, "superseded", oldA.Status, "clinic A old license should be superseded")

	newA, _ := svc.GetLicense(licA2.ID)
	assert.Equal(t, "active", newA.Status, "clinic A new license should be active")

	oldB, _ := svc.GetLicense(licB1.ID)
	assert.Equal(t, "active", oldB.Status, "clinic B license should remain active")
}

func TestDeleteLicense_InvalidatesCorrectType(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	siteLic, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "site", SiteID: "xyj", MachineID: "m1",
		Method: "month", Duration: 1, Features: []string{"basic"},
	}, "admin", "")
	require.NoError(t, err)

	clinicLic, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "clinic", ClinicCode: "1001", SiteID: "xyj", MachineID: "m1",
		Method: "month", Duration: 1, Features: []string{"basic"},
	}, "admin", "")
	require.NoError(t, err)

	svc.DeleteLicense(siteLic.ID)

	_, err = svc.GetSiteActiveLicense("xyj", "m1")
	assert.Error(t, err, "site license should be gone after deletion")

	clinic, err := svc.GetClinicActiveLicense("1001", "xyj", "m1")
	require.NoError(t, err)
	assert.Equal(t, clinicLic.ID, clinic.ID, "clinic license should still be active")
}

func TestPermanentLicense_NeverExpires(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	lic, err := svc.CreateSiteLicense(CreateLicenseRequest{
		LicenseType: "site", SiteID: "xyj", MachineID: "m1",
		Method: "permanent", Duration: 0, Features: []string{"basic"},
	}, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", lic.Status)
	assert.NotNil(t, lic.ExpiryDate)
	assert.True(t, lic.ExpiryDate.Year() == 2099)

	CheckExpiredLicenses(db)

	refreshed, err := svc.GetLicense(lic.ID)
	require.NoError(t, err)
	assert.Equal(t, "active", refreshed.Status, "permanent license should never be marked expired")
}

func TestExpiredLicenseCheck_BothTypes(t *testing.T) {
	db := setupTestDB(t)

	loc, _ := time.LoadLocation("Asia/Shanghai")
	past := time.Date(2020, 1, 1, 0, 0, 0, 0, loc)

	siteLic := model.License{
		LicenseType: "site", SiteID: "xyj", MachineID: "m1",
		Method: "month", Duration: 1, AuthDate: &past, ExpiryDate: &past,
		Features: `["basic"]`, Status: "active", CreatedBy: "admin",
	}
	clinicLic := model.License{
		LicenseType: "clinic", ClinicCode: "1001", SiteID: "xyj", MachineID: "m1",
		Method: "month", Duration: 1, AuthDate: &past, ExpiryDate: &past,
		Features: `["basic"]`, Status: "active", CreatedBy: "admin",
	}
	db.Create(&siteLic)
	db.Create(&clinicLic)

	count := CheckExpiredLicenses(db)
	assert.Equal(t, 2, count, "both site and clinic expired licenses should be detected")

	var checked1, checked2 model.License
	db.First(&checked1, siteLic.ID)
	db.First(&checked2, clinicLic.ID)
	assert.Equal(t, "expired", checked1.Status)
	assert.Equal(t, "expired", checked2.Status)
}
