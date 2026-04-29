package handler

import (
	"strconv"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

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

	var tenantID uint64
	tenantIDStr := c.Query("tenant_id")
	if tenantIDStr != "" {
		id, _ := strconv.ParseUint(tenantIDStr, 10, 64)
		tenantID = id
	}
	if tenantID == 0 {
		tenantID = middleware.GetTenantID(c)
	}

	lic, err := svc.GetActiveLicense(tenantID)
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

func (h *LicenseHandler) CreateLicense(c *gin.Context) {
	var req service.CreateLicenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误: "+err.Error())
		return
	}

	username := middleware.GetUsername(c)
	privateKey := service.LoadPrivateKey()

	svc := service.NewLicenseService(h.db)
	lic, err := svc.CreateLicense(req, username, privateKey)
	if err != nil {
		Error(c, 500, "创建授权失败: "+err.Error())
		return
	}
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

	svc := service.NewLicenseService(h.db)
	licenses, err := svc.ListLicenses(tenantID)
	if err != nil {
		Error(c, 500, "查询失败")
		return
	}
	Success(c, licenses)
}

func (h *LicenseHandler) ListAllLicenses(c *gin.Context) {
	svc := service.NewLicenseService(h.db)
	licenses, err := svc.ListAllLicenses()
	if err != nil {
		Error(c, 500, "查询失败")
		return
	}

	type resultItem struct {
		ID          uint64  `json:"id"`
		TenantID    uint64  `json:"tenant_id"`
		TenantName  string  `json:"tenant_name"`
		TenantCode  string  `json:"tenant_code"`
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

		var authDateStr, expiryDateStr string
		if lic.AuthDate != nil {
			authDateStr = lic.AuthDate.Format("2006-01-02")
		}
		if lic.ExpiryDate != nil {
			if lic.Method == "permanent" {
				expiryDateStr = "永久"
			} else {
				expiryDateStr = lic.ExpiryDate.Format("2006-01-02")
			}
		}

		results = append(results, resultItem{
			ID:         lic.ID,
			TenantID:   lic.TenantID,
			TenantName: tenantName,
			TenantCode: tenantCode,
			SiteID:     lic.SiteID,
			MachineID:  lic.MachineID,
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
