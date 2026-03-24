package testutil

import (
	"fmt"
	"math/rand"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestJWTSecret is the JWT secret used in all tests.
const TestJWTSecret = "test-jwt-secret-for-testing"

var (
	rootDB    *gorm.DB
	rootDBErr error
	rootOnce  sync.Once
)

// getRootDB returns a shared root MySQL connection (no database selected).
// This avoids opening a new connection per test, preventing "too many connections".
// Returns (nil, error) when MySQL is not reachable; callers should t.Skip in that case.
func getRootDB(t *testing.T) (*gorm.DB, error) {
	t.Helper()
	rootOnce.Do(func() {
		dsn := getTestDSN()
		var db *gorm.DB
		db, rootDBErr = gorm.Open(mysql.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
		if rootDBErr != nil {
			return
		}
		rootDB = db
		// Limit root connection pool to avoid exhausting MySQL connections.
		sqlDB, _ := rootDB.DB()
		if sqlDB != nil {
			sqlDB.SetMaxOpenConns(5)
			sqlDB.SetMaxIdleConns(5)
		}
	})
	return rootDB, rootDBErr
}

// SetupTestDB creates a temporary test database and returns a *gorm.DB.
// The database is automatically dropped when the test finishes.
// The test is skipped when MySQL is not reachable.
func SetupTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := getRootDB(t)
	if err != nil {
		t.Skipf("skipping: MySQL not available (%v)", err)
	}

	// Create a unique database for this test.
	dbName := fmt.Sprintf("test_mz_%d_%d", time.Now().UnixNano()%1e9, rand.Intn(10000))
	if err := db.Exec("CREATE DATABASE " + dbName).Error; err != nil {
		t.Fatalf("failed to create test database %s: %v", dbName, err)
	}

	// Connect to the new database.
	dsn := getTestDSN()
	testDSN := fmt.Sprintf("%s%s?charset=utf8mb4&parseTime=True&loc=Local", dsn, dbName)
	testDB, err := gorm.Open(mysql.Open(testDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		db.Exec("DROP DATABASE IF EXISTS " + dbName)
		t.Fatalf("failed to connect to test database %s: %v", dbName, err)
	}

	// Limit test DB connections too.
	sqlDB, _ := testDB.DB()
	if sqlDB != nil {
		sqlDB.SetMaxOpenConns(5)
		sqlDB.SetMaxIdleConns(2)
	}

	// AutoMigrate all models.
	err = testDB.AutoMigrate(
		&model.Tenant{},
		&model.User{},
		&model.Role{},
		&model.Permission{},
		&model.RolePermission{},
		&model.UserRole{},
		&model.Patient{},
		&model.MedicalRecord{},
		&model.RecordAttachment{},
		&model.OpLog{},
		&model.Herb{},
		&model.Formula{},
		&model.Prescription{},
		&model.PrescriptionItem{},
		&model.AIAnalysis{},
		&model.Pulse{},
		&model.MeridianResource{},
		&model.WuyunLiuqi{},
		&model.ClinicalExperience{},
		&model.InventoryDrug{},
		&model.SolarTerm{},
		&model.Hexagram{},
		&model.Billing{},
		&model.DailyStats{},
		&model.FollowUp{},
	)
	if err != nil {
		db.Exec("DROP DATABASE IF EXISTS " + dbName)
		t.Fatalf("failed to migrate test database: %v", err)
	}

	// Cleanup: drop database when test finishes.
	t.Cleanup(func() {
		sqlDB, _ := testDB.DB()
		if sqlDB != nil {
			sqlDB.Close()
		}
		db.Exec("DROP DATABASE IF EXISTS " + dbName)
	})

	return testDB
}

func getTestDSN() string {
	if v := os.Getenv("TEST_DB_DSN"); v != "" {
		return v
	}
	return "root:menzhen123@tcp(127.0.0.1:3306)/"
}

// SeedTestTenant creates a test tenant and returns it.
func SeedTestTenant(t *testing.T, db *gorm.DB, name, code string) *model.Tenant {
	t.Helper()
	tenant := model.Tenant{Name: name, Code: code, Status: 1}
	if err := db.Create(&tenant).Error; err != nil {
		t.Fatalf("failed to seed test tenant: %v", err)
	}
	return &tenant
}

// SeedTestPermission creates a permission and returns it.
func SeedTestPermission(t *testing.T, db *gorm.DB, code, name string) *model.Permission {
	t.Helper()
	perm := model.Permission{Code: code, Name: name}
	if err := db.Create(&perm).Error; err != nil {
		t.Fatalf("failed to seed test permission: %v", err)
	}
	return &perm
}

// SeedTestRole creates a role with given permissions and returns it.
func SeedTestRole(t *testing.T, db *gorm.DB, tenantID uint64, name string, perms ...*model.Permission) *model.Role {
	t.Helper()
	role := model.Role{TenantID: tenantID, Name: name}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("failed to seed test role: %v", err)
	}
	for _, p := range perms {
		if err := db.Create(&model.RolePermission{RoleID: role.ID, PermissionID: p.ID}).Error; err != nil {
			t.Fatalf("failed to assign permission to role: %v", err)
		}
	}
	return &role
}

// SeedTestUser creates a user with role and returns user + JWT token.
func SeedTestUser(t *testing.T, db *gorm.DB, tenantID uint64, username, password string, role *model.Role) (*model.User, string) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	user := model.User{
		TenantID:     tenantID,
		Username:     username,
		PasswordHash: string(hash),
		RealName:     username,
		Status:       1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("failed to seed test user: %v", err)
	}
	if role != nil {
		if err := db.Create(&model.UserRole{UserID: user.ID, RoleID: role.ID}).Error; err != nil {
			t.Fatalf("failed to assign role to user: %v", err)
		}
	}

	token, err := generateTestToken(user.ID, tenantID, username)
	if err != nil {
		t.Fatalf("failed to generate test token: %v", err)
	}
	return &user, token
}

// SeedTestPatient creates a test patient and returns it.
func SeedTestPatient(t *testing.T, db *gorm.DB, tenantID, createdBy uint64, name string) *model.Patient {
	t.Helper()
	patient := model.Patient{
		TenantID:  tenantID,
		Name:      name,
		Gender:    1,
		Age:       30,
		CreatedBy: createdBy,
	}
	if err := db.Create(&patient).Error; err != nil {
		t.Fatalf("failed to seed test patient: %v", err)
	}
	return &patient
}

// SeedAllPermissions creates all system permissions and returns them as a map[code]*Permission.
func SeedAllPermissions(t *testing.T, db *gorm.DB) map[string]*model.Permission {
	t.Helper()
	codes := []struct{ code, name string }{
		{"patient:create", "创建患者"}, {"patient:read", "查看患者"},
		{"patient:update", "修改患者"}, {"patient:delete", "删除患者"},
		{"record:create", "创建诊疗记录"}, {"record:read", "查看诊疗记录"},
		{"record:update", "修改诊疗记录"}, {"record:delete", "删除诊疗记录"},
		{"oplog:read", "查看操作日志"}, {"user:manage", "用户管理"},
		{"role:manage", "角色管理"}, {"herb:read", "查询中药"},
		{"formula:read", "查询方剂"}, {"prescription:create", "开方"},
		{"prescription:read", "查看处方"}, {"tenant:manage", "诊所管理"},
		{"inventory:create", "库存新增"}, {"inventory:read", "库存查看"},
		{"inventory:update", "库存修改"}, {"inventory:delete", "库存删除"},
		{"billing:create", "收费"}, {"billing:read", "查看收费"},
		{"tenant:user:manage", "诊所用户管理"}, {"tenant:role:manage", "诊所角色管理"},
		{"followup:create", "新增回访"}, {"followup:read", "查看回访"},
		{"followup:update", "编辑回访"}, {"followup:delete", "删除回访"},
	}
	result := make(map[string]*model.Permission)
	for _, c := range codes {
		p := SeedTestPermission(t, db, c.code, c.name)
		result[c.code] = p
	}
	return result
}

// SeedAdminUser creates a tenant + admin role with all permissions + admin user.
// Returns tenant, user, token.
func SeedAdminUser(t *testing.T, db *gorm.DB) (*model.Tenant, *model.User, string) {
	t.Helper()
	tenant := SeedTestTenant(t, db, "测试诊所", "test-clinic")
	perms := SeedAllPermissions(t, db)

	// Collect all permissions for admin role.
	permList := make([]*model.Permission, 0, len(perms))
	for _, p := range perms {
		permList = append(permList, p)
	}
	role := SeedTestRole(t, db, tenant.ID, "admin", permList...)
	user, token := SeedTestUser(t, db, tenant.ID, "admin", "admin123", role)
	return tenant, user, token
}

// generateTestToken creates a JWT token for testing without importing middleware.
// This breaks the circular dependency: testutil → middleware → service.
func generateTestToken(userID, tenantID uint64, username string) (string, error) {
	claims := jwt.MapClaims{
		"user_id":   userID,
		"tenant_id": tenantID,
		"username":  username,
		"exp":       time.Now().Add(24 * time.Hour).Unix(),
		"iat":       time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(TestJWTSecret))
}
