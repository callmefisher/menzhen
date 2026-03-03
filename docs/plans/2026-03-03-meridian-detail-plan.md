# Meridian Detail Enhancement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add special acupoint attributes (五输穴, 原穴, 络穴, 母穴, 子穴) to each meridian, add backend-stored video/source content with admin editing, and create a detail drawer UI.

**Architecture:** Frontend static data for acupoint attributes (fixed TCM knowledge), backend CRUD for meridian video/source resources. New `MeridianDetailDrawer` component integrates with existing 3D visualization page via info button on each meridian in the left panel.

**Tech Stack:** Go/Gin/GORM (backend), React/TypeScript/Ant Design (frontend), existing auth/RBAC system

---

### Task 1: Add SpecialPointType to frontend types

**Files:**
- Modify: `web/src/pages/meridians/data/types.ts`

**Step 1: Update types.ts with SpecialPointType and MeridianData.specialPoints**

```typescript
// Add after AcupointData interface (line 23):

export type SpecialPointType =
  | '井穴' | '荥穴' | '输穴' | '经穴' | '合穴'
  | '原穴' | '络穴' | '母穴' | '子穴';

// Add to MeridianData interface (after internalPath field, line 10):
  specialPoints?: Partial<Record<SpecialPointType, string>>;
```

**Step 2: Verify no build errors**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
feat: add SpecialPointType to meridian data types
```

---

### Task 2: Add specialPoints data to all 12 regular meridians

**Files:**
- Modify: `web/src/pages/meridians/data/meridians.ts`

**Step 1: Add specialPoints to each of the 12 regular meridians**

Data to add (from TCM standard reference):

```typescript
// LU 肺经
specialPoints: {
  '井穴': 'LU11', '荥穴': 'LU10', '输穴': 'LU9', '经穴': 'LU8', '合穴': 'LU5',
  '原穴': 'LU9', '络穴': 'LU7', '母穴': 'LU9', '子穴': 'LU5',
},

// LI 大肠经
specialPoints: {
  '井穴': 'LI1', '荥穴': 'LI2', '输穴': 'LI3', '经穴': 'LI5', '合穴': 'LI11',
  '原穴': 'LI4', '络穴': 'LI6', '母穴': 'LI11', '子穴': 'LI2',
},

// ST 胃经
specialPoints: {
  '井穴': 'ST45', '荥穴': 'ST44', '输穴': 'ST43', '经穴': 'ST41', '合穴': 'ST36',
  '原穴': 'ST42', '络穴': 'ST40', '母穴': 'ST41', '子穴': 'ST45',
},

// SP 脾经
specialPoints: {
  '井穴': 'SP1', '荥穴': 'SP2', '输穴': 'SP3', '经穴': 'SP5', '合穴': 'SP9',
  '原穴': 'SP3', '络穴': 'SP4', '母穴': 'SP2', '子穴': 'SP5',
},

// HT 心经
specialPoints: {
  '井穴': 'HT9', '荥穴': 'HT8', '输穴': 'HT7', '经穴': 'HT4', '合穴': 'HT3',
  '原穴': 'HT7', '络穴': 'HT5', '母穴': 'HT9', '子穴': 'HT7',
},

// SI 小肠经
specialPoints: {
  '井穴': 'SI1', '荥穴': 'SI2', '输穴': 'SI3', '经穴': 'SI5', '合穴': 'SI8',
  '原穴': 'SI4', '络穴': 'SI7', '母穴': 'SI3', '子穴': 'SI8',
},

// BL 膀胱经
specialPoints: {
  '井穴': 'BL67', '荥穴': 'BL66', '输穴': 'BL65', '经穴': 'BL60', '合穴': 'BL40',
  '原穴': 'BL64', '络穴': 'BL58', '母穴': 'BL67', '子穴': 'BL40',
},

// KI 肾经
specialPoints: {
  '井穴': 'KI1', '荥穴': 'KI2', '输穴': 'KI3', '经穴': 'KI7', '合穴': 'KI10',
  '原穴': 'KI3', '络穴': 'KI4', '母穴': 'KI7', '子穴': 'KI1',
},

// PC 心包经
specialPoints: {
  '井穴': 'PC9', '荥穴': 'PC8', '输穴': 'PC7', '经穴': 'PC5', '合穴': 'PC3',
  '原穴': 'PC7', '络穴': 'PC6', '母穴': 'PC9', '子穴': 'PC7',
},

// TE 三焦经
specialPoints: {
  '井穴': 'TE1', '荥穴': 'TE2', '输穴': 'TE3', '经穴': 'TE6', '合穴': 'TE10',
  '原穴': 'TE4', '络穴': 'TE5', '母穴': 'TE3', '子穴': 'TE10',
},

// GB 胆经
specialPoints: {
  '井穴': 'GB44', '荥穴': 'GB43', '输穴': 'GB41', '经穴': 'GB38', '合穴': 'GB34',
  '原穴': 'GB40', '络穴': 'GB37', '母穴': 'GB43', '子穴': 'GB38',
},

// LR 肝经
specialPoints: {
  '井穴': 'LR1', '荥穴': 'LR2', '输穴': 'LR3', '经穴': 'LR4', '合穴': 'LR8',
  '原穴': 'LR3', '络穴': 'LR5', '母穴': 'LR8', '子穴': 'LR2',
},
```

Note: RN (任脉), DU (督脉), and the 6 extraordinary meridians do NOT get specialPoints.

**Step 2: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
feat: add special acupoint attributes for all 12 regular meridians
```

---

### Task 3: Backend — MeridianResource model

**Files:**
- Create: `server/model/meridian_resource.go`
- Modify: `server/database/database.go:32-49` (add to AutoMigrate list)

**Step 1: Create model file**

```go
// server/model/meridian_resource.go
package model

import "time"

type MeridianResource struct {
	ID         uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	MeridianID string    `gorm:"column:meridian_id;type:varchar(10);uniqueIndex;not null" json:"meridian_id"`
	VideoURL   string    `gorm:"column:video_url;type:text" json:"video_url"`
	SourceText string    `gorm:"column:source_text;type:text" json:"source_text"`
	UpdatedBy  uint64    `gorm:"column:updated_by" json:"updated_by"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (MeridianResource) TableName() string {
	return "meridian_resources"
}
```

**Step 2: Add to AutoMigrate in `server/database/database.go`**

Add `&model.MeridianResource{},` after `&model.Pulse{},` (line 48).

**Step 3: Verify build**

Run: `cd server && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```
feat: add MeridianResource model and migration
```

---

### Task 4: Backend — MeridianResource service

**Files:**
- Create: `server/service/meridian_resource.go`

**Step 1: Create service file**

```go
// server/service/meridian_resource.go
package service

import (
	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

type MeridianResourceService struct {
	DB *gorm.DB
}

func NewMeridianResourceService(db *gorm.DB) *MeridianResourceService {
	return &MeridianResourceService{DB: db}
}

func (s *MeridianResourceService) GetByMeridianID(meridianID string) (*model.MeridianResource, error) {
	var res model.MeridianResource
	err := s.DB.Where("meridian_id = ?", meridianID).First(&res).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	return &res, err
}

func (s *MeridianResourceService) Upsert(meridianID string, videoURL string, sourceText string, userID uint64) (*model.MeridianResource, error) {
	var res model.MeridianResource
	err := s.DB.Where("meridian_id = ?", meridianID).First(&res).Error

	if err == gorm.ErrRecordNotFound {
		res = model.MeridianResource{
			MeridianID: meridianID,
			VideoURL:   videoURL,
			SourceText: sourceText,
			UpdatedBy:  userID,
		}
		if err := s.DB.Create(&res).Error; err != nil {
			return nil, err
		}
		return &res, nil
	}
	if err != nil {
		return nil, err
	}

	res.VideoURL = videoURL
	res.SourceText = sourceText
	res.UpdatedBy = userID
	if err := s.DB.Save(&res).Error; err != nil {
		return nil, err
	}
	return &res, nil
}
```

**Step 2: Verify build**

Run: `cd server && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```
feat: add MeridianResource service with get and upsert
```

---

### Task 5: Backend — MeridianResource handler

**Files:**
- Create: `server/handler/meridian_resource.go`

**Step 1: Create handler file**

```go
// server/handler/meridian_resource.go
package handler

import (
	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type MeridianResourceHandler struct {
	db *gorm.DB
}

func NewMeridianResourceHandler(db *gorm.DB) *MeridianResourceHandler {
	return &MeridianResourceHandler{db: db}
}

func (h *MeridianResourceHandler) Get(c *gin.Context) {
	meridianID := c.Param("id")
	svc := service.NewMeridianResourceService(h.db)
	res, err := svc.GetByMeridianID(meridianID)
	if err != nil {
		Error(c, 500, "查询失败")
		return
	}
	if res == nil {
		Success(c, gin.H{
			"meridian_id": meridianID,
			"video_url":   "",
			"source_text": "",
		})
		return
	}
	Success(c, res)
}

func (h *MeridianResourceHandler) Update(c *gin.Context) {
	meridianID := c.Param("id")

	var req struct {
		VideoURL   string `json:"video_url"`
		SourceText string `json:"source_text"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, 400, "参数错误")
		return
	}

	userID := middleware.GetUserID(c)
	svc := service.NewMeridianResourceService(h.db)
	res, err := svc.Upsert(meridianID, req.VideoURL, req.SourceText, userID)
	if err != nil {
		Error(c, 500, "保存失败")
		return
	}
	Success(c, res)
}
```

**Step 2: Verify build**

Run: `cd server && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```
feat: add MeridianResource handler with GET and PUT endpoints
```

---

### Task 6: Backend — Register routes

**Files:**
- Modify: `server/router/router.go`

**Step 1: Add handler creation**

After `aiAnalysisHandler := handler.NewAIAnalysisHandler(...)` (line 48), add:
```go
meridianResourceHandler := handler.NewMeridianResourceHandler(db)
```

**Step 2: Add route group**

After the pulses route group (line 170), add:
```go
// Meridian resource routes (global data, authenticated).
meridianRes := authenticated.Group("/meridians")
{
    meridianRes.GET("/:id/resource", meridianResourceHandler.Get)
    meridianRes.PUT("/:id/resource", middleware.RequirePermission(db, "role:manage"), meridianResourceHandler.Update)
}
```

**Step 3: Verify build**

Run: `cd server && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```
feat: register meridian resource API routes
```

---

### Task 7: Frontend — API client for meridian resources

**Files:**
- Create: `web/src/api/meridian.ts`

**Step 1: Create API file**

```typescript
import request from '../utils/request';

export interface MeridianResource {
  meridian_id: string;
  video_url: string;
  source_text: string;
  updated_by?: number;
  updated_at?: string;
}

export function getMeridianResource(meridianId: string) {
  return request.get<MeridianResource>(`/meridians/${meridianId}/resource`);
}

export function updateMeridianResource(meridianId: string, data: { video_url: string; source_text: string }) {
  return request.put(`/meridians/${meridianId}/resource`, data);
}
```

**Step 2: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
feat: add meridian resource API client
```

---

### Task 8: Frontend — MeridianDetailDrawer component

**Files:**
- Create: `web/src/pages/meridians/MeridianDetailDrawer.tsx`

**Step 1: Create the drawer component**

This is the main UI component. Key features:
- Receives `meridian: MeridianData | null` and `open: boolean`
- Shows special acupoint tags (clickable → navigate to acupoint in 3D)
- Fetches video/source from API on open
- Admin sees edit buttons for video URL and source text
- Dark theme matching existing 3D page (`#1a1a2e` background tones)
- Uses Ant Design `Drawer`, `Tag`, `Modal`, `Input`, `Button`, `Spin`, `message`

Component structure:
```typescript
interface MeridianDetailDrawerProps {
  meridian: MeridianData | null;
  open: boolean;
  onClose: () => void;
  onAcupointNavigate: (acupoint: AcupointData) => void;
  isMobile?: boolean;
}
```

Sections:
1. **Header** — Meridian color bar with name and description
2. **Special Points** — Two groups: 五输穴 (井荥输经合) and 其他 (原络母子), each as clickable Tags showing "类型: 穴名(代码)"
3. **Video** — HTML5 video player or "暂无视频" placeholder. Admin: edit button → Modal with URL input
4. **Source** — Text display or "暂无出处介绍" placeholder. Admin: edit button → Modal with TextArea

Uses `useAuth()` to check `hasPermission('role:manage')` for showing edit buttons.
Uses `useEffect` to fetch resource when `meridian` changes and drawer is open.

**Step 2: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```
feat: add MeridianDetailDrawer component
```

---

### Task 9: Frontend — Integrate drawer into MeridianPanel and MeridianView

**Files:**
- Modify: `web/src/pages/meridians/MeridianPanel.tsx`
- Modify: `web/src/pages/meridians/MeridianView.tsx`

**Step 1: Add info button to MeridianPanel**

In `MeridianItem` component (line 8-73 of MeridianPanel.tsx):
- Import `InfoCircleOutlined` from `@ant-design/icons`
- Add `onInfoClick: (meridian: MeridianData) => void` to props
- Add an `InfoCircleOutlined` icon button next to the meridian name (after the point count)
- Style: subtle, same line as checkbox, clickable with hover effect

In `MeridianPanel` component:
- Add `onMeridianInfoClick: (meridian: MeridianData) => void` to `MeridianPanelProps`
- Pass it down to `MeridianItem` as `onInfoClick`

**Step 2: Integrate MeridianDetailDrawer in MeridianView**

In `MeridianView.tsx`:
- Import `MeridianDetailDrawer` and `meridianMap` from data
- Add state: `const [detailMeridian, setDetailMeridian] = useState<MeridianData | null>(null);`
- Add handler: `handleMeridianInfoClick` sets `detailMeridian`
- Add handler: `handleDrawerAcupointNavigate` → sets `focusedAcupoint`, enables meridian, closes drawer
- Pass `onMeridianInfoClick` to `MeridianPanel`
- Render `MeridianDetailDrawer` with appropriate props

**Step 3: Verify build**

Run: `cd web && npx tsc --noEmit && cd ../web && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```
feat: integrate meridian detail drawer into meridian view
```

---

### Task 10: Full integration test and final polish

**Step 1: Run backend build and tests**

Run: `cd server && go build ./... && go test ./...`
Expected: All pass

**Step 2: Run frontend build**

Run: `cd web && npm run build`
Expected: Build succeeds

**Step 3: Run frontend tests**

Run: `cd web && npm run test`
Expected: All pass (existing tests still pass)

**Step 4: Manual verification checklist**

- [ ] Info button visible next to each regular meridian name
- [ ] Clicking info button opens drawer with correct meridian data
- [ ] Special points display correctly with proper grouping
- [ ] Clicking a special point tag navigates to acupoint in 3D
- [ ] Video section shows "暂无视频" when empty
- [ ] Source section shows "暂无出处介绍" when empty
- [ ] Admin can edit video URL and source text
- [ ] Non-admin cannot see edit buttons
- [ ] Drawer closes properly
- [ ] Mobile layout works (full-screen drawer)

**Step 5: Update docs**

- Update `docs/codebase.md` with new meridian resource table, API routes, and components
- Update `CLAUDE.md` with link to design doc

**Step 6: Final commit**

```
docs: update codebase docs for meridian detail enhancement
```
