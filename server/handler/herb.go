package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// HerbHandler handles herb query endpoints.
type HerbHandler struct {
	db       *gorm.DB
	deepSeek *service.DeepSeekService
}

// NewHerbHandler creates a new HerbHandler.
func NewHerbHandler(db *gorm.DB, ds *service.DeepSeekService) *HerbHandler {
	return &HerbHandler{db: db, deepSeek: ds}
}

// List handles GET /api/v1/herbs?name=&category=&page=&size=
func (h *HerbHandler) List(c *gin.Context) {
	name := c.Query("name")
	category := c.Query("category")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewHerbService(h.db, h.deepSeek)
	herbs, total, err := svc.Search(name, category, page, size)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to search herbs")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  herbs,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// Categories handles GET /api/v1/herbs/categories
func (h *HerbHandler) Categories(c *gin.Context) {
	svc := service.NewHerbService(h.db, h.deepSeek)
	categories, err := svc.ListCategories()
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to list categories")
		return
	}

	Success(c, categories)
}

// Detail handles GET /api/v1/herbs/:id
func (h *HerbHandler) Detail(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid herb id")
		return
	}

	svc := service.NewHerbService(h.db, h.deepSeek)
	herb, err := svc.GetByID(id)
	if err != nil {
		if errors.Is(err, service.ErrHerbNotFound) {
			Error(c, http.StatusNotFound, "herb not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get herb")
		return
	}

	Success(c, herb)
}

// Delete handles DELETE /api/v1/herbs/:id
func (h *HerbHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid herb id")
		return
	}

	svc := service.NewHerbService(h.db, h.deepSeek)
	if err := svc.DeleteByID(id); err != nil {
		if errors.Is(err, service.ErrHerbNotFound) {
			Error(c, http.StatusNotFound, "herb not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to delete herb")
		return
	}

	Success(c, nil)
}

// Update handles PUT /api/v1/herbs/:id
func (h *HerbHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid herb id")
		return
	}

	var req struct {
		Name        *string `json:"name"`
		Alias       *string `json:"alias"`
		Category    *string `json:"category"`
		Properties  *string `json:"properties"`
		Effects     *string `json:"effects"`
		Indications *string `json:"indications"`
		Origin      *string `json:"origin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}

	// Build updates map from non-nil fields (whitelist)
	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Alias != nil {
		updates["alias"] = *req.Alias
	}
	if req.Category != nil {
		updates["category"] = *req.Category
	}
	if req.Properties != nil {
		updates["properties"] = *req.Properties
	}
	if req.Effects != nil {
		updates["effects"] = *req.Effects
	}
	if req.Indications != nil {
		updates["indications"] = *req.Indications
	}
	if req.Origin != nil {
		updates["origin"] = *req.Origin
	}

	svc := service.NewHerbService(h.db, h.deepSeek)
	if err := svc.Update(id, updates); err != nil {
		if errors.Is(err, service.ErrHerbNotFound) {
			Error(c, http.StatusNotFound, "herb not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update herb")
		return
	}

	Success(c, nil)
}

// AIRefresh handles POST /api/v1/herbs/:id/ai-refresh
// Queries DeepSeek for updated herb information and merges it into the existing record.
func (h *HerbHandler) AIRefresh(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid herb id")
		return
	}

	svc := service.NewHerbService(h.db, h.deepSeek)
	herb, err := svc.AIRefresh(id)
	if err != nil {
		if errors.Is(err, service.ErrHerbNotFound) {
			Error(c, http.StatusNotFound, "herb not found")
			return
		}
		Error(c, http.StatusInternalServerError, "AI查询失败: "+err.Error())
		return
	}

	Success(c, herb)
}
