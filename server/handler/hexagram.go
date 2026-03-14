package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type HexagramHandler struct {
	db *gorm.DB
}

func NewHexagramHandler(db *gorm.DB) *HexagramHandler {
	return &HexagramHandler{db: db}
}

func (h *HexagramHandler) List(c *gin.Context) {
	name := c.Query("name")
	upperTrigram := c.Query("upper_trigram")
	lowerTrigram := c.Query("lower_trigram")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewHexagramService(h.db)
	items, total, err := svc.Search(name, upperTrigram, lowerTrigram, page, size)
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to search hexagrams")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code": 0, "message": "success",
		"data": gin.H{"list": items, "total": total, "page": page, "size": size},
	})
}

func (h *HexagramHandler) Trigrams(c *gin.Context) {
	svc := service.NewHexagramService(h.db)
	trigrams, err := svc.ListTrigrams()
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to list trigrams")
		return
	}
	Success(c, trigrams)
}

func (h *HexagramHandler) Detail(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid hexagram id")
		return
	}
	svc := service.NewHexagramService(h.db)
	hexagram, err := svc.GetByID(id)
	if err != nil {
		if errors.Is(err, service.ErrHexagramNotFound) {
			Error(c, http.StatusNotFound, "hexagram not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to get hexagram")
		return
	}
	Success(c, hexagram)
}

func (h *HexagramHandler) Create(c *gin.Context) {
	var req struct {
		Number           int            `json:"number" binding:"required"`
		Name             string         `json:"name" binding:"required"`
		Symbol           string         `json:"symbol" binding:"required"`
		UpperTrigram     string         `json:"upper_trigram"`
		LowerTrigram     string         `json:"lower_trigram"`
		Judgment         string         `json:"judgment"`
		YaoTexts         datatypes.JSON `json:"yao_texts"`
		Commentary       string         `json:"commentary"`
		TcmApplication   string         `json:"tcm_application"`
		RelatedHexagrams datatypes.JSON `json:"related_hexagrams"`
		Description      string         `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}
	hexagram := model.Hexagram{
		Number: req.Number, Name: req.Name, Symbol: req.Symbol,
		UpperTrigram: req.UpperTrigram, LowerTrigram: req.LowerTrigram,
		Judgment: req.Judgment, YaoTexts: req.YaoTexts,
		Commentary: req.Commentary, TcmApplication: req.TcmApplication,
		RelatedHexagrams: req.RelatedHexagrams, Description: req.Description,
	}
	svc := service.NewHexagramService(h.db)
	if err := svc.Create(&hexagram); err != nil {
		Error(c, http.StatusInternalServerError, "failed to create hexagram")
		return
	}
	Created(c, hexagram)
}

func (h *HexagramHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid hexagram id")
		return
	}
	var req struct {
		Number           *int           `json:"number"`
		Name             *string        `json:"name"`
		Symbol           *string        `json:"symbol"`
		UpperTrigram     *string        `json:"upper_trigram"`
		LowerTrigram     *string        `json:"lower_trigram"`
		Judgment         *string        `json:"judgment"`
		YaoTexts         datatypes.JSON `json:"yao_texts"`
		Commentary       *string        `json:"commentary"`
		TcmApplication   *string        `json:"tcm_application"`
		RelatedHexagrams datatypes.JSON `json:"related_hexagrams"`
		Description      *string        `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body")
		return
	}
	updates := make(map[string]interface{})
	if req.Number != nil {
		updates["number"] = *req.Number
	}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Symbol != nil {
		updates["symbol"] = *req.Symbol
	}
	if req.UpperTrigram != nil {
		updates["upper_trigram"] = *req.UpperTrigram
	}
	if req.LowerTrigram != nil {
		updates["lower_trigram"] = *req.LowerTrigram
	}
	if req.Judgment != nil {
		updates["judgment"] = *req.Judgment
	}
	if req.YaoTexts != nil {
		updates["yao_texts"] = req.YaoTexts
	}
	if req.Commentary != nil {
		updates["commentary"] = *req.Commentary
	}
	if req.TcmApplication != nil {
		updates["tcm_application"] = *req.TcmApplication
	}
	if req.RelatedHexagrams != nil {
		updates["related_hexagrams"] = req.RelatedHexagrams
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}

	svc := service.NewHexagramService(h.db)
	if err := svc.Update(id, updates); err != nil {
		if errors.Is(err, service.ErrHexagramNotFound) {
			Error(c, http.StatusNotFound, "hexagram not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update hexagram")
		return
	}
	Success(c, nil)
}

func (h *HexagramHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid hexagram id")
		return
	}
	svc := service.NewHexagramService(h.db)
	if err := svc.DeleteByID(id); err != nil {
		if errors.Is(err, service.ErrHexagramNotFound) {
			Error(c, http.StatusNotFound, "hexagram not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to delete hexagram")
		return
	}
	Success(c, nil)
}
