# 库存管理功能实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为诊所系统新增库存管理模块（药物 CRUD + 库存预警 + 开方库存提示）

**Architecture:** 后端新增 InventoryDrug 模型 + Service + Handler，遵循现有 Patient 模式（租户隔离 + RBAC）。前端新增库存页面 + 预警页面，预警纯前端定时扫描，开方页面新增库存提示。

**Tech Stack:** Go/Gin/GORM (后端) + React/TypeScript/Ant Design 6 (前端)

**设计文档:** `docs/plans/2026-03-13-inventory-management-design.md`

---

## Chunk 1: 后端 — 模型 + 权限 + Service + Handler + 路由

### Task 1: GORM 模型定义

**Files:**
- Create: `server/model/inventory_drug.go`

- [ ] **Step 1: 创建模型文件**

```go
package model

// InventoryDrug represents a drug in the clinic's inventory (tenant-scoped).
type InventoryDrug struct {
	BaseModel
	TenantID       uint64   `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	Name           string   `gorm:"column:name;type:varchar(100);not null" json:"name"`
	Category       string   `gorm:"column:category;type:varchar(10);not null;index;comment:herb=本草,patent=成药" json:"category"`
	Stock          float64  `gorm:"column:stock;type:decimal(10,2);not null;default:0" json:"stock"`
	PurchasePrice  float64  `gorm:"column:purchase_price;type:decimal(10,2);not null;default:0" json:"purchase_price"`
	SellingPrice   float64  `gorm:"column:selling_price;type:decimal(10,2);not null;default:0" json:"selling_price"`
	AlertThreshold *float64 `gorm:"column:alert_threshold;type:decimal(10,2)" json:"alert_threshold"`
	Remark         string   `gorm:"column:remark;type:text" json:"remark"`
}

func (InventoryDrug) TableName() string {
	return "inventory_drugs"
}
```

- [ ] **Step 2: 注册 AutoMigrate**

Modify: `server/database/database.go`

在 `db.AutoMigrate(...)` 列表末尾添加：
```go
&model.InventoryDrug{},
```

- [ ] **Step 3: 验证编译**

Run: `cd server && go build ./...`
Expected: 编译通过

- [ ] **Step 4: 提交**

```bash
git add server/model/inventory_drug.go server/database/database.go
git commit -m "feat: add InventoryDrug model and AutoMigrate"
```

---

### Task 2: Seed 权限码

**Files:**
- Modify: `server/database/seed.go`

- [ ] **Step 1: 在 seedPermissions 的 permissions 切片末尾添加 4 条**

```go
{Code: "inventory:read", Name: "查看库存", Description: "查看药物库存"},
{Code: "inventory:create", Name: "新增库存", Description: "新增库存药物"},
{Code: "inventory:update", Name: "修改库存", Description: "修改库存药物"},
{Code: "inventory:delete", Name: "删除库存", Description: "删除库存药物"},
```

- [ ] **Step 2: 验证编译**

Run: `cd server && go build ./...`
Expected: 编译通过

- [ ] **Step 3: 提交**

```bash
git add server/database/seed.go
git commit -m "feat: seed inventory permission codes"
```

---

### Task 3: Service 层

**Files:**
- Create: `server/service/inventory_drug.go`

- [ ] **Step 1: 创建 Service 文件**

```go
package service

import (
	"errors"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var ErrInventoryDrugNotFound = errors.New("inventory drug not found")

type InventoryDrugService struct {
	DB *gorm.DB
}

func NewInventoryDrugService(db *gorm.DB) *InventoryDrugService {
	return &InventoryDrugService{DB: db}
}

// List returns paginated inventory drugs for a tenant, with optional name/category filters.
func (s *InventoryDrugService) List(tenantID uint64, name, category string, page, size int) ([]model.InventoryDrug, int64, error) {
	var drugs []model.InventoryDrug
	var total int64

	query := s.DB.Model(&model.InventoryDrug{}).Where("tenant_id = ?", tenantID)
	if name != "" {
		query = query.Where("name LIKE ?", "%"+name+"%")
	}
	if category != "" {
		query = query.Where("category = ?", category)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("id ASC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&drugs).Error; err != nil {
		return nil, 0, err
	}

	return drugs, total, nil
}

// CreateInventoryDrugRequest is the input for creating a new inventory drug.
type CreateInventoryDrugRequest struct {
	Name           string   `json:"name" binding:"required"`
	Category       string   `json:"category" binding:"required,oneof=herb patent"`
	Stock          float64  `json:"stock"`
	PurchasePrice  float64  `json:"purchase_price"`
	SellingPrice   float64  `json:"selling_price"`
	AlertThreshold *float64 `json:"alert_threshold"`
	Remark         string   `json:"remark"`
}

// Create creates a new inventory drug.
func (s *InventoryDrugService) Create(tenantID uint64, req *CreateInventoryDrugRequest) (*model.InventoryDrug, error) {
	drug := model.InventoryDrug{
		TenantID:       tenantID,
		Name:           req.Name,
		Category:       req.Category,
		Stock:          req.Stock,
		PurchasePrice:  req.PurchasePrice,
		SellingPrice:   req.SellingPrice,
		AlertThreshold: req.AlertThreshold,
		Remark:         req.Remark,
	}
	if err := s.DB.Create(&drug).Error; err != nil {
		return nil, err
	}
	return &drug, nil
}

// UpdateInventoryDrugRequest is the input for updating an inventory drug.
type UpdateInventoryDrugRequest struct {
	Name           *string  `json:"name"`
	Category       *string  `json:"category"`
	Stock          *float64 `json:"stock"`
	PurchasePrice  *float64 `json:"purchase_price"`
	SellingPrice   *float64 `json:"selling_price"`
	AlertThreshold *float64 `json:"alert_threshold"`
	Remark         *string  `json:"remark"`
}

// Update updates an existing inventory drug.
func (s *InventoryDrugService) Update(tenantID uint64, id uint64, req *UpdateInventoryDrugRequest) (*model.InventoryDrug, error) {
	var drug model.InventoryDrug
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&drug, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInventoryDrugNotFound
		}
		return nil, err
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Category != nil {
		updates["category"] = *req.Category
	}
	if req.Stock != nil {
		updates["stock"] = *req.Stock
	}
	if req.PurchasePrice != nil {
		updates["purchase_price"] = *req.PurchasePrice
	}
	if req.SellingPrice != nil {
		updates["selling_price"] = *req.SellingPrice
	}
	if req.AlertThreshold != nil {
		if *req.AlertThreshold < 0 {
			updates["alert_threshold"] = nil
		} else {
			updates["alert_threshold"] = *req.AlertThreshold
		}
	}
	if req.Remark != nil {
		updates["remark"] = *req.Remark
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&drug).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	s.DB.Where("tenant_id = ?", tenantID).First(&drug, id)
	return &drug, nil
}

// Delete soft-deletes an inventory drug.
func (s *InventoryDrugService) Delete(tenantID uint64, id uint64) error {
	var drug model.InventoryDrug
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&drug, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInventoryDrugNotFound
		}
		return err
	}
	return s.DB.Delete(&drug).Error
}
```

- [ ] **Step 2: 验证编译**

Run: `cd server && go build ./...`
Expected: 编译通过

- [ ] **Step 3: 提交**

```bash
git add server/service/inventory_drug.go
git commit -m "feat: add InventoryDrug service layer"
```

---

### Task 4: Handler 层

**Files:**
- Create: `server/handler/inventory_drug.go`

- [ ] **Step 1: 创建 Handler 文件**

```go
package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type InventoryDrugHandler struct {
	db *gorm.DB
}

func NewInventoryDrugHandler(db *gorm.DB) *InventoryDrugHandler {
	return &InventoryDrugHandler{db: db}
}

// List handles GET /api/v1/inventory/drugs
func (h *InventoryDrugHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
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

	svc := service.NewInventoryDrugService(h.db)
	drugs, total, err := svc.List(tenantID, name, category, page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list inventory drugs",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  drugs,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// Create handles POST /api/v1/inventory/drugs
func (h *InventoryDrugHandler) Create(c *gin.Context) {
	var req service.CreateInventoryDrugRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	tenantID := middleware.GetTenantID(c)
	svc := service.NewInventoryDrugService(h.db)
	drug, err := svc.Create(tenantID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to create inventory drug",
		})
		return
	}

	middleware.LogOperation(h.db, c, "create", "inventory_drug", drug.ID, nil, drug)

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    drug,
	})
}

// Update handles PUT /api/v1/inventory/drugs/:id
func (h *InventoryDrugHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid id",
		})
		return
	}

	var req service.UpdateInventoryDrugRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewInventoryDrugService(h.db)
	drug, err := svc.Update(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrInventoryDrugNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "inventory drug not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update inventory drug",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    drug,
	})
}

// Delete handles DELETE /api/v1/inventory/drugs/:id
func (h *InventoryDrugHandler) Delete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid id",
		})
		return
	}

	svc := service.NewInventoryDrugService(h.db)
	if err := svc.Delete(tenantID, id); err != nil {
		if errors.Is(err, service.ErrInventoryDrugNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "inventory drug not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to delete inventory drug",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}
```

- [ ] **Step 2: 验证编译**

Run: `cd server && go build ./...`
Expected: 编译通过

- [ ] **Step 3: 提交**

```bash
git add server/handler/inventory_drug.go
git commit -m "feat: add InventoryDrug handler layer"
```

---

### Task 5: 注册路由

**Files:**
- Modify: `server/router/router.go`

- [ ] **Step 1: 创建 handler 实例**

在 `clinicalExpHandler` 声明之后添加：
```go
inventoryDrugHandler := handler.NewInventoryDrugHandler(db)
```

- [ ] **Step 2: 注册路由组**

在 `prescriptions` 路由组之后（约 L212 之前）添加：
```go
// Inventory drug routes (tenant-scoped).
inventoryDrugs := authenticated.Group("/inventory/drugs")
{
	inventoryDrugs.GET("", middleware.RequirePermission(db, "inventory:read"), inventoryDrugHandler.List)
	inventoryDrugs.POST("", middleware.RequirePermission(db, "inventory:create"), inventoryDrugHandler.Create)
	inventoryDrugs.PUT("/:id", middleware.RequirePermission(db, "inventory:update"), inventoryDrugHandler.Update)
	inventoryDrugs.DELETE("/:id", middleware.RequirePermission(db, "inventory:delete"), inventoryDrugHandler.Delete)
}
```

- [ ] **Step 3: 验证编译**

Run: `cd server && go build ./...`
Expected: 编译通过

- [ ] **Step 4: 提交**

```bash
git add server/router/router.go
git commit -m "feat: register inventory drug routes with RBAC"
```

---

## Chunk 2: 前端 — API + 药物库存页面

### Task 6: 前端 API 封装

**Files:**
- Create: `web/src/api/inventory.ts`

- [ ] **Step 1: 创建 API 文件**

```typescript
import request from '../utils/request';

export interface InventoryDrug {
  id: number;
  tenant_id: number;
  name: string;
  category: 'herb' | 'patent';
  stock: number;
  purchase_price: number;
  selling_price: number;
  alert_threshold: number | null;
  remark: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryDrugListParams {
  name?: string;
  category?: string;
  page?: number;
  size?: number;
}

export interface CreateInventoryDrugReq {
  name: string;
  category: 'herb' | 'patent';
  stock: number;
  purchase_price: number;
  selling_price: number;
  alert_threshold?: number | null;
  remark?: string;
}

export interface UpdateInventoryDrugReq {
  name?: string;
  category?: string;
  stock?: number;
  purchase_price?: number;
  selling_price?: number;
  alert_threshold?: number | null;
  remark?: string;
}

export function listInventoryDrugs(params: InventoryDrugListParams) {
  return request.get('/inventory/drugs', { params });
}

export function createInventoryDrug(data: CreateInventoryDrugReq) {
  return request.post('/inventory/drugs', data);
}

export function updateInventoryDrug(id: number, data: UpdateInventoryDrugReq) {
  return request.put(`/inventory/drugs/${id}`, data);
}

export function deleteInventoryDrug(id: number) {
  return request.delete(`/inventory/drugs/${id}`);
}
```

- [ ] **Step 2: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add web/src/api/inventory.ts
git commit -m "feat: add inventory drug API client"
```

---

### Task 7: 药物库存页面 (DrugList)

**Files:**
- Create: `web/src/pages/inventory/DrugList.tsx`

- [ ] **Step 1: 创建药物库存页面**

完整实现包含：
- 搜索栏（名称 + 分类筛选）
- Table 分页展示
- 库存量 < 阈值时行红色高亮
- 新增/编辑 Modal，表单根据分类动态切换单位标签
- 删除确认

关键实现要点：

```typescript
import { useState, useCallback, useEffect } from 'react';
import {
  Card, Table, Button, Space, Input, Select, Modal, Form,
  InputNumber, Popconfirm, message, Tag,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  listInventoryDrugs, createInventoryDrug, updateInventoryDrug, deleteInventoryDrug,
} from '../../api/inventory';
import type { InventoryDrug, CreateInventoryDrugReq } from '../../api/inventory';
import useIsMobile from '../../hooks/useIsMobile';
```

**表格列定义**：
- 名称、种类（Tag: 本草/成药）、库存量（本草显示"克"、成药显示"盒"）
- 进货价（本草: 元/500克、成药: 元/盒）、出售价（同上）
- 预警阈值（空则显示"默认"）、备注、操作（编辑/删除）

**红色高亮逻辑**：
```typescript
// 从 localStorage 获取全局默认阈值
const getDefaultThreshold = (category: string): number => {
  const config = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}');
  return category === 'herb' ? (config.herbThreshold ?? 500) : (config.patentThreshold ?? 10);
};

const isLowStock = (drug: InventoryDrug): boolean => {
  const threshold = drug.alert_threshold ?? getDefaultThreshold(drug.category);
  return drug.stock < threshold;
};

// Table rowClassName
rowClassName={(record) => isLowStock(record) ? 'low-stock-row' : ''}
```

**Modal 表单**：根据 category 值动态切换：
- herb 选中时：库存量标签"克"，进货价标签"元/500克"，出售价标签"元/500克"
- patent 选中时：库存量标签"盒"，进货价标签"元/盒"，出售价标签"元/盒"

**CSS**（用 style 标签或内联，保持简单）：
```css
.low-stock-row {
  background-color: #fff1f0 !important;
}
.low-stock-row:hover > td {
  background-color: #ffccc7 !important;
}
```

- [ ] **Step 2: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add web/src/pages/inventory/DrugList.tsx
git commit -m "feat: add DrugList page with CRUD and low-stock highlight"
```

---

### Task 8: 注册路由和菜单

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Layout.tsx`

- [ ] **Step 1: App.tsx 添加路由**

在 imports 中添加：
```typescript
import DrugList from './pages/inventory/DrugList';
```

在 routes 中（`clinical-experience` 路由之后）添加：
```typescript
<Route path="inventory/drugs" element={<DrugList />} />
```

- [ ] **Step 2: Layout.tsx 添加菜单项**

导入图标：
```typescript
import { ShopOutlined } from '@ant-design/icons';
```

在 `menuItems` 构建中（`tcm` 之后、`settings` 之前）添加：
```typescript
if (hasPermission('inventory:read')) {
  items.push({
    key: '/inventory',
    icon: <ShopOutlined />,
    label: '库存',
    children: [
      {
        key: '/inventory/drugs',
        icon: <MedicineBoxOutlined />,
        label: '药物',
      },
    ],
  });
}
```

在 `selectedKeys` 中添加：
```typescript
if (path.startsWith('/inventory')) return [path];
```

在 `openKeys` 中添加：
```typescript
if (path.startsWith('/inventory')) return ['/inventory'];
```

- [ ] **Step 3: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git add web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: add inventory menu and routes"
```

---

## Chunk 3: 前端 — 库存预警页面

### Task 9: 库存预警页面 (InventoryAlert)

**Files:**
- Create: `web/src/pages/inventory/InventoryAlert.tsx`

- [ ] **Step 1: 创建预警页面**

关键实现要点：

**数据加载**：调用 `listInventoryDrugs({ size: 9999 })` 获取全量数据，前端筛选 `stock < threshold` 的记录。

**定时扫描**：
```typescript
const [scanInterval, setScanInterval] = useState<number>(() => {
  const config = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}');
  return config.scanInterval ?? 30; // 分钟
});

useEffect(() => {
  fetchAlerts();
  const timer = setInterval(fetchAlerts, scanInterval * 60 * 1000);
  return () => clearInterval(timer);
}, [scanInterval]);
```

**屏蔽功能**：
```typescript
// localStorage key: 'inventory-alert-muted'
// 值: { [drugId]: muteUntilTimestamp }
const isMuted = (drugId: number): boolean => {
  const muted = JSON.parse(localStorage.getItem('inventory-alert-muted') || '{}');
  const until = muted[drugId];
  if (!until) return false;
  if (Date.now() > until) {
    // 过期，清除
    delete muted[drugId];
    localStorage.setItem('inventory-alert-muted', JSON.stringify(muted));
    return false;
  }
  return true;
};

const muteDrug = (drugId: number, hours: number) => {
  const muted = JSON.parse(localStorage.getItem('inventory-alert-muted') || '{}');
  muted[drugId] = Date.now() + hours * 3600 * 1000;
  localStorage.setItem('inventory-alert-muted', JSON.stringify(muted));
};
```

**全局阈值配置**（页面顶部）：
- 本草默认阈值输入框（默认 500 克）
- 成药默认阈值输入框（默认 10 盒）
- 扫描频率输入框（默认 30 分钟）
- 保存到 localStorage `inventory-alert-config`

**展示列**：药物名、分类、当前库存、阈值、缺口量、操作（屏蔽按钮，选择 1h/6h/12h/24h）

**过滤逻辑**：先筛选低库存药物，再排除已屏蔽的。

- [ ] **Step 2: 注册路由和菜单**

`App.tsx` 添加：
```typescript
import InventoryAlert from './pages/inventory/InventoryAlert';
// 在 routes 中添加
<Route path="inventory/alerts" element={<InventoryAlert />} />
```

`Layout.tsx` 在库存菜单 children 中添加：
```typescript
{
  key: '/inventory/alerts',
  icon: <AlertOutlined />,
  label: '库存预警',
},
```

导入 `AlertOutlined` 图标。

- [ ] **Step 3: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git add web/src/pages/inventory/InventoryAlert.tsx web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: add InventoryAlert page with mute and config"
```

---

### Task 10: 菜单红点 Badge

**Files:**
- Modify: `web/src/components/Layout.tsx`

- [ ] **Step 1: 添加告警计数状态和定时扫描**

在 Layout 组件中添加：
```typescript
const [alertCount, setAlertCount] = useState(0);

useEffect(() => {
  if (!hasPermission('inventory:read')) return;

  const checkAlerts = async () => {
    try {
      const res = await listInventoryDrugs({ size: 9999 });
      const body = res as any;
      const drugs: InventoryDrug[] = body.data?.list || [];
      const config = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}');
      const muted = JSON.parse(localStorage.getItem('inventory-alert-muted') || '{}');
      const now = Date.now();

      const count = drugs.filter((d) => {
        const threshold = d.alert_threshold ?? (d.category === 'herb' ? (config.herbThreshold ?? 500) : (config.patentThreshold ?? 10));
        if (d.stock >= threshold) return false;
        const muteUntil = muted[d.id];
        if (muteUntil && now < muteUntil) return false;
        return true;
      }).length;

      setAlertCount(count);
    } catch { /* ignore */ }
  };

  checkAlerts();
  const interval = JSON.parse(localStorage.getItem('inventory-alert-config') || '{}').scanInterval ?? 30;
  const timer = setInterval(checkAlerts, interval * 60 * 1000);
  return () => clearInterval(timer);
}, [hasPermission]);
```

- [ ] **Step 2: 菜单 label 添加 Badge**

库存菜单项和库存预警子项的 label 使用 Badge：
```typescript
import { Badge } from 'antd';

// 库存菜单
label: alertCount > 0 ? <Badge count={alertCount} offset={[10, 0]} size="small"><span>库存</span></Badge> : '库存',

// 库存预警子项
label: alertCount > 0 ? <Badge dot><span>库存预警</span></Badge> : '库存预警',
```

- [ ] **Step 3: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git add web/src/components/Layout.tsx
git commit -m "feat: add alert badge to inventory menu items"
```

---

## Chunk 4: 开方库存提示 + 构建 + 文档

### Task 11: 开方页面库存提示

**Files:**
- Modify: `web/src/components/PrescriptionModal.tsx`

- [ ] **Step 1: 添加库存查询 & 提示**

在 PrescriptionModal 中添加库存提示：

```typescript
import { listInventoryDrugs } from '../api/inventory';
import type { InventoryDrug } from '../api/inventory';

// 在组件内添加状态
const [inventoryMap, setInventoryMap] = useState<Record<string, InventoryDrug>>({});

// 加载全量库存数据（组件打开时）
useEffect(() => {
  if (!open) return;
  (async () => {
    try {
      const res = await listInventoryDrugs({ size: 9999 });
      const body = res as any;
      const drugs: InventoryDrug[] = body.data?.list || [];
      const map: Record<string, InventoryDrug> = {};
      drugs.forEach((d) => { map[d.name] = d; });
      setInventoryMap(map);
    } catch { /* ignore */ }
  })();
}, [open]);
```

在药名列 render 中，药名 Input 下方添加库存提示：
```typescript
// 在 herb_name 列的 render 函数中，Input 之后添加
const inv = inventoryMap[record.herb_name?.trim()];
const stockHint = inv
  ? inv.stock < (inv.alert_threshold ?? getDefaultThreshold(inv.category))
    ? <span style={{ fontSize: 11, color: '#ff4d4f' }}>库存不足: {inv.stock}{inv.category === 'herb' ? '克' : '盒'}</span>
    : <span style={{ fontSize: 11, color: '#52c41a' }}>库存: {inv.stock}{inv.category === 'herb' ? '克' : '盒'}</span>
  : record.herb_name?.trim()
    ? <span style={{ fontSize: 11, color: '#999' }}>未录入库存</span>
    : null;
```

将 render 返回值从 `<Space>` 改为 `<div>` 布局，药名输入行 + 库存提示行。

- [ ] **Step 2: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add web/src/components/PrescriptionModal.tsx
git commit -m "feat: show inventory stock hints in prescription modal"
```

---

### Task 12: 全量构建验证

- [ ] **Step 1: 后端构建**

Run: `cd server && go build ./...`
Expected: 编译通过

- [ ] **Step 2: 前端构建**

Run: `cd web && npm run build`
Expected: 构建通过

- [ ] **Step 3: 提交（如有修复）**

---

### Task 13: 更新文档

**Files:**
- Modify: `docs/codebase.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 codebase.md**

添加：
- `inventory_drugs` 表结构到数据模型章节
- 库存相关 API 路由到 API 清单
- 新文件到项目结构
- `inventory:read/create/update/delete` 到权限码列表

- [ ] **Step 2: 更新 CLAUDE.md**

在权限码列表中添加 `inventory:create/read/update/delete`。

- [ ] **Step 3: 提交**

```bash
git add docs/codebase.md CLAUDE.md
git commit -m "docs: update codebase.md and CLAUDE.md for inventory feature"
```

---

### Task 14: 部署到 Docker

- [ ] **Step 1: 构建前端并部署**

```bash
cd web && npm run build
docker cp dist/. menzhen-web-1:/usr/share/nginx/html/
docker exec menzhen-nginx-1 nginx -s reload
```

- [ ] **Step 2: 重建后端容器**

```bash
docker compose up -d --build server
```

- [ ] **Step 3: 验证功能**

用浏览器访问 `http://localhost`，检查：
- 左侧菜单出现「库存」分组
- 药物页面 CRUD 正常
- 库存预警页面正常
- 开方页面显示库存提示
