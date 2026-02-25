package handler

import (
	"errors"
	"net/http"
	"strconv"

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
