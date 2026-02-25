package database

import (
	"log"

	"github.com/callmefisher/menzhen/server/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// Seed populates the database with initial data (permissions, default tenant,
// admin role, admin user). Each section is idempotent — it skips if data
// already exists.
func Seed(db *gorm.DB) {
	seedPermissions(db)
	tenant := seedDefaultTenant(db)
	role := seedAdminRole(db, tenant.ID)
	seedAdminUser(db, tenant.ID, role.ID)
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
	result := db.Where("code = ?", "default").First(&tenant)
	if result.Error == nil {
		log.Println("Default tenant already exists, skipping")
		return tenant
	}

	tenant = model.Tenant{
		Name:   "默认诊所",
		Code:   "default",
		Status: 1,
	}
	if err := db.Create(&tenant).Error; err != nil {
		log.Panicf("failed to seed default tenant: %v", err)
	}
	log.Println("Default tenant seeded successfully")
	return tenant
}

// seedAdminRole creates the admin role with all permissions if it does not
// already exist within the default tenant.
func seedAdminRole(db *gorm.DB, tenantID uint64) model.Role {
	var role model.Role
	result := db.Where("name = ? AND tenant_id = ?", "管理员", tenantID).First(&role)

	// Fetch all permissions to assign to the admin role.
	var permissions []model.Permission
	if err := db.Find(&permissions).Error; err != nil {
		log.Panicf("failed to fetch permissions for admin role: %v", err)
	}

	if result.Error == nil {
		// Role already exists — sync permissions to latest full set.
		if err := db.Model(&role).Association("Permissions").Replace(permissions); err != nil {
			log.Printf("Warning: failed to update admin role permissions: %v", err)
		} else {
			log.Println("Admin role permissions synced")
		}
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
