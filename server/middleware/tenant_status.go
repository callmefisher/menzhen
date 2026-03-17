package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// TenantStatusMiddleware checks that the authenticated user's tenant is enabled (status=1).
// Returns HTTP 403 with "tenant_disabled" if the tenant is disabled, not found, or on DB error (fail-closed).
func TenantStatusMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantID := GetTenantID(c)
		if tenantID == 0 {
			c.Next()
			return
		}

		var tenant struct{ Status int8 }
		err := db.Table("tenants").Select("status").Where("id = ?", tenantID).First(&tenant).Error
		if err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "tenant_disabled",
			})
			return
		}

		if tenant.Status != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code":    403,
				"message": "tenant_disabled",
			})
			return
		}

		c.Next()
	}
}
