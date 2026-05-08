package handler

import (
	"log"
	"strconv"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var cstLoc *time.Location

func init() {
	cstLoc, _ = time.LoadLocation("Asia/Shanghai")
}

func fmtCST(t time.Time) string {
	return t.In(cstLoc).Format("2006-01-02 15:04:05")
}

type LicenseHandler struct {
	db *gorm.DB
}

func NewLicenseHandler(db *gorm.DB) *LicenseHandler {
	return &LicenseHandler{db: db}
}

func (h *LicenseHandler) GetIdentity(c *gin.Context) {
	svc := service.NewLicenseService(h.db)
	siteID, machineID := svc.GetMachineIdentity()
	publicKey := service.LoadPublicKey()
	Success(c, gin.H{
		"site_id":     siteID,
		"machine_id":  machineID,
		"public_key":  publicKey,
	})
}

func (h *LicenseHandler) UpdateIdentity(c *gin.Context) {
	var req struct {
		SiteID string `json:"site_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}
	svc := service.NewLicenseService(h.db)
	if err := svc.UpdateMachineIdentity(req.SiteID); err != nil {
		Error(c, 500, "更新失败")
		return
	}
	Success(c, nil)
}

func (h *LicenseHandler) GetSiteLicense(c *gin.Context) {
	svc := service.NewLicenseService(h.db)
	siteID, machineID := svc.GetMachineIdentity()

	lic, err := svc.GetSiteActiveLicense(siteID, machineID)
	if err != nil {
		lic, err = svc.GetSiteLatestLicense(siteID, machineID)
		if err != nil {
			Success(c, gin.H{
				"site_id":     siteID,
				"machine_id":  machineID,
				"license":     nil,
				"status":      "none",
				"remaining":   0,
			})
			return
		}

		remaining := 0
		status := "expired"
		if lic.Status == "superseded" {
			status = "superseded"
		}
		if lic.ExpiryDate != nil {
			diff := time.Until(*lic.ExpiryDate)
			remaining = int(diff.Hours() / 24)
		}

		publicKey := service.LoadPublicKey()
		var decodedClaims interface{}
		if lic.JWTToken != "" && publicKey != "" {
			if claims, err := service.VerifyLicense(publicKey, lic.JWTToken); err == nil {
				decodedClaims = claims
			}
		}

		Success(c, gin.H{
			"site_id":        siteID,
			"machine_id":     machineID,
			"license":        lic,
			"status":         status,
			"remaining_days": remaining,
			"decoded_claims": decodedClaims,
		})
		return
	}

	remaining := 0
	status := "active"
	if lic.ExpiryDate != nil {
		diff := time.Until(*lic.ExpiryDate)
		if diff <= 0 {
			status = "expired"
			remaining = int(diff.Hours() / 24)
		} else {
			remaining = int(diff.Hours()/24) + 1
			if remaining <= 7 {
				status = "expiring"
			}
		}
	} else {
		status = "active"
	}

	publicKey := service.LoadPublicKey()
	var decodedClaims interface{}
	if lic.JWTToken != "" && publicKey != "" {
		if claims, err := service.VerifyLicense(publicKey, lic.JWTToken); err == nil {
			decodedClaims = claims
		}
	}

	Success(c, gin.H{
		"site_id":        siteID,
		"machine_id":     machineID,
		"license":        lic,
		"status":         status,
		"remaining_days": remaining,
		"decoded_claims": decodedClaims,
	})
}

func (h *LicenseHandler) GetClinicLicense(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		Error(c, 400, "无法获取当前诊所信息")
		return
	}

	svc := service.NewLicenseService(h.db)
	siteID, machineID := svc.GetMachineIdentity()
	clinicCode := svc.ResolveTenantCode(tenantID)
	clinicName := svc.ResolveTenantName(tenantID)

	log.Printf("[license:handler] GetClinicLicense: tenant_id=%d, clinic_code=%s, clinic_name=%s", tenantID, clinicCode, clinicName)

	if clinicCode == "" {
		Success(c, gin.H{
			"tenant_id":    tenantID,
			"clinic_code":  "",
			"clinic_name":  clinicName,
			"site_id":      siteID,
			"machine_id":   machineID,
			"license":      nil,
			"status":       "none",
			"remaining":    0,
			"license_type": "clinic",
		})
		return
	}

	lic, err := svc.GetClinicActiveLicense(clinicCode, siteID, machineID)
	if err != nil {
		lic, err = svc.GetClinicLatestLicense(clinicCode, siteID, machineID)
		if err != nil {
			hasAny, _ := svc.HasAnyClinicLicense(clinicCode)
			Success(c, gin.H{
				"tenant_id":      tenantID,
				"clinic_code":    clinicCode,
				"clinic_name":    clinicName,
				"site_id":        siteID,
				"machine_id":     machineID,
				"license":        nil,
				"status":         "none",
				"remaining_days": 0,
				"decoded_claims": nil,
				"license_type":   "clinic",
				"has_any":        hasAny,
			})
			return
		}

		remaining := 0
		status := "expired"
		if lic.Status == "superseded" {
			status = "superseded"
		}
		if lic.ExpiryDate != nil {
			diff := time.Until(*lic.ExpiryDate)
			remaining = int(diff.Hours() / 24)
		}

		publicKey := service.LoadPublicKey()
		var decodedClaims interface{}
		if lic.JWTToken != "" && publicKey != "" {
			if claims, err := service.VerifyLicense(publicKey, lic.JWTToken); err == nil {
				decodedClaims = claims
			}
		}

		Success(c, gin.H{
			"tenant_id":      tenantID,
			"clinic_code":    clinicCode,
			"clinic_name":    clinicName,
			"site_id":        siteID,
			"machine_id":     machineID,
			"license":        lic,
			"status":         status,
			"remaining_days": remaining,
			"decoded_claims": decodedClaims,
			"license_type":   "clinic",
		})
		return
	}

	remaining := 0
	status := "active"
	if lic.ExpiryDate != nil {
		diff := time.Until(*lic.ExpiryDate)
		if diff <= 0 {
			status = "expired"
			remaining = int(diff.Hours() / 24)
		} else {
			remaining = int(diff.Hours()/24) + 1
			if remaining <= 7 {
				status = "expiring"
			}
		}
	} else {
		status = "active"
	}

	publicKey := service.LoadPublicKey()
	var decodedClaims interface{}
	if lic.JWTToken != "" && publicKey != "" {
		if claims, err := service.VerifyLicense(publicKey, lic.JWTToken); err == nil {
			decodedClaims = claims
		}
	}

	Success(c, gin.H{
		"tenant_id":      tenantID,
		"clinic_code":    clinicCode,
		"clinic_name":    clinicName,
		"site_id":        siteID,
		"machine_id":     machineID,
		"license":        lic,
		"status":         status,
		"remaining_days": remaining,
		"decoded_claims": decodedClaims,
		"license_type":   "clinic",
	})
}

func (h *LicenseHandler) SearchTenantsForLicense(c *gin.Context) {
	keyword := c.Query("keyword")
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 || size > 50 {
		size = 20
	}

	type tenantItem struct {
		ID   uint64 `json:"id"`
		Name string `json:"name"`
		Code string `json:"code"`
	}

	var tenants []tenantItem
	q := h.db.Table("tenants").Where("status = 1")
	if keyword != "" {
		q = q.Where("name LIKE ? OR code LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	q = q.Select("id, name, code").Order("id ASC").Limit(size)
	q.Scan(&tenants)

	Success(c, tenants)
}

func (h *LicenseHandler) CreateLicense(c *gin.Context) {
	var req service.CreateLicenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误: "+err.Error())
		return
	}

	username := middleware.GetUsername(c)
	privateKey := service.LoadPrivateKey()

	svc := service.NewLicenseService(h.db)
	lic, err := svc.CreateSiteLicense(req, username, privateKey)
	if err != nil {
		Error(c, 500, "创建授权失败: "+err.Error())
		return
	}
	middleware.InvalidateLicenseCache()
	Created(c, lic)
}

func (h *LicenseHandler) UpdateLicense(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, 400, "无效ID")
		return
	}

	var req service.UpdateLicenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	privateKey := service.LoadPrivateKey()
	svc := service.NewLicenseService(h.db)
	lic, err := svc.UpdateLicense(id, req, privateKey)
	if err != nil {
		Error(c, 500, "更新授权失败: "+err.Error())
		return
	}
	middleware.InvalidateLicenseCache()
	Success(c, lic)
}

func (h *LicenseHandler) GetLicense(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, 400, "无效ID")
		return
	}

	svc := service.NewLicenseService(h.db)
	lic, err := svc.GetLicense(id)
	if err != nil {
		Error(c, 404, "授权记录不存在")
		return
	}

	publicKey := service.LoadPublicKey()
	var decodedClaims interface{}
	if lic.JWTToken != "" && publicKey != "" {
		if claims, err := service.VerifyLicense(publicKey, lic.JWTToken); err == nil {
			decodedClaims = claims
		}
	}

	Success(c, gin.H{
		"license":        lic,
		"decoded_claims": decodedClaims,
	})
}

func (h *LicenseHandler) ListTenantLicenses(c *gin.Context) {
	tenantIDStr := c.Param("tenant_id")
	tenantID, err := strconv.ParseUint(tenantIDStr, 10, 64)
	if err != nil {
		Error(c, 400, "无效诊所ID")
		return
	}

	siteID := c.Query("site_id")

	svc := service.NewLicenseService(h.db)
	licenses, err := svc.ListLicenses(tenantID, siteID)
	if err != nil {
		Error(c, 500, "查询失败")
		return
	}
	Success(c, licenses)
}

func (h *LicenseHandler) ListAllLicenses(c *gin.Context) {
	search := c.Query("search")
	expiringDaysStr := c.Query("expiring_days")
	var expiringDays int
	if expiringDaysStr != "" {
		if d, err := strconv.Atoi(expiringDaysStr); err == nil && d > 0 {
			expiringDays = d
		}
	}

	username := middleware.GetUsername(c)
	isSuperAdmin := username == "admin"
	managedGroups := middleware.GetManagedGroups(c)
	isPowerAdmin := len(managedGroups) > 0 && !isSuperAdmin
	tenantID := middleware.GetTenantID(c)

	log.Printf("[license:handler] ListAllLicenses: username=%s, isSuperAdmin=%v, isPowerAdmin=%v, managedGroups=%v, tenantID=%d", username, isSuperAdmin, isPowerAdmin, managedGroups, tenantID)

	svc := service.NewLicenseService(h.db)
	licenses, err := svc.ListAllLicenses(search)
	if err != nil {
		Error(c, 500, "查询失败")
		return
	}

	var allowedTenantIDs []uint64
	var allowedClinicCodes []string
	if !isSuperAdmin {
		if isPowerAdmin {
			var tenants []struct {
				ID   uint64
				Code string
			}
			h.db.Table("tenants").Where("group_name IN ? AND status = 1", managedGroups).Select("id, code").Scan(&tenants)
			for _, t := range tenants {
				allowedTenantIDs = append(allowedTenantIDs, t.ID)
				allowedClinicCodes = append(allowedClinicCodes, t.Code)
			}
			log.Printf("[license:handler] powerAdmin filter: allowedTenantIDs=%v, allowedClinicCodes=%v", allowedTenantIDs, allowedClinicCodes)
		} else {
			if tenantID > 0 {
				allowedTenantIDs = []uint64{tenantID}
				code := svc.ResolveTenantCode(tenantID)
				if code != "" {
					allowedClinicCodes = []string{code}
				}
			}
			expiringDays = 0
			log.Printf("[license:handler] normal admin filter: tenantID=%d, allowedClinicCodes=%v", tenantID, allowedClinicCodes)
		}
	}

	type resultItem struct {
		ID          uint64  `json:"id"`
		TenantID    uint64  `json:"tenant_id"`
		TenantName  string  `json:"tenant_name"`
		TenantCode  string  `json:"tenant_code"`
		LicenseType string  `json:"license_type"`
		ClinicCode  string  `json:"clinic_code"`
		SiteID      string  `json:"site_id"`
		MachineID   string  `json:"machine_id"`
		Method      string  `json:"method"`
		Duration    int     `json:"duration"`
		AuthDate    *string `json:"auth_date"`
		ExpiryDate  *string `json:"expiry_date"`
		Features    string  `json:"features"`
		Amount      float64 `json:"amount"`
		Status      string  `json:"status"`
		Remaining   int     `json:"remaining_days"`
		Remark      string  `json:"remark"`
		CreatedBy   string  `json:"created_by"`
		CreatedAt   string  `json:"created_at"`
	}

	var results []resultItem
	for _, lic := range licenses {
		if !isSuperAdmin {
			if lic.LicenseType == "site" || lic.LicenseType == "" {
				continue
			}
			if isPowerAdmin {
				matched := false
				for _, code := range allowedClinicCodes {
					if lic.ClinicCode == code {
						matched = true
						break
					}
				}
				if !matched {
					continue
				}
			} else {
				matched := false
				for _, code := range allowedClinicCodes {
					if lic.ClinicCode == code {
						matched = true
						break
					}
				}
				if !matched {
					continue
				}
			}
		}

		var tenantName, tenantCode string
		h.db.Table("tenants").Where("id = ?", lic.TenantID).Select("name").Scan(&tenantName)
		h.db.Table("tenants").Where("id = ?", lic.TenantID).Select("code").Scan(&tenantCode)

		remaining := 0
		if lic.ExpiryDate != nil {
			diff := time.Until(*lic.ExpiryDate)
			if diff <= 0 {
				remaining = int(diff.Hours() / 24)
			} else {
				remaining = int(diff.Hours()/24) + 1
			}
		}

		if expiringDays > 0 {
			if lic.Method == "permanent" {
				continue
			}
			if lic.Status != "active" {
				continue
			}
			if remaining <= 0 || remaining > expiringDays {
				continue
			}
		}

		var authDateStr, expiryDateStr string
		if lic.AuthDate != nil {
			authDateStr = fmtCST(*lic.AuthDate)
		}
		if lic.ExpiryDate != nil {
			if lic.Method == "permanent" {
				expiryDateStr = "永久"
			} else {
				expiryDateStr = fmtCST(*lic.ExpiryDate)
			}
		}

		results = append(results, resultItem{
			ID:          lic.ID,
			TenantID:    lic.TenantID,
			TenantName:  tenantName,
			TenantCode:  tenantCode,
			LicenseType: lic.LicenseType,
			ClinicCode:  lic.ClinicCode,
			SiteID:      lic.SiteID,
			MachineID:   lic.MachineID,
			Method:     lic.Method,
			Duration:   lic.Duration,
			AuthDate:   &authDateStr,
			ExpiryDate: &expiryDateStr,
			Features:   lic.Features,
			Amount:     lic.Amount,
			Status:     lic.Status,
			Remaining:  remaining,
			Remark:     lic.Remark,
			CreatedBy:  lic.CreatedBy,
			CreatedAt:  lic.CreatedAt.Format("2006-01-02 15:04:05"),
		})
	}

	log.Printf("[license:handler] ListAllLicenses: search=%s, expiring_days=%d, results=%d, role=%s", search, expiringDays, len(results), func() string {
		if isSuperAdmin { return "superAdmin" }
		if isPowerAdmin { return "powerAdmin" }
		return "tenantAdmin"
	}())
	Success(c, results)
}

func (h *LicenseHandler) DeleteLicense(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, 400, "无效ID")
		return
	}
	svc := service.NewLicenseService(h.db)
	if err := svc.DeleteLicense(id); err != nil {
		Error(c, 500, "删除失败")
		return
	}
	middleware.InvalidateLicenseCache()
	Success(c, nil)
}

func (h *LicenseHandler) GetStats(c *gin.Context) {
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	svc := service.NewLicenseService(h.db)
	stats, err := svc.GetStats(startDate, endDate)
	if err != nil {
		Error(c, 500, "统计失败")
		return
	}

	monthly, err := svc.GetMonthlyStats(startDate, endDate)
	if err != nil {
		monthly = []service.MonthlyAmount{}
	}

	Success(c, gin.H{
		"summary":  stats,
		"monthly":  monthly,
	})
}

func (h *LicenseHandler) GetKeys(c *gin.Context) {
	privateKey := service.LoadPrivateKey()
	publicKey := service.LoadPublicKey()
	Success(c, gin.H{
		"public_key":       publicKey,
		"has_private":      privateKey != "",
		"public_key_path":  "/app/scripts/public.pem",
		"private_key_path": "/app/scripts/private.pem",
	})
}

func (h *LicenseHandler) VerifyToken(c *gin.Context) {
	var req struct {
		Token string `json:"token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	publicKey := service.LoadPublicKey()
	if publicKey == "" {
		Error(c, 500, "公钥未配置，无法验证License")
		return
	}

	claims, err := service.VerifyLicense(publicKey, req.Token)
	if err != nil {
		Error(c, 400, "License验证失败: "+err.Error())
		return
	}

	svc := service.NewLicenseService(h.db)
	_, localMachineID := svc.GetMachineIdentity()
	siteID := service.GetSiteID()

	mismatches := []string{}
	if claims.ClinicCode != "" {
		tenantID := middleware.GetTenantID(c)
		if tenantID > 0 {
			localClinicCode := svc.ResolveTenantCode(tenantID)
			if claims.ClinicCode != localClinicCode {
				mismatches = append(mismatches, "诊所编码不匹配(license="+claims.ClinicCode+", 本诊所="+localClinicCode+")")
			}
		}
	}
	if claims.SiteID != siteID {
		mismatches = append(mismatches, "SITE_ID不匹配(license="+claims.SiteID+", 本站="+siteID+")")
	}
	if claims.MachineID != localMachineID {
		mismatches = append(mismatches, "MachineID不匹配(license="+claims.MachineID+", 本站="+localMachineID+")")
	}

	durationDesc := ""
	if claims.Method == "permanent" {
		durationDesc = "永久"
	} else if claims.Duration > 0 {
		durationDesc = strconv.Itoa(claims.Duration) + map[string]string{
			"day": "天", "week": "周", "month": "月", "year": "年",
		}[claims.Method]
	}

	Success(c, gin.H{
		"valid":         len(mismatches) == 0,
		"claims":        claims,
		"mismatches":    mismatches,
		"duration_desc": durationDesc,
	})
}
