package database

import (
	"fmt"
	"log"
	"regexp"

	"github.com/callmefisher/menzhen/server/config"
	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// InitDB initialises the MySQL connection and runs AutoMigrate on all models.
// It panics on failure because this runs at startup — fail fast.
func InitDB(cfg *config.Config) *gorm.DB {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		cfg.DBUser,
		cfg.DBPassword,
		cfg.DBHost,
		cfg.DBPort,
		cfg.DBName,
	)

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		log.Panicf("failed to connect to database: %v (user=%s password=%s host=%s port=%s dbname=%s)",
			err, cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName)
	}

	log.Println("Database connected successfully")

	// AutoMigrate all models
	err = db.AutoMigrate(
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
		&model.PrescriptionNotification{},
	)
	if err != nil {
		log.Panicf("failed to auto-migrate database: %v", err)
	}

	// Composite index for billing stats aggregation by created_at (revenue by billing date).
	// Handles 5M+ rows efficiently with (tenant_id, created_at) range scan.
	if !db.Migrator().HasIndex(&model.Billing{}, "idx_billing_tenant_created") {
		if result := db.Exec("CREATE INDEX idx_billing_tenant_created ON billings (tenant_id, created_at)"); result.Error != nil {
			log.Panicf("failed to create billing stats index: %v", result.Error)
		}
	}

	// InnoDB table compression for tables with TEXT/LONGTEXT fields.
	// ROW_FORMAT=COMPRESSED KEY_BLOCK_SIZE=8 reduces disk usage ~50%.
	// Idempotent: skips tables already compressed.
	// SECURITY: compressTables must be a static hardcoded list, never from external input.
	compressTables := []string{
		"medical_records", "formulas", "hexagrams", "clinical_experiences",
		"ai_analyses", "solar_terms", "wuyun_liuqi", "herbs", "pulses",
		"follow_ups", "prescriptions", "patients", "meridian_resources",
		"inventory_drugs", "users",
	}
	validTableName := regexp.MustCompile(`^[a-z_]+$`)
	for _, table := range compressTables {
		if !validTableName.MatchString(table) {
			log.Panicf("invalid table name in compressTables: %q", table)
		}
		var rowFormat string
		db.Raw("SELECT ROW_FORMAT FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
			cfg.DBName, table).Scan(&rowFormat)
		if rowFormat == "" {
			log.Printf("WARNING: could not read ROW_FORMAT for table %s, skipping compression", table)
			continue
		}
		if rowFormat != "Compressed" {
			if result := db.Exec("ALTER TABLE `" + table + "` ROW_FORMAT=COMPRESSED KEY_BLOCK_SIZE=8"); result.Error != nil {
				log.Printf("WARNING: failed to compress table %s: %v", table, result.Error)
			} else {
				log.Printf("Compressed table: %s", table)
			}
		}
	}

	log.Println("Database migration completed")

	return db
}
