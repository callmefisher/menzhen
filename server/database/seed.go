package database

import (
	_ "embed"
	"encoding/json"
	"log"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

//go:embed hexagram_seed.json
var hexagramSeedJSON []byte

// Seed populates the database with initial data (permissions, default tenant,
// admin role, admin user). Each section is idempotent — it skips if data
// already exists.
func Seed(db *gorm.DB) {
	seedPermissions(db)
	tenant := seedDefaultTenant(db)
	role := seedAdminRole(db, tenant.ID)
	seedAdminUser(db, tenant.ID, role.ID)
	seedClinicOpsRole(db, tenant.ID)
	seedSolarTerms(db)
	seedHexagrams(db)
	rebuildEmptyDailyStats(db)
	log.Println("Seed data check completed")
}

// seedPermissions upserts all system permissions (creates new ones, skips existing).
func seedPermissions(db *gorm.DB) {
	permissions := []model.Permission{
		{Code: "patient:create", Name: "创建患者", Description: "创建患者"},
		{Code: "patient:read", Name: "查看患者", Description: "查看患者"},
		{Code: "patient:update", Name: "修改患者", Description: "修改患者"},
		{Code: "patient:delete", Name: "删除患者", Description: "删除患者"},
		{Code: "record:create", Name: "创建诊疗记录", Description: "创建诊疗记录"},
		{Code: "record:read", Name: "查看诊疗记录", Description: "查看诊疗记录"},
		{Code: "record:update", Name: "修改诊疗记录", Description: "修改诊疗记录"},
		{Code: "record:delete", Name: "删除诊疗记录", Description: "删除诊疗记录"},
		{Code: "oplog:read", Name: "查看操作日志", Description: "查看操作日志"},
		{Code: "user:manage", Name: "用户管理", Description: "用户管理"},
		{Code: "role:manage", Name: "角色管理", Description: "角色管理"},
		{Code: "herb:read", Name: "查询中药", Description: "查询中药信息"},
		{Code: "formula:read", Name: "查询方剂", Description: "查询方剂信息"},
		{Code: "prescription:create", Name: "开方", Description: "创建处方"},
		{Code: "prescription:read", Name: "查看处方", Description: "查看处方信息"},
		{Code: "tenant:manage", Name: "诊所管理", Description: "管理租户/诊所"},
		{Code: "inventory:read", Name: "查看库存", Description: "查看药物库存"},
		{Code: "inventory:create", Name: "新增库存", Description: "新增库存药物"},
		{Code: "inventory:update", Name: "修改库存", Description: "修改库存药物"},
		{Code: "inventory:delete", Name: "删除库存", Description: "删除库存药物"},
		{Code: "billing:create", Name: "收费", Description: "创建收费记录"},
		{Code: "billing:read", Name: "查看收费", Description: "查看收费记录"},
		{Code: "tenant:user:manage", Name: "诊所用户管理", Description: "管理本诊所用户"},
		{Code: "tenant:role:manage", Name: "诊所角色管理", Description: "管理本诊所角色"},
		{Code: "followup:create", Name: "新增回访", Description: "创建回访记录"},
		{Code: "followup:read", Name: "查看回访", Description: "查看回访列表和详情"},
		{Code: "followup:update", Name: "编辑回访", Description: "修改回访记录"},
		{Code: "followup:delete", Name: "删除回访", Description: "删除回访记录"},
		{Code: "statistics:read", Name: "统计数据", Description: "查看统计概览"},
	}

	for _, p := range permissions {
		var existing model.Permission
		result := db.Where("code = ?", p.Code).First(&existing)
		if result.Error != nil {
			if err := db.Create(&p).Error; err != nil {
				log.Printf("Warning: failed to create permission %s: %v", p.Code, err)
			}
		}
	}
	log.Println("Permissions upsert completed")
}

// seedDefaultTenant creates the default tenant if it does not already exist.
func seedDefaultTenant(db *gorm.DB) model.Tenant {
	var tenant model.Tenant
	result := db.Where("code = ?", "1000").First(&tenant)
	if result.Error == nil {
		log.Println("Default tenant already exists, skipping")
		return tenant
	}

	tenant = model.Tenant{
		Name:   "默认诊所",
		Code:   "1000",
		Status: 1,
	}
	if err := db.Create(&tenant).Error; err != nil {
		log.Panicf("failed to seed default tenant: %v", err)
	}
	log.Println("Default tenant seeded successfully")
	return tenant
}

// seedAdminRole creates the admin role with all permissions if it does not
// already exist within the default tenant. Also syncs all "管理员" roles across
// all tenants to the latest full permission set.
func seedAdminRole(db *gorm.DB, tenantID uint64) model.Role {
	// Fetch all permissions to assign to admin roles.
	var permissions []model.Permission
	if err := db.Find(&permissions).Error; err != nil {
		log.Panicf("failed to fetch permissions for admin role: %v", err)
	}

	// Sync all existing "管理员" roles across all tenants.
	var adminRoles []model.Role
	if err := db.Where("name = ?", "管理员").Find(&adminRoles).Error; err == nil {
		for _, r := range adminRoles {
			if err := db.Model(&r).Association("Permissions").Replace(permissions); err != nil {
				log.Printf("Warning: failed to sync admin role (id=%d) permissions: %v", r.ID, err)
			}
		}
		if len(adminRoles) > 0 {
			log.Printf("Admin role permissions synced for %d tenants", len(adminRoles))
		}
	}

	// Ensure default tenant has an admin role.
	var role model.Role
	result := db.Where("name = ? AND tenant_id = ?", "管理员", tenantID).First(&role)
	if result.Error == nil {
		return role
	}

	role = model.Role{
		TenantID:    tenantID,
		Name:        "管理员",
		Description: "系统管理员",
		Permissions: permissions,
	}
	if err := db.Create(&role).Error; err != nil {
		log.Panicf("failed to seed admin role: %v", err)
	}
	log.Println("Admin role seeded successfully")
	return role
}

// seedAdminUser creates the default admin user if it does not already exist
// within the default tenant.
func seedAdminUser(db *gorm.DB, tenantID uint64, roleID uint64) {
	var user model.User
	result := db.Where("username = ? AND tenant_id = ?", "admin", tenantID).First(&user)
	if result.Error == nil {
		log.Println("Admin user already exists, skipping")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
	if err != nil {
		log.Panicf("failed to hash admin password: %v", err)
	}

	user = model.User{
		TenantID:     tenantID,
		Username:     "admin",
		PasswordHash: string(hash),
		RealName:     "管理员",
		Status:       1,
	}
	if err := db.Create(&user).Error; err != nil {
		log.Panicf("failed to seed admin user: %v", err)
	}

	// Assign admin role to admin user.
	userRole := model.UserRole{
		UserID: user.ID,
		RoleID: roleID,
	}
	if err := db.Create(&userRole).Error; err != nil {
		log.Panicf("failed to assign admin role to admin user: %v", err)
	}
	log.Println("Admin user seeded successfully")
}

// seedClinicOpsRole creates the "诊所运营" role if it does not exist.
// Unlike admin role, this role is NOT synced on restart — users may customize its permissions.
func seedClinicOpsRole(db *gorm.DB, tenantID uint64) {
	// Check if the role already exists in the default tenant.
	var role model.Role
	result := db.Where("name = ? AND tenant_id = ?", "诊所运营", tenantID).First(&role)
	if result.Error == nil {
		log.Println("Clinic ops role already exists, skipping (user may have customized permissions)")
		return
	}

	clinicOpsPermCodes := []string{"tenant:user:manage", "tenant:role:manage", "statistics:read"}

	var perms []model.Permission
	if err := db.Where("code IN ?", clinicOpsPermCodes).Find(&perms).Error; err != nil {
		log.Printf("Warning: failed to fetch permissions for clinic ops role: %v", err)
		return
	}

	role = model.Role{
		TenantID:    tenantID,
		Name:        "诊所运营",
		Description: "诊所运营管理，可管理本诊所的用户和角色、查看统计",
		Permissions: perms,
	}
	if err := db.Create(&role).Error; err != nil {
		log.Printf("Warning: failed to seed clinic ops role: %v", err)
	}
	log.Println("Clinic ops role seeded successfully")
}

// seedSolarTerms upserts all 24 solar terms (creates new ones, skips existing).
func seedSolarTerms(db *gorm.DB) {
	terms := []model.SolarTerm{
		{Name: "立春", Season: "春", OrderIndex: 1, Month: 2, Day: 3, EndMonth: 2, EndDay: 18},
		{Name: "雨水", Season: "春", OrderIndex: 2, Month: 2, Day: 18, EndMonth: 3, EndDay: 5},
		{Name: "惊蛰", Season: "春", OrderIndex: 3, Month: 3, Day: 5, EndMonth: 3, EndDay: 20},
		{Name: "春分", Season: "春", OrderIndex: 4, Month: 3, Day: 20, EndMonth: 4, EndDay: 4},
		{Name: "清明", Season: "春", OrderIndex: 5, Month: 4, Day: 4, EndMonth: 4, EndDay: 19},
		{Name: "谷雨", Season: "春", OrderIndex: 6, Month: 4, Day: 19, EndMonth: 5, EndDay: 5},
		{Name: "立夏", Season: "夏", OrderIndex: 7, Month: 5, Day: 5, EndMonth: 5, EndDay: 20},
		{Name: "小满", Season: "夏", OrderIndex: 8, Month: 5, Day: 20, EndMonth: 6, EndDay: 5},
		{Name: "芒种", Season: "夏", OrderIndex: 9, Month: 6, Day: 5, EndMonth: 6, EndDay: 21},
		{Name: "夏至", Season: "夏", OrderIndex: 10, Month: 6, Day: 21, EndMonth: 7, EndDay: 6},
		{Name: "小暑", Season: "夏", OrderIndex: 11, Month: 7, Day: 6, EndMonth: 7, EndDay: 22},
		{Name: "大暑", Season: "夏", OrderIndex: 12, Month: 7, Day: 22, EndMonth: 8, EndDay: 7},
		{Name: "立秋", Season: "秋", OrderIndex: 13, Month: 8, Day: 7, EndMonth: 8, EndDay: 22},
		{Name: "处暑", Season: "秋", OrderIndex: 14, Month: 8, Day: 22, EndMonth: 9, EndDay: 7},
		{Name: "白露", Season: "秋", OrderIndex: 15, Month: 9, Day: 7, EndMonth: 9, EndDay: 22},
		{Name: "秋分", Season: "秋", OrderIndex: 16, Month: 9, Day: 22, EndMonth: 10, EndDay: 8},
		{Name: "寒露", Season: "秋", OrderIndex: 17, Month: 10, Day: 8, EndMonth: 10, EndDay: 23},
		{Name: "霜降", Season: "秋", OrderIndex: 18, Month: 10, Day: 23, EndMonth: 11, EndDay: 7},
		{Name: "立冬", Season: "冬", OrderIndex: 19, Month: 11, Day: 7, EndMonth: 11, EndDay: 22},
		{Name: "小雪", Season: "冬", OrderIndex: 20, Month: 11, Day: 22, EndMonth: 12, EndDay: 6},
		{Name: "大雪", Season: "冬", OrderIndex: 21, Month: 12, Day: 6, EndMonth: 12, EndDay: 21},
		{Name: "冬至", Season: "冬", OrderIndex: 22, Month: 12, Day: 21, EndMonth: 1, EndDay: 5},
		{Name: "小寒", Season: "冬", OrderIndex: 23, Month: 1, Day: 5, EndMonth: 1, EndDay: 20},
		{Name: "大寒", Season: "冬", OrderIndex: 24, Month: 1, Day: 20, EndMonth: 2, EndDay: 3},
	}

	for _, term := range terms {
		var existing model.SolarTerm
		result := db.Where("name = ?", term.Name).First(&existing)
		if result.Error != nil {
			if err := db.Create(&term).Error; err != nil {
				log.Printf("Warning: failed to create solar term %s: %v", term.Name, err)
			}
		}
	}
	log.Println("Solar terms upsert completed")
}

// seedHexagrams upserts all 64 I Ching hexagrams from the embedded JSON file.
func seedHexagrams(db *gorm.DB) {
	var seeds []struct {
		Number       int             `json:"number"`
		Name         string          `json:"name"`
		Symbol       string          `json:"symbol"`
		UpperTrigram string          `json:"upper_trigram"`
		LowerTrigram string          `json:"lower_trigram"`
		Judgment     string          `json:"judgment"`
		YaoTexts     json.RawMessage `json:"yao_texts"`
	}
	if err := json.Unmarshal(hexagramSeedJSON, &seeds); err != nil {
		log.Printf("Warning: failed to parse hexagram seed data: %v", err)
		return
	}

	for _, s := range seeds {
		var existing model.Hexagram
		result := db.Where("name = ?", s.Name).First(&existing)
		if result.Error != nil {
			h := model.Hexagram{
				Number:       s.Number,
				Name:         s.Name,
				Symbol:       s.Symbol,
				UpperTrigram: s.UpperTrigram,
				LowerTrigram: s.LowerTrigram,
				Judgment:     s.Judgment,
				YaoTexts:     datatypes.JSON(s.YaoTexts),
			}
			if err := db.Create(&h).Error; err != nil {
				log.Printf("Warning: failed to create hexagram %s: %v", s.Name, err)
			}
		}
	}
	log.Println("Hexagram seed upsert completed")
}

// rebuildEmptyDailyStats checks if daily_stats is empty for tenants that have
// billing records, and triggers a full rebuild if so. This handles the case
// where billing data was created before the statistics feature was added.
func rebuildEmptyDailyStats(db *gorm.DB) {
	// Find tenant IDs that have billing records.
	var tenantIDs []uint64
	db.Model(&model.Billing{}).Distinct("tenant_id").Pluck("tenant_id", &tenantIDs)
	if len(tenantIDs) == 0 {
		return
	}

	statsSvc := service.NewStatisticsService(db)
	for _, tid := range tenantIDs {
		var statsCount int64
		db.Model(&model.DailyStats{}).Where("tenant_id = ?", tid).Count(&statsCount)
		if statsCount == 0 {
			log.Printf("Rebuilding daily stats for tenant %d (billing records exist but no stats)", tid)
			if err := statsSvc.RebuildAllDailyStats(tid); err != nil {
				log.Printf("Warning: failed to rebuild daily stats for tenant %d: %v", tid, err)
			}
		}
	}
}
