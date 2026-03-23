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

// FormulaHandler handles formula query endpoints.
type FormulaHandler struct {
	db       *gorm.DB
	deepSeek *service.DeepSeekService
}

// NewFormulaHandler creates a new FormulaHandler.
func NewFormulaHandler(db *gorm.DB, ds *service.DeepSeekService) *FormulaHandler {
	return &FormulaHandler{db: db, deepSeek: ds}
}

// Create handles POST /api/v1/formulas
func (h *FormulaHandler) Create(c *gin.Context) {
	var req struct {
		Name        string                  `json:"name" binding:"required"`
		Effects     string                  `json:"effects"`
		Indications string                  `json:"indications"`
		Notes       string                  `json:"notes"`
		Composition model.FormulaComposition `json:"composition"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}

	formula := model.Formula{
		Name:        req.Name,
		Effects:     req.Effects,
		Indications: req.Indications,
		Notes:       req.Notes,
		Composition: req.Composition,
		Source:      "manual",
	}

	svc := service.NewFormulaService(h.db, h.deepSeek)
	if err := svc.Create(&formula); err != nil {
		if errors.Is(err, service.ErrFormulaDuplicate) {
			Error(c, http.StatusConflict, "该方剂名称已存在")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to create formula")
		return
	}
	Created(c, formula)
}

// List handles GET /api/v1/formulas?name=&page=&size=
func (h *FormulaHandler) List(c *gin.Context) {
	name := c.Query("name")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewFormulaService(h.db, h.deepSeek)
	formulas, total, err := svc.Search(name, page, size)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to search formulas")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  formulas,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// FindPage handles GET /api/v1/formulas/:id/page — returns which page a formula is on.
func (h *FormulaHandler) FindPage(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "invalid formula id"})
		return
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewFormulaService(h.db, h.deepSeek)
	page, err := svc.FindFormulaPage(id, size)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"page": 1}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"page": page}})
}

// Detail handles GET /api/v1/formulas/:id
func (h *FormulaHandler) Detail(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid formula id")
		return
	}

	svc := service.NewFormulaService(h.db, h.deepSeek)
	formula, err := svc.GetByID(id)
	if err != nil {
		if errors.Is(err, service.ErrFormulaNotFound) {
			Error(c, http.StatusNotFound, "formula not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get formula")
		return
	}

	Success(c, formula)
}

// Delete handles DELETE /api/v1/formulas/:id
func (h *FormulaHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid formula id")
		return
	}

	svc := service.NewFormulaService(h.db, h.deepSeek)
	if err := svc.DeleteByID(id); err != nil {
		if errors.Is(err, service.ErrFormulaNotFound) {
			Error(c, http.StatusNotFound, "formula not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to delete formula")
		return
	}

	Success(c, nil)
}

// UpdateComposition handles PUT /api/v1/formulas/:id/composition
func (h *FormulaHandler) UpdateComposition(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid formula id")
		return
	}

	var req struct {
		Composition model.FormulaComposition `json:"composition" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}

	svc := service.NewFormulaService(h.db, h.deepSeek)
	if err := svc.UpdateComposition(id, req.Composition); err != nil {
		if errors.Is(err, service.ErrFormulaNotFound) {
			Error(c, http.StatusNotFound, "formula not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update composition")
		return
	}

	Success(c, nil)
}

// UpdateName handles PUT /api/v1/formulas/:id/name
func (h *FormulaHandler) UpdateName(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid formula id")
		return
	}

	var req struct {
		Name string `json:"name" binding:"required,max=100"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body: name is required and max 100 chars")
		return
	}

	svc := service.NewFormulaService(h.db, h.deepSeek)
	if err := svc.UpdateName(id, req.Name); err != nil {
		if errors.Is(err, service.ErrFormulaNotFound) {
			Error(c, http.StatusNotFound, "formula not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update formula name")
		return
	}

	Success(c, nil)
}

// UpdateNotes handles PUT /api/v1/formulas/:id/notes
func (h *FormulaHandler) UpdateNotes(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid formula id")
		return
	}

	var req struct {
		Notes string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}

	svc := service.NewFormulaService(h.db, h.deepSeek)
	if err := svc.UpdateNotes(id, req.Notes); err != nil {
		if errors.Is(err, service.ErrFormulaNotFound) {
			Error(c, http.StatusNotFound, "formula not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update formula notes")
		return
	}

	Success(c, nil)
}
