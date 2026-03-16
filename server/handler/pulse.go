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

type PulseHandler struct {
	db       *gorm.DB
	deepSeek *service.DeepSeekService
}

func NewPulseHandler(db *gorm.DB, ds *service.DeepSeekService) *PulseHandler {
	return &PulseHandler{db: db, deepSeek: ds}
}

// List handles GET /api/v1/pulses?name=&category=&page=&size=
func (h *PulseHandler) List(c *gin.Context) {
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

	useAI := c.Query("ai") == "true"
	svc := service.NewPulseService(h.db, h.deepSeek)
	pulses, total, err := svc.Search(name, category, page, size, useAI)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to search pulses")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0, "message": "success",
		"data": gin.H{"list": pulses, "total": total, "page": page, "size": size},
	})
}

// Categories handles GET /api/v1/pulses/categories
func (h *PulseHandler) Categories(c *gin.Context) {
	svc := service.NewPulseService(h.db, nil)
	categories, err := svc.ListCategories()
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to list categories")
		return
	}
	Success(c, categories)
}

// Detail handles GET /api/v1/pulses/:id
func (h *PulseHandler) Detail(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid pulse id")
		return
	}

	svc := service.NewPulseService(h.db, nil)
	pulse, err := svc.GetByID(id)
	if err != nil {
		if errors.Is(err, service.ErrPulseNotFound) {
			Error(c, http.StatusNotFound, "pulse not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get pulse")
		return
	}
	Success(c, pulse)
}

// Create handles POST /api/v1/pulses
func (h *PulseHandler) Create(c *gin.Context) {
	var req struct {
		Name             string `json:"name" binding:"required"`
		Category         string `json:"category"`
		Description      string `json:"description"`
		ClinicalMeaning  string `json:"clinical_meaning"`
		CommonConditions string `json:"common_conditions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}

	pulse := model.Pulse{
		Name:             req.Name,
		Category:         req.Category,
		Description:      req.Description,
		ClinicalMeaning:  req.ClinicalMeaning,
		CommonConditions: req.CommonConditions,
	}

	svc := service.NewPulseService(h.db, nil)
	if err := svc.Create(&pulse); err != nil {
		Error(c, http.StatusInternalServerError, "failed to create pulse")
		return
	}
	Created(c, pulse)
}

// Update handles PUT /api/v1/pulses/:id
func (h *PulseHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid pulse id")
		return
	}

	var req struct {
		Name             *string `json:"name"`
		Category         *string `json:"category"`
		Description      *string `json:"description"`
		ClinicalMeaning  *string `json:"clinical_meaning"`
		CommonConditions *string `json:"common_conditions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Category != nil {
		updates["category"] = *req.Category
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.ClinicalMeaning != nil {
		updates["clinical_meaning"] = *req.ClinicalMeaning
	}
	if req.CommonConditions != nil {
		updates["common_conditions"] = *req.CommonConditions
	}

	svc := service.NewPulseService(h.db, nil)
	if err := svc.Update(id, updates); err != nil {
		if errors.Is(err, service.ErrPulseNotFound) {
			Error(c, http.StatusNotFound, "pulse not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update pulse")
		return
	}
	Success(c, nil)
}

// Delete handles DELETE /api/v1/pulses/:id
func (h *PulseHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid pulse id")
		return
	}

	svc := service.NewPulseService(h.db, nil)
	if err := svc.DeleteByID(id); err != nil {
		if errors.Is(err, service.ErrPulseNotFound) {
			Error(c, http.StatusNotFound, "pulse not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to delete pulse")
		return
	}
	Success(c, nil)
}
