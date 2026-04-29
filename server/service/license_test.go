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
		TenantID:  1,
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
	assert.Equal(t, uint64(1), verified.TenantID)
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

func TestCreateLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)
	privateKeyPEM, _ := generateTestRSAKeys(t)

	req := CreateLicenseRequest{
		TenantID:  1,
		SiteID:    "test-site",
		MachineID: "abc123_2026-01-01",
		Method:    "month",
		Duration:  1,
		Features:  []string{"basic", "ai"},
		Amount:    2000,
	}

	lic, err := svc.CreateLicense(req, "admin", privateKeyPEM)
	require.NoError(t, err)
	assert.NotNil(t, lic)
	assert.Equal(t, uint64(1), lic.TenantID)
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
		TenantID:  1,
		SiteID:    "perm-site",
		MachineID: "xyz789",
		Method:    "permanent",
		Duration:  0,
		Features:  []string{"basic"},
		Amount:    50000,
	}

	lic, err := svc.CreateLicense(req, "admin", "")
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
			TenantID:  1,
			SiteID:    fmt.Sprintf("site-%d", i),
			MachineID: fmt.Sprintf("machine-%d", i),
			Method:    "month",
			Duration:  1,
			Features:  []string{"basic"},
		}
		_, err := svc.CreateLicense(req, "admin", "")
		require.NoError(t, err)
	}

	licenses, err := svc.ListLicenses(1)
	require.NoError(t, err)
	assert.Len(t, licenses, 3)
}

func TestGetActiveLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	req := CreateLicenseRequest{
		TenantID:  1,
		SiteID:    "active-site",
		MachineID: "m1",
		Method:    "month",
		Duration:  1,
		Features:  []string{"basic"},
	}
	_, err := svc.CreateLicense(req, "admin", "")
	require.NoError(t, err)

	lic, err := svc.GetActiveLicense(1)
	require.NoError(t, err)
	assert.Equal(t, "active", lic.Status)
}

func TestSupersedeOldLicense(t *testing.T) {
	db := setupTestDB(t)
	svc := NewLicenseService(db)

	req1 := CreateLicenseRequest{
		TenantID:  1,
		SiteID:    "old-site",
		MachineID: "m1",
		Method:    "month",
		Duration:  1,
		Features:  []string{"basic"},
	}
	lic1, err := svc.CreateLicense(req1, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", lic1.Status)

	req2 := CreateLicenseRequest{
		TenantID:  1,
		SiteID:    "new-site",
		MachineID: "m1",
		Method:    "year",
		Duration:  1,
		Features:  []string{"basic", "ai"},
	}
	lic2, err := svc.CreateLicense(req2, "admin", "")
	require.NoError(t, err)
	assert.Equal(t, "active", lic2.Status)

	old, err := svc.GetLicense(lic1.ID)
	require.NoError(t, err)
	assert.Equal(t, "superseded", old.Status)
}

func TestCalcExpiry(t *testing.T) {
	svc := NewLicenseService(nil)
	start := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)

	assert.Equal(t, time.Date(2026, 4, 2, 0, 0, 0, 0, time.UTC), svc.calcExpiry(start, "day", 1))
	assert.Equal(t, time.Date(2026, 4, 8, 0, 0, 0, 0, time.UTC), svc.calcExpiry(start, "week", 1))
	assert.Equal(t, time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC), svc.calcExpiry(start, "month", 1))
	assert.Equal(t, time.Date(2027, 4, 1, 0, 0, 0, 0, time.UTC), svc.calcExpiry(start, "year", 1))
}

func TestCheckExpiredLicenses(t *testing.T) {
	db := setupTestDB(t)

	past := time.Now().AddDate(0, 0, -1)
	lic := model.License{
		TenantID:   1,
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
			TenantID:  uint64(i + 1),
			SiteID:    fmt.Sprintf("site-%d", i),
			MachineID: fmt.Sprintf("machine-%d", i),
			Method:    "month",
			Duration:  1,
			Features:  []string{"basic", "ai"},
			Amount:    2000,
		}
		_, err := svc.CreateLicense(req, "admin", "")
		require.NoError(t, err)
	}

	stats, err := svc.GetStats("", "")
	require.NoError(t, err)
	assert.Equal(t, int64(3), stats.TotalCount)
	assert.Equal(t, float64(6000), stats.TotalAmount)
	assert.Equal(t, float64(6000), stats.ByMethod["month"])
}
