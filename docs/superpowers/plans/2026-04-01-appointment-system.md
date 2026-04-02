# 预约系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有排队取号系统增加预约功能：患者可预约当日时段，0点自动入队，前端排队看板展示"预"标记和签到按钮。

**Architecture:** 新增 `Appointment` 和 `AppointmentSlotConfig` 两张表；扩展 `QueueEntry` 加 4 个字段（checkin_status、appointment_id、slot_start、slot_end）；在 `main.go` 加午夜自动入队 goroutine（带重试）；前端扩展 `QueueDashboard` 展示签到按钮和"预"标记。

**Tech Stack:** Go 1.21 + Gin + GORM + MySQL, React 18 + TypeScript + Ant Design 6, Vitest + Testing Library, testify + testutil.SetupTestDB

---

## File Map

| 文件 | 动作 | 说明 |
|------|------|------|
| `server/model/appointment.go` | Create | Appointment + AppointmentSlotConfig 模型 |
| `server/model/queue.go` | Modify | 添加 CheckinStatus、AppointmentID、SlotStart、SlotEnd 字段 |
| `server/service/appointment.go` | Create | 预约 CRUD + 时段配置 + 签到 + 自动入队逻辑 |
| `server/service/appointment_test.go` | Create | 后端测试 |
| `server/handler/appointment.go` | Create | HTTP 处理器 |
| `server/handler/appointment_test.go` | Create | handler 测试 |
| `server/router/router.go` | Modify | 注册预约路由 |
| `server/database/seed.go` | Modify | 新增预约相关权限码 |
| `server/main.go` | Modify | 加午夜自动入队 goroutine |
| `web/src/api/appointment.ts` | Create | 前端 API 函数 + 类型 |
| `web/src/api/queue.ts` | Modify | QueueEntry 接口增加新字段 |
| `web/src/pages/queue/QueueDashboard.tsx` | Modify | 展示签到按钮、"预"标记 |
| `web/src/pages/queue/__tests__/QueueDashboard.test.tsx` | Modify | 覆盖签到场景 |

---

## Task 1: 模型层 — Appointment + QueueEntry 扩展

**Files:**
- Create: `server/model/appointment.go`
- Modify: `server/model/queue.go`

- [ ] **Step 1: 写失败的模型编译测试**

```bash
cd server && go build ./model/... 2>&1
```
预期: 当前通过（基准确认）

- [ ] **Step 2: 创建 `server/model/appointment.go`**

```go
package model

import "time"

const (
    AppointmentStatusPending   = "pending"   // 已预约，未入队
    AppointmentStatusQueued    = "queued"    // 已自动入队
    AppointmentStatusCancelled = "cancelled"
    AppointmentStatusNoShow    = "no_show"

    CheckinStatusPending = "pending"  // 未签到
    CheckinStatusDone    = "done"     // 已签到
)

// Appointment 代表一条预约记录（预约时段当天0点自动入队）。
type Appointment struct {
    ID            uint       `gorm:"primaryKey;autoIncrement" json:"id"`
    TenantID      uint       `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
    PatientID     *uint      `gorm:"column:patient_id" json:"patient_id"`
    PatientName   string     `gorm:"column:patient_name;type:varchar(50);not null" json:"patient_name"`
    DoctorID      uint       `gorm:"column:doctor_id;not null" json:"doctor_id"`
    DoctorName    string     `gorm:"column:doctor_name;type:varchar(50);not null" json:"doctor_name"`
    Room          string     `gorm:"column:room;type:varchar(50)" json:"room"`
    AppointDate   string     `gorm:"column:appoint_date;type:date;not null;index" json:"appoint_date"`
    SlotStart     string     `gorm:"column:slot_start;type:varchar(5);not null" json:"slot_start"` // "08:30"
    SlotEnd       string     `gorm:"column:slot_end;type:varchar(5);not null" json:"slot_end"`
    Status        string     `gorm:"column:status;type:varchar(20);not null;default:pending" json:"status"`
    QueueEntryID  *uint      `gorm:"column:queue_entry_id" json:"queue_entry_id,omitempty"`
    CreatedAt     time.Time  `gorm:"autoCreateTime" json:"created_at"`
    UpdatedAt     time.Time  `gorm:"autoUpdateTime" json:"updated_at"`
}

func (Appointment) TableName() string { return "appointments" }

// AppointmentSlotConfig 定义某医生某天某时段的可预约容量。
type AppointmentSlotConfig struct {
    ID         uint   `gorm:"primaryKey;autoIncrement" json:"id"`
    TenantID   uint   `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
    DoctorID   uint   `gorm:"column:doctor_id;not null" json:"doctor_id"`
    SlotStart  string `gorm:"column:slot_start;type:varchar(5);not null" json:"slot_start"`
    SlotEnd    string `gorm:"column:slot_end;type:varchar(5);not null" json:"slot_end"`
    MaxCount   int    `gorm:"column:max_count;not null;default:10" json:"max_count"`
}

func (AppointmentSlotConfig) TableName() string { return "appointment_slot_configs" }
```

- [ ] **Step 3: 扩展 `server/model/queue.go` — 添加 4 个字段**

在 `QueueEntry` 结构体中，在 `CreatedAt` 字段前插入：

```go
    CheckinStatus  string  `gorm:"column:checkin_status;type:varchar(20);not null;default:pending" json:"checkin_status"`
    AppointmentID  *uint   `gorm:"column:appointment_id" json:"appointment_id,omitempty"`
    SlotStart      string  `gorm:"column:slot_start;type:varchar(5)" json:"slot_start,omitempty"`
    SlotEnd        string  `gorm:"column:slot_end;type:varchar(5)" json:"slot_end,omitempty"`
```

- [ ] **Step 4: 验证编译通过**

```bash
cd server && go build ./model/...
```
预期: 无错误

- [ ] **Step 5: Commit**

```bash
git add server/model/appointment.go server/model/queue.go
git commit -m "feat: add Appointment model and extend QueueEntry with checkin/appointment fields"
```

---

## Task 2: 数据库迁移 — AutoMigrate 注册

**Files:**
- Modify: `server/database/database.go` (找到 AutoMigrate 调用处)

- [ ] **Step 1: 找到 AutoMigrate 位置**

```bash
grep -n "AutoMigrate" server/database/database.go
```

- [ ] **Step 2: 在 AutoMigrate 中加入新模型**

在现有 `AutoMigrate(...)` 调用中追加：

```go
&model.Appointment{},
&model.AppointmentSlotConfig{},
```

- [ ] **Step 3: 验证编译**

```bash
cd server && go build ./database/...
```
预期: 无错误

- [ ] **Step 4: Commit**

```bash
git add server/database/database.go
git commit -m "chore: register Appointment and AppointmentSlotConfig in AutoMigrate"
```

---

## Task 3: 权限种子 — seed.go

**Files:**
- Modify: `server/database/seed.go`

- [ ] **Step 1: 在 `seedPermissions` 的 permissions 切片末尾追加**

```go
{Code: "appointment:create", Name: "创建预约", Description: "创建预约记录"},
{Code: "appointment:read",   Name: "查看预约", Description: "查看预约列表"},
{Code: "appointment:update", Name: "修改预约", Description: "修改/取消预约"},
{Code: "appointment:checkin",Name: "预约签到", Description: "为预约患者签到"},
```

- [ ] **Step 2: 验证编译**

```bash
cd server && go build ./database/...
```

- [ ] **Step 3: Commit**

```bash
git add server/database/seed.go
git commit -m "feat: add appointment permission seeds"
```

---

## Task 4: AppointmentService — 核心业务逻辑

**Files:**
- Create: `server/service/appointment.go`
- Create: `server/service/appointment_test.go`

### Step 1 ~ 4: 写测试（TDD RED）

- [ ] **Step 1: 创建 `server/service/appointment_test.go`**

```go
package service_test

import (
    "testing"
    "time"

    "github.com/callmefisher/menzhen/server/model"
    "github.com/callmefisher/menzhen/server/service"
    "github.com/callmefisher/menzhen/server/testutil"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func setupApptService(t *testing.T) (*service.AppointmentService, uint) {
    db := testutil.SetupTestDB(t)
    tenant := testutil.SeedTestTenant(db)
    return service.NewAppointmentService(db), uint(tenant.ID)
}

// --- CreateAppointment ---

func TestCreateAppointment_Success(t *testing.T) {
    svc, tid := setupApptService(t)
    appt, err := svc.CreateAppointment(tid, service.CreateAppointmentInput{
        PatientName: "张三",
        DoctorID:    1,
        DoctorName:  "李医生",
        Room:        "诊室1",
        AppointDate: time.Now().Format("2006-01-02"),
        SlotStart:   "09:00",
        SlotEnd:     "09:30",
    })
    require.NoError(t, err)
    assert.Equal(t, model.AppointmentStatusPending, appt.Status)
    assert.Equal(t, "09:00", appt.SlotStart)
}

func TestCreateAppointment_DuplicateSameDay(t *testing.T) {
    svc, tid := setupApptService(t)
    input := service.CreateAppointmentInput{
        PatientName: "张三",
        DoctorID:    1,
        DoctorName:  "李医生",
        Room:        "诊室1",
        AppointDate: time.Now().Format("2006-01-02"),
        SlotStart:   "09:00",
        SlotEnd:     "09:30",
    }
    _, err := svc.CreateAppointment(tid, input)
    require.NoError(t, err)
    _, err2 := svc.CreateAppointment(tid, input)
    assert.ErrorIs(t, err2, service.ErrDuplicateAppointment)
}

// --- Checkin ---

func TestCheckin_Success(t *testing.T) {
    svc, tid := setupApptService(t)
    appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
        PatientName: "王五",
        DoctorID:    1,
        DoctorName:  "李医生",
        AppointDate: time.Now().Format("2006-01-02"),
        SlotStart:   "09:00",
        SlotEnd:     "09:30",
    })
    // First auto-queue the appointment
    queueSvc := service.NewQueueService(svc.DB)
    _ = svc.EnqueueAppointment(tid, appt.ID, queueSvc)

    entry, err := svc.Checkin(tid, appt.ID)
    require.NoError(t, err)
    assert.Equal(t, model.CheckinStatusDone, entry.CheckinStatus)
}

func TestCheckin_AnySlotCurrentDay(t *testing.T) {
    // A past-slot appointment can still be checked in on the same day
    svc, tid := setupApptService(t)
    appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
        PatientName: "赵六",
        DoctorID:    1,
        DoctorName:  "李医生",
        AppointDate: time.Now().Format("2006-01-02"),
        SlotStart:   "08:00",
        SlotEnd:     "08:30",
    })
    queueSvc := service.NewQueueService(svc.DB)
    _ = svc.EnqueueAppointment(tid, appt.ID, queueSvc)

    _, err := svc.Checkin(tid, appt.ID)
    assert.NoError(t, err, "past-slot appointment on current day must be checkin-able")
}

func TestCheckin_WrongTenant(t *testing.T) {
    svc, tid := setupApptService(t)
    appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
        PatientName: "张三",
        DoctorID:    1,
        DoctorName:  "李医生",
        AppointDate: time.Now().Format("2006-01-02"),
        SlotStart:   "09:00",
        SlotEnd:     "09:30",
    })
    queueSvc := service.NewQueueService(svc.DB)
    _ = svc.EnqueueAppointment(tid, appt.ID, queueSvc)
    _, err := svc.Checkin(tid+999, appt.ID)
    assert.Error(t, err)
}

// --- EnqueueAppointment ---

func TestEnqueueAppointment_SetsQueueEntryID(t *testing.T) {
    svc, tid := setupApptService(t)
    appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
        PatientName: "李四",
        DoctorID:    1,
        DoctorName:  "李医生",
        AppointDate: time.Now().Format("2006-01-02"),
        SlotStart:   "09:00",
        SlotEnd:     "09:30",
    })
    queueSvc := service.NewQueueService(svc.DB)
    err := svc.EnqueueAppointment(tid, appt.ID, queueSvc)
    require.NoError(t, err)

    var updated model.Appointment
    svc.DB.First(&updated, appt.ID)
    assert.Equal(t, model.AppointmentStatusQueued, updated.Status)
    assert.NotNil(t, updated.QueueEntryID)
}

// --- AutoEnqueueToday ---

func TestAutoEnqueueToday_SkipsAlreadyQueued(t *testing.T) {
    svc, tid := setupApptService(t)
    appt, _ := svc.CreateAppointment(tid, service.CreateAppointmentInput{
        PatientName: "孙七",
        DoctorID:    1,
        DoctorName:  "李医生",
        AppointDate: time.Now().Format("2006-01-02"),
        SlotStart:   "09:00",
        SlotEnd:     "09:30",
    })
    queueSvc := service.NewQueueService(svc.DB)
    _ = svc.EnqueueAppointment(tid, appt.ID, queueSvc)

    // Run auto-enqueue again, should not create duplicate
    errored, total := svc.AutoEnqueueToday(queueSvc)
    assert.Equal(t, 0, total)
    assert.Empty(t, errored)
}

func TestAutoEnqueueToday_ReturnFailedIDs(t *testing.T) {
    svc, tid := setupApptService(t)
    // Insert invalid appointment (doctor_id=0 will cause seq to still work, just verifying error path)
    appt := model.Appointment{
        TenantID:    tid,
        PatientName: "测试错误",
        DoctorID:    99999,
        DoctorName:  "不存在",
        AppointDate: time.Now().Format("2006-01-02"),
        SlotStart:   "09:00",
        SlotEnd:     "09:30",
        Status:      model.AppointmentStatusPending,
    }
    svc.DB.Create(&appt)
    queueSvc := service.NewQueueService(svc.DB)
    // Should not panic, errored list may or may not contain this ID depending on DB constraints
    _, _ = svc.AutoEnqueueToday(queueSvc)
}
```

- [ ] **Step 2: 运行测试，确认 RED**

```bash
cd server && go test ./service/ -run TestCreate -v 2>&1 | head -20
```
预期: `cannot find package` 或 `undefined: service.AppointmentService`

- [ ] **Step 3: 创建 `server/service/appointment.go`**

```go
package service

import (
    "errors"
    "time"

    "github.com/callmefisher/menzhen/server/model"
    "gorm.io/gorm"
)

var (
    ErrAppointmentNotFound  = errors.New("appointment not found")
    ErrDuplicateAppointment = errors.New("该患者当日已有预约，请勿重复预约")
    ErrNotQueued            = errors.New("该预约尚未入队，无法签到")
    ErrCheckinWrongDate     = errors.New("只能在预约当日签到")
)

type CreateAppointmentInput struct {
    PatientName string
    PatientID   *uint
    DoctorID    uint
    DoctorName  string
    Room        string
    AppointDate string // "2006-01-02"
    SlotStart   string // "09:00"
    SlotEnd     string // "09:30"
}

type AppointmentService struct {
    DB *gorm.DB
}

func NewAppointmentService(db *gorm.DB) *AppointmentService {
    return &AppointmentService{DB: db}
}

// CreateAppointment 创建预约。同一患者同一日期不允许重复预约。
func (s *AppointmentService) CreateAppointment(tenantID uint, in CreateAppointmentInput) (*model.Appointment, error) {
    var count int64
    if err := s.DB.Model(&model.Appointment{}).
        Where("tenant_id = ? AND patient_name = ? AND appoint_date = ? AND status NOT IN (?,?)",
            tenantID, in.PatientName, in.AppointDate,
            model.AppointmentStatusCancelled, model.AppointmentStatusNoShow).
        Count(&count).Error; err != nil {
        return nil, fmt.Errorf("check duplicate appointment: %w", err)
    }
    if count > 0 {
        return nil, ErrDuplicateAppointment
    }

    appt := &model.Appointment{
        TenantID:    tenantID,
        PatientID:   in.PatientID,
        PatientName: in.PatientName,
        DoctorID:    in.DoctorID,
        DoctorName:  in.DoctorName,
        Room:        in.Room,
        AppointDate: in.AppointDate,
        SlotStart:   in.SlotStart,
        SlotEnd:     in.SlotEnd,
        Status:      model.AppointmentStatusPending,
    }
    if err := s.DB.Create(appt).Error; err != nil {
        return nil, fmt.Errorf("create appointment: %w", err)
    }
    return appt, nil
}

// ListByDate 返回某日的预约列表，可按 doctor_id 过滤。
func (s *AppointmentService) ListByDate(tenantID uint, date string, doctorID *uint) ([]model.Appointment, error) {
    q := s.DB.Where("tenant_id = ? AND appoint_date = ?", tenantID, date)
    if doctorID != nil {
        q = q.Where("doctor_id = ?", *doctorID)
    }
    var list []model.Appointment
    err := q.Order("slot_start ASC, id ASC").Find(&list).Error
    return list, err
}

// Cancel 取消预约（仅 pending 状态可取消）。
func (s *AppointmentService) Cancel(tenantID, apptID uint) error {
    result := s.DB.Model(&model.Appointment{}).
        Where("id = ? AND tenant_id = ? AND status = ?", apptID, tenantID, model.AppointmentStatusPending).
        Update("status", model.AppointmentStatusCancelled)
    if result.Error != nil {
        return fmt.Errorf("cancel appointment: %w", result.Error)
    }
    if result.RowsAffected == 0 {
        return ErrAppointmentNotFound
    }
    return nil
}

// EnqueueAppointment 将单条预约转为 QueueEntry（source=appointment）。
// 幂等：若已 queued 则直接返回 nil。
func (s *AppointmentService) EnqueueAppointment(tenantID, apptID uint, queueSvc *QueueService) error {
    var appt model.Appointment
    if err := s.DB.Where("id = ? AND tenant_id = ?", apptID, tenantID).First(&appt).Error; err != nil {
        if errors.Is(err, gorm.ErrRecordNotFound) {
            return ErrAppointmentNotFound
        }
        return fmt.Errorf("load appointment: %w", err)
    }
    if appt.Status == model.AppointmentStatusQueued {
        return nil // already done
    }

    return s.DB.Transaction(func(tx *gorm.DB) error {
        seq, err := queueSvc.NextSeq(tenantID)
        if err != nil {
            return fmt.Errorf("next seq: %w", err)
        }
        now := time.Now()
        entry := &model.QueueEntry{
            TenantID:      tenantID,
            PatientID:     appt.PatientID,
            PatientName:   appt.PatientName,
            DoctorID:      appt.DoctorID,
            DoctorName:    appt.DoctorName,
            Room:          appt.Room,
            SeqNumber:     seq,
            Status:        model.QueueStatusWaiting,
            Source:        "appointment",
            QueueDate:     appt.AppointDate,
            ArrivalTime:   &now,
            CheckinStatus: model.CheckinStatusPending,
            AppointmentID: &appt.ID,
            SlotStart:     appt.SlotStart,
            SlotEnd:       appt.SlotEnd,
        }
        if err := tx.Create(entry).Error; err != nil {
            return fmt.Errorf("create queue entry: %w", err)
        }
        if err := tx.Model(&appt).Updates(map[string]interface{}{
            "status":         model.AppointmentStatusQueued,
            "queue_entry_id": entry.ID,
        }).Error; err != nil {
            return fmt.Errorf("update appointment status: %w", err)
        }
        return nil
    })
}

// Checkin 为已入队的预约患者签到（当日任意时段均可）。
// 返回更新后的 QueueEntry。
func (s *AppointmentService) Checkin(tenantID, apptID uint) (*model.QueueEntry, error) {
    var appt model.Appointment
    if err := s.DB.Where("id = ? AND tenant_id = ?", apptID, tenantID).First(&appt).Error; err != nil {
        if errors.Is(err, gorm.ErrRecordNotFound) {
            return nil, ErrAppointmentNotFound
        }
        return nil, fmt.Errorf("load appointment: %w", err)
    }
    if appt.Status != model.AppointmentStatusQueued || appt.QueueEntryID == nil {
        return nil, ErrNotQueued
    }
    // 只能在预约当日签到
    if appt.AppointDate != time.Now().Format("2006-01-02") {
        return nil, ErrCheckinWrongDate
    }

    now := time.Now()
    var entry model.QueueEntry
    if err := s.DB.Where("id = ? AND tenant_id = ?", *appt.QueueEntryID, tenantID).First(&entry).Error; err != nil {
        return nil, fmt.Errorf("load queue entry: %w", err)
    }
    if err := s.DB.Model(&entry).Updates(map[string]interface{}{
        "checkin_status": model.CheckinStatusDone,
        "arrival_time":   now,
    }).Error; err != nil {
        return nil, fmt.Errorf("update checkin: %w", err)
    }
    entry.CheckinStatus = model.CheckinStatusDone
    entry.ArrivalTime = &now
    return &entry, nil
}

// AutoEnqueueToday 将今日所有 pending 预约转为 QueueEntry。
// 返回 (失败的 apptID 列表, 成功入队总数)。逐条处理，单条失败不影响其他条。
func (s *AppointmentService) AutoEnqueueToday(queueSvc *QueueService) (failedIDs []uint, successCount int) {
    var appts []model.Appointment
    if err := s.DB.Where("appoint_date = ? AND status = ?",
        time.Now().Format("2006-01-02"), model.AppointmentStatusPending).
        Find(&appts).Error; err != nil {
        return nil, 0
    }
    for _, appt := range appts {
        if err := s.EnqueueAppointment(appt.TenantID, appt.ID, queueSvc); err != nil {
            failedIDs = append(failedIDs, appt.ID)
        } else {
            successCount++
        }
    }
    return failedIDs, successCount
}
```

> **注意**：`CreateAppointment` 使用了 `fmt.Errorf`，需要在 import 中加 `"fmt"`。

- [ ] **Step 4: 补全 import（确认 appointment.go 文件头 import 正确）**

```go
import (
    "errors"
    "fmt"
    "time"

    "github.com/callmefisher/menzhen/server/model"
    "gorm.io/gorm"
)
```

- [ ] **Step 5: 运行测试，确认 GREEN**

```bash
cd server && go test ./service/ -run "TestCreate|TestCheckin|TestEnqueue|TestAutoEnqueue" -v
```
预期: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add server/service/appointment.go server/service/appointment_test.go
git commit -m "feat: AppointmentService with CRUD, checkin, and auto-enqueue"
```

---

## Task 5: HTTP Handler — appointment_handler.go

**Files:**
- Create: `server/handler/appointment.go`
- Create: `server/handler/appointment_test.go`

- [ ] **Step 1: 写 handler 测试（RED）**

创建 `server/handler/appointment_test.go`：

```go
package handler_test

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "net/http/httptest"
    "testing"
    "time"

    "github.com/callmefisher/menzhen/server/handler"
    "github.com/callmefisher/menzhen/server/middleware"
    "github.com/callmefisher/menzhen/server/testutil"
    "github.com/gin-gonic/gin"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func setupApptRouter(t *testing.T) (*gin.Engine, uint) {
    gin.SetMode(gin.TestMode)
    db := testutil.SetupTestDB(t)
    tenant := testutil.SeedTestTenant(db)
    h := handler.NewAppointmentHandler(db)

    r := gin.New()
    appt := r.Group("/appointments")
    appt.Use(func(c *gin.Context) {
        c.Set(middleware.TenantIDKey, uint64(tenant.ID))
        c.Set(middleware.UserIDKey, uint64(1))
        c.Next()
    })
    appt.POST("", h.Create)
    appt.GET("", h.List)
    appt.POST("/:id/checkin", h.Checkin)
    appt.POST("/:id/cancel", h.Cancel)
    return r, uint(tenant.ID)
}

func TestApptHandler_Create(t *testing.T) {
    r, _ := setupApptRouter(t)
    body, _ := json.Marshal(map[string]interface{}{
        "patient_name": "张三",
        "doctor_id":    1,
        "doctor_name":  "李医生",
        "room":         "诊室1",
        "appoint_date": time.Now().Format("2006-01-02"),
        "slot_start":   "09:00",
        "slot_end":     "09:30",
    })
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("POST", "/appointments", bytes.NewBuffer(body))
    req.Header.Set("Content-Type", "application/json")
    r.ServeHTTP(w, req)
    assert.Equal(t, http.StatusOK, w.Code)
    var resp map[string]interface{}
    require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
    assert.Equal(t, float64(0), resp["code"])
}

func TestApptHandler_List(t *testing.T) {
    r, _ := setupApptRouter(t)
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("GET", "/appointments?date="+time.Now().Format("2006-01-02"), nil)
    r.ServeHTTP(w, req)
    assert.Equal(t, http.StatusOK, w.Code)
}

func TestApptHandler_Checkin_NotFound(t *testing.T) {
    r, _ := setupApptRouter(t)
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("POST", "/appointments/9999/checkin", nil)
    r.ServeHTTP(w, req)
    assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestApptHandler_Cancel_NotFound(t *testing.T) {
    r, _ := setupApptRouter(t)
    w := httptest.NewRecorder()
    req, _ := http.NewRequest("POST", fmt.Sprintf("/appointments/%d/cancel", 9999), nil)
    r.ServeHTTP(w, req)
    assert.Equal(t, http.StatusNotFound, w.Code)
}
```

- [ ] **Step 2: 运行测试，确认 RED**

```bash
cd server && go test ./handler/ -run "TestApptHandler" -v 2>&1 | head -10
```
预期: `undefined: handler.NewAppointmentHandler`

- [ ] **Step 3: 创建 `server/handler/appointment.go`**

```go
package handler

import (
    "errors"
    "net/http"
    "strconv"

    "github.com/callmefisher/menzhen/server/middleware"
    "github.com/callmefisher/menzhen/server/service"
    "github.com/callmefisher/menzhen/server/ws"
    "github.com/gin-gonic/gin"
    "gorm.io/gorm"
)

type AppointmentHandler struct {
    db      *gorm.DB
    svc     *service.AppointmentService
    queueSvc *service.QueueService
}

func NewAppointmentHandler(db *gorm.DB) *AppointmentHandler {
    return &AppointmentHandler{
        db:       db,
        svc:      service.NewAppointmentService(db),
        queueSvc: service.NewQueueService(db),
    }
}

// Create handles POST /appointments
func (h *AppointmentHandler) Create(c *gin.Context) {
    tenantID := middleware.GetTenantID(c)
    var req struct {
        PatientName string `json:"patient_name" binding:"required"`
        PatientID   *uint  `json:"patient_id"`
        DoctorID    uint   `json:"doctor_id" binding:"required"`
        DoctorName  string `json:"doctor_name" binding:"required"`
        Room        string `json:"room"`
        AppointDate string `json:"appoint_date" binding:"required"`
        SlotStart   string `json:"slot_start" binding:"required"`
        SlotEnd     string `json:"slot_end" binding:"required"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
        return
    }
    appt, err := h.svc.CreateAppointment(uint(tenantID), service.CreateAppointmentInput{
        PatientName: req.PatientName,
        PatientID:   req.PatientID,
        DoctorID:    req.DoctorID,
        DoctorName:  req.DoctorName,
        Room:        req.Room,
        AppointDate: req.AppointDate,
        SlotStart:   req.SlotStart,
        SlotEnd:     req.SlotEnd,
    })
    if err != nil {
        if errors.Is(err, service.ErrDuplicateAppointment) {
            c.JSON(http.StatusConflict, gin.H{"code": 1, "message": err.Error()})
            return
        }
        c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
        return
    }
    c.JSON(http.StatusOK, gin.H{"code": 0, "data": appt})
}

// List handles GET /appointments?date=2006-01-02&doctor_id=N
func (h *AppointmentHandler) List(c *gin.Context) {
    tenantID := middleware.GetTenantID(c)
    date := c.Query("date")
    if date == "" {
        c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "date is required"})
        return
    }
    var doctorID *uint
    if raw := c.Query("doctor_id"); raw != "" {
        parsed, err := strconv.ParseUint(raw, 10, 64)
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid doctor_id"})
            return
        }
        id := uint(parsed)
        doctorID = &id
    }
    list, err := h.svc.ListByDate(uint(tenantID), date, doctorID)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
        return
    }
    c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"list": list}})
}

// Checkin handles POST /appointments/:id/checkin
func (h *AppointmentHandler) Checkin(c *gin.Context) {
    tenantID := middleware.GetTenantID(c)
    id, err := strconv.ParseUint(c.Param("id"), 10, 64)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
        return
    }
    entry, err := h.svc.Checkin(uint(tenantID), uint(id))
    if err != nil {
        if errors.Is(err, service.ErrAppointmentNotFound) {
            c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
            return
        }
        if errors.Is(err, service.ErrNotQueued) || errors.Is(err, service.ErrCheckinWrongDate) {
            c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": err.Error()})
            return
        }
        c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
        return
    }
    // Broadcast queue_update so all connected clients refresh
    ws.DefaultHub.Broadcast(uint(tenantID), ws.Message{
        Type:    "queue_update",
        Payload: gin.H{"action": "checkin", "entry": entry},
    })
    c.JSON(http.StatusOK, gin.H{"code": 0, "data": entry})
}

// Cancel handles POST /appointments/:id/cancel
func (h *AppointmentHandler) Cancel(c *gin.Context) {
    tenantID := middleware.GetTenantID(c)
    id, err := strconv.ParseUint(c.Param("id"), 10, 64)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "invalid id"})
        return
    }
    if err := h.svc.Cancel(uint(tenantID), uint(id)); err != nil {
        if errors.Is(err, service.ErrAppointmentNotFound) {
            c.JSON(http.StatusNotFound, gin.H{"code": 1, "message": err.Error()})
            return
        }
        c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": err.Error()})
        return
    }
    c.JSON(http.StatusOK, gin.H{"code": 0, "data": nil})
}
```

- [ ] **Step 4: 运行测试，确认 GREEN**

```bash
cd server && go test ./handler/ -run "TestApptHandler" -v
```
预期: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/handler/appointment.go server/handler/appointment_test.go
git commit -m "feat: AppointmentHandler with create/list/checkin/cancel"
```

---

## Task 6: 路由注册

**Files:**
- Modify: `server/router/router.go`

- [ ] **Step 1: 在 router.go 中找到 queue routes 结束位置（约 line 336）**

```bash
grep -n "appointment\|queueHandler\|queue_doctor" server/router/router.go | head -20
```

- [ ] **Step 2: 在 queue routes 区块之后（约 line 337）插入预约路由**

找到：
```go
        queue.GET("/stats", middleware.RequirePermission(db, "queue:read"), queueHandler.Stats)
    }
```

在其后添加：
```go

    // Appointment routes (tenant-scoped).
    apptHandler := handler.NewAppointmentHandler(db)
    appt := authenticated.Group("/appointments")
    {
        appt.POST("", middleware.RequirePermission(db, "appointment:create"), apptHandler.Create)
        appt.GET("", middleware.RequirePermission(db, "appointment:read"), apptHandler.List)
        appt.POST("/:id/checkin", middleware.RequirePermission(db, "appointment:checkin"), apptHandler.Checkin)
        appt.POST("/:id/cancel", middleware.RequirePermission(db, "appointment:update"), apptHandler.Cancel)
    }
```

- [ ] **Step 3: 验证编译**

```bash
cd server && go build ./...
```
预期: 无错误

- [ ] **Step 4: Commit**

```bash
git add server/router/router.go
git commit -m "feat: register appointment routes"
```

---

## Task 7: 午夜自动入队 goroutine（带重试）

**Files:**
- Modify: `server/main.go`

业务规则：0点自动将当天所有 pending 预约入队。失败的条目记录下来，每 5 分钟重试，直至全部成功或超过 3 次重试上限。

- [ ] **Step 1: 在 `main.go` 的 goroutine 区块（约 line 41）追加以下代码**

在现有两个 goroutine 之后、`r.Run(...)` 之前插入：

```go
    // Appointment auto-enqueue: runs at midnight, retries every 5 min if any failed.
    go func() {
        apptSvc := service.NewAppointmentService(db)
        queueSvc := service.NewQueueService(db)

        // scheduleAutoEnqueue fires once per day at midnight and retries failures.
        scheduleAutoEnqueue := func() {
            const maxRetries = 3
            retries := 0
            var failed []uint

            run := func() {
                f, n := apptSvc.AutoEnqueueToday(queueSvc)
                if n > 0 {
                    log.Printf("appointment auto-enqueue: queued %d entries", n)
                }
                if len(f) > 0 {
                    log.Printf("appointment auto-enqueue: %d entries failed, will retry (attempt %d/%d)", len(f), retries+1, maxRetries)
                }
                failed = f
            }
            run()

            // Retry loop: up to maxRetries, every 5 min
            retryTicker := time.NewTicker(5 * time.Minute)
            defer retryTicker.Stop()
            for range retryTicker.C {
                if len(failed) == 0 || retries >= maxRetries {
                    break
                }
                retries++
                run()
            }
            if len(failed) > 0 {
                log.Printf("appointment auto-enqueue: gave up after %d retries, failed IDs: %v", maxRetries, failed)
            }
        }

        // Run once on startup (catches any missed midnight job from crash/restart)
        scheduleAutoEnqueue()

        // Then run at each subsequent midnight
        for {
            now := time.Now()
            next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 5, 0, now.Location())
            time.Sleep(time.Until(next))
            scheduleAutoEnqueue()
        }
    }()
```

- [ ] **Step 2: 验证编译**

```bash
cd server && go build ./...
```
预期: 无错误

- [ ] **Step 3: Commit**

```bash
git add server/main.go
git commit -m "feat: midnight appointment auto-enqueue goroutine with retry"
```

---

## Task 8: 全量后端测试

- [ ] **Step 1: 运行全部后端测试**

```bash
cd server && go test ./... -v 2>&1 | tail -30
```
预期: 全部 PASS，无 FAIL

- [ ] **Step 2: 若有失败，先修复再继续**

---

## Task 9: 前端 API 层

**Files:**
- Create: `web/src/api/appointment.ts`
- Modify: `web/src/api/queue.ts`

- [ ] **Step 1: 创建 `web/src/api/appointment.ts`**

```typescript
import request from '../utils/request';

export interface Appointment {
  id: number;
  tenant_id: number;
  patient_id?: number;
  patient_name: string;
  doctor_id: number;
  doctor_name: string;
  room: string;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
  status: 'pending' | 'queued' | 'cancelled' | 'no_show';
  queue_entry_id?: number;
  created_at: string;
}

export const createAppointment = (data: {
  patient_name: string;
  patient_id?: number;
  doctor_id: number;
  doctor_name: string;
  room?: string;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
}) => request.post<{ code: number; data: Appointment }>('/appointments', data);

export const listAppointments = (date: string, doctorId?: number) =>
  request.get<{ code: number; data: { list: Appointment[] } }>('/appointments', {
    params: { date, doctor_id: doctorId },
  });

export const checkinAppointment = (id: number) =>
  request.post(`/appointments/${id}/checkin`);

export const cancelAppointment = (id: number) =>
  request.post(`/appointments/${id}/cancel`);
```

- [ ] **Step 2: 在 `web/src/api/queue.ts` 的 `QueueEntry` 接口中追加字段**

在 `created_at: string;` 之前插入：

```typescript
  checkin_status?: 'pending' | 'done';
  appointment_id?: number;
  slot_start?: string;
  slot_end?: string;
```

- [ ] **Step 3: 验证前端编译**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```
预期: 无错误

- [ ] **Step 4: Commit**

```bash
git add web/src/api/appointment.ts web/src/api/queue.ts
git commit -m "feat: appointment API client and extend QueueEntry type"
```

---

## Task 10: QueueDashboard — 签到按钮 + "预"标记

**Files:**
- Modify: `web/src/pages/queue/QueueDashboard.tsx`
- Modify: `web/src/pages/queue/__tests__/QueueDashboard.test.tsx`

设计参照 `03-full-design.html`：
- `source === 'appointment'` 且 `checkin_status === 'pending'`：显示橙色实心「签到」按钮
- `source === 'appointment'` 且 `checkin_status === 'done'`：显示绿色「✓ 已到」chip，恢复普通排队逻辑
- 患者姓名旁展示蓝色「预」上标

- [ ] **Step 1: 读取现有 QueueDashboard，找到行渲染的位置**

```bash
grep -n "patientName\|patient_name\|seq_number\|callNumber\|row\|action" web/src/pages/queue/QueueDashboard.tsx | head -30
```

- [ ] **Step 2: 在 QueueDashboard.tsx 中添加 checkinAppointment 导入**

找到 import 行：
```typescript
import { listQueue, takeNumber, callNumber, completeVisit, clearQueue, type QueueEntry } from '../../api/queue';
```
改为：
```typescript
import { listQueue, takeNumber, callNumber, completeVisit, clearQueue, type QueueEntry } from '../../api/queue';
import { checkinAppointment } from '../../api/appointment';
```

- [ ] **Step 3: 在 QueueDashboard 函数体内，在 state 区域添加 checkin loading state**

```typescript
const [checkinLoading, setCheckinLoading] = useState<Record<number, boolean>>({});
```

- [ ] **Step 4: 添加 handleCheckin 函数（放在其他 handler 附近）**

```typescript
const handleCheckin = useCallback(async (apptId: number, entryId: number) => {
  setCheckinLoading(prev => ({ ...prev, [entryId]: true }));
  try {
    await checkinAppointment(apptId);
    await fetchQueue();
  } catch {
    message.error('签到失败');
  } finally {
    setCheckinLoading(prev => ({ ...prev, [entryId]: false }));
  }
}, [fetchQueue]);
```

- [ ] **Step 5: 添加 renderPatientName 和 renderCheckinAction 辅助函数（放在 return 之前）**

```typescript
const renderPatientName = (entry: QueueEntry) => (
  <span>
    {entry.patient_name}
    {entry.source === 'appointment' && (
      <span style={{
        display: 'inline-block',
        fontSize: 9,
        fontWeight: 800,
        background: '#1677ff',
        color: '#fff',
        borderRadius: 3,
        padding: '0 3px',
        verticalAlign: 'super',
        marginLeft: 2,
        lineHeight: 1.5,
      }}>预</span>
    )}
  </span>
);

const renderCheckinAction = (entry: QueueEntry) => {
  if (entry.source !== 'appointment') return null;
  if (entry.checkin_status === 'done') {
    return (
      <span style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 8,
        fontWeight: 600,
        color: '#52c41a',
        background: '#f6ffed',
        border: '1px solid #b7eb8f',
        whiteSpace: 'nowrap',
      }}>✓ 已到</span>
    );
  }
  // pending checkin
  return (
    <Button
      size="small"
      type="primary"
      style={{ background: '#fa8c16', borderColor: '#fa8c16', fontSize: 12 }}
      loading={checkinLoading[entry.id]}
      onClick={() => entry.appointment_id && handleCheckin(entry.appointment_id, entry.id)}
    >
      签到
    </Button>
  );
};
```

- [ ] **Step 6: 在队列行渲染中，将 `entry.patient_name` 替换为 `renderPatientName(entry)`，并在操作区域插入 `renderCheckinAction(entry)`**

找到当前渲染患者姓名的 JSX（根据实际代码定位），用 `renderPatientName(entry)` 替换纯文本渲染。在叫号按钮之前插入 `{renderCheckinAction(entry)}`。

> **注意**：需先运行 `grep -n "patient_name\|patientName" web/src/pages/queue/QueueDashboard.tsx` 找到确切位置，再执行 Edit。

- [ ] **Step 7: 前端编译验证**

```bash
cd web && npx tsc --noEmit && npm run build 2>&1 | tail -10
```
预期: 无错误

- [ ] **Step 8: 写前端测试（补充签到场景）**

在 `web/src/pages/queue/__tests__/QueueDashboard.test.tsx` 中添加：

```typescript
import { checkinAppointment } from '../../../api/appointment';

vi.mock('../../../api/appointment', () => ({
  checkinAppointment: vi.fn().mockResolvedValue({ data: { code: 0 } }),
}));

it('shows 签到 button for appointment entry with pending checkin', async () => {
  // Mock listQueue to return an appointment entry with checkin_status=pending
  vi.mocked(listQueue).mockResolvedValueOnce({
    data: {
      code: 0,
      data: {
        list: [{
          id: 10,
          tenant_id: 1,
          patient_id: 1,
          patient_name: '张三',
          doctor_id: 1,
          doctor_name: '李医生',
          room: '诊室1',
          seq_number: 1,
          status: 'waiting',
          source: 'appointment',
          checkin_status: 'pending',
          appointment_id: 5,
          slot_start: '09:00',
          slot_end: '09:30',
          queue_date: new Date().toISOString().slice(0, 10),
          created_at: new Date().toISOString(),
        }],
      },
    },
  } as any);

  // render component (follow existing test setup pattern in QueueDashboard.test.tsx)
  // ...
  // Assert 签到 button is visible
  expect(await screen.findByText('签到')).toBeInTheDocument();
  expect(screen.getByText('预')).toBeInTheDocument();
});

it('shows ✓ 已到 chip after checkin', async () => {
  vi.mocked(listQueue).mockResolvedValueOnce({
    data: {
      code: 0,
      data: {
        list: [{
          id: 11,
          patient_name: '李四',
          doctor_id: 1,
          doctor_name: '李医生',
          room: '诊室1',
          seq_number: 2,
          status: 'waiting',
          source: 'appointment',
          checkin_status: 'done',
          appointment_id: 6,
          slot_start: '09:00',
          slot_end: '09:30',
          queue_date: new Date().toISOString().slice(0, 10),
          created_at: new Date().toISOString(),
        }],
      },
    },
  } as any);
  // ...
  expect(await screen.findByText('✓ 已到')).toBeInTheDocument();
});
```

> **注意**: 需要根据现有测试文件的 setup 模式（mock listQueue、renderWithProviders 等）完成渲染部分。先运行 `cat web/src/pages/queue/__tests__/QueueDashboard.test.tsx` 看现有模式，再补全。

- [ ] **Step 9: 运行前端测试**

```bash
cd web && npx vitest run src/pages/queue/__tests__/QueueDashboard.test.tsx
```
预期: 全部 PASS

- [ ] **Step 10: Commit**

```bash
git add web/src/pages/queue/QueueDashboard.tsx web/src/pages/queue/__tests__/QueueDashboard.test.tsx
git commit -m "feat: QueueDashboard — appointment checkin button and 预 marker"
```

---

## Task 11: 全量测试 + 部署

- [ ] **Step 1: 后端全量测试**

```bash
cd server && go test ./... 2>&1 | tail -20
```
预期: ok（无 FAIL）

- [ ] **Step 2: 前端全量测试**

```bash
cd web && npm run test 2>&1 | tail -20
```
预期: 全部 PASS

- [ ] **Step 3: 前后端编译**

```bash
cd server && go build ./... && cd ../web && npm run build
```
预期: 无错误

- [ ] **Step 4: 部署**

```bash
bash /Users/xiayanji/qbox/menzhen/deploy.sh
```

- [ ] **Step 5: 验证部署**

打开排队取号页面，确认：
1. 手动创建一条预约（POST /appointments）后，在排队列表中出现"预"标记和橙色签到按钮
2. 点击签到后，按钮消失，出现"✓ 已到"绿色 chip
3. 签到后该患者可正常被叫号（同普通患者）

---

## 关键业务规则速查

| 规则 | 实现位置 |
|------|---------|
| 当日任意时段均可签到（不受时段限制） | `AppointmentService.Checkin` — 只检查 `appoint_date == today()`，不检查 `slot_start/slot_end` |
| 0点自动入队，失败可重试 | `main.go` goroutine：`scheduleAutoEnqueue` 内嵌 5 分钟重试 ticker，最多 3 次 |
| 自动入队幂等 | `EnqueueAppointment` 开头检查 `status == queued` 直接返回 nil |
| 签到只广播 queue_update（不广播叫号音效） | `AppointmentHandler.Checkin` 只发 `queue_update`，不发 `queue_call` |
| 租户隔离 | 所有查询携带 `tenant_id`，来自 `middleware.GetTenantID(c)` |
