# 易理（卦象）功能实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete "易理" (I Ching hexagrams) CRUD feature to the TCM clinic management system with card grid UI, drawer detail view, and 64 pre-seeded hexagrams.

**Architecture:** Single `hexagrams` table (global, no tenant_id) with JSON fields for yao texts and related hexagrams. Backend follows the Pulse model pattern (Go/Gin/GORM). Frontend uses card grid layout with Ant Design Drawer for detail/edit views.

**Tech Stack:** Go + Gin + GORM + datatypes.JSON (backend), React 19 + TypeScript + Ant Design 6 (frontend), Vitest + Testing Library (frontend tests), Go test + testify (backend tests)

**Spec:** `docs/plans/2026-03-14-yijing-hexagram-design.md`

---

## Chunk 1: Backend — Model, Service, Seed Data

### Task 1: Create Hexagram Model

**Files:**
- Create: `server/model/hexagram.go`

- [ ] **Step 1: Create the model file**

```go
package model

import (
	"time"

	"gorm.io/datatypes"
)

// Hexagram represents an I Ching hexagram (global data, no tenant_id).
type Hexagram struct {
	ID               uint64         `gorm:"primaryKey;autoIncrement" json:"id"`
	Number           int            `gorm:"column:number;uniqueIndex;not null" json:"number"`
	Name             string         `gorm:"column:name;type:varchar(20);uniqueIndex;not null" json:"name"`
	Symbol           string         `gorm:"column:symbol;type:varchar(20);not null" json:"symbol"`
	UpperTrigram     string         `gorm:"column:upper_trigram;type:varchar(10);index" json:"upper_trigram"`
	LowerTrigram     string         `gorm:"column:lower_trigram;type:varchar(10);index" json:"lower_trigram"`
	Judgment         string         `gorm:"column:judgment;type:text" json:"judgment"`
	YaoTexts         datatypes.JSON `gorm:"column:yao_texts;type:json" json:"yao_texts"`
	Commentary       string         `gorm:"column:commentary;type:text" json:"commentary"`
	TcmApplication   string         `gorm:"column:tcm_application;type:text" json:"tcm_application"`
	RelatedHexagrams datatypes.JSON `gorm:"column:related_hexagrams;type:json" json:"related_hexagrams"`
	Description      string         `gorm:"column:description;type:text" json:"description"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

func (Hexagram) TableName() string {
	return "hexagrams"
}
```

- [ ] **Step 2: Register in AutoMigrate**

Modify: `server/database/database.go:53` — add `&model.Hexagram{}` after `&model.SolarTerm{}`:

```go
		&model.SolarTerm{},
		&model.Hexagram{},
```

- [ ] **Step 3: Verify build**

Run: `cd server && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add server/model/hexagram.go server/database/database.go
git commit -m "feat: add Hexagram model and AutoMigrate"
```

---

### Task 2: Create Hexagram Service (TDD)

**Files:**
- Create: `server/service/hexagram.go`
- Create: `server/service/hexagram_test.go`

- [ ] **Step 1: Write failing tests**

```go
package service_test

import (
	"encoding/json"
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"gorm.io/datatypes"
)

func setupHexagramService(t *testing.T) *service.HexagramService {
	db := testutil.SetupTestDB(t)
	return service.NewHexagramService(db)
}

func makeYaoTextsJSON(t *testing.T) datatypes.JSON {
	yao := []map[string]interface{}{
		{"position": 1, "name": "初九", "text": "潜龙勿用"},
		{"position": 2, "name": "九二", "text": "见龙在田"},
		{"position": 3, "name": "九三", "text": "君子终日乾乾"},
		{"position": 4, "name": "九四", "text": "或跃在渊"},
		{"position": 5, "name": "九五", "text": "飞龙在天"},
		{"position": 6, "name": "上九", "text": "亢龙有悔"},
	}
	b, err := json.Marshal(yao)
	assert.NoError(t, err)
	return datatypes.JSON(b)
}

func seedHexagrams(t *testing.T, svc *service.HexagramService) []model.Hexagram {
	hexagrams := []model.Hexagram{
		{Number: 1, Name: "乾", Symbol: "☰☰", UpperTrigram: "乾", LowerTrigram: "乾", Judgment: "元亨利贞", YaoTexts: makeYaoTextsJSON(t)},
		{Number: 2, Name: "坤", Symbol: "☷☷", UpperTrigram: "坤", LowerTrigram: "坤", Judgment: "元亨，利牝马之贞"},
		{Number: 3, Name: "屯", Symbol: "☵☳", UpperTrigram: "坎", LowerTrigram: "震", Judgment: "元亨利贞，勿用有攸往"},
		{Number: 4, Name: "蒙", Symbol: "☶☵", UpperTrigram: "艮", LowerTrigram: "坎", Judgment: "亨。匪我求童蒙"},
	}
	for i := range hexagrams {
		err := svc.DB.Create(&hexagrams[i]).Error
		assert.NoError(t, err)
	}
	return hexagrams
}

func TestHexagramService_Search_All(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)

	items, total, err := svc.Search("", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(4), total)
	assert.Len(t, items, 4)
}

func TestHexagramService_Search_ByName(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)

	items, total, err := svc.Search("乾", "", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, items, 1)
	assert.Equal(t, "乾", items[0].Name)
}

func TestHexagramService_Search_ByUpperTrigram(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)

	items, total, err := svc.Search("", "坎", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "屯", items[0].Name)
}

func TestHexagramService_Search_ByLowerTrigram(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)

	items, total, err := svc.Search("", "", "坎", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "蒙", items[0].Name)
}

func TestHexagramService_Search_Pagination(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)

	items, total, err := svc.Search("", "", "", 1, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(4), total)
	assert.Len(t, items, 2)
}

func TestHexagramService_GetByID_Success(t *testing.T) {
	svc := setupHexagramService(t)
	seeded := seedHexagrams(t, svc)

	h, err := svc.GetByID(seeded[0].ID)
	assert.NoError(t, err)
	assert.Equal(t, "乾", h.Name)
	assert.Equal(t, 1, h.Number)
}

func TestHexagramService_GetByID_NotFound(t *testing.T) {
	svc := setupHexagramService(t)

	h, err := svc.GetByID(99999)
	assert.ErrorIs(t, err, service.ErrHexagramNotFound)
	assert.Nil(t, h)
}

func TestHexagramService_Create(t *testing.T) {
	svc := setupHexagramService(t)

	h := &model.Hexagram{
		Number: 5, Name: "需", Symbol: "☵☰",
		UpperTrigram: "坎", LowerTrigram: "乾",
		Judgment: "有孚，光亨，贞吉",
	}
	err := svc.Create(h)
	assert.NoError(t, err)
	assert.NotZero(t, h.ID)

	fetched, err := svc.GetByID(h.ID)
	assert.NoError(t, err)
	assert.Equal(t, "需", fetched.Name)
}

func TestHexagramService_Update(t *testing.T) {
	svc := setupHexagramService(t)
	seeded := seedHexagrams(t, svc)

	err := svc.Update(seeded[0].ID, map[string]interface{}{
		"description": "天行健，君子以自强不息",
	})
	assert.NoError(t, err)

	h, _ := svc.GetByID(seeded[0].ID)
	assert.Equal(t, "天行健，君子以自强不息", h.Description)
}

func TestHexagramService_Update_NotFound(t *testing.T) {
	svc := setupHexagramService(t)

	err := svc.Update(99999, map[string]interface{}{"description": "x"})
	assert.ErrorIs(t, err, service.ErrHexagramNotFound)
}

func TestHexagramService_Delete(t *testing.T) {
	svc := setupHexagramService(t)
	seeded := seedHexagrams(t, svc)

	err := svc.DeleteByID(seeded[0].ID)
	assert.NoError(t, err)

	_, err = svc.GetByID(seeded[0].ID)
	assert.ErrorIs(t, err, service.ErrHexagramNotFound)
}

func TestHexagramService_Delete_NotFound(t *testing.T) {
	svc := setupHexagramService(t)

	err := svc.DeleteByID(99999)
	assert.ErrorIs(t, err, service.ErrHexagramNotFound)
}

func TestHexagramService_ListTrigrams(t *testing.T) {
	svc := setupHexagramService(t)
	seedHexagrams(t, svc)

	trigrams, err := svc.ListTrigrams()
	assert.NoError(t, err)
	assert.Contains(t, trigrams, "乾")
	assert.Contains(t, trigrams, "坤")
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./service/ -run TestHexagram -v`
Expected: FAIL — `service.HexagramService` not defined

- [ ] **Step 3: Implement the service**

```go
package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrHexagramNotFound = errors.New("hexagram not found")

type HexagramService struct {
	DB *gorm.DB
}

func NewHexagramService(db *gorm.DB) *HexagramService {
	return &HexagramService{DB: db}
}

func (s *HexagramService) Search(name, upperTrigram, lowerTrigram string, page, size int) ([]model.Hexagram, int64, error) {
	var items []model.Hexagram
	var total int64

	query := s.DB.Model(&model.Hexagram{})
	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}
	if upperTrigram != "" {
		query = query.Where("upper_trigram = ?", upperTrigram)
	}
	if lowerTrigram != "" {
		query = query.Where("lower_trigram = ?", lowerTrigram)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("number ASC").Offset((page - 1) * size).Limit(size).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *HexagramService) ListTrigrams() ([]string, error) {
	// The 8 standard trigrams are fixed — return them directly.
	return []string{"乾", "坤", "震", "巽", "坎", "离", "艮", "兑"}, nil
}

func (s *HexagramService) GetByID(id uint64) (*model.Hexagram, error) {
	var h model.Hexagram
	if err := s.DB.First(&h, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrHexagramNotFound
		}
		return nil, err
	}
	return &h, nil
}

func (s *HexagramService) Create(h *model.Hexagram) error {
	return s.DB.Create(h).Error
}

func (s *HexagramService) Update(id uint64, updates map[string]interface{}) error {
	var h model.Hexagram
	if err := s.DB.First(&h, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrHexagramNotFound
		}
		return err
	}
	if len(updates) == 0 {
		return nil
	}
	return s.DB.Model(&h).Updates(updates).Error
}

func (s *HexagramService) DeleteByID(id uint64) error {
	var h model.Hexagram
	if err := s.DB.First(&h, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrHexagramNotFound
		}
		return err
	}
	return s.DB.Delete(&h).Error
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./service/ -run TestHexagram -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/service/hexagram.go server/service/hexagram_test.go
git commit -m "feat: add HexagramService with CRUD and tests"
```

---

### Task 3: Create Seed Data (JSON embed)

**Files:**
- Create: `server/database/hexagram_seed.json`
- Modify: `server/database/seed.go`

- [ ] **Step 1: Create the hexagram seed JSON file**

Create `server/database/hexagram_seed.json` with all 64 hexagrams. Each entry has: `number`, `name`, `symbol`, `upper_trigram`, `lower_trigram`, `judgment`, `yao_texts` (array of 6 objects).

The 64 hexagrams follow the King Wen sequence. The 8 trigrams and their symbols:
- 乾 ☰, 坤 ☷, 震 ☳, 巽 ☴, 坎 ☵, 离 ☲, 艮 ☶, 兑 ☱

Format per entry:
```json
{
  "number": 1,
  "name": "乾",
  "symbol": "☰☰",
  "upper_trigram": "乾",
  "lower_trigram": "乾",
  "judgment": "元亨利贞",
  "yao_texts": [
    {"position": 1, "name": "初九", "text": "潜龙勿用"},
    {"position": 2, "name": "九二", "text": "见龙在田，利见大人"},
    {"position": 3, "name": "九三", "text": "君子终日乾乾，夕惕若厉，无咎"},
    {"position": 4, "name": "九四", "text": "或跃在渊，无咎"},
    {"position": 5, "name": "九五", "text": "飞龙在天，利见大人"},
    {"position": 6, "name": "上九", "text": "亢龙有悔"}
  ]
}
```

Note: This is a large file (~64 entries). Implementor must include all 64 hexagrams with authentic 周易 data.

- [ ] **Step 2: Add embed and seed function to seed.go**

Modify `server/database/seed.go` imports to add `_ "embed"`, `"encoding/json"`, and `"gorm.io/datatypes"`:
```go
import (
	_ "embed"
	"encoding/json"
	"log"

	"github.com/callmefisher/menzhen/server/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)
```

Add the `//go:embed` directive and `var` declaration immediately after the import block (at package level, BEFORE the `Seed()` function). The `//go:embed` line must be directly above the `var` with no blank lines between:
```go
//go:embed hexagram_seed.json
var hexagramSeedJSON []byte

// seedHexagrams upserts all 64 hexagrams (creates new ones, skips existing).
func seedHexagrams(db *gorm.DB) {
	var seeds []struct {
		Number       int    `json:"number"`
		Name         string `json:"name"`
		Symbol       string `json:"symbol"`
		UpperTrigram string `json:"upper_trigram"`
		LowerTrigram string `json:"lower_trigram"`
		Judgment     string `json:"judgment"`
		YaoTexts     json.RawMessage `json:"yao_texts"`
	}
	if err := json.Unmarshal(hexagramSeedJSON, &seeds); err != nil {
		log.Printf("Warning: failed to parse hexagram seed data: %v", err)
		return
	}

	for _, s := range seeds {
		var existing model.Hexagram
		result := db.Where("name = ?", s.Name).First(&existing)
		if result.Error != nil {
			h := model.Hexagram{
				Number:       s.Number,
				Name:         s.Name,
				Symbol:       s.Symbol,
				UpperTrigram: s.UpperTrigram,
				LowerTrigram: s.LowerTrigram,
				Judgment:     s.Judgment,
				YaoTexts:     datatypes.JSON(s.YaoTexts),
			}
			if err := db.Create(&h).Error; err != nil {
				log.Printf("Warning: failed to create hexagram %s: %v", s.Name, err)
			}
		}
	}
	log.Println("Hexagram seed upsert completed")
}
```

- [ ] **Step 3: Call seedHexagrams from Seed()**

Modify `server/database/seed.go` — in the `Seed()` function (line 19), add before the final log:
```go
	seedSolarTerms(db)
	seedHexagrams(db)
	log.Println("Seed data check completed")
```

- [ ] **Step 4: Verify build**

Run: `cd server && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 5: Commit**

```bash
git add server/database/hexagram_seed.json server/database/seed.go
git commit -m "feat: add 64 hexagram seed data with JSON embed"
```

---

## Chunk 2: Backend — Handler (TDD), Router

### Task 4: Create Handler + Tests (TDD)

**Files:**
- Create: `server/handler/hexagram.go`
- Create: `server/handler/hexagram_handler_test.go`
- Modify: `server/handler/test_helpers_test.go`

- [ ] **Step 1: Create handler file `server/handler/hexagram.go`**

Full code in the handler file — follows Pulse handler pattern. Key differences: no DeepSeek, uses `upper_trigram`/`lower_trigram` instead of `category`, JSON fields for `yao_texts`/`related_hexagrams`.

```go
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

// List handles GET /api/v1/hexagrams?name=&upper_trigram=&lower_trigram=&page=&size=
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

// Trigrams handles GET /api/v1/hexagrams/trigrams
func (h *HexagramHandler) Trigrams(c *gin.Context) {
	svc := service.NewHexagramService(h.db)
	trigrams, err := svc.ListTrigrams()
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to list trigrams")
		return
	}
	Success(c, trigrams)
}

// Detail handles GET /api/v1/hexagrams/:id
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

// Create handles POST /api/v1/hexagrams
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
		Number:           req.Number,
		Name:             req.Name,
		Symbol:           req.Symbol,
		UpperTrigram:     req.UpperTrigram,
		LowerTrigram:     req.LowerTrigram,
		Judgment:         req.Judgment,
		YaoTexts:         req.YaoTexts,
		Commentary:       req.Commentary,
		TcmApplication:   req.TcmApplication,
		RelatedHexagrams: req.RelatedHexagrams,
		Description:      req.Description,
	}

	svc := service.NewHexagramService(h.db)
	if err := svc.Create(&hexagram); err != nil {
		Error(c, http.StatusInternalServerError, "failed to create hexagram")
		return
	}
	Created(c, hexagram)
}

// Update handles PUT /api/v1/hexagrams/:id
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

// Delete handles DELETE /api/v1/hexagrams/:id
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
```

- [ ] **Step 2: Register hexagram in `test_helpers_test.go`**

In `setupTestRouter()`, add after `solarTermHandler` init (line 36):
```go
	hexagramHandler := NewHexagramHandler(db)
```

Add hexagram routes after solarTerms group (before `return r`):
```go
	hexagrams := authed.Group("/hexagrams")
	hexagrams.GET("", hexagramHandler.List)
	hexagrams.GET("/trigrams", hexagramHandler.Trigrams)
	hexagrams.GET("/:id", hexagramHandler.Detail)
	hexagrams.POST("", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Create)
	hexagrams.PUT("/:id", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Update)
	hexagrams.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Delete)
```

- [ ] **Step 3: Write handler tests `server/handler/hexagram_handler_test.go`**

```go
package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func createTestHexagram(env *testEnv) float64 {
	body := map[string]interface{}{
		"number":        1,
		"name":          "乾",
		"symbol":        "☰☰",
		"upper_trigram": "乾",
		"lower_trigram": "乾",
		"judgment":      "元亨利贞",
		"yao_texts": []map[string]interface{}{
			{"position": 1, "name": "初九", "text": "潜龙勿用"},
			{"position": 2, "name": "九二", "text": "见龙在田"},
			{"position": 3, "name": "九三", "text": "君子终日乾乾"},
			{"position": 4, "name": "九四", "text": "或跃在渊"},
			{"position": 5, "name": "九五", "text": "飞龙在天"},
			{"position": 6, "name": "上九", "text": "亢龙有悔"},
		},
	}
	w := env.doRequest("POST", "/api/v1/hexagrams", body)
	result := parseJSON(w)
	data := result["data"].(map[string]interface{})
	return data["id"].(float64)
}

func TestHexagramHandler_Create_Success(t *testing.T) {
	env := setupTestEnv(t)
	body := map[string]interface{}{
		"number": 1, "name": "乾", "symbol": "☰☰",
		"upper_trigram": "乾", "lower_trigram": "乾", "judgment": "元亨利贞",
	}
	w := env.doRequest("POST", "/api/v1/hexagrams", body)
	assert.Equal(t, http.StatusCreated, w.Code)
	result := parseJSON(w)
	assert.Equal(t, float64(0), result["code"])
	data := result["data"].(map[string]interface{})
	assert.Equal(t, "乾", data["name"])
}

func TestHexagramHandler_Create_MissingName(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("POST", "/api/v1/hexagrams", map[string]interface{}{"number": 1, "symbol": "☰☰"})
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHexagramHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)
	createTestHexagram(env)
	w := env.doRequest("GET", "/api/v1/hexagrams", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	data := parseJSON(w)["data"].(map[string]interface{})
	list := data["list"].([]interface{})
	assert.Len(t, list, 1)
}

func TestHexagramHandler_List_SearchByName(t *testing.T) {
	env := setupTestEnv(t)
	createTestHexagram(env)
	w := env.doRequest("GET", "/api/v1/hexagrams?name=乾", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	data := parseJSON(w)["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["total"])
}

func TestHexagramHandler_Detail_Success(t *testing.T) {
	env := setupTestEnv(t)
	id := createTestHexagram(env)
	w := env.doRequest("GET", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)), nil)
	assert.Equal(t, http.StatusOK, w.Code)
	data := parseJSON(w)["data"].(map[string]interface{})
	assert.Equal(t, "乾", data["name"])
	yao := data["yao_texts"].([]interface{})
	assert.Len(t, yao, 6)
}

func TestHexagramHandler_Detail_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("GET", "/api/v1/hexagrams/99999", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHexagramHandler_Update_Success(t *testing.T) {
	env := setupTestEnv(t)
	id := createTestHexagram(env)
	w := env.doRequest("PUT", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)),
		map[string]interface{}{"description": "天行健，君子以自强不息"})
	assert.Equal(t, http.StatusOK, w.Code)
	w = env.doRequest("GET", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)), nil)
	data := parseJSON(w)["data"].(map[string]interface{})
	assert.Equal(t, "天行健，君子以自强不息", data["description"])
}

func TestHexagramHandler_Update_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("PUT", "/api/v1/hexagrams/99999", map[string]interface{}{"description": "x"})
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHexagramHandler_Delete_Success(t *testing.T) {
	env := setupTestEnv(t)
	id := createTestHexagram(env)
	w := env.doRequest("DELETE", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)), nil)
	assert.Equal(t, http.StatusOK, w.Code)
	w = env.doRequest("GET", fmt.Sprintf("/api/v1/hexagrams/%d", int(id)), nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHexagramHandler_Delete_NotFound(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("DELETE", "/api/v1/hexagrams/99999", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHexagramHandler_Trigrams(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequest("GET", "/api/v1/hexagrams/trigrams", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	data := parseJSON(w)["data"].([]interface{})
	assert.Len(t, data, 8)
	assert.Contains(t, data, "乾")
}

func TestHexagramHandler_NoAuth(t *testing.T) {
	env := setupTestEnv(t)
	w := env.doRequestNoAuth("GET", "/api/v1/hexagrams", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./handler/ -run TestHexagram -v`
Expected: ALL PASS

- [ ] **Step 5: Run full backend test suite**

Run: `cd server && go test ./...`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add server/handler/hexagram.go server/handler/hexagram_handler_test.go server/handler/test_helpers_test.go
git commit -m "feat: add hexagram handler with integration tests"
```

---

### Task 5: Register Routes

**Files:**
- Modify: `server/router/router.go`

- [ ] **Step 1: Add hexagram handler init**

After line 53 (`solarTermHandler := handler.NewSolarTermHandler(db)`), add:
```go
	hexagramHandler := handler.NewHexagramHandler(db)
```

- [ ] **Step 2: Add hexagram route group**

After the solar terms route group (after the `}` closing brace of the solarTerms group), add:
```go
	// Hexagram routes (global data, authenticated).
	hexagrams := authenticated.Group("/hexagrams")
	{
		hexagrams.GET("", hexagramHandler.List)
		hexagrams.GET("/trigrams", hexagramHandler.Trigrams)
		hexagrams.GET("/:id", hexagramHandler.Detail)
		hexagrams.POST("", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Create)
		hexagrams.PUT("/:id", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Update)
		hexagrams.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), hexagramHandler.Delete)
	}
```

- [ ] **Step 3: Verify build**

Run: `cd server && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add server/router/router.go
git commit -m "feat: register hexagram API routes"
```

---

## Chunk 3: Frontend — API, List Page, Drawer

### Task 7: Create Frontend API Service

**Files:**
- Create: `web/src/api/yijing.ts`

- [ ] **Step 1: Create the API service**

```typescript
import request from '../utils/request';

export interface YaoText {
  position: number;
  name: string;
  text: string;
}

export interface RelatedHexagrams {
  mutual: string;
  opposite: string;
  reverse: string;
}

export interface HexagramItem {
  id: number;
  number: number;
  name: string;
  symbol: string;
  upper_trigram: string;
  lower_trigram: string;
  judgment: string;
  yao_texts: YaoText[] | null;
  commentary: string;
  tcm_application: string;
  related_hexagrams: RelatedHexagrams | null;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface HexagramListParams {
  name?: string;
  upper_trigram?: string;
  lower_trigram?: string;
  page?: number;
  size?: number;
}

export function listHexagrams(params: HexagramListParams) {
  return request.get('/hexagrams', { params });
}

export function getHexagram(id: number) {
  return request.get(`/hexagrams/${id}`);
}

export function createHexagram(data: Partial<HexagramItem>) {
  return request.post('/hexagrams', data);
}

export function updateHexagram(id: number, data: Partial<HexagramItem>) {
  return request.put(`/hexagrams/${id}`, data);
}

export function deleteHexagram(id: number) {
  return request.delete(`/hexagrams/${id}`);
}

export function listTrigrams() {
  return request.get('/hexagrams/trigrams');
}
```

- [ ] **Step 2: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/api/yijing.ts
git commit -m "feat: add hexagram API service"
```

---

### Task 8: Create Hexagram Detail Drawer

**Files:**
- Create: `web/src/pages/yijing/HexagramDrawer.tsx`

- [ ] **Step 1: Create the drawer component**

This component receives a hexagram item, displays detail in tabs (概述/爻辞/传文/中医应用/关联卦), and supports edit mode.

Key patterns:
- `useIsMobile()` for responsive drawer width
- `hasPermission('role:manage')` for edit/delete buttons
- Tabs: Overview, Yao Texts, Commentary, TCM Application, Related Hexagrams
- Edit mode: toggles fields to editable Input/TextArea
- Markdown rendering for commentary and tcm_application (use `react-markdown` + `rehype-raw`)
- Mobile drawer width: `calc(100vw - 32px)`, desktop: 520px

Props interface:
```typescript
interface HexagramDrawerProps {
  hexagram: HexagramItem | null;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onNavigate: (name: string) => void;
}
```

Implementation details:
- State: `editing` (boolean), `editForm` (partial hexagram fields), `saving` (boolean)
- On save: call `updateHexagram(hexagram.id, editForm)`, then `onUpdate()` to refresh list
- On delete: `Popconfirm` → `deleteHexagram(hexagram.id)` → `onClose()` + `onUpdate()`
- Yao texts edit: 6 individual TextArea rows, each with label (初九/九二/etc.)
- Related hexagrams: display as clickable Tag elements, `onClick={() => onNavigate(name)}`

- [ ] **Step 2: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/yijing/HexagramDrawer.tsx
git commit -m "feat: add HexagramDrawer component with tabs and edit mode"
```

---

### Task 9: Create Hexagram List Page

**Files:**
- Create: `web/src/pages/yijing/YijingList.tsx`

- [ ] **Step 1: Create the list page**

Key patterns (follow PulseList.tsx structure):
- State: `hexagrams[]`, `loading`, `page`, `size`, `total`, `searchName`, `upperTrigram`, `lowerTrigram`, `trigrams[]` (for dropdown), `selectedHexagram`, `drawerOpen`, `createModalOpen`
- `useIsMobile()` for responsive layout
- `useAuth()` → `hasPermission('role:manage')` for create button
- On mount: fetch trigrams list + fetch hexagrams

Layout:
- Top row: `Input.Search` for name + 2x `Select` for upper/lower trigram + "新增" button (if admin)
- Card grid: `Row` + `Col` with `xs={12} md={6}` (2 cols mobile, 4 cols desktop)
- Each card: `Card hoverable onClick` → sets selectedHexagram + opens drawer
  - Card content: symbol (大号 32px font), 卦名, 第N卦, 上下卦标签
- Bottom: `Pagination` (mobile: `size="small" simple`)
- HexagramDrawer component for detail view

Create Modal:
- `Modal` with form fields: number, name, symbol, upper_trigram, lower_trigram, judgment
- On submit: `createHexagram(values)` → refresh list

- [ ] **Step 2: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/yijing/YijingList.tsx
git commit -m "feat: add YijingList page with card grid and drawer"
```

---

### Task 10: Register Route and Menu

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Layout.tsx`

- [ ] **Step 1: Add route to App.tsx**

Import:
```typescript
import YijingList from './pages/yijing/YijingList';
```

Add route (after the solar-terms route):
```tsx
<Route path="yijing" element={<YijingList />} />
```

- [ ] **Step 2: Add menu item to Layout.tsx**

Import `FileTextOutlined` from `@ant-design/icons` (avoid `BookOutlined` which is already used by 临床经验集, and `ReadOutlined` which is used by 方剂查询).

In the `tcmChildren` array, add after the 节气 entry:
```typescript
{
  key: '/yijing',
  icon: <FileTextOutlined />,
  label: '易理',
},
```

**IMPORTANT:** Also update the `openKeys` logic. Find the condition that checks TCM paths (e.g., `path.startsWith('/herbs') || ... || path.startsWith('/solar-terms')`) and add `|| path.startsWith('/yijing')` so the TCM submenu auto-expands when navigating to `/yijing`.

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: add yijing route and menu item"
```

---

## Chunk 4: Frontend Tests + Documentation

### Task 11: Frontend Tests

**Files:**
- Create: `web/src/pages/yijing/__tests__/YijingList.test.tsx`
- Create: `web/src/pages/yijing/__tests__/HexagramDrawer.test.tsx`

- [ ] **Step 1: Write YijingList tests**

Test cases:
1. Renders search bar and card grid
2. Displays hexagram cards with name and symbol
3. Clicking card opens drawer
4. Search filters results
5. Pagination works
6. Create button shows for admin users
7. Empty state when no results

Use `vi.mock('../../api/yijing')` to mock API calls. Follow existing test patterns in `src/pages/__tests__/`.

- [ ] **Step 2: Write HexagramDrawer tests**

Test cases:
1. Renders hexagram detail with tabs
2. Tab switching works (概述/爻辞/传文/中医应用/关联卦)
3. Edit button toggles edit mode (for admin)
4. Save calls updateHexagram API
5. Delete shows confirmation and calls deleteHexagram
6. Non-admin cannot see edit/delete buttons

- [ ] **Step 3: Run tests**

Run: `cd web && npm run test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/yijing/__tests__/
git commit -m "test: add YijingList and HexagramDrawer tests"
```

---

### Task 12: Update Documentation

**Files:**
- Modify: `docs/codebase.md` — add Hexagram model and API routes
- Modify: `CLAUDE.md` — add reference to design doc
- Modify: `README.md` — add 易理 to feature list

- [ ] **Step 1: Update docs/codebase.md**

Add to Data Models section:
```markdown
### Hexagram（卦象）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uint64 | PK |
| number | int | 卦序（1-64），唯一 |
| name | varchar(20) | 卦名，唯一 |
| symbol | varchar(20) | 卦象符号 |
| upper_trigram | varchar(10) | 上卦 |
| lower_trigram | varchar(10) | 下卦 |
| judgment | text | 卦辞 |
| yao_texts | JSON | 六爻爻辞 |
| commentary | text | 传文 |
| tcm_application | text | 中医应用阐述 |
| related_hexagrams | JSON | 关联卦（互/错/综） |
| description | text | 描述/注解 |
```

Add to API Routes section:
```markdown
### 卦象 Hexagram
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/hexagrams | 认证 | 列表（name/trigram搜索+分页） |
| GET | /api/v1/hexagrams/trigrams | 认证 | 八卦分类 |
| GET | /api/v1/hexagrams/:id | 认证 | 详情 |
| POST | /api/v1/hexagrams | role:manage | 创建 |
| PUT | /api/v1/hexagrams/:id | role:manage | 更新 |
| DELETE | /api/v1/hexagrams/:id | role:manage | 删除 |
```

- [ ] **Step 2: Update CLAUDE.md**

Add to 详细文档 section:
```markdown
- [易理卦象功能设计](docs/plans/2026-03-14-yijing-hexagram-design.md)
```

- [ ] **Step 3: Update README.md**

Add 易理（I Ching hexagrams）to the features list in README.md.

- [ ] **Step 4: Commit**

```bash
git add docs/codebase.md CLAUDE.md README.md
git commit -m "docs: update codebase docs with hexagram feature"
```

---

### Task 13: Build + Deploy

- [ ] **Step 1: Run full backend tests**

Run: `cd server && go test ./...`
Expected: ALL PASS

- [ ] **Step 2: Build frontend**

Run: `cd web && npm run build`
Expected: BUILD SUCCESS

- [ ] **Step 3: Deploy to Docker**

```bash
docker cp web/dist/. menzhen-web-1:/usr/share/nginx/html/
docker exec menzhen-nginx-1 nginx -s reload
```
