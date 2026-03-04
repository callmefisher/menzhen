package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ClinicalExperienceHandler struct {
	db *gorm.DB
}

func NewClinicalExperienceHandler(db *gorm.DB) *ClinicalExperienceHandler {
	return &ClinicalExperienceHandler{db: db}
}

// List handles GET /api/v1/clinical-experiences?keyword=&category=&page=&size=
func (h *ClinicalExperienceHandler) List(c *gin.Context) {
	keyword := c.Query("keyword")
	category := c.Query("category")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewClinicalExperienceService(h.db)
	items, total, err := svc.Search(keyword, category, page, size)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to search clinical experiences")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0, "message": "success",
		"data": gin.H{"list": items, "total": total, "page": page, "size": size},
	})
}

// Categories handles GET /api/v1/clinical-experiences/categories
func (h *ClinicalExperienceHandler) Categories(c *gin.Context) {
	svc := service.NewClinicalExperienceService(h.db)
	categories, err := svc.ListCategories()
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to list categories")
		return
	}
	Success(c, categories)
}

// Detail handles GET /api/v1/clinical-experiences/:id
func (h *ClinicalExperienceHandler) Detail(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	svc := service.NewClinicalExperienceService(h.db)
	item, err := svc.GetByID(id)
	if err != nil {
		if errors.Is(err, service.ErrClinicalExperienceNotFound) {
			Error(c, http.StatusNotFound, "clinical experience not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get clinical experience")
		return
	}
	Success(c, item)
}

// Create handles POST /api/v1/clinical-experiences
func (h *ClinicalExperienceHandler) Create(c *gin.Context) {
	var req struct {
		Source     string `json:"source"`
		Category   string `json:"category"`
		Herbs      string `json:"herbs"`
		Formula    string `json:"formula"`
		Experience string `json:"experience" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}

	item := model.ClinicalExperience{
		Source:     req.Source,
		Category:   req.Category,
		Herbs:      req.Herbs,
		Formula:    req.Formula,
		Experience: req.Experience,
	}

	svc := service.NewClinicalExperienceService(h.db)
	if err := svc.Create(&item); err != nil {
		Error(c, http.StatusInternalServerError, "failed to create clinical experience")
		return
	}
	Created(c, item)
}

// Update handles PUT /api/v1/clinical-experiences/:id
func (h *ClinicalExperienceHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	var req struct {
		Source     *string `json:"source"`
		Category   *string `json:"category"`
		Herbs      *string `json:"herbs"`
		Formula    *string `json:"formula"`
		Experience *string `json:"experience"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}

	updates := make(map[string]interface{})
	if req.Source != nil {
		updates["source"] = *req.Source
	}
	if req.Category != nil {
		updates["category"] = *req.Category
	}
	if req.Herbs != nil {
		updates["herbs"] = *req.Herbs
	}
	if req.Formula != nil {
		updates["formula"] = *req.Formula
	}
	if req.Experience != nil {
		updates["experience"] = *req.Experience
	}

	svc := service.NewClinicalExperienceService(h.db)
	if err := svc.Update(id, updates); err != nil {
		if errors.Is(err, service.ErrClinicalExperienceNotFound) {
			Error(c, http.StatusNotFound, "clinical experience not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update clinical experience")
		return
	}
	Success(c, nil)
}

// Delete handles DELETE /api/v1/clinical-experiences/:id
func (h *ClinicalExperienceHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	svc := service.NewClinicalExperienceService(h.db)
	if err := svc.DeleteByID(id); err != nil {
		if errors.Is(err, service.ErrClinicalExperienceNotFound) {
			Error(c, http.StatusNotFound, "clinical experience not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to delete clinical experience")
		return
	}
	Success(c, nil)
}
