# 节气功能实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在中医药模块下新增「节气」页面，展示二十四节气圆环可视化 + Markdown 养生内容编辑。

**Architecture:** 后端新增 SolarTerm 全局模型（无租户隔离），24 条 seed 数据初始化。前端用 SVG 绘制四季圆环 + Ant Design Drawer 展示详情。桌面端右侧抽屉，移动端底部抽屉。

**Tech Stack:** Go/Gin/GORM (后端), React 19/TypeScript/Ant Design 6/react-markdown (前端), Vitest (前端测试)

**Design Spec:** `docs/plans/2026-03-14-solar-terms-design.md`

---

## Task 1: 后端 Model + Migration + Seed

**Files:**
- Create: `server/model/solar_term.go`
- Modify: `server/database/database.go:32-53` (AutoMigrate)
- Modify: `server/database/seed.go:14-19` (Seed 函数)
- Modify: `server/testutil/testutil.go:83-104` (测试 AutoMigrate)

### Step 1: 创建 SolarTerm 模型

- [ ] **1.1 创建模型文件**

```go
// server/model/solar_term.go
package model

import "time"

// SolarTerm represents one of the 24 solar terms in the Chinese calendar.
// Global data (no tenant_id).
type SolarTerm struct {
	ID         uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	Name       string    `gorm:"column:name;type:varchar(20);not null;uniqueIndex" json:"name"`
	Season     string    `gorm:"column:season;type:varchar(10);not null" json:"season"`
	OrderIndex int       `gorm:"column:order_index;not null" json:"order_index"`
	Month      int       `gorm:"column:month;not null" json:"month"`
	Day        int       `gorm:"column:day;not null" json:"day"`
	EndMonth   int       `gorm:"column:end_month;not null" json:"end_month"`
	EndDay     int       `gorm:"column:end_day;not null" json:"end_day"`
	Content    string    `gorm:"column:content;type:longtext" json:"content"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (SolarTerm) TableName() string {
	return "solar_terms"
}
```

- [ ] **1.2 添加 AutoMigrate**

在 `server/database/database.go:52` 的 `&model.InventoryDrug{},` 后面添加：
```go
&model.SolarTerm{},
```

在 `server/testutil/testutil.go:103` 的 `&model.InventoryDrug{},` 后面添加：
```go
&model.SolarTerm{},
```

- [ ] **1.3 添加 Seed 函数**

在 `server/database/seed.go` 的 `Seed()` 函数中（第 19 行之前）添加调用：
```go
seedSolarTerms(db)
```

在 `seed.go` 文件末尾添加：
```go
// seedSolarTerms upserts the 24 solar terms (creates new ones, skips existing).
func seedSolarTerms(db *gorm.DB) {
	terms := []model.SolarTerm{
		{Name: "立春", Season: "春", OrderIndex: 1, Month: 2, Day: 3, EndMonth: 2, EndDay: 18},
		{Name: "雨水", Season: "春", OrderIndex: 2, Month: 2, Day: 18, EndMonth: 3, EndDay: 5},
		{Name: "惊蛰", Season: "春", OrderIndex: 3, Month: 3, Day: 5, EndMonth: 3, EndDay: 20},
		{Name: "春分", Season: "春", OrderIndex: 4, Month: 3, Day: 20, EndMonth: 4, EndDay: 4},
		{Name: "清明", Season: "春", OrderIndex: 5, Month: 4, Day: 4, EndMonth: 4, EndDay: 19},
		{Name: "谷雨", Season: "春", OrderIndex: 6, Month: 4, Day: 19, EndMonth: 5, EndDay: 5},
		{Name: "立夏", Season: "夏", OrderIndex: 7, Month: 5, Day: 5, EndMonth: 5, EndDay: 20},
		{Name: "小满", Season: "夏", OrderIndex: 8, Month: 5, Day: 20, EndMonth: 6, EndDay: 5},
		{Name: "芒种", Season: "夏", OrderIndex: 9, Month: 6, Day: 5, EndMonth: 6, EndDay: 21},
		{Name: "夏至", Season: "夏", OrderIndex: 10, Month: 6, Day: 21, EndMonth: 7, EndDay: 6},
		{Name: "小暑", Season: "夏", OrderIndex: 11, Month: 7, Day: 6, EndMonth: 7, EndDay: 22},
		{Name: "大暑", Season: "夏", OrderIndex: 12, Month: 7, Day: 22, EndMonth: 8, EndDay: 7},
		{Name: "立秋", Season: "秋", OrderIndex: 13, Month: 8, Day: 7, EndMonth: 8, EndDay: 22},
		{Name: "处暑", Season: "秋", OrderIndex: 14, Month: 8, Day: 22, EndMonth: 9, EndDay: 7},
		{Name: "白露", Season: "秋", OrderIndex: 15, Month: 9, Day: 7, EndMonth: 9, EndDay: 22},
		{Name: "秋分", Season: "秋", OrderIndex: 16, Month: 9, Day: 22, EndMonth: 10, EndDay: 8},
		{Name: "寒露", Season: "秋", OrderIndex: 17, Month: 10, Day: 8, EndMonth: 10, EndDay: 23},
		{Name: "霜降", Season: "秋", OrderIndex: 18, Month: 10, Day: 23, EndMonth: 11, EndDay: 7},
		{Name: "立冬", Season: "冬", OrderIndex: 19, Month: 11, Day: 7, EndMonth: 11, EndDay: 22},
		{Name: "小雪", Season: "冬", OrderIndex: 20, Month: 11, Day: 22, EndMonth: 12, EndDay: 6},
		{Name: "大雪", Season: "冬", OrderIndex: 21, Month: 12, Day: 6, EndMonth: 12, EndDay: 21},
		{Name: "冬至", Season: "冬", OrderIndex: 22, Month: 12, Day: 21, EndMonth: 1, EndDay: 5},
		{Name: "小寒", Season: "冬", OrderIndex: 23, Month: 1, Day: 5, EndMonth: 1, EndDay: 20},
		{Name: "大寒", Season: "冬", OrderIndex: 24, Month: 1, Day: 20, EndMonth: 2, EndDay: 3},
	}

	for _, t := range terms {
		var existing model.SolarTerm
		result := db.Where("name = ?", t.Name).First(&existing)
		if result.Error != nil {
			if err := db.Create(&t).Error; err != nil {
				log.Printf("Warning: failed to create solar term %s: %v", t.Name, err)
			}
		}
	}
	log.Println("Solar terms upsert completed")
}
```

- [ ] **1.4 验证编译通过**

```bash
cd server && go build ./...
```

- [ ] **1.5 提交**

```bash
git add server/model/solar_term.go server/database/database.go server/database/seed.go server/testutil/testutil.go
git commit -m "feat: add SolarTerm model, migration and seed data"
```

---

## Task 2: 后端 Service 层

**Files:**
- Create: `server/service/solar_term.go`

- [ ] **2.1 创建 Service**

```go
// server/service/solar_term.go
package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrSolarTermNotFound = errors.New("solar term not found")

type SolarTermService struct {
	DB *gorm.DB
}

func NewSolarTermService(db *gorm.DB) *SolarTermService {
	return &SolarTermService{DB: db}
}

// List returns all 24 solar terms ordered by order_index.
func (s *SolarTermService) List() ([]model.SolarTerm, error) {
	var terms []model.SolarTerm
	if err := s.DB.Order("order_index ASC").Find(&terms).Error; err != nil {
		return nil, err
	}
	return terms, nil
}

// GetByID returns a single solar term by ID.
func (s *SolarTermService) GetByID(id uint64) (*model.SolarTerm, error) {
	var term model.SolarTerm
	if err := s.DB.First(&term, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSolarTermNotFound
		}
		return nil, err
	}
	return &term, nil
}

// UpdateContent updates the markdown content of a solar term.
func (s *SolarTermService) UpdateContent(id uint64, content string) (*model.SolarTerm, error) {
	var term model.SolarTerm
	if err := s.DB.First(&term, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrSolarTermNotFound
		}
		return nil, err
	}
	if err := s.DB.Model(&term).Update("content", content).Error; err != nil {
		return nil, err
	}
	return &term, nil
}

// DeleteContent clears the content of a solar term (does not delete the record).
func (s *SolarTermService) DeleteContent(id uint64) error {
	var term model.SolarTerm
	if err := s.DB.First(&term, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrSolarTermNotFound
		}
		return err
	}
	return s.DB.Model(&term).Update("content", "").Error
}
```

- [ ] **2.2 验证编译通过**

```bash
cd server && go build ./...
```

- [ ] **2.3 提交**

```bash
git add server/service/solar_term.go
git commit -m "feat: add SolarTerm service layer"
```

---

## Task 3: 后端 Service 测试

**Files:**
- Create: `server/service/solar_term_test.go`

- [ ] **3.1 编写测试**

```go
// server/service/solar_term_test.go
package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/database"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func setupSolarTermTest(t *testing.T) *service.SolarTermService {
	t.Helper()
	db := testutil.SetupTestDB(t)
	database.Seed(db) // seed the 24 solar terms
	return service.NewSolarTermService(db)
}

func TestSolarTermService_List(t *testing.T) {
	svc := setupSolarTermTest(t)

	terms, err := svc.List()

	assert.NoError(t, err)
	assert.Len(t, terms, 24)
	assert.Equal(t, "立春", terms[0].Name)
	assert.Equal(t, "大寒", terms[23].Name)
	assert.Equal(t, 1, terms[0].OrderIndex)
	assert.Equal(t, 24, terms[23].OrderIndex)
}

func TestSolarTermService_GetByID(t *testing.T) {
	svc := setupSolarTermTest(t)

	terms, _ := svc.List()
	term, err := svc.GetByID(terms[0].ID)

	assert.NoError(t, err)
	assert.Equal(t, "立春", term.Name)
	assert.Equal(t, "春", term.Season)
}

func TestSolarTermService_GetByID_NotFound(t *testing.T) {
	svc := setupSolarTermTest(t)

	_, err := svc.GetByID(99999)

	assert.ErrorIs(t, err, service.ErrSolarTermNotFound)
}

func TestSolarTermService_UpdateContent(t *testing.T) {
	svc := setupSolarTermTest(t)

	terms, _ := svc.List()
	content := "## 养生原则\n惊蛰时节，宜养肝健脾。"
	updated, err := svc.UpdateContent(terms[2].ID, content) // 惊蛰

	assert.NoError(t, err)
	assert.Equal(t, content, updated.Content)

	// Verify persistence
	got, _ := svc.GetByID(terms[2].ID)
	assert.Equal(t, content, got.Content)
}

func TestSolarTermService_UpdateContent_NotFound(t *testing.T) {
	svc := setupSolarTermTest(t)

	_, err := svc.UpdateContent(99999, "test")

	assert.ErrorIs(t, err, service.ErrSolarTermNotFound)
}

func TestSolarTermService_DeleteContent(t *testing.T) {
	svc := setupSolarTermTest(t)

	terms, _ := svc.List()
	// First set content
	svc.UpdateContent(terms[0].ID, "some content")

	// Then delete it
	err := svc.DeleteContent(terms[0].ID)

	assert.NoError(t, err)

	// Verify content cleared
	got, _ := svc.GetByID(terms[0].ID)
	assert.Equal(t, "", got.Content)
}

func TestSolarTermService_DeleteContent_NotFound(t *testing.T) {
	svc := setupSolarTermTest(t)

	err := svc.DeleteContent(99999)

	assert.ErrorIs(t, err, service.ErrSolarTermNotFound)
}
```

- [ ] **3.2 运行测试确认通过**

```bash
cd server && go test ./service/ -run "TestSolarTerm" -v -timeout 60s
```

- [ ] **3.3 提交**

```bash
git add server/service/solar_term_test.go
git commit -m "test: add SolarTerm service tests"
```

---

## Task 4: 后端 Handler + Router

**Files:**
- Create: `server/handler/solar_term.go`
- Modify: `server/router/router.go:51-52` (创建 handler), `router.go:194` (注册路由)
- Modify: `server/handler/test_helpers_test.go:35` (测试 router)

- [ ] **4.1 创建 Handler**

```go
// server/handler/solar_term.go
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

// List returns all 24 solar terms.
func (h *SolarTermHandler) List(c *gin.Context) {
	svc := service.NewSolarTermService(h.db)
	terms, err := svc.List()
	if err != nil {
		Error(c, http.StatusInternalServerError, "failed to list solar terms")
		return
	}
	Success(c, terms)
}

// Update updates the content of a solar term.
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

// DeleteContent clears the content of a solar term.
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
```

> **注意**：Handler 使用 `response.go` 中的 `Success()` / `Error()` 辅助函数，不直接使用 `c.JSON`。不在错误响应中暴露内部错误信息。

- [ ] **4.2 注册路由**

在 `server/router/router.go:52`（`inventoryDrugHandler` 行之后）添加：
```go
solarTermHandler := handler.NewSolarTermHandler(db)
```

在 `server/router/router.go:205`（clinical-experiences 路由组之后）添加：
```go
// Solar term routes (global data, authenticated).
solarTerms := authenticated.Group("/solar-terms")
{
	solarTerms.GET("", solarTermHandler.List)
	solarTerms.PUT("/:id", middleware.RequirePermission(db, "role:manage"), solarTermHandler.Update)
	solarTerms.DELETE("/:id/content", middleware.RequirePermission(db, "role:manage"), solarTermHandler.DeleteContent)
}
```

- [ ] **4.3 注册测试路由**

在 `server/handler/test_helpers_test.go:35`（`meridianResourceHandler` 行之后）添加：
```go
solarTermHandler := NewSolarTermHandler(db)
```

在 `test_helpers_test.go` 的 `wuyunLiuqi` 路由组之后添加：
```go
solarTerms := authed.Group("/solar-terms")
solarTerms.GET("", solarTermHandler.List)
solarTerms.PUT("/:id", solarTermHandler.Update)
solarTerms.DELETE("/:id/content", solarTermHandler.DeleteContent)
```

- [ ] **4.4 验证编译通过**

```bash
cd server && go build ./...
```

- [ ] **4.5 提交**

```bash
git add server/handler/solar_term.go server/router/router.go server/handler/test_helpers_test.go
git commit -m "feat: add SolarTerm handler and routes"
```

---

## Task 5: 后端 Handler 测试

**Files:**
- Create: `server/handler/solar_term_handler_test.go`

- [ ] **5.1 编写 Handler 测试**

```go
// server/handler/solar_term_handler_test.go
package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/callmefisher/menzhen/server/database"
	"github.com/stretchr/testify/assert"
)

func TestSolarTermHandler_List(t *testing.T) {
	env := setupTestEnv(t)
	database.Seed(env.DB)

	w := env.doRequest("GET", "/api/v1/solar-terms", nil)

	assert.Equal(t, http.StatusOK, w.Code)
	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data, ok := body["data"].([]interface{})
	assert.True(t, ok)
	assert.Len(t, data, 24)

	first := data[0].(map[string]interface{})
	assert.Equal(t, "立春", first["name"])
	assert.Equal(t, "春", first["season"])
	assert.Equal(t, float64(1), first["order_index"])
}

func TestSolarTermHandler_Update(t *testing.T) {
	env := setupTestEnv(t)
	database.Seed(env.DB)

	// Get list first to find an ID
	w := env.doRequest("GET", "/api/v1/solar-terms", nil)
	body := parseJSON(w)
	data := body["data"].([]interface{})
	first := data[0].(map[string]interface{})
	id := first["id"]

	// Update content
	content := "## 立春养生\n宜养肝护阳。"
	w = env.doRequest("PUT", fmt.Sprintf("/api/v1/solar-terms/%.0f", id), map[string]interface{}{
		"content": content,
	})

	assert.Equal(t, http.StatusOK, w.Code)
	respBody := parseJSON(w)
	assert.Equal(t, float64(0), respBody["code"])
	respData := respBody["data"].(map[string]interface{})
	assert.Equal(t, content, respData["content"])
}

func TestSolarTermHandler_Update_NotFound(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("PUT", "/api/v1/solar-terms/99999", map[string]interface{}{
		"content": "test",
	})

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestSolarTermHandler_DeleteContent(t *testing.T) {
	env := setupTestEnv(t)
	database.Seed(env.DB)

	// Get list to find an ID
	w := env.doRequest("GET", "/api/v1/solar-terms", nil)
	body := parseJSON(w)
	data := body["data"].([]interface{})
	first := data[0].(map[string]interface{})
	id := first["id"]

	// Set content first
	env.doRequest("PUT", fmt.Sprintf("/api/v1/solar-terms/%.0f", id), map[string]interface{}{
		"content": "to be deleted",
	})

	// Delete content
	w = env.doRequest("DELETE", fmt.Sprintf("/api/v1/solar-terms/%.0f/content", id), nil)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify content is empty
	w = env.doRequest("GET", "/api/v1/solar-terms", nil)
	body = parseJSON(w)
	data = body["data"].([]interface{})
	first = data[0].(map[string]interface{})
	assert.Equal(t, "", first["content"])
}

func TestSolarTermHandler_DeleteContent_NotFound(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("DELETE", "/api/v1/solar-terms/99999/content", nil)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestSolarTermHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/solar-terms", nil)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
```

- [ ] **5.2 运行测试确认通过**

```bash
cd server && go test ./handler/ -run "TestSolarTerm" -v -timeout 60s
```

- [ ] **5.3 运行全量后端测试确认无回归**

```bash
cd server && go test ./... -timeout 120s
```

- [ ] **5.4 提交**

```bash
git add server/handler/solar_term_handler_test.go
git commit -m "test: add SolarTerm handler tests"
```

---

## Task 6: 前端 API 层

**Files:**
- Create: `web/src/api/solarTerm.ts`

- [ ] **6.1 创建 API 文件**

```ts
// web/src/api/solarTerm.ts
import request from '../utils/request';

export interface SolarTermItem {
  id: number;
  name: string;
  season: string;
  order_index: number;
  month: number;
  day: number;
  end_month: number;
  end_day: number;
  content: string;
  created_at: string;
  updated_at: string;
}

/** Get all 24 solar terms */
export function listSolarTerms() {
  return request.get<unknown, { code: number; data: SolarTermItem[] }>('/solar-terms');
}

/** Update solar term content (admin) */
export function updateSolarTerm(id: number, content: string) {
  return request.put(`/solar-terms/${id}`, { content });
}

/** Delete solar term content (admin) */
export function deleteSolarTermContent(id: number) {
  return request.delete(`/solar-terms/${id}/content`);
}
```

- [ ] **6.2 提交**

```bash
git add web/src/api/solarTerm.ts
git commit -m "feat: add solar term API service"
```

---

## Task 7: 前端页面组件

**Files:**
- Create: `web/src/pages/solar-terms/SolarTerms.tsx`
- Modify: `web/src/App.tsx:22` (import), `App.tsx:78` (route)
- Modify: `web/src/components/Layout.tsx:141` (menu item)

这是最大的 Task，包含 SVG 圆环可视化 + Drawer 交互。

- [ ] **7.1 创建页面组件**

创建 `web/src/pages/solar-terms/SolarTerms.tsx`，核心结构：

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Input, message, Popconfirm, Space, Spin, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import { listSolarTerms, updateSolarTerm, deleteSolarTermContent } from '../../api/solarTerm';
import type { SolarTermItem } from '../../api/solarTerm';

const { TextArea } = Input;

// 四季颜色
const SEASON_COLORS: Record<string, string> = {
  春: '#52c41a',
  夏: '#fa8c16',
  秋: '#1890ff',
  冬: '#722ed1',
};

const CURRENT_COLOR = '#ff4d4f';

export default function SolarTerms() { ... }
```

**组件内逻辑**（关键点）：

1. **State**：`terms`, `loading`, `selectedId`, `drawerOpen`, `editing`, `editContent`
2. **当前节气计算**：`useMemo` 根据 `new Date()` 匹配 month/day，找到当前 + 下一个
3. **SVG 圆环**：24 个点均匀分布在圆上（每个 15°），起始角度 -90°（顶部 = 立春）
   - 点的坐标：`cx = centerX + radius * cos(angle)`, `cy = centerY + radius * sin(angle)`
   - 四段季节弧用 `<path>` 的 SVG arc 命令
   - 当前节气红色脉动，下一节气绿色虚线圈
   - 圆心显示当前节气信息
4. **Drawer**：桌面端 `placement="right" width={420}`，移动端 `placement="bottom" height="75vh"`
5. **编辑**：点击编辑 → `TextArea` 替换内容，保存调 `updateSolarTerm` API
6. **删除**：`Popconfirm` → 调 `deleteSolarTermContent` API
7. **进入页面时**：自动选中当前节气并打开抽屉

- [ ] **7.2 添加路由**

在 `web/src/App.tsx:22`（`DrugList` import 之后）添加：
```ts
import SolarTerms from './pages/solar-terms/SolarTerms';
```

在 `web/src/App.tsx:78`（`clinical-experience` 路由之后）添加：
```tsx
<Route path="solar-terms" element={<SolarTerms />} />
```

- [ ] **7.3 添加菜单项**

在 `web/src/components/Layout.tsx:141`（临床经验集 menu item 之后，`];` 之前）添加：
```ts
{
  key: '/solar-terms',
  icon: <CalendarOutlined />,
  label: '节气',
},
```

在 `web/src/components/Layout.tsx:24`（`AlertOutlined,` 行之后）添加 icon import：
```ts
CalendarOutlined,
```

在 `web/src/components/Layout.tsx` 的 `selectedKeys` memo 中（`/clinical-experience` 行之后）添加：
```ts
if (path.startsWith('/solar-terms')) return ['/solar-terms'];
```

在 `web/src/components/Layout.tsx` 的 `openKeys` memo 中（`/clinical-experience` 条件之后）添加 `|| path.startsWith('/solar-terms')`：
```ts
if (... || path.startsWith('/clinical-experience') || path.startsWith('/solar-terms')) return ['/tcm'];
```

- [ ] **7.4 验证前端编译通过**

```bash
cd web && npm run build
```

- [ ] **7.5 提交**

```bash
git add web/src/pages/solar-terms/SolarTerms.tsx web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: add solar terms page with ring visualization and drawer"
```

---

## Task 8: 前端测试

**Files:**
- Create: `web/src/pages/solar-terms/__tests__/SolarTerms.test.tsx`

- [ ] **8.1 编写前端测试**

测试覆盖：
1. 页面渲染 — 加载后显示「节气」标题和 SVG 圆环
2. 显示当前节气信息 — 圆心显示当前节气名
3. 点击节气打开抽屉 — 点击圆环上的点后 Drawer 可见
4. 编辑流程 — 点编辑后出现 textarea，输入内容保存
5. 删除流程 — 点删除后 content 清空
6. 空数据状态 — 无内容时显示空状态提示

Mock `listSolarTerms` / `updateSolarTerm` / `deleteSolarTermContent` API。

- [ ] **8.2 运行前端测试确认通过**

```bash
cd web && npx vitest run src/pages/solar-terms/__tests__/SolarTerms.test.tsx
```

- [ ] **8.3 提交**

```bash
git add web/src/pages/solar-terms/__tests__/SolarTerms.test.tsx
git commit -m "test: add SolarTerms page tests"
```

---

## Task 9: 部署 + 文档更新

**Files:**
- Modify: `docs/codebase.md` (新增模型/API/页面文档)
- Modify: `CLAUDE.md` (新增设计方案链接)
- Modify: `README.md` (如有需要)

- [ ] **9.1 构建部署**

```bash
cd web && npm run build
docker cp dist/. menzhen-web-1:/usr/share/nginx/html/
docker exec menzhen-nginx-1 nginx -s reload
```

- [ ] **9.2 更新 docs/codebase.md**

在数据模型章节添加 SolarTerm 表说明，在 API 路由章节添加 `/solar-terms` 路由。

- [ ] **9.3 更新 CLAUDE.md**

在详细文档章节添加：
```
- [节气功能设计](docs/plans/2026-03-14-solar-terms-design.md)
- [节气功能实施计划](docs/plans/2026-03-14-solar-terms-plan.md)
```

- [ ] **9.4 提交**

```bash
git add docs/codebase.md CLAUDE.md
git commit -m "docs: add solar terms feature documentation"
```

---

## 任务依赖关系

```
Task 1 (Model+Seed) → Task 2 (Service) → Task 3 (Service Test)
                                       → Task 4 (Handler+Router) → Task 5 (Handler Test)
Task 6 (Frontend API) → Task 7 (Frontend Page) → Task 8 (Frontend Test)
Task 5 + Task 8 → Task 9 (Deploy+Docs)
```

**注意**：Task 4 依赖 Task 2（Handler import Service），不能跳过 Task 2 直接做 Task 4。

**可并行**：Task 3（Service 测试）与 Task 4（Handler）可在 Task 2 完成后并行。Task 6（前端 API）可在 Task 1 完成后与后端并行。
