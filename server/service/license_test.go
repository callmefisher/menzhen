package service

import (
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

func TestEnsureMachineID(t *testing.T) {
	_ = t.TempDir()
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

	old, err := svc.GetLicense(lic1.ID)
	require.NoError(t, err)
	assert.Equal(t, "superseded", old.Status)
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
		SiteID:     "expired-site",
		MachineID:  "m1",
		Method:     "month",
		Duration:   1,
		AuthDate:   &past,
		ExpiryDate: &past,
		Features:   `["basic"]`,
		Status:     "active",
		CreatedBy:  "admin",
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
