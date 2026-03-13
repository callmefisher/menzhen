package handler

import (
	"encoding/json"
	"fmt"
	"log"
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
	cached := false
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
			if err := h.db.Model(&existing).Updates(map[string]interface{}{
				"diagnosis": req.Diagnosis,
				"analysis":  result,
			}).Error; err == nil {
				cached = true
			}
		} else {
			if err := h.db.Create(&analysis).Error; err == nil {
				cached = true
			}
		}
	}

	Success(c, gin.H{"analysis": result, "cached": cached})
}

// SaveCached handles POST /api/v1/records/:id/ai-analysis
// Directly saves an AI analysis result for a record (used when analysis was done before record was saved).
func (h *AIAnalysisHandler) SaveCached(c *gin.Context) {
	recordID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "无效的记录 ID")
		return
	}

	var req struct {
		Diagnosis string `json:"diagnosis" binding:"required"`
		Analysis  string `json:"analysis" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请提供诊断内容和分析结果")
		return
	}

	tenantID := middleware.GetTenantID(c)

	// Upsert: update if exists, create if not
	var existing model.AIAnalysis
	if err := h.db.Where("record_id = ? AND tenant_id = ?", recordID, tenantID).First(&existing).Error; err == nil {
		h.db.Model(&existing).Updates(map[string]interface{}{
			"diagnosis": req.Diagnosis,
			"analysis":  req.Analysis,
		})
	} else {
		h.db.Create(&model.AIAnalysis{
			RecordID:  recordID,
			TenantID:  tenantID,
			Diagnosis: req.Diagnosis,
			Analysis:  req.Analysis,
		})
	}

	Success(c, nil)
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

// AnalyzeStream handles POST /api/v1/ai/analyze-diagnosis-stream (SSE streaming).
// Same logic as Analyze but streams the response via SSE.
func (h *AIAnalysisHandler) AnalyzeStream(c *gin.Context) {
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
	userID := middleware.GetUserID(c)

	// If not forcing, try cache first
	if req.RecordID > 0 && !req.Force {
		var cached model.AIAnalysis
		if err := h.db.Where("record_id = ? AND tenant_id = ?", req.RecordID, tenantID).First(&cached).Error; err == nil {
			if cached.Diagnosis == req.Diagnosis {
				// Return cached result as a single SSE "cached" event
				c.Header("Content-Type", "text/event-stream")
				c.Header("Cache-Control", "no-cache")
				c.Header("Connection", "keep-alive")
				w := c.Writer
				data, _ := json.Marshal(map[string]interface{}{
					"type":     "cached",
					"analysis": cached.Analysis,
				})
				fmt.Fprintf(w, "data: %s\n\n", string(data))
				w.(http.Flusher).Flush()
				return
			}
		}
	}

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	w := c.Writer
	flusher := w.(http.Flusher)

	// Stream chunks to client
	fullContent, err := h.deepSeek.AnalyzeDiagnosisStream(req.Diagnosis, func(chunk string) error {
		data, _ := json.Marshal(map[string]interface{}{
			"type":    "chunk",
			"content": chunk,
		})
		_, writeErr := fmt.Fprintf(w, "data: %s\n\n", string(data))
		if writeErr != nil {
			return writeErr
		}
		flusher.Flush()
		return nil
	})

	if err != nil {
		log.Printf("AI analysis stream error: %v", err)
		errData, _ := json.Marshal(map[string]interface{}{
			"type":  "error",
			"error": "AI 分析失败，请稍后重试",
		})
		fmt.Fprintf(w, "data: %s\n\n", string(errData))
		flusher.Flush()
		return
	}

	// Persist result if record_id is provided
	if req.RecordID > 0 {
		analysis := model.AIAnalysis{
			RecordID:  req.RecordID,
			TenantID:  tenantID,
			Diagnosis: req.Diagnosis,
			Analysis:  fullContent,
		}
		var existing model.AIAnalysis
		if err := h.db.Where("record_id = ? AND tenant_id = ?", req.RecordID, tenantID).First(&existing).Error; err == nil {
			h.db.Model(&existing).Updates(map[string]interface{}{
				"diagnosis": req.Diagnosis,
				"analysis":  fullContent,
			})
		} else {
			h.db.Create(&analysis)
		}
	}

	// Send done event
	doneData, _ := json.Marshal(map[string]interface{}{
		"type":      "done",
		"analysis":  fullContent,
		"record_id": req.RecordID,
		"user_id":   userID,
	})
	fmt.Fprintf(w, "data: %s\n\n", string(doneData))
	flusher.Flush()
}

type tongueAnalysisRequest struct {
	Description string `json:"description" binding:"required"`
	RecordID    uint64 `json:"record_id"`
	Force       bool   `json:"force"`
}

// AnalyzeTongueStream handles POST /api/v1/ai/analyze-tongue-stream (SSE streaming).
func (h *AIAnalysisHandler) AnalyzeTongueStream(c *gin.Context) {
	var req tongueAnalysisRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请输入舌象描述")
		return
	}

	if !h.deepSeek.IsEnabled() {
		Error(c, http.StatusServiceUnavailable, "AI 服务未配置")
		return
	}

	tenantID := middleware.GetTenantID(c)

	// If record_id provided and not forcing, check cached tongue_analysis
	if req.RecordID > 0 && !req.Force {
		var record model.MedicalRecord
		if err := h.db.Where("id = ? AND tenant_id = ?", req.RecordID, tenantID).
			First(&record).Error; err == nil {
			if record.TongueAnalysis != "" {
				c.Header("Content-Type", "text/event-stream")
				c.Header("Cache-Control", "no-cache")
				c.Header("Connection", "keep-alive")
				w := c.Writer
				data, _ := json.Marshal(map[string]interface{}{
					"type":     "cached",
					"analysis": record.TongueAnalysis,
				})
				fmt.Fprintf(w, "data: %s\n\n", string(data))
				w.(http.Flusher).Flush()
				return
			}
		}
	}

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	w := c.Writer
	flusher := w.(http.Flusher)

	fullContent, err := h.deepSeek.AnalyzeTongueStream(req.Description, func(chunk string) error {
		data, _ := json.Marshal(map[string]interface{}{
			"type":    "chunk",
			"content": chunk,
		})
		_, writeErr := fmt.Fprintf(w, "data: %s\n\n", string(data))
		if writeErr != nil {
			return writeErr
		}
		flusher.Flush()
		return nil
	})

	if err != nil {
		log.Printf("Tongue analysis stream error: %v", err)
		errData, _ := json.Marshal(map[string]interface{}{
			"type":  "error",
			"error": "舌象分析失败，请稍后重试",
		})
		fmt.Fprintf(w, "data: %s\n\n", string(errData))
		flusher.Flush()
		return
	}

	// Cache result in medical_records.tongue_analysis if record_id provided
	if req.RecordID > 0 {
		h.db.Model(&model.MedicalRecord{}).
			Where("id = ? AND tenant_id = ?", req.RecordID, tenantID).
			Update("tongue_analysis", fullContent)
	}

	doneData, _ := json.Marshal(map[string]interface{}{
		"type":     "done",
		"analysis": fullContent,
	})
	fmt.Fprintf(w, "data: %s\n\n", string(doneData))
	flusher.Flush()
}

// AnalyzeTongue handles POST /api/v1/ai/analyze-tongue
func (h *AIAnalysisHandler) AnalyzeTongue(c *gin.Context) {
	var req tongueAnalysisRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请输入舌象描述")
		return
	}

	if !h.deepSeek.IsEnabled() {
		Error(c, http.StatusServiceUnavailable, "AI 服务未配置")
		return
	}

	tenantID := middleware.GetTenantID(c)

	// If record_id provided and not forcing, check cached tongue_analysis
	if req.RecordID > 0 && !req.Force {
		var record model.MedicalRecord
		if err := h.db.Where("id = ? AND tenant_id = ?", req.RecordID, tenantID).
			First(&record).Error; err == nil {
			if record.TongueAnalysis != "" {
				Success(c, gin.H{"analysis": record.TongueAnalysis, "cached": true})
				return
			}
		}
	}

	// Call DeepSeek API
	result, err := h.deepSeek.AnalyzeTongue(req.Description)
	if err != nil {
		Error(c, http.StatusInternalServerError, "舌象分析失败，请稍后重试")
		return
	}

	// Cache result in medical_records.tongue_analysis if record_id provided
	if req.RecordID > 0 {
		h.db.Model(&model.MedicalRecord{}).
			Where("id = ? AND tenant_id = ?", req.RecordID, tenantID).
			Update("tongue_analysis", result)
	}

	Success(c, gin.H{"analysis": result, "cached": false})
}
