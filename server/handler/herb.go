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
