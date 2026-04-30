package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type licenseCache struct {
	mu        sync.RWMutex
	active    bool
	checkedAt time.Time
}

var (
	lc = &licenseCache{}
)

func isLicenseActive(db *gorm.DB) bool {
	lc.mu.RLock()
	if lc.active && time.Since(lc.checkedAt) < 60*time.Second {
		lc.mu.RUnlock()
		return true
	}
	lc.mu.RUnlock()

	lc.mu.Lock()
	defer lc.mu.Unlock()

	if lc.active && time.Since(lc.checkedAt) < 60*time.Second {
		return true
	}

	siteID := service.GetSiteID()
	machineID := service.EnsureMachineID()

	var count int64
	if siteID != "" && machineID != "" {
		db.Raw("SELECT COUNT(*) FROM licenses WHERE status = 'active' AND (expiry_date IS NULL OR expiry_date > NOW()) AND site_id = ? AND machine_id = ? AND deleted_at IS NULL", siteID, machineID).Scan(&count)
	} else if siteID != "" {
		db.Raw("SELECT COUNT(*) FROM licenses WHERE status = 'active' AND (expiry_date IS NULL OR expiry_date > NOW()) AND site_id = ? AND deleted_at IS NULL", siteID).Scan(&count)
	} else if machineID != "" {
		db.Raw("SELECT COUNT(*) FROM licenses WHERE status = 'active' AND (expiry_date IS NULL OR expiry_date > NOW()) AND machine_id = ? AND deleted_at IS NULL", machineID).Scan(&count)
	} else {
		count = 0
	}
	lc.active = count > 0
	lc.checkedAt = time.Now()
	return lc.active
}

func InvalidateLicenseCache() {
	lc.mu.Lock()
	lc.checkedAt = time.Time{}
	lc.mu.Unlock()
}

func LicenseCheckMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		active := isLicenseActive(db)

		c.Header("X-License-Active", strconv.FormatBool(active))

		if active {
			c.Next()
			return
		}

		whitelist := []string{
			"/api/v1/auth/login",
			"/api/v1/auth/register",
			"/api/v1/auth/refresh",
			"/api/v1/auth/logout",
			"/api/v1/auth/me",
			"/api/v1/auth/change-password",
			"/api/v1/patient/auth/login",
			"/api/v1/patient/auth/tenant-list",
			"/api/v1/patient/auth/tenant-info",
			"/api/v1/tenants/accessible",
		}
		for _, w := range whitelist {
			if path == w {
				c.Next()
				return
			}
		}

		prefixWhitelist := []string{
			"/api/v1/licenses",
			"/api/v1/permissions",
			"/api/v1/roles",
			"/api/v1/tenant/permissions",
			"/api/v1/tenant/roles",
		}
		for _, p := range prefixWhitelist {
			if len(path) >= len(p) && path[:len(p)] == p {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"code":    403,
			"message": "license_required",
		})
	}
}
