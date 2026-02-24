package database

import (
	"fmt"
	"log"

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

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Panicf("failed to connect to database: %v", err)
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
	)
	if err != nil {
		log.Panicf("failed to auto-migrate database: %v", err)
	}

	log.Println("Database migration completed")

	return db
}
