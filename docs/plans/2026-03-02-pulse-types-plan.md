# 脉象功能实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在中医药模块下新增"脉象"CRUD功能，支持列表分页、搜索、分类筛选、新增/编辑/删除。

**Architecture:** 全局表（无租户隔离），纯手动维护（无AI回退）。后端 Go/Gin/GORM，前端 React/Ant Design。完全复用中药模块的模式。

**Tech Stack:** Go + Gin + GORM (backend), React 19 + TypeScript + Ant Design 6 (frontend)

---

### Task 1: Backend Model

**Files:**
- Create: `server/model/pulse.go`

**Step 1: Create the Pulse model**

```go
package model

import "time"

// Pulse represents a traditional Chinese medicine pulse type (global, no tenant_id).
type Pulse struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	Name             string    `gorm:"column:name;type:varchar(50);uniqueIndex;not null" json:"name"`
	Category         string    `gorm:"column:category;type:varchar(50);index" json:"category"`
	Description      string    `gorm:"column:description;type:text" json:"description"`
	ClinicalMeaning  string    `gorm:"column:clinical_meaning;type:text" json:"clinical_meaning"`
	CommonConditions string    `gorm:"column:common_conditions;type:text" json:"common_conditions"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (Pulse) TableName() string {
	return "pulses"
}
```

**Step 2: Register in AutoMigrate**

Modify `server/database/database.go` — add `&model.Pulse{}` to the AutoMigrate list, after `&model.AIAnalysis{}`.

**Step 3: Verify backend compiles**

Run: `cd server && go build ./...`
Expected: SUCCESS, no errors

**Step 4: Commit**

```bash
git add server/model/pulse.go server/database/database.go
git commit -m "feat: add Pulse model and database migration"
```

---

### Task 2: Backend Service

**Files:**
- Create: `server/service/pulse.go`

**Step 1: Create PulseService with all CRUD methods**

```go
package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrPulseNotFound = errors.New("pulse not found")

type PulseService struct {
	DB *gorm.DB
}

func NewPulseService(db *gorm.DB) *PulseService {
	return &PulseService{DB: db}
}

// Search searches pulses by name and/or category with pagination.
func (s *PulseService) Search(name, category string, page, size int) ([]model.Pulse, int64, error) {
	var pulses []model.Pulse
	var total int64

	query := s.DB.Model(&model.Pulse{})
	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}
	if category != "" {
		query = query.Where("category = ?", category)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("id ASC").Offset((page - 1) * size).Limit(size).Find(&pulses).Error; err != nil {
		return nil, 0, err
	}
	return pulses, total, nil
}

// ListCategories returns all distinct non-empty category values.
func (s *PulseService) ListCategories() ([]string, error) {
	var categories []string
	err := s.DB.Model(&model.Pulse{}).
		Where("category != ''").
		Distinct("category").
		Order("category").
		Pluck("category", &categories).Error
	return categories, err
}

// GetByID retrieves a single pulse by ID.
func (s *PulseService) GetByID(id uint64) (*model.Pulse, error) {
	var pulse model.Pulse
	if err := s.DB.First(&pulse, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPulseNotFound
		}
		return nil, err
	}
	return &pulse, nil
}

// Create creates a new pulse record.
func (s *PulseService) Create(pulse *model.Pulse) error {
	return s.DB.Create(pulse).Error
}

// Update updates allowed fields of a pulse by ID.
func (s *PulseService) Update(id uint64, updates map[string]interface{}) error {
	var pulse model.Pulse
	if err := s.DB.First(&pulse, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPulseNotFound
		}
		return err
	}
	if len(updates) == 0 {
		return nil
	}
	return s.DB.Model(&pulse).Updates(updates).Error
}

// DeleteByID deletes a pulse by ID.
func (s *PulseService) DeleteByID(id uint64) error {
	result := s.DB.Delete(&model.Pulse{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrPulseNotFound
	}
	return nil
}
```

**Step 2: Verify backend compiles**

Run: `cd server && go build ./...`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add server/service/pulse.go
git commit -m "feat: add PulseService with CRUD operations"
```

---

### Task 3: Backend Handler

**Files:**
- Create: `server/handler/pulse.go`

**Step 1: Create PulseHandler with all endpoints**

```go
package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PulseHandler struct {
	db *gorm.DB
}

func NewPulseHandler(db *gorm.DB) *PulseHandler {
	return &PulseHandler{db: db}
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

	svc := service.NewPulseService(h.db)
	pulses, total, err := svc.Search(name, category, page, size)
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
	svc := service.NewPulseService(h.db)
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

	svc := service.NewPulseService(h.db)
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

	svc := service.NewPulseService(h.db)
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

	svc := service.NewPulseService(h.db)
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

	svc := service.NewPulseService(h.db)
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
```

**Step 2: Verify backend compiles**

Run: `cd server && go build ./...`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add server/handler/pulse.go
git commit -m "feat: add PulseHandler with CRUD endpoints"
```

---

### Task 4: Backend Router

**Files:**
- Modify: `server/router/router.go`

**Step 1: Register pulse routes**

After the formula handler creation (line 44), add:
```go
pulseHandler := handler.NewPulseHandler(db)
```

After the formulas route group (line 158), add:
```go
// Pulse routes (global data, authenticated, no permission required for read).
pulses := authenticated.Group("/pulses")
{
    pulses.GET("", pulseHandler.List)
    pulses.GET("/categories", pulseHandler.Categories)
    pulses.GET("/:id", pulseHandler.Detail)
    pulses.POST("", middleware.RequirePermission(db, "role:manage"), pulseHandler.Create)
    pulses.PUT("/:id", middleware.RequirePermission(db, "role:manage"), pulseHandler.Update)
    pulses.DELETE("/:id", middleware.RequirePermission(db, "role:manage"), pulseHandler.Delete)
}
```

**Step 2: Verify backend compiles**

Run: `cd server && go build ./...`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add server/router/router.go
git commit -m "feat: register pulse API routes"
```

---

### Task 5: Frontend API Layer

**Files:**
- Create: `web/src/api/pulse.ts`

**Step 1: Create pulse API module**

```typescript
import request from '../utils/request';

export interface PulseListParams {
  name?: string;
  category?: string;
  page?: number;
  size?: number;
}

export interface PulseItem {
  id: number;
  name: string;
  category: string;
  description: string;
  clinical_meaning: string;
  common_conditions: string;
  created_at: string;
}

export function listPulses(params: PulseListParams) {
  return request.get('/pulses', { params });
}

export function getPulse(id: number) {
  return request.get(`/pulses/${id}`);
}

export function createPulse(data: Omit<PulseItem, 'id' | 'created_at'>) {
  return request.post('/pulses', data);
}

export function updatePulse(id: number, data: Partial<Omit<PulseItem, 'id' | 'created_at'>>) {
  return request.put(`/pulses/${id}`, data);
}

export function deletePulse(id: number) {
  return request.delete(`/pulses/${id}`);
}

export function listPulseCategories() {
  return request.get('/pulses/categories');
}
```

**Step 2: Commit**

```bash
git add web/src/api/pulse.ts
git commit -m "feat: add pulse API layer"
```

---

### Task 6: Frontend Pulse List Page

**Files:**
- Create: `web/src/pages/pulses/PulseList.tsx`

**Step 1: Create the PulseList page**

Follow HerbSearch.tsx pattern: search bar + category filter + paginated table + expandable row (view/edit) + new pulse modal + CRUD actions gated by `role:manage`. See `web/src/pages/herbs/HerbSearch.tsx` for exact patterns.

Key differences from HerbSearch:
- No `source` column (no AI)
- No AI refresh button
- Has a "新增" button that opens a Modal form
- Fields: name, category, description, clinical_meaning, common_conditions
- Column labels: 脉名, 分类, 特征描述, 临床意义, 常见病证

**Step 2: Verify frontend builds**

Run: `cd web && npm run build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add web/src/pages/pulses/PulseList.tsx
git commit -m "feat: add PulseList page with CRUD"
```

---

### Task 7: Frontend Routing & Navigation

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Layout.tsx`

**Step 1: Add route in App.tsx**

After the `FormulaSearch` import (line 18), add:
```typescript
import PulseList from './pages/pulses/PulseList';
```

After the formulas route (line 69), add:
```tsx
<Route path="pulses" element={<PulseList />} />
```

**Step 2: Add menu item in Layout.tsx**

Import `HeartOutlined` icon (add to the icon import line).

In `tcmChildren` array (after the 经络穴位 entry), add:
```typescript
{
  key: '/pulses',
  icon: <HeartOutlined />,
  label: '脉象',
},
```

In `selectedKeys` useMemo, add before the final `return`:
```typescript
if (path.startsWith('/pulses')) return ['/pulses'];
```

In `openKeys` useMemo, update the TCM condition:
```typescript
if (path.startsWith('/herbs') || path.startsWith('/formulas') || path.startsWith('/meridians') || path.startsWith('/pulses')) return ['/tcm'];
```

**Step 3: Verify frontend builds**

Run: `cd web && npm run build`
Expected: SUCCESS

**Step 4: Commit**

```bash
git add web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: add pulse route and navigation menu item"
```

---

### Task 8: Update Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/codebase.md` (if exists)

**Step 1: Update CLAUDE.md**

Add to 中医药表 section:
```
- `pulses` — 脉象（全局，无租户隔离）
```

Add to API 路由 section the new pulse endpoints.

Add `pulse:read` to 权限码 section.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add pulse feature to project documentation"
```
