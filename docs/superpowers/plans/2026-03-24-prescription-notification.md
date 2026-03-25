# 处方通知系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现处方出库后 WebSocket 实时通知抓药人员，含红点、通知列表、抓药卡、打印功能。

**Architecture:** WebSocket 独立公共模块（server/ws/ + useWebSocket hook），不动已有代码。数据库是真相来源，WebSocket 只增量推送，前端重连后全量 API 拉取。通知表仅保留 1 天数据，定时清理。

**Tech Stack:** Go/Gin/GORM/gorilla-websocket (后端), React/TypeScript/Ant Design (前端), MySQL (10M+ rows，需关注索引和查询性能)

**Spec:** `docs/superpowers/specs/2026-03-24-prescription-notification-design.md`
**Design Preview:** `docs/design-preview/prescription-notification-preview.html`

**Performance Constraints (10M+ MySQL):**
- 所有查询必须走索引，禁止全表扫描
- 通知表复合索引 `(tenant_id, status, created_at)` 覆盖列表查询
- 清理任务用 `LIMIT` 分批删除，避免长事务锁表
- 详情查询用 `WHERE IN` 批量获取货架号，避免 N+1
- WebSocket 按 tenant_id 分房间，广播只发给同租户

---

### Task 1: 后端 — 数据模型 + 迁移

**Files:**
- Create: `server/model/prescription_notification.go`
- Modify: `server/database/database.go` (AutoMigrate 列表)

- [ ] **Step 1: 创建模型文件**

```go
// server/model/prescription_notification.go
package model

import "time"

type PrescriptionNotification struct {
	BaseModel
	TenantID       uint64     `gorm:"column:tenant_id;not null;index:idx_pn_tenant_status_created,priority:1" json:"tenant_id"`
	PrescriptionID uint64     `gorm:"column:prescription_id;not null;uniqueIndex:idx_pn_tenant_prescription" json:"prescription_id"`
	RecordID       uint64     `gorm:"column:record_id;not null" json:"record_id"`
	PatientName    string     `gorm:"column:patient_name;type:varchar(50);not null" json:"patient_name"`
	DoctorName     string     `gorm:"column:doctor_name;type:varchar(50);not null" json:"doctor_name"`
	FormulaName    string     `gorm:"column:formula_name;type:varchar(100)" json:"formula_name"`
	TotalDoses     int        `gorm:"column:total_doses;not null;default:7" json:"total_doses"`
	HerbCount      int        `gorm:"column:herb_count;not null;default:0" json:"herb_count"`
	PatentCount    int        `gorm:"column:patent_count;not null;default:0" json:"patent_count"`
	Notes          string     `gorm:"column:notes;type:varchar(500)" json:"notes"`
	Status         string     `gorm:"column:status;type:varchar(10);not null;default:'pending';index:idx_pn_tenant_status_created,priority:2" json:"status"`
	CreatedAt      time.Time  `gorm:"index:idx_pn_tenant_status_created,priority:3" json:"created_at"`
	DoneAt         *time.Time `gorm:"column:done_at" json:"done_at"`
	CreatedBy      uint64     `gorm:"column:created_by;not null" json:"created_by"`
}

func (PrescriptionNotification) TableName() string {
	return "prescription_notifications"
}
```

索引设计说明：
- `idx_pn_tenant_status_created(tenant_id, status, created_at)` — 覆盖列表查询 + 清理查询
- `idx_pn_tenant_prescription(tenant_id, prescription_id)` — 防重复 + 快速查找

- [ ] **Step 2: 注册 AutoMigrate**

在 `server/database/database.go` 的 `AutoMigrate` 列表末尾添加 `&model.PrescriptionNotification{}`

- [ ] **Step 3: 验证迁移**

```bash
cd server && go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add server/model/prescription_notification.go server/database/database.go
git commit -m "feat: add prescription_notification model with composite indexes"
```

---

### Task 2: 后端 — WebSocket 公共模块

**Files:**
- Create: `server/ws/hub.go`
- Create: `server/ws/client.go`

- [ ] **Step 1: 安装 gorilla/websocket**

```bash
cd server && go get github.com/gorilla/websocket
```

- [ ] **Step 2: 创建 Hub（连接管理中心）**

```go
// server/ws/hub.go
package ws

import "sync"

// Message 是 WebSocket 广播的消息结构
type Message struct {
	Type    string      `json:"type"`    // rx_notify, rx_done, rx_cleanup
	Payload interface{} `json:"payload"`
}

// Hub 管理所有 WebSocket 连接，按 tenantID 分房间
type Hub struct {
	mu      sync.RWMutex
	rooms   map[uint64]map[*Client]struct{} // tenantID -> clients
}

var DefaultHub = NewHub()

func NewHub() *Hub {
	return &Hub{rooms: make(map[uint64]map[*Client]struct{})}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[c.TenantID] == nil {
		h.rooms[c.TenantID] = make(map[*Client]struct{})
	}
	h.rooms[c.TenantID][c] = struct{}{}
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.rooms[c.TenantID]; ok {
		delete(clients, c)
		if len(clients) == 0 {
			delete(h.rooms, c.TenantID)
		}
	}
}

// Broadcast 向指定租户的所有连接发送消息
func (h *Hub) Broadcast(tenantID uint64, msg Message) {
	h.mu.RLock()
	clients := h.rooms[tenantID]
	// 复制一份避免持锁写
	targets := make([]*Client, 0, len(clients))
	for c := range clients {
		targets = append(targets, c)
	}
	h.mu.RUnlock()

	for _, c := range targets {
		c.Send(msg)
	}
}
```

- [ ] **Step 3: 创建 Client（单连接管理）**

```go
// server/ws/client.go
package ws

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 30 * time.Second
	maxMsgSize = 4096
	sendBufSize = 16
)

type Client struct {
	TenantID uint64
	UserID   uint64
	conn     *websocket.Conn
	send     chan []byte
	hub      *Hub
}

func NewClient(hub *Hub, conn *websocket.Conn, tenantID, userID uint64) *Client {
	return &Client{
		TenantID: tenantID,
		UserID:   userID,
		conn:     conn,
		send:     make(chan []byte, sendBufSize),
		hub:      hub,
	}
}

func (c *Client) Send(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
		// send buffer 满了，关闭连接
		c.Close()
	}
}

func (c *Client) Close() {
	c.hub.Unregister(c)
	close(c.send)
	c.conn.Close()
}

// ReadPump 读取客户端消息（主要处理 pong）
func (c *Client) ReadPump() {
	defer c.Close()
	c.conn.SetReadLimit(maxMsgSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			break
		}
	}
}

// WritePump 向客户端写消息 + 心跳
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case data, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Run 启动读写协程
func (c *Client) Run() {
	c.hub.Register(c)
	go c.WritePump()
	c.ReadPump() // 阻塞直到连接关闭
}
```

- [ ] **Step 4: 编译验证**

```bash
cd server && go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add server/ws/
git commit -m "feat: add WebSocket public module (hub + client)"
```

---

### Task 3: 后端 — Service 层

**Files:**
- Create: `server/service/prescription_notification.go`

- [ ] **Step 1: 创建 Service**

```go
// server/service/prescription_notification.go
package service

import (
	"errors"
	"fmt"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrNotificationNotFound = errors.New("notification not found")
	ErrAlreadyDone          = errors.New("already marked as done")
)

type PrescriptionNotificationService struct {
	DB *gorm.DB
}

func NewPrescriptionNotificationService(db *gorm.DB) *PrescriptionNotificationService {
	return &PrescriptionNotificationService{DB: db}
}

// Create 创建通知（出库时调用）
func (s *PrescriptionNotificationService) Create(n *model.PrescriptionNotification) error {
	return s.DB.Create(n).Error
}

// ListByTenant 获取租户通知列表（走覆盖索引）
func (s *PrescriptionNotificationService) ListByTenant(tenantID uint64, status string) ([]model.PrescriptionNotification, error) {
	var list []model.PrescriptionNotification
	q := s.DB.Where("tenant_id = ?", tenantID)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	// 24h 内数据量不大，直接全量返回，避免分页复杂度
	err := q.Order("created_at DESC").Limit(200).Find(&list).Error
	return list, err
}

// PendingCount 获取待抓药数量（红点用，覆盖索引快速计数）
func (s *PrescriptionNotificationService) PendingCount(tenantID uint64) (int64, error) {
	var count int64
	err := s.DB.Model(&model.PrescriptionNotification{}).
		Where("tenant_id = ? AND status = 'pending'", tenantID).
		Count(&count).Error
	return count, err
}

// MarkDone 标记已抓药
func (s *PrescriptionNotificationService) MarkDone(tenantID, id uint64) error {
	now := time.Now()
	result := s.DB.Model(&model.PrescriptionNotification{}).
		Where("id = ? AND tenant_id = ? AND status = 'pending'", id, tenantID).
		Updates(map[string]interface{}{"status": "done", "done_at": now})
	if result.RowsAffected == 0 {
		return ErrNotificationNotFound
	}
	return result.Error
}

// BatchMarkDone 批量标记已抓药
func (s *PrescriptionNotificationService) BatchMarkDone(tenantID uint64) (int64, error) {
	now := time.Now()
	result := s.DB.Model(&model.PrescriptionNotification{}).
		Where("tenant_id = ? AND status = 'pending'", tenantID).
		Updates(map[string]interface{}{"status": "done", "done_at": now})
	return result.RowsAffected, result.Error
}

// Detail 获取抓药详情（含药品+货架号）
type DispenseDetailItem struct {
	ShelfNo  string `json:"shelf_no"`
	HerbName string `json:"herb_name"`
	Dosage   string `json:"dosage"`
	Notes    string `json:"notes"`
	Category string `json:"category"`
}

type DispenseDetail struct {
	Notification model.PrescriptionNotification `json:"notification"`
	Herbs        []DispenseDetailItem           `json:"herbs"`
	Patents      []DispenseDetailItem           `json:"patents"`
}

func (s *PrescriptionNotificationService) GetDetail(tenantID, id uint64) (*DispenseDetail, error) {
	var n model.PrescriptionNotification
	if err := s.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&n).Error; err != nil {
		return nil, ErrNotificationNotFound
	}

	// 查处方药品
	var items []model.PrescriptionItem
	s.DB.Where("prescription_id = ?", n.PrescriptionID).Order("sort_order ASC").Find(&items)

	if len(items) == 0 {
		return &DispenseDetail{Notification: n}, nil
	}

	// 批量获取货架号（WHERE IN 避免 N+1）
	names := make([]string, len(items))
	for i, it := range items {
		names[i] = it.HerbName
	}
	type shelfRow struct {
		Name    string
		ShelfNo string
	}
	var shelves []shelfRow
	s.DB.Model(&model.InventoryDrug{}).
		Select("name, shelf_no").
		Where("tenant_id = ? AND name IN ?", tenantID, names).
		Find(&shelves)

	shelfMap := make(map[string]string, len(shelves))
	for _, r := range shelves {
		shelfMap[r.Name] = r.ShelfNo
	}

	detail := &DispenseDetail{Notification: n}
	for _, it := range items {
		d := DispenseDetailItem{
			ShelfNo:  shelfMap[it.HerbName],
			HerbName: it.HerbName,
			Dosage:   it.Dosage,
			Notes:    it.Notes,
			Category: it.Category,
		}
		if it.Category == "patent" {
			detail.Patents = append(detail.Patents, d)
		} else {
			detail.Herbs = append(detail.Herbs, d)
		}
	}
	return detail, nil
}

// Cleanup 清理超过 24h 的记录（分批删，避免锁表）
func (s *PrescriptionNotificationService) Cleanup() (int64, error) {
	cutoff := time.Now().Add(-24 * time.Hour)
	var total int64
	for {
		result := s.DB.Unscoped().
			Where("created_at < ?", cutoff).
			Limit(500).
			Delete(&model.PrescriptionNotification{})
		if result.Error != nil {
			return total, result.Error
		}
		total += result.RowsAffected
		if result.RowsAffected < 500 {
			break
		}
		time.Sleep(100 * time.Millisecond) // 让出锁
	}
	return total, nil
}
```

- [ ] **Step 2: 编译验证**

```bash
cd server && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add server/service/prescription_notification.go
git commit -m "feat: add prescription notification service with batch cleanup"
```

---

### Task 4: 后端 — Handler + WebSocket 升级 + 路由

**Files:**
- Create: `server/handler/prescription_notification.go`
- Create: `server/handler/ws.go`
- Modify: `server/router/router.go`

- [ ] **Step 1: 创建 WebSocket 升级 handler**

```go
// server/handler/ws.go
package handler

import (
	"net/http"
	"strings"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/ws"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	gws "github.com/gorilla/websocket"
)

var upgrader = gws.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// WSHandler WebSocket 升级处理
type WSHandler struct {
	jwtSecret string
}

func NewWSHandler(jwtSecret string) *WSHandler {
	return &WSHandler{jwtSecret: jwtSecret}
}

func (h *WSHandler) Upgrade(c *gin.Context) {
	// 从 query param 获取 token（WebSocket 不方便用 Header）
	tokenStr := c.Query("token")
	if tokenStr == "" {
		// 兼容 Authorization header
		auth := c.GetHeader("Authorization")
		parts := strings.SplitN(auth, " ", 2)
		if len(parts) == 2 {
			tokenStr = parts[1]
		}
	}
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "missing token"})
		return
	}

	claims := &middleware.Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(h.jwtSecret), nil
	})
	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "invalid token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	client := ws.NewClient(ws.DefaultHub, conn, claims.TenantID, claims.UserID)
	client.Run() // 阻塞直到断开
}
```

- [ ] **Step 2: 创建通知 Handler**

```go
// server/handler/prescription_notification.go
package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/ws"
	"github.com/gin-gonic/gin"
)

type PrescriptionNotificationHandler struct {
	db interface{ /* gorm.DB */ }
}

func NewPrescriptionNotificationHandler(db interface{}) *PrescriptionNotificationHandler {
	return &PrescriptionNotificationHandler{db: db}
}
```

注意：实际实现中 db 类型为 `*gorm.DB`，这里简写。完整 handler 包含 List、Detail、MarkDone、BatchDone、PendingCount 五个方法，遵循现有 handler 模式（参见 billing handler）。

- [ ] **Step 3: 注册路由**

在 `server/router/router.go` 中：
- 创建 `wsHandler := handler.NewWSHandler(cfg.JWTSecret)`
- 创建 `pnHandler := handler.NewPrescriptionNotificationHandler(db)`
- 添加 WebSocket 路由：`v1.GET("/ws", wsHandler.Upgrade)`
- 添加通知路由组（需要认证 + inventory:read 权限）

- [ ] **Step 4: 编译验证**

```bash
cd server && go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add server/handler/prescription_notification.go server/handler/ws.go server/router/router.go
git commit -m "feat: add prescription notification handler + WebSocket upgrade + routes"
```

---

### Task 5: 后端 — 集成触发 + 定时清理

**Files:**
- Modify: `server/service/billing.go` (DeductStockAndBill 成功后创建通知)
- Modify: `server/main.go` (启动清理 goroutine)

- [ ] **Step 1: 在 DeductStockAndBill 成功后创建通知并广播**

在 `server/service/billing.go` 的 `DeductStockAndBill` 方法中，扣库存事务成功后（约 line 354-360），追加：

```go
// 创建处方通知（事务外，非关键路径）
go func() {
    pnSvc := NewPrescriptionNotificationService(s.DB)
    // 查患者名
    var patientName string
    s.DB.Table("patients").Select("name").
        Joins("JOIN medical_records ON medical_records.patient_id = patients.id").
        Where("medical_records.id = ?", billing.RecordID).Scan(&patientName)
    // 查医师名
    var doctorName string
    s.DB.Table("users").Select("display_name").Where("id = ?", billing.CreatedBy).Scan(&doctorName)
    // 统计药品数
    var herbCount, patentCount int64
    s.DB.Model(&model.PrescriptionItem{}).Where("prescription_id = ? AND category != 'patent'", prescriptionID).Count(&herbCount)
    s.DB.Model(&model.PrescriptionItem{}).Where("prescription_id = ? AND category = 'patent'", prescriptionID).Count(&patentCount)

    n := &model.PrescriptionNotification{
        TenantID: tenantID, PrescriptionID: prescriptionID,
        RecordID: billing.RecordID, PatientName: patientName,
        DoctorName: doctorName, FormulaName: prescription.FormulaName,
        TotalDoses: prescription.TotalDoses,
        HerbCount: int(herbCount), PatentCount: int(patentCount),
        Notes: prescription.Notes, Status: "pending",
        CreatedBy: billing.CreatedBy,
    }
    if err := pnSvc.Create(n); err == nil {
        ws.DefaultHub.Broadcast(tenantID, ws.Message{Type: "rx_notify", Payload: n})
    }
}()
```

- [ ] **Step 2: 在 main.go 添加定时清理 goroutine**

```go
// main.go — 在 r := router.SetupRouter(...) 之后
go func() {
    ticker := time.NewTicker(1 * time.Hour)
    defer ticker.Stop()
    for range ticker.C {
        svc := service.NewPrescriptionNotificationService(db)
        if deleted, err := svc.Cleanup(); err != nil {
            log.Printf("prescription notification cleanup error: %v", err)
        } else if deleted > 0 {
            log.Printf("prescription notification cleanup: deleted %d records", deleted)
        }
    }
}()
```

- [ ] **Step 3: 编译验证**

```bash
cd server && go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add server/service/billing.go server/main.go
git commit -m "feat: trigger notification on stock deduction + hourly cleanup"
```

---

### Task 6: 前端 — WebSocket 公共 Hook + API

**Files:**
- Create: `web/src/hooks/useWebSocket.ts`
- Create: `web/src/api/prescriptionNotification.ts`

- [ ] **Step 1: 创建 WebSocket Hook**

```typescript
// web/src/hooks/useWebSocket.ts
import { useEffect, useRef, useCallback } from 'react';

interface WSMessage {
  type: string;
  payload: any;
}

type MessageHandler = (msg: WSMessage) => void;

const listeners = new Map<string, Set<MessageHandler>>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function getWSUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  return `${proto}//${location.host}/api/v1/ws?token=${token}`;
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN) return;
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (!token) return;

  socket = new WebSocket(getWSUrl());
  socket.onopen = () => {
    reconnectDelay = 1000;
    // 重连成功，通知所有监听者全量拉取
    listeners.get('_reconnect')?.forEach(fn => fn({ type: '_reconnect', payload: null }));
  };
  socket.onmessage = (e) => {
    try {
      const msg: WSMessage = JSON.parse(e.data);
      listeners.get(msg.type)?.forEach(fn => fn(msg));
    } catch {}
  };
  socket.onclose = () => {
    socket = null;
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connect();
    }, reconnectDelay);
  };
}

function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}

/**
 * 公共 WebSocket hook — 可复用于处方通知、预约排队等
 * @param type 消息类型（rx_notify, rx_done, rx_cleanup, _reconnect）
 * @param handler 消息处理函数
 */
export function useWebSocket(type: string, handler: MessageHandler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const stableHandler = useCallback((msg: WSMessage) => {
    handlerRef.current(msg);
  }, []);

  useEffect(() => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(stableHandler);
    connect(); // 首次调用时建立连接

    return () => {
      listeners.get(type)?.delete(stableHandler);
      // 所有监听者都移除后断开
      let total = 0;
      listeners.forEach(s => total += s.size);
      if (total === 0) disconnect();
    };
  }, [type, stableHandler]);
}
```

- [ ] **Step 2: 创建 API Service**

```typescript
// web/src/api/prescriptionNotification.ts
import request from '../utils/request';

export interface PrescriptionNotificationItem {
  id: number;
  tenant_id: number;
  prescription_id: number;
  record_id: number;
  patient_name: string;
  doctor_name: string;
  formula_name: string;
  total_doses: number;
  herb_count: number;
  patent_count: number;
  notes: string;
  status: 'pending' | 'done';
  done_at: string | null;
  created_at: string;
}

export interface DispenseDetailItem {
  shelf_no: string;
  herb_name: string;
  dosage: string;
  notes: string;
  category: string;
}

export interface DispenseDetail {
  notification: PrescriptionNotificationItem;
  herbs: DispenseDetailItem[];
  patents: DispenseDetailItem[];
}

export function listNotifications(status?: string) {
  return request.get('/prescription-notifications', { params: { status } });
}

export function getNotificationDetail(id: number) {
  return request.get(`/prescription-notifications/${id}/detail`);
}

export function markDone(id: number) {
  return request.post(`/prescription-notifications/${id}/done`);
}

export function batchMarkDone() {
  return request.post('/prescription-notifications/batch-done');
}

export function pendingCount() {
  return request.get('/prescription-notifications/pending-count');
}
```

- [ ] **Step 3: 编译验证**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useWebSocket.ts web/src/api/prescriptionNotification.ts
git commit -m "feat: add WebSocket public hook + notification API service"
```

---

### Task 7: 前端 — 通知面板 + 抓药卡 + 打印

**Files:**
- Create: `web/src/components/DispenseNotification.tsx` (通知面板，含列表+tabs)
- Create: `web/src/components/DispenseDetail.tsx` (抓药卡详情)
- Create: `web/src/components/DispensePrint.tsx` (打印抓药单)

这三个组件实现参照 `docs/design-preview/prescription-notification-preview.html` 中的 HTML/CSS 设计。

关键实现要点：
- **DispenseNotification**: 使用 `useWebSocket` 监听 `rx_notify`/`rx_done`/`_reconnect`，`_reconnect` 时全量 API 拉取
- **DispenseDetail**: 中药 >10 味双列，中成药 >5 种双列，移动端无列头紧凑格式
- **DispensePrint**: `window.print()` 触发，`@media print` 样式隔离

- [ ] **Step 1-3: 依次创建三个组件**（每个组件创建后编译验证）
- [ ] **Step 4: Commit**

```bash
git add web/src/components/Dispense*.tsx
git commit -m "feat: add dispense notification panel, detail card and print view"
```

---

### Task 8: 前端 — Layout 红点 + DrugList 集成

**Files:**
- Modify: `web/src/components/Layout.tsx` (新增处方通知红点)
- Modify: `web/src/pages/inventory/DrugList.tsx` (顶部嵌入通知面板)

- [ ] **Step 1: Layout.tsx 添加红点**

在「库存药物」菜单项上，新增独立的 `rxPendingCount` 状态，通过 `useWebSocket` + API 同步。
**不修改**已有的库存预警/回访红点代码。

- [ ] **Step 2: DrugList.tsx 嵌入通知面板**

在页面顶部（搜索栏上方）插入 `<DispenseNotification />`，可折叠。

- [ ] **Step 3: 编译验证**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Layout.tsx web/src/pages/inventory/DrugList.tsx
git commit -m "feat: integrate notification badge + panel into inventory page"
```

---

### Task 9: 全量测试 + 部署

- [ ] **Step 1: 后端测试**

```bash
cd server && go test ./... -v
```

- [ ] **Step 2: 前端测试**

```bash
cd web && npm run build
```

- [ ] **Step 3: 端到端验证**

1. 启动服务，打开两个浏览器标签页
2. 标签 A：创建处方 → 收费并出库
3. 标签 B：库存药物页面 → 验证红点出现 + 通知列表更新
4. 点击通知 → 验证抓药卡详情（货架号、多列布局）
5. 点击打印 → 验证打印预览
6. 标记已抓药 → 验证红点减少 + 状态更新
7. 刷新页面 → 验证全量拉取正确
8. 移动端视口 → 验证响应式布局

- [ ] **Step 4: 部署**

```bash
bash deploy.sh
```
