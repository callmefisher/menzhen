package middleware

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// TenantScope returns a GORM scope that filters queries by the
// current user's tenant_id extracted from the Gin context.
// Usage: db.Scopes(middleware.TenantScope(c)).Find(&records)
func TenantScope(c *gin.Context) func(db *gorm.DB) *gorm.DB {
	tenantID := GetTenantID(c)
	return func(db *gorm.DB) *gorm.DB {
		return db.Where("tenant_id = ?", tenantID)
	}
}
