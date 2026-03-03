package handler

import (
	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// MeridianResourceHandler handles HTTP requests for meridian resources.
type MeridianResourceHandler struct {
	db *gorm.DB
}

// NewMeridianResourceHandler creates a new MeridianResourceHandler.
func NewMeridianResourceHandler(db *gorm.DB) *MeridianResourceHandler {
	return &MeridianResourceHandler{db: db}
}

// Get returns the resource for a meridian by its ID.
func (h *MeridianResourceHandler) Get(c *gin.Context) {
	meridianID := c.Param("id")
	svc := service.NewMeridianResourceService(h.db)
	res, err := svc.GetByMeridianID(meridianID)
	if err != nil {
		Error(c, 500, "查询失败")
		return
	}
	if res == nil {
		Success(c, gin.H{
			"meridian_id": meridianID,
			"video_url":   "",
			"source_text": "",
		})
		return
	}
	Success(c, res)
}

// Update creates or updates the resource for a meridian.
func (h *MeridianResourceHandler) Update(c *gin.Context) {
	meridianID := c.Param("id")

	var req struct {
		VideoURL   string `json:"video_url"`
		SourceText string `json:"source_text"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	userID := middleware.GetUserID(c)
	svc := service.NewMeridianResourceService(h.db)
	res, err := svc.Upsert(meridianID, req.VideoURL, req.SourceText, userID)
	if err != nil {
		Error(c, 500, "保存失败")
		return
	}
	Success(c, res)
}
