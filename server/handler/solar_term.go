package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SolarTermHandler struct {
	db *gorm.DB
}

func NewSolarTermHandler(db *gorm.DB) *SolarTermHandler {
	return &SolarTermHandler{db: db}
}

// List handles GET /api/v1/solar-terms
func (h *SolarTermHandler) List(c *gin.Context) {
	svc := service.NewSolarTermService(h.db)
	terms, err := svc.List()
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to list solar terms")
		return
	}
	Success(c, terms)
}

// Update handles PUT /api/v1/solar-terms/:id
func (h *SolarTermHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	var req struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}

	svc := service.NewSolarTermService(h.db)
	term, err := svc.UpdateContent(id, req.Content)
	if err != nil {
		if errors.Is(err, service.ErrSolarTermNotFound) {
			Error(c, http.StatusNotFound, "solar term not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update solar term")
		return
	}
	Success(c, term)
}

// DeleteContent handles DELETE /api/v1/solar-terms/:id/content
func (h *SolarTermHandler) DeleteContent(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid id")
		return
	}

	svc := service.NewSolarTermService(h.db)
	if err := svc.DeleteContent(id); err != nil {
		if errors.Is(err, service.ErrSolarTermNotFound) {
			Error(c, http.StatusNotFound, "solar term not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to delete solar term content")
		return
	}
	Success(c, nil)
}
