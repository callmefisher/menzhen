package handler

import (
	"net/http"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
)

// AIAnalysisHandler handles AI-powered diagnosis analysis endpoints.
type AIAnalysisHandler struct {
	deepSeek *service.DeepSeekService
}

// NewAIAnalysisHandler creates a new AIAnalysisHandler.
func NewAIAnalysisHandler(ds *service.DeepSeekService) *AIAnalysisHandler {
	return &AIAnalysisHandler{deepSeek: ds}
}

type aiAnalysisRequest struct {
	Diagnosis string `json:"diagnosis" binding:"required"`
}

// Analyze handles POST /api/v1/ai/analyze-diagnosis
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

	result, err := h.deepSeek.AnalyzeDiagnosis(req.Diagnosis)
	if err != nil {
		Error(c, http.StatusInternalServerError, "AI 分析失败，请稍后重试")
		return
	}

	Success(c, gin.H{"analysis": result})
}
