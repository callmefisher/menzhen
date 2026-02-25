package handler

import (
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AIAnalysisHandler handles AI-powered diagnosis analysis endpoints.
type AIAnalysisHandler struct {
	deepSeek *service.DeepSeekService
	db       *gorm.DB
}

// NewAIAnalysisHandler creates a new AIAnalysisHandler.
func NewAIAnalysisHandler(ds *service.DeepSeekService, db *gorm.DB) *AIAnalysisHandler {
	return &AIAnalysisHandler{deepSeek: ds, db: db}
}

type aiAnalysisRequest struct {
	Diagnosis string `json:"diagnosis" binding:"required"`
	RecordID  uint64 `json:"record_id"`
	Force     bool   `json:"force"`
}

// Analyze handles POST /api/v1/ai/analyze-diagnosis
// When record_id is provided, it checks for a cached result first.
func (h *AIAnalysisHandler) Analyze(c *gin.Context) {
	var req aiAnalysisRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请输入诊断内容")
		return
	}

	if !h.deepSeek.IsEnabled() {
		Error(c, http.StatusServiceUnavailable, "AI 服务未配置")
		return
	}

	tenantID := middleware.GetTenantID(c)

	// If record_id is provided and not forcing refresh, try cache first
	if req.RecordID > 0 && !req.Force {
		var cached model.AIAnalysis
		if err := h.db.Where("record_id = ? AND tenant_id = ?", req.RecordID, tenantID).First(&cached).Error; err == nil {
			// Found cached result — check if diagnosis matches
			if cached.Diagnosis == req.Diagnosis {
				Success(c, gin.H{"analysis": cached.Analysis, "cached": true})
				return
			}
		}
	}

	// Call DeepSeek API
	result, err := h.deepSeek.AnalyzeDiagnosis(req.Diagnosis)
	if err != nil {
		Error(c, http.StatusInternalServerError, "AI 分析失败，请稍后重试")
		return
	}

	// Persist result if record_id is provided
	if req.RecordID > 0 {
		analysis := model.AIAnalysis{
			RecordID:  req.RecordID,
			TenantID:  tenantID,
			Diagnosis: req.Diagnosis,
			Analysis:  result,
		}
		// Upsert: update if exists, create if not
		var existing model.AIAnalysis
		if err := h.db.Where("record_id = ? AND tenant_id = ?", req.RecordID, tenantID).First(&existing).Error; err == nil {
			h.db.Model(&existing).Updates(map[string]interface{}{
				"diagnosis": req.Diagnosis,
				"analysis":  result,
			})
		} else {
			h.db.Create(&analysis)
		}
	}

	Success(c, gin.H{"analysis": result, "cached": false})
}

// GetCached handles GET /api/v1/records/:id/ai-analysis
// Returns the cached AI analysis for a record, if any.
func (h *AIAnalysisHandler) GetCached(c *gin.Context) {
	recordID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "无效的记录 ID")
		return
	}

	tenantID := middleware.GetTenantID(c)

	var cached model.AIAnalysis
	if err := h.db.Where("record_id = ? AND tenant_id = ?", recordID, tenantID).First(&cached).Error; err != nil {
		// No cached result — return empty
		Success(c, gin.H{"analysis": nil})
		return
	}

	Success(c, gin.H{
		"analysis":  cached.Analysis,
		"diagnosis": cached.Diagnosis,
		"cached":    true,
	})
}
