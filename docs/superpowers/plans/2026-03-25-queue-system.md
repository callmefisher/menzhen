# 排队叫号系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为门诊管理系统实现排队叫号功能，包括全局看板、医生叫号、患者列表联动、移动端适配、跨天清理。

**Architecture:** 后端 Go/Gin/GORM 新增 QueueEntry 模型 + Service + Handler + WebSocket 消息（复用已有 ws 模块）。前端 React/Antd 新增排队看板页 + 患者列表叫号条组件。功能开关控制 UI 显隐。

**Tech Stack:** Go + Gin + GORM + MySQL | React + TypeScript + Ant Design | WebSocket (existing ws module) | Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-03-25-queue-system-design.md`

**Design Previews:** `docs/design-preview/phase1-*.html`, `phase2*.html`

---

## File Structure

### New Backend Files
- `server/model/queue.go` — QueueEntry + QueueSeq models
- `server/service/queue.go` — Queue service (CRUD + state machine + cleanup)
- `server/service/queue_test.go` — Queue service tests
- `server/handler/queue.go` — Queue HTTP handlers + WS broadcast
- `server/handler/queue_test.go` — Queue handler tests

### New Frontend Files
- `web/src/api/queue.ts` — Queue API service
- `web/src/pages/queue/QueueDashboard.tsx` — 排队看板页面
- `web/src/components/QueueStrip.tsx` — 患者列表页管道式叫号条
- `web/src/components/CallOverlay.tsx` — 医生卡片内叫号弹窗
- `web/src/pages/queue/__tests__/QueueDashboard.test.tsx` — 看板测试

### Modify Files
- `server/database/seed.go` — 添加 queue 权限
- `server/database/database.go` — AutoMigrate 注册
- `server/router/router.go` — 注册 queue 路由
- `server/main.go` — 添加跨天清理 goroutine
- `web/src/components/Layout.tsx` — 添加排队叫号菜单 + badge
- `web/src/App.tsx` — 添加 /queue 路由
- `web/src/pages/patients/PatientList.tsx` — 集成 QueueStrip + 状态标签

---

## Task 1: 数据模型 + 权限种子

**Files:**
- Create: `server/model/queue.go`
- Modify: `server/database/database.go`
- Modify: `server/database/seed.go`

- [ ] **Step 1: 创建 QueueEntry + QueueSeq 模型**

```go
// server/model/queue.go
package model

import "time"

type QueueEntry struct {
	ID          uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID    uint      `gorm:"column:tenant_id;not null;index:idx_queue_tenant_date_status,priority:1" json:"tenant_id"`
	PatientID   *uint     `gorm:"column:patient_id" json:"patient_id"`
	PatientName string    `gorm:"column:patient_name;type:varchar(50);not null" json:"patient_name"`
	DoctorID    uint      `gorm:"column:doctor_id;not null;index:idx_queue_tenant_doctor" json:"doctor_id"`
	DoctorName  string    `gorm:"column:doctor_name;type:varchar(50);not null" json:"doctor_name"`
	Room        string    `gorm:"column:room;type:varchar(50)" json:"room"`
	SeqNumber   int       `gorm:"column:seq_number;not null" json:"seq_number"`
	Status      string    `gorm:"column:status;type:varchar(20);not null;default:waiting;index:idx_queue_tenant_date_status,priority:3" json:"status"`
	BookedTime  string    `gorm:"column:booked_time;type:varchar(10)" json:"booked_time"`
	ArrivalTime *time.Time `gorm:"column:arrival_time" json:"arrival_time"`
	CalledAt    *time.Time `gorm:"column:called_at" json:"called_at"`
	CompletedAt *time.Time `gorm:"column:completed_at" json:"completed_at"`
	Source      string    `gorm:"column:source;type:varchar(20);not null;default:walk_in" json:"source"`
	QueueDate   string    `gorm:"column:queue_date;type:date;not null;index:idx_queue_tenant_date_status,priority:2" json:"queue_date"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (QueueEntry) TableName() string { return "queue_entries" }

type QueueSeq struct {
	ID        uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	TenantID  uint   `gorm:"column:tenant_id;not null;uniqueIndex:idx_qs_tenant_date" json:"tenant_id"`
	QueueDate string `gorm:"column:queue_date;type:date;not null;uniqueIndex:idx_qs_tenant_date" json:"queue_date"`
	LastSeq   int    `gorm:"column:last_seq;not null;default:0" json:"last_seq"`
}

func (QueueSeq) TableName() string { return "queue_seqs" }
```

- [ ] **Step 2: 注册 AutoMigrate**

在 `server/database/database.go` 的 `AutoMigrate` 调用中添加 `&model.QueueEntry{}, &model.QueueSeq{}`

- [ ] **Step 3: 添加权限种子数据**

在 `server/database/seed.go` 的权限列表中添加：
```go
{Code: "queue:read", Name: "查看排队"},
{Code: "queue:create", Name: "取号"},
{Code: "queue:update", Name: "叫号/完成"},
{Code: "queue:clear", Name: "清空排队"},
```
并将 `queue:read`, `queue:create`, `queue:update` 添加到默认医生角色。

- [ ] **Step 4: 验证迁移**

```bash
cd server && go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add server/model/queue.go server/database/database.go server/database/seed.go
git commit -m "feat: add queue entry model + permissions seed"
```

---

## Task 2: Queue Service — 核心业务逻辑

**Files:**
- Create: `server/service/queue.go`

- [ ] **Step 1: 创建 service 骨架**

```go
// server/service/queue.go
package service

import (
	"errors"
	"fmt"
	"time"

	"menzhen/server/model"
	"menzhen/server/ws"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var (
	ErrQueueEntryNotFound = errors.New("queue entry not found")
	ErrInvalidStatus      = errors.New("invalid queue status transition")
)

type QueueService struct {
	DB *gorm.DB
}

func NewQueueService(db *gorm.DB) *QueueService {
	return &QueueService{DB: db}
}

func today() string { return time.Now().Format("2006-01-02") }
```

- [ ] **Step 2: NextSeq — 原子序号生成**

```go
func (s *QueueService) NextSeq(tenantID uint) (int, error) {
	date := today()
	result := s.DB.Exec(
		"INSERT INTO queue_seqs (tenant_id, queue_date, last_seq) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE last_seq = last_seq + 1",
		tenantID, date,
	)
	if result.Error != nil {
		return 0, result.Error
	}
	var seq QueueSeqResult
	if err := s.DB.Raw("SELECT last_seq FROM queue_seqs WHERE tenant_id = ? AND queue_date = ?", tenantID, date).Scan(&seq).Error; err != nil {
		return 0, err
	}
	return seq.LastSeq, nil
}

type QueueSeqResult struct {
	LastSeq int
}
```

- [ ] **Step 3: TakeNumber — 现场取号**

```go
func (s *QueueService) TakeNumber(tenantID uint, patientName string, doctorID uint, doctorName, room string) (*model.QueueEntry, error) {
	seq, err := s.NextSeq(tenantID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	entry := &model.QueueEntry{
		TenantID:    tenantID,
		PatientName: patientName,
		DoctorID:    doctorID,
		DoctorName:  doctorName,
		Room:        room,
		SeqNumber:   seq,
		Status:      "waiting",
		ArrivalTime: &now,
		Source:      "walk_in",
		QueueDate:   today(),
	}
	if err := s.DB.Create(entry).Error; err != nil {
		return nil, err
	}
	return entry, nil
}
```

- [ ] **Step 4: ListToday — 查询今日队列**

```go
func (s *QueueService) ListToday(tenantID uint, doctorID *uint) ([]model.QueueEntry, error) {
	var entries []model.QueueEntry
	q := s.DB.Where("tenant_id = ? AND queue_date = ?", tenantID, today())
	if doctorID != nil {
		q = q.Where("doctor_id = ?", *doctorID)
	}
	if err := q.Order("seq_number ASC").Find(&entries).Error; err != nil {
		return nil, err
	}
	return entries, nil
}
```

- [ ] **Step 5: Call — 叫号（状态→seeing）**

```go
func (s *QueueService) Call(tenantID, entryID uint) (*model.QueueEntry, error) {
	var entry model.QueueEntry
	if err := s.DB.Where("id = ? AND tenant_id = ?", entryID, tenantID).First(&entry).Error; err != nil {
		return nil, ErrQueueEntryNotFound
	}
	if entry.Status != "waiting" && entry.Status != "ready" {
		return nil, ErrInvalidStatus
	}
	now := time.Now()
	entry.Status = "seeing"
	entry.CalledAt = &now
	if err := s.DB.Save(&entry).Error; err != nil {
		return nil, err
	}
	return &entry, nil
}
```

- [ ] **Step 6: Complete — 完成就诊 + 自动叫下一位**

```go
func (s *QueueService) Complete(tenantID, entryID uint) (*model.QueueEntry, *model.QueueEntry, error) {
	var entry model.QueueEntry
	if err := s.DB.Where("id = ? AND tenant_id = ?", entryID, tenantID).First(&entry).Error; err != nil {
		return nil, nil, ErrQueueEntryNotFound
	}
	if entry.Status != "seeing" {
		return nil, nil, ErrInvalidStatus
	}
	now := time.Now()
	entry.Status = "done"
	entry.CompletedAt = &now
	if err := s.DB.Save(&entry).Error; err != nil {
		return nil, nil, err
	}
	// 自动叫下一位
	var next model.QueueEntry
	err := s.DB.Where("tenant_id = ? AND queue_date = ? AND doctor_id = ? AND status = ?",
		tenantID, today(), entry.DoctorID, "waiting").
		Order("seq_number ASC").First(&next).Error
	if err == nil {
		callTime := time.Now()
		next.Status = "seeing"
		next.CalledAt = &callTime
		s.DB.Save(&next)
		return &entry, &next, nil
	}
	return &entry, nil, nil
}
```

- [ ] **Step 7: Stats — 统计数据**

```go
func (s *QueueService) Stats(tenantID uint) (map[string]int64, error) {
	stats := map[string]int64{}
	var results []struct {
		Status string
		Count  int64
	}
	if err := s.DB.Model(&model.QueueEntry{}).
		Select("status, count(*) as count").
		Where("tenant_id = ? AND queue_date = ?", tenantID, today()).
		Group("status").Find(&results).Error; err != nil {
		return nil, err
	}
	for _, r := range results {
		stats[r.Status] = r.Count
	}
	return stats, nil
}
```

- [ ] **Step 8: Clear + CrossDayCleanup**

```go
func (s *QueueService) Clear(tenantID uint) (int64, error) {
	result := s.DB.Where("tenant_id = ? AND queue_date = ?", tenantID, today()).Delete(&model.QueueEntry{})
	return result.RowsAffected, result.Error
}

func (s *QueueService) CrossDayCleanup() (int64, error) {
	date := today()
	var total int64
	for {
		result := s.DB.Where("queue_date < ?", date).Limit(500).Delete(&model.QueueEntry{})
		if result.Error != nil {
			return total, result.Error
		}
		total += result.RowsAffected
		if result.RowsAffected < 500 {
			break
		}
	}
	return total, nil
}
```

- [ ] **Step 9: 编译验证**

```bash
cd server && go build ./...
```

- [ ] **Step 10: Commit**

```bash
git add server/service/queue.go
git commit -m "feat: add queue service with take/call/complete/clear/cleanup"
```

---

## Task 3: Queue Service 测试

**Files:**
- Create: `server/service/queue_test.go`

- [ ] **Step 1: 写测试 — 取号 + 叫号 + 完成流程**

测试场景：
1. TakeNumber 正常取号，序号自增
2. ListToday 按医生筛选
3. Call 叫号状态转换
4. Complete 完成 + 自动叫下一位
5. Clear 清空
6. CrossDayCleanup 跨天清理
7. 租户隔离：不同租户数据不可互访
8. 无效状态转换：对 done 状态调用 Call 应返错

使用 `testutil.SetupTestDB(t)` + `testutil.SeedTestTenant` 模式。

- [ ] **Step 2: 运行测试确认全部通过**

```bash
cd server && go test ./service/ -run TestQueue -v
```

- [ ] **Step 3: Commit**

```bash
git add server/service/queue_test.go
git commit -m "test: add queue service tests"
```

---

## Task 4: Queue Handler + Router

**Files:**
- Create: `server/handler/queue.go`
- Modify: `server/router/router.go`
- Modify: `server/main.go`

- [ ] **Step 1: 创建 handler**

Handler 方法：`List`, `TakeNumber`, `Call`, `Complete`, `Clear`, `Stats`

每个方法：
- 从 middleware 获取 tenantID
- 调用 service
- WebSocket 广播变更：`ws.DefaultHub.Broadcast(tenantID, ws.Message{Type: "queue_update", Payload: ...})`
- Call 方法额外广播 `queue_call` 消息

- [ ] **Step 2: 注册路由**

在 `server/router/router.go` 添加：
```go
queueHandler := handler.NewQueueHandler(db)
queue := authenticated.Group("/queue")
{
    queue.GET("", middleware.RequirePermission(db, "queue:read"), queueHandler.List)
    queue.POST("/take", middleware.RequirePermission(db, "queue:create"), queueHandler.TakeNumber)
    queue.POST("/:id/call", middleware.RequirePermission(db, "queue:update"), queueHandler.Call)
    queue.POST("/:id/complete", middleware.RequirePermission(db, "queue:update"), queueHandler.Complete)
    queue.POST("/clear", middleware.RequirePermission(db, "queue:clear"), queueHandler.Clear)
    queue.GET("/stats", middleware.RequirePermission(db, "queue:read"), queueHandler.Stats)
}
```

- [ ] **Step 3: 添加跨天清理到 main.go**

```go
// Cross-day queue cleanup: check at startup + daily at 00:01
go func() {
    svc := service.NewQueueService(db)
    if deleted, err := svc.CrossDayCleanup(); err != nil {
        log.Printf("queue cleanup error: %v", err)
    } else if deleted > 0 {
        log.Printf("queue cleanup: deleted %d old entries", deleted)
    }
    // Daily check
    ticker := time.NewTicker(1 * time.Hour)
    defer ticker.Stop()
    for range ticker.C {
        if deleted, err := svc.CrossDayCleanup(); err != nil {
            log.Printf("queue cleanup error: %v", err)
        } else if deleted > 0 {
            log.Printf("queue cleanup: deleted %d old entries", deleted)
        }
    }
}()
```

- [ ] **Step 4: 编译验证 + 全量测试**

```bash
cd server && go build ./... && go test ./...
```

- [ ] **Step 5: Commit**

```bash
git add server/handler/queue.go server/router/router.go server/main.go
git commit -m "feat: add queue handler + routes + cross-day cleanup"
```

---

## Task 5: 前端 API Service + 路由

**Files:**
- Create: `web/src/api/queue.ts`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 创建 API service**

```typescript
// web/src/api/queue.ts
import request from '../utils/request';

export interface QueueEntry {
  id: number;
  tenant_id: number;
  patient_id?: number;
  patient_name: string;
  doctor_id: number;
  doctor_name: string;
  room: string;
  seq_number: number;
  status: 'waiting' | 'ready' | 'seeing' | 'done' | 'missed';
  booked_time?: string;
  arrival_time?: string;
  called_at?: string;
  completed_at?: string;
  source: 'walk_in' | 'appointment';
  queue_date: string;
  created_at: string;
}

export interface QueueStats {
  waiting: number;
  seeing: number;
  done: number;
  missed: number;
}

export const listQueue = (doctorId?: number) =>
  request.get<{ list: QueueEntry[] }>('/queue', { params: { doctor_id: doctorId } });

export const takeNumber = (data: { patient_name: string; doctor_id: number }) =>
  request.post<{ entry: QueueEntry }>('/queue/take', data);

export const callNumber = (id: number) =>
  request.post<{ entry: QueueEntry }>(`/queue/${id}/call`);

export const completeVisit = (id: number) =>
  request.post<{ completed: QueueEntry; next?: QueueEntry }>(`/queue/${id}/complete`);

export const clearQueue = () =>
  request.post('/queue/clear');

export const getQueueStats = () =>
  request.get<QueueStats>('/queue/stats');
```

- [ ] **Step 2: 添加路由到 App.tsx**

```typescript
import QueueDashboard from './pages/queue/QueueDashboard';
// 在 Routes 中添加:
<Route path="queue" element={<QueueDashboard />} />
```

- [ ] **Step 3: 前端编译验证**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/api/queue.ts web/src/App.tsx
git commit -m "feat: add queue API service + route"
```

---

## Task 6: 排队看板页面（第1阶段核心 UI）

**Files:**
- Create: `web/src/pages/queue/QueueDashboard.tsx`
- Create: `web/src/components/CallOverlay.tsx`
- Modify: `web/src/components/Layout.tsx`

- [ ] **Step 1: 创建 CallOverlay 组件**

卡片内独立弹窗组件，props: `{visible, seq, name, room, doctor, onClose, duration=15}`

- [ ] **Step 2: 创建 QueueDashboard 页面**

包含：
- 统计条（候诊/就诊/完成 + 一键清空）
- 滚动速度滑块
- 医生卡片网格（自适应1/2/2x2/2xN）
- 每张卡片内：队列列表（就诊中/请准备/候诊中 三种行样式）+ CallOverlay
- 卡片头部：叫号按钮
- 就诊中行：再次叫号 + 完成按钮
- 底部取号栏
- WebSocket 监听 `queue_update` / `queue_call` / `_reconnect`
- HTTP 降级轮询（WebSocket 不可用时 3秒轮询）
- hover 提示「前方还有N位」

- [ ] **Step 3: Layout 添加菜单项 + badge**

在 `web/src/components/Layout.tsx` 菜单项中添加排队叫号，带候诊人数 badge。

- [ ] **Step 4: 前端编译 + 手动验证**

```bash
cd web && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/queue/ web/src/components/CallOverlay.tsx web/src/components/Layout.tsx
git commit -m "feat: add queue dashboard page with call overlay"
```

---

## Task 7: 患者列表页叫号条 + 状态联动

**Files:**
- Create: `web/src/components/QueueStrip.tsx`
- Modify: `web/src/pages/patients/PatientList.tsx`

- [ ] **Step 1: 创建 QueueStrip 管道式叫号条**

管道式布局：等候池 → 候诊芯片 → 流动光点 → 请准备 → 就诊中+完成按钮
只显示当前登录医生的队列。

- [ ] **Step 2: 集成到 PatientList**

- 顶部插入 QueueStrip（功能开关控制显隐）
- 表格行中就诊中/请准备患者显示状态标签 + 行高亮
- 叫号操作联动排队看板页弹窗（通过 WebSocket `queue_call` 消息）

- [ ] **Step 3: 前端编译验证**

```bash
cd web && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/QueueStrip.tsx web/src/pages/patients/PatientList.tsx
git commit -m "feat: add queue strip + status tags in patient list"
```

---

## Task 8: 移动端适配

**Files:**
- Modify: `web/src/pages/queue/QueueDashboard.tsx`
- Modify: `web/src/components/QueueStrip.tsx`
- Modify: `web/src/pages/patients/PatientList.tsx`

- [ ] **Step 1: QueueDashboard 移动端**

- 检测 `useIsMobile()`
- 桌面端：卡片网格布局
- 移动端：Tab 切换医生，每个 Tab 纵向队列列表

- [ ] **Step 2: QueueStrip 移动端**

- 管道式简化为紧凑横条，可横向滚动

- [ ] **Step 3: PatientList 移动端**

- 患者表格在移动端已有卡片模式，确保状态标签在卡片中正确显示

- [ ] **Step 4: 前端编译验证**

```bash
cd web && npm run build
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: mobile responsive for queue dashboard + strip"
```

---

## Task 9: 全面测试

**Files:**
- Modify: `server/service/queue_test.go` — 补充边界测试
- Create: `web/src/pages/queue/__tests__/QueueDashboard.test.tsx`

- [ ] **Step 1: 后端测试补全**

补充：并发取号序号、权限拒绝、空队列完成、跨天清理边界

```bash
cd server && go test ./... -v
```

- [ ] **Step 2: 前端测试**

- QueueDashboard：渲染医生卡片、取号交互、叫号弹窗
- QueueStrip：管道条显示/隐藏
- WebSocket 消息处理 mock

```bash
cd web && npm run test
```

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add comprehensive queue system tests"
```

---

## Task 10: Review + 部署

- [ ] **Step 1: 第一轮 review** — 代码审查（安全/质量/模式）
- [ ] **Step 2: 修复 review 问题**
- [ ] **Step 3: 第二轮 review** — 确认修复
- [ ] **Step 4: 全量测试通过**

```bash
cd server && go test ./... && cd ../web && npm run build && npm run test
```

- [ ] **Step 5: 部署**

```bash
./deploy.sh
```
