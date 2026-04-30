package middleware

import (
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type licenseCache struct {
	mu           sync.RWMutex
	siteActive   bool
	clinicActive map[string]bool
	checkedAt    time.Time
}

var (
	lc = &licenseCache{
		clinicActive: make(map[string]bool),
	}
)

func refreshLicenseCache(db *gorm.DB) {
	lc.mu.Lock()
	defer lc.mu.Unlock()

	if time.Since(lc.checkedAt) < 60*time.Second {
		return
	}

	siteID := service.GetSiteID()
	machineID := service.EnsureMachineID()
	now := time.Now()

	var siteCount int64
	q := db.Model(&struct {
		DeletedAt interface{}
	}{})
	q = db.Table("licenses").Where("license_type = 'site' AND status = 'active' AND (expiry_date IS NULL OR expiry_date > ?) AND deleted_at IS NULL", now)
	if siteID != "" {
		q = q.Where("site_id = ?", siteID)
	}
	if machineID != "" {
		q = q.Where("machine_id = ?", machineID)
	}
	q.Count(&siteCount)
	lc.siteActive = siteCount > 0

	type clinicStatus struct {
		ClinicCode string
		Cnt        int64
	}
	var results []clinicStatus
	clinicQ := db.Table("licenses").Where("license_type = 'clinic' AND status = 'active' AND (expiry_date IS NULL OR expiry_date > ?) AND deleted_at IS NULL", now)
	if siteID != "" {
		clinicQ = clinicQ.Where("site_id = ?", siteID)
	}
	if machineID != "" {
		clinicQ = clinicQ.Where("machine_id = ?", machineID)
	}
	clinicQ.Select("clinic_code, COUNT(*) as cnt").Group("clinic_code").Scan(&results)

	newCache := make(map[string]bool)
	for _, r := range results {
		newCache[r.ClinicCode] = r.Cnt > 0
	}
	lc.clinicActive = newCache
	lc.checkedAt = time.Now()

	log.Printf("[license:middleware] cache refreshed: site_active=%v, clinic_codes_tracked=%d", lc.siteActive, len(newCache))
}

func InvalidateLicenseCache() {
	lc.mu.Lock()
	lc.checkedAt = time.Time{}
	lc.clinicActive = make(map[string]bool)
	lc.siteActive = false
	lc.mu.Unlock()
	log.Printf("[license:middleware] cache invalidated")
}

func LicenseCheckMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		refreshLicenseCache(db)

		lc.mu.RLock()
		siteActive := lc.siteActive
		clinicActive := make(map[string]bool)
		for k, v := range lc.clinicActive {
			clinicActive[k] = v
		}
		lc.mu.RUnlock()

		active := false
		licenseType := "site"

		if siteActive {
			active = true
			licenseType = "site"
			log.Printf("[license:middleware] site license active, all requests pass")
		} else {
			tenantID := GetTenantID(c)
			var clinicCode string
			if tenantID > 0 {
				db.Table("tenants").Where("id = ?", tenantID).Select("code").Scan(&clinicCode)
			}

			if clinicCode != "" {
				if clinicOk, exists := clinicActive[clinicCode]; exists && clinicOk {
					active = true
					licenseType = "clinic"
					log.Printf("[license:middleware] site license inactive, clinic license active: clinic_code=%s", clinicCode)
				} else {
					active = false
					licenseType = "clinic"
					log.Printf("[license:middleware] site license inactive, clinic license inactive: clinic_code=%s", clinicCode)
				}
			} else {
				active = false
				licenseType = "site"
				log.Printf("[license:middleware] site license inactive, no tenant context")
			}
		}

		c.Header("X-License-Active", strconv.FormatBool(active))
		c.Header("X-License-Type", licenseType)

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
			"code":         403,
			"message":      "license_required",
			"license_type": licenseType,
		})
	}
}
