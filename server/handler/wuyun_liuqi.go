package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// WuyunLiuqiHandler handles HTTP requests for Five Phases and Six Qi.
type WuyunLiuqiHandler struct {
	db       *gorm.DB
	deepSeek *service.DeepSeekService
}

func NewWuyunLiuqiHandler(db *gorm.DB, ds *service.DeepSeekService) *WuyunLiuqiHandler {
	return &WuyunLiuqiHandler{db: db, deepSeek: ds}
}

// Get handles GET /api/v1/wuyun-liuqi?year=2026
func (h *WuyunLiuqiHandler) Get(c *gin.Context) {
	yearStr := c.Query("year")
	year, err := strconv.Atoi(yearStr)
	if err != nil || year < 1 {
		Error(c, http.StatusBadRequest, "请提供有效的年份")
		return
	}

	svc := service.NewWuyunLiuqiService(h.db, h.deepSeek)
	record, err := svc.GetByYear(year)
	if err != nil {
		Error(c, http.StatusInternalServerError, "查询失败")
		return
	}

	if record == nil {
		Success(c, nil)
		return
	}
	Success(c, record)
}

// QueryStream handles POST /api/v1/wuyun-liuqi/query-stream (SSE streaming)
func (h *WuyunLiuqiHandler) QueryStream(c *gin.Context) {
	var req struct {
		Year  int  `json:"year" binding:"required"`
		Force bool `json:"force"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请提供有效的年份")
		return
	}

	svc := service.NewWuyunLiuqiService(h.db, h.deepSeek)

	// If not forcing, try cache first
	if !req.Force {
		record, err := svc.GetByYear(req.Year)
		if err != nil {
			Error(c, http.StatusInternalServerError, "查询失败")
			return
		}
		if record != nil {
			// Return cached result as a single SSE "cached" event
			c.Header("Content-Type", "text/event-stream")
			c.Header("Cache-Control", "no-cache")
			c.Header("Connection", "keep-alive")
			w := c.Writer
			data, _ := json.Marshal(map[string]interface{}{
				"type": "cached",
				"data": record,
			})
			fmt.Fprintf(w, "data: %s\n\n", string(data))
			w.(http.Flusher).Flush()
			return
		}
	}

	// AI query with streaming
	if !h.deepSeek.IsEnabled() {
		Error(c, http.StatusServiceUnavailable, "AI 服务未配置")
		return
	}

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	w := c.Writer
	flusher := w.(http.Flusher)

	userID := middleware.GetUserID(c)

	// Stream chunks to client
	fullContent, err := h.deepSeek.QueryWuyunLiuqiStream(req.Year, func(chunk string) error {
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
		log.Printf("WuyunLiuqi stream error: %v", err)
		errData, _ := json.Marshal(map[string]interface{}{
			"type":  "error",
			"error": "AI 查询失败，请稍后重试",
		})
		fmt.Fprintf(w, "data: %s\n\n", string(errData))
		flusher.Flush()
		return
	}

	// Save to DB
	record, saveErr := svc.SaveFromAI(req.Year, fullContent, userID)
	if saveErr != nil {
		log.Printf("WuyunLiuqi save error: %v", saveErr)
	}

	// Send done event with saved record
	doneData, _ := json.Marshal(map[string]interface{}{
		"type": "done",
		"data": record,
	})
	fmt.Fprintf(w, "data: %s\n\n", string(doneData))
	flusher.Flush()
}

// Update handles PUT /api/v1/wuyun-liuqi/:id
func (h *WuyunLiuqiHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "无效的 ID")
		return
	}

	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请提供内容")
		return
	}

	userID := middleware.GetUserID(c)
	svc := service.NewWuyunLiuqiService(h.db, h.deepSeek)
	if err := svc.Update(id, req.Content, userID); err != nil {
		if errors.Is(err, service.ErrWuyunLiuqiNotFound) {
			Error(c, http.StatusNotFound, "记录不存在")
			return
		}
		Error(c, http.StatusInternalServerError, "更新失败")
		return
	}
	Success(c, nil)
}

// Delete handles DELETE /api/v1/wuyun-liuqi/:id
func (h *WuyunLiuqiHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "无效的 ID")
		return
	}

	svc := service.NewWuyunLiuqiService(h.db, h.deepSeek)
	if err := svc.Delete(id); err != nil {
		if errors.Is(err, service.ErrWuyunLiuqiNotFound) {
			Error(c, http.StatusNotFound, "记录不存在")
			return
		}
		Error(c, http.StatusInternalServerError, "删除失败")
		return
	}
	Success(c, nil)
}
