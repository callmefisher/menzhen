# 回访功能实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在运营菜单下新增回访功能，支持计划回访、状态追踪、逾期提醒、患者/诊疗记录关联跳转，桌面端和移动端适配。

**Architecture:** 独立 `follow_ups` 表（租户隔离），后端 Model → Service → Handler 三层架构，前端回访列表页（Table/Card 响应式），4 个独立权限码 `followup:*`。

**Tech Stack:** Go + Gin + GORM (后端), React + TypeScript + Ant Design (前端), MySQL (数据库), Vitest + Testing Library (前端测试), Go test + testify (后端测试)

**Spec:** `docs/plans/2026-03-15-follow-up-design.md`

---

## Chunk 1: 后端 Model + Migration + Seed

### Task 1: 创建 FollowUp 数据模型

**Files:**
- Create: `server/model/follow_up.go`

- [ ] **Step 1: 创建 FollowUp 模型文件**

```go
package model

import "time"

// FollowUp represents a patient follow-up record (tenant-scoped).
type FollowUp struct {
	BaseModel
	TenantID    uint64     `gorm:"column:tenant_id;not null;index" json:"tenant_id"`
	PatientID   uint64     `gorm:"column:patient_id;not null;index" json:"patient_id"`
	RecordID    *uint64    `gorm:"column:record_id;index" json:"record_id"`
	PlannedDate time.Time  `gorm:"column:planned_date;type:date;not null" json:"planned_date"`
	ActualDate  *time.Time `gorm:"column:actual_date;type:date" json:"actual_date"`
	Status      string     `gorm:"column:status;type:varchar(20);not null;default:'pending'" json:"status"`
	Method      string     `gorm:"column:method;type:varchar(50);not null" json:"method"`
	Content     string     `gorm:"column:content;type:text" json:"content"`
	CreatedBy   uint64     `gorm:"column:created_by;not null" json:"created_by"`
}

func (FollowUp) TableName() string {
	return "follow_ups"
}
```

- [ ] **Step 2: 验证编译通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./model/...`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add server/model/follow_up.go
git commit -m "feat: add FollowUp data model"
```

### Task 2: 注册 AutoMigrate + Seed 权限

**Files:**
- Modify: `server/database/database.go:55` — 在 `&model.DailyStats{}` 后追加
- Modify: `server/database/seed.go:57` — 在 `tenant:role:manage` 后追加 4 个权限
- Modify: `server/testutil/testutil.go:107` — AutoMigrate 追加
- Modify: `server/testutil/testutil.go:226` — SeedAllPermissions 追加

- [ ] **Step 1: 在 database.go AutoMigrate 中追加 FollowUp**

在 `server/database/database.go` 第 56 行 `&model.DailyStats{},` 后追加：

```go
		&model.FollowUp{},
```

- [ ] **Step 2: 在 seed.go 中追加 4 个回访权限**

在 `server/database/seed.go` 第 57 行 `{Code: "tenant:role:manage"...}` 后追加：

```go
		{Code: "followup:create", Name: "新增回访", Description: "创建回访记录"},
		{Code: "followup:read", Name: "查看回访", Description: "查看回访列表和详情"},
		{Code: "followup:update", Name: "编辑回访", Description: "修改回访记录"},
		{Code: "followup:delete", Name: "删除回访", Description: "删除回访记录"},
```

- [ ] **Step 3: 在 testutil.go AutoMigrate 中追加 FollowUp**

在 `server/testutil/testutil.go` 第 107 行 `&model.DailyStats{}` 后追加：

```go
		&model.FollowUp{},
```

- [ ] **Step 4: 在 testutil.go SeedAllPermissions 中追加 4 个权限**

在 `server/testutil/testutil.go` 第 226 行 `{"tenant:role:manage", "诊所角色管理"},` 后追加：

```go
		{"followup:create", "新增回访"}, {"followup:read", "查看回访"},
		{"followup:update", "编辑回访"}, {"followup:delete", "删除回访"},
```

- [ ] **Step 5: 验证编译通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./...`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add server/database/database.go server/database/seed.go server/testutil/testutil.go
git commit -m "feat: register FollowUp migration and seed permissions"
```

---

## Chunk 2: 后端 Service 层 + 测试

### Task 3: 创建 FollowUp Service

**Files:**
- Create: `server/service/follow_up.go`

- [ ] **Step 1: 创建 Service 文件**

```go
package service

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"gorm.io/gorm"
)

var (
	ErrFollowUpNotFound = errors.New("follow-up not found")
)

// CreateFollowUpRequest is the input for creating a new follow-up.
type CreateFollowUpRequest struct {
	PatientID   uint64 `json:"patient_id" binding:"required"`
	RecordID    *uint64 `json:"record_id"`
	PlannedDate string `json:"planned_date" binding:"required"` // "2006-01-02"
	Method      string `json:"method" binding:"required"`
	Content     string `json:"content"`
}

// NullableUint64 distinguishes between "not provided", "null" (clear), and a value.
// Use json.RawMessage to detect presence in JSON.
type NullableUint64 struct {
	Value   *uint64
	Present bool // true if field was present in JSON (even if null)
}

func (n *NullableUint64) UnmarshalJSON(data []byte) error {
	n.Present = true
	if string(data) == "null" {
		n.Value = nil
		return nil
	}
	var v uint64
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	n.Value = &v
	return nil
}

// UpdateFollowUpRequest uses pointer fields to distinguish "not provided" from "zero value".
// RecordID uses NullableUint64 to distinguish "not sent" vs "null" (clear association).
type UpdateFollowUpRequest struct {
	PatientID   *uint64        `json:"patient_id"`
	RecordID    NullableUint64 `json:"record_id"`
	PlannedDate *string        `json:"planned_date"`
	ActualDate  *string        `json:"actual_date"`
	Method      *string        `json:"method"`
	Content     *string        `json:"content"`
}

// FollowUpListItem is the denormalized response for list queries.
type FollowUpListItem struct {
	ID              uint64     `json:"id"`
	TenantID        uint64     `json:"tenant_id"`
	PatientID       uint64     `json:"patient_id"`
	PatientName     string     `json:"patient_name"`
	RecordID        *uint64    `json:"record_id"`
	RecordDiagnosis string     `json:"record_diagnosis"`
	RecordVisitDate *string    `json:"record_visit_date"`
	PlannedDate     string     `json:"planned_date"`
	ActualDate      *string    `json:"actual_date"`
	Status          string     `json:"status"`
	Method          string     `json:"method"`
	Content         string     `json:"content"`
	CreatedBy       uint64     `json:"created_by"`
	CreatedByName   string     `json:"created_by_name"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// FollowUpStats holds the badge counts.
type FollowUpStats struct {
	PendingCount   int64 `json:"pending_count"`
	OverdueCount   int64 `json:"overdue_count"`
	TodayCount     int64 `json:"today_count"`
	CompletedCount int64 `json:"completed_count"`
}

// FollowUpService handles follow-up business logic.
type FollowUpService struct {
	DB *gorm.DB
}

// NewFollowUpService creates a new FollowUpService.
func NewFollowUpService(db *gorm.DB) *FollowUpService {
	return &FollowUpService{DB: db}
}

// List returns a paginated, filtered list of follow-ups with denormalized patient/record info.
func (s *FollowUpService) List(tenantID uint64, patientName, status string, plannedFrom, plannedTo string, page, size int) ([]FollowUpListItem, int64, error) {
	query := s.DB.Table("follow_ups AS f").
		Select(`f.id, f.tenant_id, f.patient_id,
			COALESCE(p.name, '已删除') AS patient_name,
			f.record_id,
			COALESCE(r.diagnosis, '') AS record_diagnosis,
			DATE_FORMAT(r.visit_date, '%Y-%m-%d') AS record_visit_date,
			DATE_FORMAT(f.planned_date, '%Y-%m-%d') AS planned_date,
			DATE_FORMAT(f.actual_date, '%Y-%m-%d') AS actual_date,
			f.status, f.method, f.content,
			f.created_by,
			COALESCE(u.real_name, u.username, '') AS created_by_name,
			f.created_at, f.updated_at`).
		Joins("LEFT JOIN patients p ON p.id = f.patient_id AND p.deleted_at IS NULL").
		Joins("LEFT JOIN medical_records r ON r.id = f.record_id AND r.deleted_at IS NULL").
		Joins("LEFT JOIN users u ON u.id = f.created_by").
		Where("f.tenant_id = ? AND f.deleted_at IS NULL", tenantID)

	// Filters
	if patientName != "" {
		query = query.Where("p.name LIKE ?", "%"+patientName+"%")
	}
	if status == "overdue" {
		query = query.Where("f.status = 'pending' AND f.planned_date < CURDATE()")
	} else if status == "pending" {
		query = query.Where("f.status = 'pending' AND f.planned_date >= CURDATE()")
	} else if status == "completed" {
		query = query.Where("f.status = 'completed'")
	}
	if plannedFrom != "" {
		query = query.Where("f.planned_date >= ?", plannedFrom)
	}
	if plannedTo != "" {
		query = query.Where("f.planned_date <= ?", plannedTo)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []FollowUpListItem
	if err := query.Order("f.planned_date ASC").
		Offset((page - 1) * size).Limit(size).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}

	// Compute overdue virtual status
	today := time.Now().Format("2006-01-02")
	for i := range items {
		if items[i].Status == "pending" && items[i].PlannedDate < today {
			items[i].Status = "overdue"
		}
	}

	return items, total, nil
}

// Create creates a new follow-up.
func (s *FollowUpService) Create(tenantID, createdBy uint64, req *CreateFollowUpRequest) (*model.FollowUp, error) {
	plannedDate, err := time.Parse("2006-01-02", req.PlannedDate)
	if err != nil {
		return nil, errors.New("invalid planned_date format, expected YYYY-MM-DD")
	}

	followUp := model.FollowUp{
		TenantID:    tenantID,
		PatientID:   req.PatientID,
		RecordID:    req.RecordID,
		PlannedDate: plannedDate,
		Status:      "pending",
		Method:      req.Method,
		Content:     req.Content,
		CreatedBy:   createdBy,
	}

	if err := s.DB.Create(&followUp).Error; err != nil {
		return nil, err
	}
	return &followUp, nil
}

// GetByID returns a single follow-up by ID with tenant check.
func (s *FollowUpService) GetByID(tenantID, id uint64) (*model.FollowUp, error) {
	var followUp model.FollowUp
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&followUp, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrFollowUpNotFound
		}
		return nil, err
	}
	return &followUp, nil
}

// Update updates an existing follow-up. Returns old + new for oplog.
func (s *FollowUpService) Update(tenantID, id uint64, req *UpdateFollowUpRequest) (*model.FollowUp, *model.FollowUp, error) {
	var followUp model.FollowUp
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&followUp, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrFollowUpNotFound
		}
		return nil, nil, err
	}

	oldFollowUp := followUp

	updates := make(map[string]interface{})
	if req.PatientID != nil {
		updates["patient_id"] = *req.PatientID
	}
	if req.RecordID.Present {
		updates["record_id"] = req.RecordID.Value // nil clears, *uint64 sets
	}
	if req.PlannedDate != nil {
		pd, err := time.Parse("2006-01-02", *req.PlannedDate)
		if err != nil {
			return nil, nil, errors.New("invalid planned_date format")
		}
		updates["planned_date"] = pd
	}
	if req.ActualDate != nil {
		if *req.ActualDate == "" {
			// Clear actual_date → revert to pending
			updates["actual_date"] = nil
			updates["status"] = "pending"
		} else {
			ad, err := time.Parse("2006-01-02", *req.ActualDate)
			if err != nil {
				return nil, nil, errors.New("invalid actual_date format")
			}
			updates["actual_date"] = ad
			updates["status"] = "completed"
		}
	}
	if req.Method != nil {
		updates["method"] = *req.Method
	}
	if req.Content != nil {
		updates["content"] = *req.Content
	}

	if len(updates) > 0 {
		if err := s.DB.Model(&followUp).Updates(updates).Error; err != nil {
			return nil, nil, err
		}
	}

	// Reload
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&followUp, id).Error; err != nil {
		return nil, nil, err
	}

	return &oldFollowUp, &followUp, nil
}

// Delete soft-deletes a follow-up. Returns the deleted record for oplog.
func (s *FollowUpService) Delete(tenantID, id uint64) (*model.FollowUp, error) {
	var followUp model.FollowUp
	if err := s.DB.Where("tenant_id = ?", tenantID).First(&followUp, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrFollowUpNotFound
		}
		return nil, err
	}

	if err := s.DB.Delete(&followUp).Error; err != nil {
		return nil, err
	}
	return &followUp, nil
}

// Stats returns follow-up counts for the menu badge.
// Note: TodayCount overlaps with PendingCount by design (today's items are both "pending" and "today").
func (s *FollowUpService) Stats(tenantID uint64) (*FollowUpStats, error) {
	var stats FollowUpStats

	// IMPORTANT: Each count must use a fresh query to avoid GORM Where clause accumulation.
	base := func() *gorm.DB {
		return s.DB.Model(&model.FollowUp{}).Where("tenant_id = ?", tenantID)
	}

	if err := base().Where("status = 'pending' AND planned_date >= CURDATE()").Count(&stats.PendingCount).Error; err != nil {
		return nil, err
	}
	if err := base().Where("status = 'pending' AND planned_date < CURDATE()").Count(&stats.OverdueCount).Error; err != nil {
		return nil, err
	}
	if err := base().Where("status = 'pending' AND planned_date = CURDATE()").Count(&stats.TodayCount).Error; err != nil {
		return nil, err
	}
	if err := base().Where("status = 'completed'").Count(&stats.CompletedCount).Error; err != nil {
		return nil, err
	}

	return &stats, nil
}
```

- [ ] **Step 2: 验证编译通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./service/...`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add server/service/follow_up.go
git commit -m "feat: add FollowUp service with CRUD and stats"
```

### Task 4: FollowUp Service 测试

**Files:**
- Create: `server/service/follow_up_test.go`

- [ ] **Step 1: 编写 Service 层测试**

```go
package service

import (
	"testing"
	"time"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupFollowUpTest(t *testing.T) (*FollowUpService, uint64, uint64, uint64) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "测试诊所", "test")
	perms := testutil.SeedAllPermissions(t, db)
	_ = perms
	role := testutil.SeedTestRole(t, db, tenant.ID, "admin")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor", "pass", role)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "张三")

	svc := NewFollowUpService(db)
	return svc, tenant.ID, user.ID, patient.ID
}

func TestFollowUpCreate(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	req := &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2026-03-20",
		Method:      "电话",
		Content:     "术后回访",
	}
	fu, err := svc.Create(tenantID, userID, req)
	require.NoError(t, err)
	assert.Equal(t, patientID, fu.PatientID)
	assert.Equal(t, "pending", fu.Status)
	assert.Equal(t, "电话", fu.Method)
	assert.Nil(t, fu.RecordID)
}

func TestFollowUpCreateWithRecord(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant := testutil.SeedTestTenant(t, db, "测试诊所", "test")
	role := testutil.SeedTestRole(t, db, tenant.ID, "admin")
	user, _ := testutil.SeedTestUser(t, db, tenant.ID, "doctor", "pass", role)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "李四")

	// Create a medical record
	record := model.MedicalRecord{
		TenantID:  tenant.ID,
		PatientID: patient.ID,
		Diagnosis: "感冒",
		VisitDate: time.Now(),
		CreatedBy: user.ID,
	}
	require.NoError(t, db.Create(&record).Error)

	svc := NewFollowUpService(db)
	recordID := record.ID
	req := &CreateFollowUpRequest{
		PatientID:   patient.ID,
		RecordID:    &recordID,
		PlannedDate: "2026-03-25",
		Method:      "微信",
	}
	fu, err := svc.Create(tenant.ID, user.ID, req)
	require.NoError(t, err)
	assert.NotNil(t, fu.RecordID)
	assert.Equal(t, recordID, *fu.RecordID)
}

func TestFollowUpCreateInvalidDate(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	req := &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "invalid-date",
		Method:      "电话",
	}
	_, err := svc.Create(tenantID, userID, req)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid planned_date")
}

func TestFollowUpList(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	// Create 3 follow-ups
	for i := 0; i < 3; i++ {
		_, err := svc.Create(tenantID, userID, &CreateFollowUpRequest{
			PatientID:   patientID,
			PlannedDate: "2026-03-20",
			Method:      "电话",
		})
		require.NoError(t, err)
	}

	items, total, err := svc.List(tenantID, "", "", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	assert.Len(t, items, 3)
	assert.Equal(t, "张三", items[0].PatientName)
}

func TestFollowUpListFilterByStatus(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	// Create pending (future)
	_, err := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2099-12-31",
		Method:      "电话",
	})
	require.NoError(t, err)

	// Create overdue (past, still pending)
	_, err = svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2020-01-01",
		Method:      "微信",
	})
	require.NoError(t, err)

	// Filter pending only (future)
	items, _, err := svc.List(tenantID, "", "pending", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, 1, len(items))
	assert.Equal(t, "pending", items[0].Status)

	// Filter overdue
	items, _, err = svc.List(tenantID, "", "overdue", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, 1, len(items))
	assert.Equal(t, "overdue", items[0].Status)
}

func TestFollowUpUpdate(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	fu, err := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2026-03-20",
		Method:      "电话",
	})
	require.NoError(t, err)

	// Update with actual_date → completed
	actualDate := "2026-03-21"
	newMethod := "微信"
	_, updated, err := svc.Update(tenantID, fu.ID, &UpdateFollowUpRequest{
		ActualDate: &actualDate,
		Method:     &newMethod,
	})
	require.NoError(t, err)
	assert.Equal(t, "completed", updated.Status)
	assert.NotNil(t, updated.ActualDate)
	assert.Equal(t, "微信", updated.Method)
}

func TestFollowUpUpdateClearActualDate(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	fu, _ := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2026-03-20",
		Method:      "电话",
	})

	// Set actual_date
	ad := "2026-03-21"
	svc.Update(tenantID, fu.ID, &UpdateFollowUpRequest{ActualDate: &ad})

	// Clear actual_date → revert to pending
	empty := ""
	_, updated, err := svc.Update(tenantID, fu.ID, &UpdateFollowUpRequest{ActualDate: &empty})
	require.NoError(t, err)
	assert.Equal(t, "pending", updated.Status)
	assert.Nil(t, updated.ActualDate)
}

func TestFollowUpDelete(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	fu, _ := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID:   patientID,
		PlannedDate: "2026-03-20",
		Method:      "电话",
	})

	deleted, err := svc.Delete(tenantID, fu.ID)
	require.NoError(t, err)
	assert.Equal(t, fu.ID, deleted.ID)

	// Verify not found after delete
	_, err = svc.GetByID(tenantID, fu.ID)
	assert.ErrorIs(t, err, ErrFollowUpNotFound)
}

func TestFollowUpDeleteNotFound(t *testing.T) {
	svc, tenantID, _, _ := setupFollowUpTest(t)
	_, err := svc.Delete(tenantID, 99999)
	assert.ErrorIs(t, err, ErrFollowUpNotFound)
}

func TestFollowUpTenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	tenant1 := testutil.SeedTestTenant(t, db, "诊所A", "clinic-a")
	tenant2 := testutil.SeedTestTenant(t, db, "诊所B", "clinic-b")
	role1 := testutil.SeedTestRole(t, db, tenant1.ID, "admin")
	role2 := testutil.SeedTestRole(t, db, tenant2.ID, "admin")
	user1, _ := testutil.SeedTestUser(t, db, tenant1.ID, "doc1", "pass", role1)
	user2, _ := testutil.SeedTestUser(t, db, tenant2.ID, "doc2", "pass", role2)
	patient1 := testutil.SeedTestPatient(t, db, tenant1.ID, user1.ID, "患者A")
	patient2 := testutil.SeedTestPatient(t, db, tenant2.ID, user2.ID, "患者B")

	svc := NewFollowUpService(db)

	// Create in tenant1
	svc.Create(tenant1.ID, user1.ID, &CreateFollowUpRequest{
		PatientID: patient1.ID, PlannedDate: "2026-03-20", Method: "电话",
	})

	// Create in tenant2
	svc.Create(tenant2.ID, user2.ID, &CreateFollowUpRequest{
		PatientID: patient2.ID, PlannedDate: "2026-03-20", Method: "微信",
	})

	// Tenant1 should only see its own
	items, total, err := svc.List(tenant1.ID, "", "", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "患者A", items[0].PatientName)

	// Tenant2 should only see its own
	items, total, err = svc.List(tenant2.ID, "", "", "", "", 1, 10)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "患者B", items[0].PatientName)
}

func TestFollowUpStats(t *testing.T) {
	svc, tenantID, userID, patientID := setupFollowUpTest(t)

	// Create future pending
	svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, PlannedDate: "2099-12-31", Method: "电话",
	})

	// Create overdue (past pending)
	svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, PlannedDate: "2020-01-01", Method: "微信",
	})

	// Create completed
	fu, _ := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, PlannedDate: "2026-03-01", Method: "到诊",
	})
	ad := "2026-03-02"
	svc.Update(tenantID, fu.ID, &UpdateFollowUpRequest{ActualDate: &ad})

	stats, err := svc.Stats(tenantID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), stats.PendingCount)
	assert.Equal(t, int64(1), stats.OverdueCount)
	assert.Equal(t, int64(1), stats.CompletedCount)
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./service/ -run TestFollowUp -v`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add server/service/follow_up_test.go
git commit -m "test: add FollowUp service tests"
```

---

## Chunk 3: 后端 Handler 层 + 路由 + 测试

### Task 5: 创建 FollowUp Handler

**Files:**
- Create: `server/handler/follow_up.go`

- [ ] **Step 1: 创建 Handler 文件**

```go
package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// FollowUpHandler handles follow-up CRUD endpoints.
type FollowUpHandler struct {
	db *gorm.DB
}

// NewFollowUpHandler creates a new FollowUpHandler.
func NewFollowUpHandler(db *gorm.DB) *FollowUpHandler {
	return &FollowUpHandler{db: db}
}

// List handles GET /api/v1/follow-ups.
func (h *FollowUpHandler) List(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	patientName := c.Query("patient_name")
	status := c.Query("status")
	plannedFrom := c.Query("planned_date_from")
	plannedTo := c.Query("planned_date_to")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size < 1 {
		size = 20
	}

	svc := service.NewFollowUpService(h.db)
	items, total, err := svc.List(tenantID, patientName, status, plannedFrom, plannedTo, page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to list follow-ups",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"list":  items,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

// Create handles POST /api/v1/follow-ups.
func (h *FollowUpHandler) Create(c *gin.Context) {
	var req service.CreateFollowUpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	tenantID := middleware.GetTenantID(c)
	userID := middleware.GetUserID(c)

	svc := service.NewFollowUpService(h.db)
	followUp, err := svc.Create(tenantID, userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to create follow-up: " + err.Error(),
		})
		return
	}

	middleware.LogOperation(h.db, c, "create", "follow_up", followUp.ID, nil, followUp)

	c.JSON(http.StatusCreated, gin.H{
		"code":    0,
		"message": "success",
		"data":    followUp,
	})
}

// Detail handles GET /api/v1/follow-ups/:id.
// Computes overdue virtual status before returning.
func (h *FollowUpHandler) Detail(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid follow-up id",
		})
		return
	}

	svc := service.NewFollowUpService(h.db)
	followUp, err := svc.GetByID(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrFollowUpNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "follow-up not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to get follow-up",
		})
		return
	}

	// Compute overdue virtual status
	status := followUp.Status
	today := time.Now().Format("2006-01-02")
	plannedStr := followUp.PlannedDate.Format("2006-01-02")
	if status == "pending" && plannedStr < today {
		status = "overdue"
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"id":           followUp.ID,
			"tenant_id":    followUp.TenantID,
			"patient_id":   followUp.PatientID,
			"record_id":    followUp.RecordID,
			"planned_date": plannedStr,
			"actual_date":  followUp.ActualDate,
			"status":       status,
			"method":       followUp.Method,
			"content":      followUp.Content,
			"created_by":   followUp.CreatedBy,
			"created_at":   followUp.CreatedAt,
			"updated_at":   followUp.UpdatedAt,
		},
	})
}

// Update handles PUT /api/v1/follow-ups/:id.
func (h *FollowUpHandler) Update(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid follow-up id",
		})
		return
	}

	var req service.UpdateFollowUpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	svc := service.NewFollowUpService(h.db)
	oldFollowUp, newFollowUp, err := svc.Update(tenantID, id, &req)
	if err != nil {
		if errors.Is(err, service.ErrFollowUpNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "follow-up not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to update follow-up: " + err.Error(),
		})
		return
	}

	middleware.LogOperation(h.db, c, "update", "follow_up", id, oldFollowUp, newFollowUp)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    newFollowUp,
	})
}

// Delete handles DELETE /api/v1/follow-ups/:id.
func (h *FollowUpHandler) Delete(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "invalid follow-up id",
		})
		return
	}

	svc := service.NewFollowUpService(h.db)
	oldFollowUp, err := svc.Delete(tenantID, id)
	if err != nil {
		if errors.Is(err, service.ErrFollowUpNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "follow-up not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to delete follow-up",
		})
		return
	}

	middleware.LogOperation(h.db, c, "delete", "follow_up", id, oldFollowUp, nil)

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
	})
}

// Stats handles GET /api/v1/follow-ups/stats.
func (h *FollowUpHandler) Stats(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)

	svc := service.NewFollowUpService(h.db)
	stats, err := svc.Stats(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to get follow-up stats",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data":    stats,
	})
}
```

- [ ] **Step 2: 验证编译通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./handler/...`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add server/handler/follow_up.go
git commit -m "feat: add FollowUp handler with CRUD and stats endpoints"
```

### Task 6: 注册路由

**Files:**
- Modify: `server/router/router.go:52` — 追加 handler 创建
- Modify: `server/router/router.go:286` — 追加路由组（在 inventory 路由后）

- [ ] **Step 1: 在 router.go 中创建 handler 实例**

在 `server/router/router.go` 约第 52 行（handler 创建区域），追加：

```go
	followUpHandler := handler.NewFollowUpHandler(db)
```

- [ ] **Step 2: 在 router.go 中注册路由组**

在 `server/router/router.go` 第 286 行（inventory 路由组 `}` 后），追加：

```go

		// Follow-up routes (tenant-scoped).
		followUps := authenticated.Group("/follow-ups")
		{
			followUps.GET("", middleware.RequirePermission(db, "followup:read"), followUpHandler.List)
			followUps.POST("", middleware.RequirePermission(db, "followup:create"), followUpHandler.Create)
			followUps.GET("/stats", middleware.RequirePermission(db, "followup:read"), followUpHandler.Stats)
			followUps.GET("/:id", middleware.RequirePermission(db, "followup:read"), followUpHandler.Detail)
			followUps.PUT("/:id", middleware.RequirePermission(db, "followup:update"), followUpHandler.Update)
			followUps.DELETE("/:id", middleware.RequirePermission(db, "followup:delete"), followUpHandler.Delete)
		}
```

注意：`/stats` 必须在 `/:id` 之前注册，避免被通配符捕获。

- [ ] **Step 3: 验证编译通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go build ./...`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add server/router/router.go
git commit -m "feat: register follow-up API routes"
```

### Task 7: Handler 测试

**Files:**
- Create: `server/handler/follow_up_test.go`

- [ ] **Step 1: 编写 Handler 层测试**

```go
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupFollowUpRouter(t *testing.T) (*gin.Engine, string, uint64) {
	gin.SetMode(gin.TestMode)
	db := testutil.SetupTestDB(t)
	tenant, user, token := testutil.SeedAdminUser(t, db)
	patient := testutil.SeedTestPatient(t, db, tenant.ID, user.ID, "测试患者")

	h := NewFollowUpHandler(db)
	r := gin.New()
	r.Use(middleware.AuthMiddleware(testutil.TestJWTSecret))

	g := r.Group("/follow-ups")
	g.GET("", middleware.RequirePermission(db, "followup:read"), h.List)
	g.POST("", middleware.RequirePermission(db, "followup:create"), h.Create)
	g.GET("/stats", middleware.RequirePermission(db, "followup:read"), h.Stats)
	g.GET("/:id", middleware.RequirePermission(db, "followup:read"), h.Detail)
	g.PUT("/:id", middleware.RequirePermission(db, "followup:update"), h.Update)
	g.DELETE("/:id", middleware.RequirePermission(db, "followup:delete"), h.Delete)

	return r, token, patient.ID
}

func TestFollowUpHandlerCreate(t *testing.T) {
	r, token, patientID := setupFollowUpRouter(t)

	body, _ := json.Marshal(map[string]interface{}{
		"patient_id":   patientID,
		"planned_date": "2026-03-20",
		"method":       "电话",
		"content":      "术后回访",
	})

	req := httptest.NewRequest(http.MethodPost, "/follow-ups", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestFollowUpHandlerList(t *testing.T) {
	r, token, patientID := setupFollowUpRouter(t)

	// Create a follow-up first
	body, _ := json.Marshal(map[string]interface{}{
		"patient_id":   patientID,
		"planned_date": "2026-03-20",
		"method":       "电话",
	})
	req := httptest.NewRequest(http.MethodPost, "/follow-ups", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusCreated, w.Code)

	// List
	req = httptest.NewRequest(http.MethodGet, "/follow-ups?page=1&size=10", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})
	assert.Equal(t, float64(1), data["total"])
}

func TestFollowUpHandlerStats(t *testing.T) {
	r, token, _ := setupFollowUpRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/follow-ups/stats", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestFollowUpHandlerDeleteNotFound(t *testing.T) {
	r, token, _ := setupFollowUpRouter(t)

	req := httptest.NewRequest(http.MethodDelete, "/follow-ups/99999", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestFollowUpHandlerCreateBadRequest(t *testing.T) {
	r, token, _ := setupFollowUpRouter(t)

	// Missing required fields
	body, _ := json.Marshal(map[string]interface{}{})
	req := httptest.NewRequest(http.MethodPost, "/follow-ups", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./handler/ -run TestFollowUp -v`
Expected: 全部 PASS

- [ ] **Step 3: 运行全量后端测试确保无回归**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./... -count=1`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add server/handler/follow_up_test.go
git commit -m "test: add FollowUp handler tests"
```

---

## Chunk 4: 前端 API + 页面 + 菜单

### Task 8: 创建前端 API 层

**Files:**
- Create: `web/src/api/followUp.ts`

- [ ] **Step 1: 创建 API 文件**

```typescript
import request from '../utils/request';

export interface FollowUp {
  id: number;
  tenant_id: number;
  patient_id: number;
  record_id: number | null;
  planned_date: string;
  actual_date: string | null;
  status: 'pending' | 'completed' | 'overdue';
  method: string;
  content: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface FollowUpListItem {
  id: number;
  tenant_id: number;
  patient_id: number;
  patient_name: string;
  record_id: number | null;
  record_diagnosis: string;
  record_visit_date: string | null;
  planned_date: string;
  actual_date: string | null;
  status: 'pending' | 'completed' | 'overdue';
  method: string;
  content: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface FollowUpListParams {
  patient_name?: string;
  status?: string;
  planned_date_from?: string;
  planned_date_to?: string;
  page?: number;
  size?: number;
}

export interface CreateFollowUpReq {
  patient_id: number;
  record_id?: number | null;
  planned_date: string;
  method: string;
  content?: string;
}

export interface UpdateFollowUpReq {
  patient_id?: number;
  record_id?: number | null;
  planned_date?: string;
  actual_date?: string | null;
  method?: string;
  content?: string;
}

export interface FollowUpStats {
  pending_count: number;
  overdue_count: number;
  today_count: number;
  completed_count: number;
}

export function listFollowUps(params: FollowUpListParams) {
  return request.get('/follow-ups', { params });
}

export function createFollowUp(data: CreateFollowUpReq) {
  return request.post('/follow-ups', data);
}

export function getFollowUp(id: number) {
  return request.get(`/follow-ups/${id}`);
}

export function updateFollowUp(id: number, data: UpdateFollowUpReq) {
  return request.put(`/follow-ups/${id}`, data);
}

export function deleteFollowUp(id: number) {
  return request.delete(`/follow-ups/${id}`);
}

export function getFollowUpStats() {
  return request.get('/follow-ups/stats');
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/api/followUp.ts
git commit -m "feat: add follow-up frontend API layer"
```

### Task 9: 创建回访列表页

**Files:**
- Create: `web/src/pages/followup/FollowUpList.tsx`

- [ ] **Step 1: 创建回访列表页组件（完整实现）**

**IMPORTANT:** 此文件必须作为完整的可运行组件编写，不能只是片段。参考 `web/src/pages/inventory/DrugList.tsx` (976行) 的模式，以下是完整实现所需的所有要素：

**组件结构：**

```typescript
import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Button, Space, Input, Select, Modal, Form, DatePicker, message, Tag, Statistic, Row, Col, Popconfirm, Pagination } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../../store/auth';
import useIsMobile from '../../hooks/useIsMobile';
import { listFollowUps, createFollowUp, updateFollowUp, deleteFollowUp, getFollowUpStats } from '../../api/followUp';
import type { FollowUpListItem, FollowUpStats, CreateFollowUpReq, UpdateFollowUpReq } from '../../api/followUp';
import { listPatients } from '../../api/patient';
import { listRecords } from '../../api/record';
import dayjs from 'dayjs';

const { Option } = Select;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: '待回访', color: 'blue' },
  completed: { label: '已完成', color: 'green' },
  overdue: { label: '逾期', color: 'red' },
};

export default function FollowUpList() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  // List state
  const [data, setData] = useState<FollowUpListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [params, setParams] = useState({ page: 1, size: 20, patient_name: '', status: '', planned_date_from: '', planned_date_to: '' });
  const [stats, setStats] = useState<FollowUpStats>({ pending_count: 0, overdue_count: 0, today_count: 0, completed_count: 0 });

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FollowUpListItem | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [form] = Form.useForm();

  // Patient/Record select state
  const [patients, setPatients] = useState<{ id: number; name: string }[]>([]);
  const [patientRecords, setPatientRecords] = useState<{ id: number; diagnosis: string; visit_date: string }[]>([]);
  const [isOtherMethod, setIsOtherMethod] = useState(false);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listFollowUps(params);
      const body = res as any;
      setData(body.data?.list || []);
      setTotal(body.data?.total || 0);
    } catch { /* interceptor handles */ }
    finally { setLoading(false); }
  }, [params]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await getFollowUpStats();
      const body = res as any;
      if (body.data) setStats(body.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Patient search for modal
  const searchPatients = async (name: string) => {
    if (!name || name.length < 1) return;
    try {
      const res = await listPatients({ name, size: 20 });
      const body = res as any;
      setPatients((body.data?.list || []).map((p: any) => ({ id: p.id, name: p.name })));
    } catch { /* ignore */ }
  };

  // Load records when patient changes
  const handlePatientChange = async (patientId: number) => {
    form.setFieldValue('record_id', undefined);
    setPatientRecords([]);
    try {
      const res = await listRecords({ patient_id: patientId, size: 100 } as any);
      const body = res as any;
      setPatientRecords((body.data?.list || []).map((r: any) => ({
        id: r.id, diagnosis: r.diagnosis || r.chief_complaint || '未填写', visit_date: r.visit_date,
      })));
    } catch { /* ignore */ }
  };

  // CRUD handlers
  const handleAdd = () => {
    form.resetFields();
    setEditing(null);
    setIsOtherMethod(false);
    setPatientRecords([]);
    setModalOpen(true);
  };

  const handleEdit = (record: FollowUpListItem) => {
    setEditing(record);
    const isOther = !['电话', '微信', '到诊'].includes(record.method);
    setIsOtherMethod(isOther);
    form.setFieldsValue({
      patient_id: record.patient_id,
      record_id: record.record_id,
      planned_date: record.planned_date ? dayjs(record.planned_date) : undefined,
      actual_date: record.actual_date ? dayjs(record.actual_date) : undefined,
      method: isOther ? '其他' : record.method,
      custom_method: isOther ? record.method : undefined,
      content: record.content,
    });
    handlePatientChange(record.patient_id);
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteFollowUp(id);
      message.success('删除成功');
      fetchData();
      fetchStats();
    } catch { message.error('删除失败'); }
  };

  const handleModalOk = async () => {
    const values = await form.validateFields();
    setConfirmLoading(true);
    try {
      const method = values.method === '其他' ? (values.custom_method || '其他') : values.method;
      if (editing) {
        const req: UpdateFollowUpReq = {
          patient_id: values.patient_id,
          record_id: values.record_id ?? null,
          planned_date: values.planned_date?.format('YYYY-MM-DD'),
          actual_date: values.actual_date?.format('YYYY-MM-DD') ?? null,
          method,
          content: values.content || '',
        };
        await updateFollowUp(editing.id, req);
        message.success('更新成功');
      } else {
        const req: CreateFollowUpReq = {
          patient_id: values.patient_id,
          record_id: values.record_id ?? undefined,
          planned_date: values.planned_date.format('YYYY-MM-DD'),
          method,
          content: values.content || '',
        };
        await createFollowUp(req);
        message.success('新增成功');
      }
      setModalOpen(false);
      fetchData();
      fetchStats();
    } catch { message.error('操作失败'); }
    finally { setConfirmLoading(false); }
  };

  // Table columns (desktop)
  const columns: ColumnsType<FollowUpListItem> = [
    {
      title: '患者姓名', dataIndex: 'patient_name', key: 'patient_name', width: 100,
      render: (name: string, record) => (
        name === '已删除'
          ? <span style={{ color: '#999' }}>{name}</span>
          : <a onClick={() => navigate(`/patients/${record.patient_id}`)}>{name}</a>
      ),
    },
    {
      title: '关联诊疗', key: 'record', width: 160,
      render: (_, record) => record.record_id
        ? (record.record_diagnosis
          ? <a onClick={() => navigate(`/records/${record.record_id}`)}>{record.record_diagnosis} ({record.record_visit_date})</a>
          : <span style={{ color: '#999' }}>已删除</span>)
        : '—',
    },
    { title: '计划日期', dataIndex: 'planned_date', key: 'planned_date', width: 110 },
    {
      title: '实际日期', dataIndex: 'actual_date', key: 'actual_date', width: 110,
      render: (v: string | null) => v || '—',
    },
    {
      title: '状态', key: 'status', width: 80,
      render: (_, record) => {
        const cfg = statusConfig[record.status] || statusConfig.pending;
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    { title: '回访方式', dataIndex: 'method', key: 'method', width: 80 },
    {
      title: '操作', key: 'action', width: 120,
      render: (_, record) => (
        <Space size="small">
          {hasPermission('followup:update') && (
            <Button type="link" size="small" onClick={() => handleEdit(record)}>编辑</Button>
          )}
          {hasPermission('followup:delete') && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // Mobile card
  const renderMobileCard = (item: FollowUpListItem) => {
    const cfg = statusConfig[item.status] || statusConfig.pending;
    return (
      <Card key={item.id} size="small" style={{ marginBottom: 8, borderLeft: item.status === 'overdue' ? '3px solid #ff4d4f' : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <a onClick={() => navigate(`/patients/${item.patient_id}`)} style={{ fontWeight: 500 }}>{item.patient_name}</a>
          <Tag color={cfg.color}>{cfg.label}</Tag>
        </div>
        <div style={{ color: '#666', fontSize: 13 }}>
          计划: {item.planned_date} | 方式: {item.method}
          {item.actual_date && ` | 实际: ${item.actual_date}`}
        </div>
        {item.record_id && item.record_diagnosis && (
          <div style={{ marginTop: 4 }}>
            <a onClick={() => navigate(`/records/${item.record_id}`)} style={{ fontSize: 13 }}>
              诊疗: {item.record_diagnosis}
            </a>
          </div>
        )}
        {item.content && <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>{item.content}</div>}
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          {hasPermission('followup:update') && <Button size="small" onClick={() => handleEdit(item)}>编辑</Button>}
          {hasPermission('followup:delete') && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(item.id)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </div>
      </Card>
    );
  };

  // Search bar
  const renderSearchBar = () => (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      <Input
        placeholder="患者姓名"
        prefix={<SearchOutlined />}
        value={params.patient_name}
        onChange={(e) => setParams({ ...params, patient_name: e.target.value, page: 1 })}
        style={{ width: isMobile ? '100%' : 200 }}
        allowClear
      />
      <Select
        value={params.status || undefined}
        placeholder="状态"
        onChange={(v) => setParams({ ...params, status: v || '', page: 1 })}
        style={{ width: isMobile ? '100%' : 120 }}
        allowClear
      >
        <Option value="pending">待回访</Option>
        <Option value="overdue">逾期</Option>
        <Option value="completed">已完成</Option>
      </Select>
      {!isMobile && (
        <RangePicker
          onChange={(dates) => {
            setParams({
              ...params,
              planned_date_from: dates?.[0]?.format('YYYY-MM-DD') || '',
              planned_date_to: dates?.[1]?.format('YYYY-MM-DD') || '',
              page: 1,
            });
          }}
        />
      )}
      {hasPermission('followup:create') && (
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          {isMobile ? '' : '新增回访'}
        </Button>
      )}
    </div>
  );

  // Stats cards
  const renderStats = () => (
    <Row gutter={16} style={{ marginBottom: 16 }}>
      <Col span={isMobile ? 8 : 4}>
        <Card size="small"><Statistic title="待回访" value={stats.pending_count} /></Card>
      </Col>
      <Col span={isMobile ? 8 : 4}>
        <Card size="small"><Statistic title="今日" value={stats.today_count} /></Card>
      </Col>
      <Col span={isMobile ? 8 : 4}>
        <Card size="small"><Statistic title="逾期" value={stats.overdue_count} valueStyle={{ color: '#ff4d4f' }} /></Card>
      </Col>
    </Row>
  );

  // Modal form
  const renderModal = () => (
    <Modal
      title={editing ? '编辑回访' : '新增回访'}
      open={modalOpen}
      onOk={handleModalOk}
      onCancel={() => setModalOpen(false)}
      confirmLoading={confirmLoading}
      width={isMobile ? 'calc(100vw - 32px)' : 560}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="patient_id" label="患者" rules={[{ required: true, message: '请选择患者' }]}>
          <Select
            showSearch
            filterOption={false}
            onSearch={searchPatients}
            onChange={handlePatientChange}
            placeholder="搜索患者姓名"
          >
            {patients.map((p) => <Option key={p.id} value={p.id}>{p.name}</Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="record_id" label="关联诊疗记录">
          <Select allowClear placeholder="选择诊疗记录（可选）">
            {patientRecords.map((r) => (
              <Option key={r.id} value={r.id}>{r.diagnosis} ({r.visit_date})</Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="planned_date" label="计划回访日期" rules={[{ required: true, message: '请选择日期' }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="method" label="回访方式" rules={[{ required: true, message: '请选择方式' }]}>
          <Select onChange={(v) => setIsOtherMethod(v === '其他')}>
            <Option value="电话">电话</Option>
            <Option value="微信">微信</Option>
            <Option value="到诊">到诊</Option>
            <Option value="其他">其他</Option>
          </Select>
        </Form.Item>
        {isOtherMethod && (
          <Form.Item name="custom_method" label="自定义方式" rules={[{ required: true, message: '请输入方式' }]}>
            <Input maxLength={50} />
          </Form.Item>
        )}
        {editing && (
          <Form.Item name="actual_date" label="实际回访日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        )}
        <Form.Item name="content" label="回访内容">
          <TextArea rows={4} maxLength={2000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );

  return (
    <>
      {renderSearchBar()}
      {renderStats()}
      {isMobile ? (
        <>
          {data.map(renderMobileCard)}
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Pagination
              size="small"
              simple
              current={params.page}
              pageSize={params.size}
              total={total}
              onChange={(page) => setParams({ ...params, page })}
            />
          </div>
        </>
      ) : (
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          rowClassName={(record) => record.status === 'overdue' ? 'follow-up-overdue-row' : ''}
          pagination={{
            current: params.page,
            pageSize: params.size,
            total,
            onChange: (page, size) => setParams({ ...params, page, size }),
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
        />
      )}
      {renderModal()}
      <style>{`.follow-up-overdue-row { background: #fff2f0 !important; }`}</style>
    </>
  );
}
```

**NOTE:** 此为完整组件代码，直接写入文件即可。如编译报错需根据实际 API 响应类型调整。

- [ ] **Step 2: 验证 TypeScript 编译通过**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/followup/FollowUpList.tsx
git commit -m "feat: add FollowUpList page with responsive design"
```

### Task 10: 注册路由 + 修改菜单

**Files:**
- Modify: `web/src/App.tsx:24-25` — 追加 import
- Modify: `web/src/App.tsx:84` — 追加 Route
- Modify: `web/src/components/Layout.tsx:31` — 追加 import
- Modify: `web/src/components/Layout.tsx:53` — 追加 followUpCount state + useEffect
- Modify: `web/src/components/Layout.tsx:162-208` — 改写运营菜单逻辑

- [ ] **Step 1: 在 App.tsx 中注册路由**

在 `web/src/App.tsx` import 区域（约第 25 行后）追加：

```typescript
import FollowUpList from './pages/followup/FollowUpList';
```

在路由区域（约第 84 行 `inventory/alerts` 后）追加：

```typescript
        <Route path="follow-ups" element={<FollowUpList />} />
```

- [ ] **Step 2: 修改 Layout.tsx 菜单逻辑**

在 `web/src/components/Layout.tsx` import 区域追加：

```typescript
import { getFollowUpStats } from '../api/followUp';
import { PhoneOutlined } from '@ant-design/icons';
```

在 state 区域（约第 53 行 `alertCount` 后）追加：

```typescript
const [followUpCount, setFollowUpCount] = useState(0);
```

新增 useEffect 加载回访统计：

```typescript
useEffect(() => {
  if (!hasPermission('followup:read')) return;

  const checkFollowUps = async () => {
    try {
      const res = await getFollowUpStats();
      const data = (res as any).data;
      setFollowUpCount((data?.pending_count || 0) + (data?.overdue_count || 0));
    } catch { /* ignore */ }
  };

  checkFollowUps();
  const interval = setInterval(checkFollowUps, 5 * 60 * 1000); // 5分钟刷新
  return () => clearInterval(interval);
}, [hasPermission]);
```

修改运营菜单构建逻辑（替换第 163-216 行，保留 statistics 子菜单）：

```typescript
    const showOps = hasPermission('inventory:read') || hasPermission('followup:read') || hasPermission('tenant:manage');
    if (showOps) {
      const totalBadge = alertCount + followUpCount;
      items.push({
        key: '/ops',
        icon: <ShopOutlined />,
        label: totalBadge > 0
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              运营
              <span style={{
                background: '#ff4d4f', color: '#fff', fontSize: 11,
                lineHeight: '16px', minWidth: 16, height: 16,
                borderRadius: 8, padding: '0 4px', textAlign: 'center', fontWeight: 500,
              }}>{totalBadge}</span>
            </span>
          : '运营',
        children: [
          ...(hasPermission('inventory:read') ? [
            {
              key: '/inventory/drugs',
              icon: <MedicineBoxOutlined />,
              label: '库存药物',
            },
            {
              key: '/inventory/alerts',
              icon: <AlertOutlined />,
              label: alertCount > 0
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    库存预警
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4d4f', boxShadow: '0 0 4px #ff4d4f', flexShrink: 0 }} />
                  </span>
                : '库存预警',
            },
          ] : []),
          ...(hasPermission('followup:read') ? [{
            key: '/follow-ups',
            icon: <PhoneOutlined />,
            label: followUpCount > 0
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  回访
                  <span style={{
                    background: '#ff4d4f', color: '#fff', fontSize: 11,
                    lineHeight: '16px', minWidth: 16, height: 16,
                    borderRadius: 8, padding: '0 4px', textAlign: 'center', fontWeight: 500,
                  }}>{followUpCount}</span>
                </span>
              : '回访',
          }] : []),
          ...(hasPermission('tenant:manage') ? [{
            key: '/statistics',
            icon: <BarChartOutlined />,
            label: '统计概览',
          }] : []),
        ],
      });
    }
```

- [ ] **Step 3: 验证构建通过**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: register follow-up route and update operations menu"
```

---

## Chunk 5: 前端测试 + 文档更新 + 部署

### Task 11: 前端测试

**Files:**
- Create: `web/src/pages/followup/__tests__/FollowUpList.test.tsx`

- [ ] **Step 1: 编写前端组件测试**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FollowUpList from '../FollowUpList';

// Mock API
vi.mock('../../../api/followUp', () => ({
  listFollowUps: vi.fn(),
  createFollowUp: vi.fn(),
  updateFollowUp: vi.fn(),
  deleteFollowUp: vi.fn(),
  getFollowUpStats: vi.fn(),
}));

// Mock patient/record API for select dropdowns
vi.mock('../../../api/patient', () => ({
  listPatients: vi.fn(),
}));
vi.mock('../../../api/record', () => ({
  listRecords: vi.fn(),
}));

// Mock auth
vi.mock('../../../store/auth', () => ({
  useAuth: () => ({
    hasPermission: (code: string) => true,
    user: { id: 1, real_name: 'Admin' },
    token: 'test-token',
  }),
}));

import { listFollowUps, getFollowUpStats } from '../../../api/followUp';

const mockListFollowUps = listFollowUps as ReturnType<typeof vi.fn>;
const mockGetStats = getFollowUpStats as ReturnType<typeof vi.fn>;

describe('FollowUpList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockResolvedValue({ data: { pending_count: 2, overdue_count: 1, today_count: 1, completed_count: 5 } });
  });

  it('renders follow-up list with data', async () => {
    mockListFollowUps.mockResolvedValue({
      data: {
        list: [
          {
            id: 1, patient_id: 10, patient_name: '张三',
            record_id: 5, record_diagnosis: '感冒', record_visit_date: '2026-03-10',
            planned_date: '2026-03-20', actual_date: null,
            status: 'pending', method: '电话', content: '回访',
            created_by: 1, created_by_name: '李医生',
            created_at: '2026-03-15', updated_at: '2026-03-15',
          },
        ],
        total: 1, page: 1, size: 20,
      },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });
  });

  it('renders empty state', async () => {
    mockListFollowUps.mockResolvedValue({
      data: { list: [], total: 0, page: 1, size: 20 },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(mockListFollowUps).toHaveBeenCalled();
    });
  });

  it('renders overdue status tag', async () => {
    mockListFollowUps.mockResolvedValue({
      data: {
        list: [
          {
            id: 2, patient_id: 10, patient_name: '王五',
            record_id: null, record_diagnosis: '', record_visit_date: null,
            planned_date: '2020-01-01', actual_date: null,
            status: 'overdue', method: '微信', content: '',
            created_by: 1, created_by_name: '李医生',
            created_at: '2026-03-15', updated_at: '2026-03-15',
          },
        ],
        total: 1, page: 1, size: 20,
      },
    });

    render(<MemoryRouter><FollowUpList /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('逾期')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npx vitest run src/pages/followup/__tests__/FollowUpList.test.tsx`
Expected: 全部 PASS

- [ ] **Step 3: 运行全量前端测试确保无回归**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run test`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/followup/__tests__/FollowUpList.test.tsx
git commit -m "test: add FollowUpList component tests"
```

### Task 12: 更新文档

**Files:**
- Modify: `docs/codebase.md` — 追加 follow_ups 表、API 路由、权限码
- Modify: `CLAUDE.md` — 权限码列表追加 `followup:*`
- Modify: `README.md` — 功能列表追加回访

- [ ] **Step 1: 更新 codebase.md**

在数据模型部分追加 follow_ups 表定义：

```markdown
### follow_ups（租户隔离）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uint64 PK | 主键 |
| tenant_id | uint64 index | 租户 ID |
| patient_id | uint64 index | 患者 ID |
| record_id | uint64 nullable index | 诊疗记录 ID |
| planned_date | date | 计划回访日期 |
| actual_date | date nullable | 实际回访日期 |
| status | varchar(20) default 'pending' | 状态(pending/completed) |
| method | varchar(50) | 回访方式 |
| content | text | 回访内容 |
| created_by | uint64 | 创建者 |
| created_at/updated_at/deleted_at | datetime | 时间戳+软删除 |
```

在 API 路由部分追加回访路由。

在权限码部分追加 `followup:create/read/update/delete`。

- [ ] **Step 2: 更新 CLAUDE.md 权限码列表**

在权限码列表中追加：`followup:create/read/update/delete`

- [ ] **Step 3: 更新 README.md 功能列表**

追加回访功能描述。

- [ ] **Step 4: Commit**

```bash
git add docs/codebase.md CLAUDE.md README.md
git commit -m "docs: add follow-up feature to codebase docs"
```

### Task 13: 构建部署验证

- [ ] **Step 1: 全量后端测试**

Run: `cd /Users/xiayanji/qbox/menzhen/server && go test ./... -count=1`
Expected: 全部 PASS

- [ ] **Step 2: 前端构建**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run build`
Expected: 构建成功

- [ ] **Step 3: 部署到 Docker**

```bash
cd /Users/xiayanji/qbox/menzhen/web
docker cp dist/. menzhen-web-1:/usr/share/nginx/html/
docker exec menzhen-nginx-1 nginx -s reload
```

- [ ] **Step 4: 验证功能**

打开 `http://localhost`，检查：
1. 运营菜单下出现"回访"入口
2. 回访列表页正常渲染
3. 新增回访弹窗正常
4. 患者搜索、诊疗记录联动正常
5. 编辑、删除功能正常
6. 移动端适配正常

---

## 依赖关系

```
Task 1 (Model) → Task 2 (Migration/Seed) → Task 3 (Service) → Task 4 (Service Test)
                                          → Task 5 (Handler) → Task 6 (Routes) → Task 7 (Handler Test)
Task 8 (Frontend API) → Task 9 (Page) → Task 10 (Route/Menu) → Task 11 (Frontend Test)
Task 12 (Docs) — 独立，可与 Task 8-11 并行
Task 13 (Deploy) — 依赖全部完成
```

**可并行执行**：
- Chunk 2 (后端 Service + 测试) 和 Chunk 4 中的 Task 8 (前端 API) 可并行
- Task 12 (文档更新) 可与前端开发并行
