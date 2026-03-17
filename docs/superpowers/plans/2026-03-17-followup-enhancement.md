# 回访功能增强实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强回访功能：Badge Pill 标签栏替代统计卡片、诊疗记录内嵌回访折叠面板、回访来源定位高亮。

**Architecture:** 后端增加 `total_count` 和 `record_id` 过滤；前端用 Badge Pill 标签栏替代统计卡片+状态下拉+快速日期按钮；新建 FollowUpPanel 组件替代 FollowUpDrawer，内嵌在 RecordForm 处方区域下方。

**Tech Stack:** Go/Gin/GORM, React/TypeScript/Ant Design, Vitest/Testing Library

**Spec:** `docs/superpowers/specs/2026-03-17-followup-enhancement-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/service/follow_up.go` | Modify | Stats 增加 TotalCount；List 增加 recordID 参数 |
| `server/handler/follow_up.go` | Modify | List handler 解析 record_id query param |
| `server/service/follow_up_test.go` | Modify | 测试 TotalCount 和 record_id 过滤 |
| `web/src/api/followUp.ts` | Modify | FollowUpStats 增加 total_count；FollowUpListParams 增加 record_id |
| `web/src/pages/followup/FollowUpList.tsx` | Modify | Badge Pill 标签栏替代统计卡片+下拉+快速日期按钮 |
| `web/src/pages/followup/__tests__/FollowUpList.test.tsx` | Modify | 更新测试适配新标签栏 |
| `web/src/components/FollowUpPanel.tsx` | Create | 回访折叠面板组件 |
| `web/src/components/__tests__/FollowUpPanel.test.tsx` | Create | 面板测试 |
| `web/src/pages/records/RecordForm.tsx` | Modify | 替换 FollowUpDrawer 为 FollowUpPanel；读取 followup_id |
| `web/src/components/FollowUpDrawer.tsx` | Delete | 功能被 FollowUpPanel 替代 |

---

## Chunk 1: 后端变更

### Task 1: Stats 增加 TotalCount

**Files:**
- Modify: `server/service/follow_up.go:59-64` (FollowUpStats struct)
- Modify: `server/service/follow_up.go:273-299` (Stats method)
- Test: `server/service/follow_up_test.go`

- [ ] **Step 1: Write the failing test**

在 `server/service/follow_up_test.go` 末尾添加：

```go
func TestFollowUpStatsTotalCount(t *testing.T) {
	svc, tenantID, userID, patientID, recordID := setupFollowUpTest(t)

	// Create future pending
	svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, RecordID: recordID, PlannedDate: "2099-12-31", Method: "电话",
	})
	// Create overdue (past pending)
	svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, RecordID: recordID, PlannedDate: "2020-01-01", Method: "微信",
	})
	// Create completed
	fu, _ := svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, RecordID: recordID, PlannedDate: "2026-03-01", Method: "到诊",
	})
	ad := "2026-03-02"
	svc.Update(tenantID, fu.ID, &UpdateFollowUpRequest{ActualDate: &ad})

	stats, err := svc.Stats(tenantID)
	require.NoError(t, err)
	assert.Equal(t, int64(3), stats.TotalCount)
	assert.Equal(t, stats.PendingCount+stats.OverdueCount+stats.CompletedCount, stats.TotalCount)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./service/ -run TestFollowUpStatsTotalCount -v`
Expected: FAIL — `stats.TotalCount` undefined

- [ ] **Step 3: Implement TotalCount**

In `server/service/follow_up.go`:

1. Add `TotalCount` to `FollowUpStats` struct:
```go
type FollowUpStats struct {
	PendingCount   int64 `json:"pending_count"`
	OverdueCount   int64 `json:"overdue_count"`
	TodayCount     int64 `json:"today_count"`
	CompletedCount int64 `json:"completed_count"`
	TotalCount     int64 `json:"total_count"`
}
```

2. Add `TotalCount` to the `aggregated` struct inside `Stats()`:
```go
type aggregated struct {
	PendingCount   int64
	OverdueCount   int64
	TodayCount     int64
	CompletedCount int64
	TotalCount     int64
}
```

3. Add `COUNT(*) AS total_count` to the SQL Select:
```go
Select(`
	SUM(CASE WHEN status='pending' AND planned_date >= CURDATE() THEN 1 ELSE 0 END) AS pending_count,
	SUM(CASE WHEN status='pending' AND planned_date < CURDATE() THEN 1 ELSE 0 END) AS overdue_count,
	SUM(CASE WHEN status='pending' AND planned_date = CURDATE() THEN 1 ELSE 0 END) AS today_count,
	SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_count,
	COUNT(*) AS total_count
`)
```

4. Set `TotalCount` in the return:
```go
return &FollowUpStats{
	PendingCount:   agg.PendingCount,
	OverdueCount:   agg.OverdueCount,
	TodayCount:     agg.TodayCount,
	CompletedCount: agg.CompletedCount,
	TotalCount:     agg.TotalCount,
}, nil
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./service/ -run TestFollowUpStatsTotalCount -v`
Expected: PASS

- [ ] **Step 5: Run all existing Stats tests still pass**

Run: `cd server && go test ./service/ -run TestFollowUpStats -v`
Expected: PASS (all Stats tests)

- [ ] **Step 6: Commit**

```bash
git add server/service/follow_up.go server/service/follow_up_test.go
git commit -m "feat: add total_count to follow-up stats API"
```

---

### Task 2: List API 增加 record_id 过滤

**Files:**
- Modify: `server/service/follow_up.go:77` (List method signature + filter)
- Modify: `server/handler/follow_up.go:26-54` (List handler)
- Test: `server/service/follow_up_test.go`

- [ ] **Step 1: Write the failing test**

在 `server/service/follow_up_test.go` 末尾添加：

```go
func TestFollowUpListByRecordID(t *testing.T) {
	svc, tenantID, userID, patientID, recordID := setupFollowUpTest(t)

	// Create a second medical record
	db := svc.DB
	record2 := model.MedicalRecord{
		TenantID: tenantID, PatientID: patientID, Diagnosis: "头痛",
		VisitDate: time.Now(), CreatedBy: userID,
	}
	require.NoError(t, db.Create(&record2).Error)

	// Create follow-ups for different records
	svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, RecordID: recordID, PlannedDate: "2026-04-01", Method: "电话",
	})
	svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, RecordID: recordID, PlannedDate: "2026-04-02", Method: "微信",
	})
	svc.Create(tenantID, userID, &CreateFollowUpRequest{
		PatientID: patientID, RecordID: record2.ID, PlannedDate: "2026-04-03", Method: "到诊",
	})

	// Filter by recordID should return only 2
	items, total, err := svc.List(tenantID, 0, recordID, "", "", "", "", 1, 10, "asc")
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, items, 2)

	// Filter by record2.ID should return only 1
	items, total, err = svc.List(tenantID, 0, record2.ID, "", "", "", "", 1, 10, "asc")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, items, 1)
	assert.Equal(t, "头痛", items[0].RecordDiagnosis)

	// No filter should return all 3
	items, total, err = svc.List(tenantID, 0, 0, "", "", "", "", 1, 10, "asc")
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./service/ -run TestFollowUpListByRecordID -v`
Expected: FAIL — too many arguments in call to `svc.List`

- [ ] **Step 3: Add recordID parameter to List method**

In `server/service/follow_up.go`, change the `List` method signature from:

```go
func (s *FollowUpService) List(tenantID uint64, patientID uint64, patientName, status string, plannedFrom, plannedTo string, page, size int, sortOrder string) ([]FollowUpListItem, int64, error) {
```

to:

```go
func (s *FollowUpService) List(tenantID uint64, patientID uint64, recordID uint64, patientName, status string, plannedFrom, plannedTo string, page, size int, sortOrder string) ([]FollowUpListItem, int64, error) {
```

Add the filter after the `patientID` filter block (after line 99):

```go
if recordID > 0 {
	query = query.Where("f.record_id = ?", recordID)
}
```

- [ ] **Step 4: Update handler to pass recordID**

In `server/handler/follow_up.go`, add after `patientID` parsing (around line 36):

```go
recordIDStr := c.Query("record_id")
var recordID uint64
if recordIDStr != "" {
	recordID, _ = strconv.ParseUint(recordIDStr, 10, 64)
}
```

Update the `svc.List` call (line 54) to include `recordID`:

```go
items, total, err := svc.List(tenantID, patientID, recordID, patientName, status, plannedFrom, plannedTo, page, size, sortOrder)
```

- [ ] **Step 5: Fix all existing List call sites**

All existing test calls to `svc.List` pass 0 as recordID. Search for `svc.List(` in `follow_up_test.go` and add `0,` after `patientID`. There are calls in:
- `TestFollowUpTenantIsolation` (2 calls, line ~318 and ~324)
- Any other test calling `svc.List`

Each call changes from:
```go
svc.List(tenantID, 0, "", "", "", "", 1, 10, "asc")
```
to:
```go
svc.List(tenantID, 0, 0, "", "", "", "", 1, 10, "asc")
```

- [ ] **Step 6: Run all tests to verify**

Run: `cd server && go test ./service/ -run TestFollowUp -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add server/service/follow_up.go server/handler/follow_up.go server/service/follow_up_test.go
git commit -m "feat: add record_id filter to follow-up list API"
```

---

## Chunk 2: 前端 API 类型 + Badge Pill 标签栏

### Task 3: 前端 API 类型更新

**Files:**
- Modify: `web/src/api/followUp.ts`

- [ ] **Step 1: Update FollowUpStats interface**

In `web/src/api/followUp.ts`, add `total_count` to `FollowUpStats`:

```typescript
export interface FollowUpStats {
  pending_count: number;
  overdue_count: number;
  today_count: number;
  completed_count: number;
  total_count: number;
}
```

- [ ] **Step 2: Update FollowUpListParams interface**

Add `record_id` to `FollowUpListParams`:

```typescript
export interface FollowUpListParams {
  patient_id?: number;
  patient_name?: string;
  record_id?: number;
  status?: string;
  planned_date_from?: string;
  planned_date_to?: string;
  sort_order?: 'asc' | 'desc';
  page?: number;
  size?: number;
}
```

- [ ] **Step 3: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/api/followUp.ts
git commit -m "feat: add total_count and record_id to follow-up API types"
```

---

### Task 4: Badge Pill 标签栏替代统计卡片

**Files:**
- Modify: `web/src/pages/followup/FollowUpList.tsx`
- Modify: `web/src/pages/followup/__tests__/FollowUpList.test.tsx`

- [ ] **Step 1: Define pill tab configuration**

At the top of `FollowUpList.tsx` (after `statusConfig`), add:

```typescript
type PillTab = 'all' | 'pending' | 'today' | 'overdue' | 'completed';

const pillTabs: { key: PillTab; label: string; bgActive: string; colorActive: string; bgInactive: string; colorInactive: string; statsKey: keyof FollowUpStats }[] = [
  { key: 'all', label: '全部', bgActive: '#1677ff', colorActive: '#fff', bgInactive: '#f5f5f5', colorInactive: '#666', statsKey: 'total_count' },
  { key: 'pending', label: '待回访', bgActive: '#e6f4ff', colorActive: '#1677ff', bgInactive: '#f5f5f5', colorInactive: '#666', statsKey: 'pending_count' },
  { key: 'today', label: '今日', bgActive: '#fff7e6', colorActive: '#fa8c16', bgInactive: '#f5f5f5', colorInactive: '#666', statsKey: 'today_count' },
  { key: 'overdue', label: '逾期', bgActive: '#fff2f0', colorActive: '#ff4d4f', bgInactive: '#f5f5f5', colorInactive: '#666', statsKey: 'overdue_count' },
  { key: 'completed', label: '已完成', bgActive: '#f6ffed', colorActive: '#52c41a', bgInactive: '#f5f5f5', colorInactive: '#666', statsKey: 'completed_count' },
];
```

- [ ] **Step 2: Add activeTab state**

Add new state inside the component:

```typescript
const [activeTab, setActiveTab] = useState<PillTab>('all');
```

- [ ] **Step 3: Implement handleTabClick**

```typescript
const handleTabClick = (tab: PillTab) => {
  if (tab === activeTab) {
    // Toggle off → back to all
    setActiveTab('all');
    setParams({ ...params, status: '', planned_date_from: '', planned_date_to: '', page: 1 });
    return;
  }
  setActiveTab(tab);
  const today = dayjs().format('YYYY-MM-DD');
  switch (tab) {
    case 'all':
      setParams({ ...params, status: '', planned_date_from: '', planned_date_to: '', page: 1 });
      break;
    case 'pending':
      setParams({ ...params, status: 'pending', planned_date_from: '', planned_date_to: '', page: 1 });
      break;
    case 'today':
      setParams({ ...params, status: '', planned_date_from: today, planned_date_to: today, page: 1 });
      break;
    case 'overdue':
      setParams({ ...params, status: 'overdue', planned_date_from: '', planned_date_to: '', page: 1 });
      break;
    case 'completed':
      setParams({ ...params, status: 'completed', planned_date_from: '', planned_date_to: '', page: 1 });
      break;
  }
};
```

- [ ] **Step 4: Create renderPillTabs function**

Replace `renderStats` with:

```typescript
const renderPillTabs = () => (
  <div style={{
    display: 'flex',
    gap: 8,
    marginBottom: 16,
    ...(isMobile ? { overflowX: 'auto', whiteSpace: 'nowrap' as const, flexWrap: 'nowrap' as const, paddingBottom: 4 } : { flexWrap: 'wrap' as const }),
  }}>
    {pillTabs.map(({ key, label, bgActive, colorActive, bgInactive, colorInactive, statsKey }) => {
      const isActive = activeTab === key;
      return (
        <div
          key={key}
          onClick={() => handleTabClick(key)}
          style={{
            padding: isMobile ? '4px 12px' : '6px 16px',
            background: isActive ? bgActive : bgInactive,
            color: isActive ? colorActive : colorInactive,
            borderRadius: 20,
            fontSize: isMobile ? 12 : 13,
            cursor: 'pointer',
            fontWeight: isActive ? 500 : 400,
            flexShrink: 0,
            transition: 'all 0.2s',
            userSelect: 'none' as const,
          }}
        >
          {label} {stats[statsKey] ?? 0}
        </div>
      );
    })}
  </div>
);
```

- [ ] **Step 5: Remove old code from renderSearchBar**

In `renderSearchBar`, remove:
1. The `Select` status dropdown (lines ~402-412)
2. The `Space.Compact` with quick date buttons (lines ~416-430)
3. Keep: patient name input, date range picker, add button

- [ ] **Step 6: Replace renderStats call with renderPillTabs**

In the return JSX, replace `{renderStats()}` with `{renderPillTabs()}`.

Delete the entire `renderStats` function.

Also remove these now-unused items:
- `QuickRangeKey` type
- `getQuickRange` function
- `activeQuickRange` memo
- `handleQuickRange` function
- `Statistic` from antd imports
- `Row, Col` from antd imports (if only used by renderStats)

- [ ] **Step 7: Update stats initial state**

Update the `useState` for stats to include `total_count`:

```typescript
const [stats, setStats] = useState<FollowUpStats>({ pending_count: 0, overdue_count: 0, today_count: 0, completed_count: 0, total_count: 0 });
```

- [ ] **Step 8: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Update FollowUpList tests**

In `web/src/pages/followup/__tests__/FollowUpList.test.tsx`:
- Update mock stats response to include `total_count`
- Update assertions: replace checks for Statistic cards with checks for pill tabs
- Add test: clicking "待回访" pill filters correctly
- Add test: clicking active pill toggles back to "全部"

- [ ] **Step 10: Run tests**

Run: `cd web && npx vitest run src/pages/followup/__tests__/FollowUpList.test.tsx`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add web/src/pages/followup/FollowUpList.tsx web/src/pages/followup/__tests__/FollowUpList.test.tsx
git commit -m "feat: replace stats cards with Badge Pill tab bar in follow-up list"
```

---

## Chunk 3: FollowUpPanel 组件

### Task 5: 创建 FollowUpPanel 组件

**Files:**
- Create: `web/src/components/FollowUpPanel.tsx`
- Test: `web/src/components/__tests__/FollowUpPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/FollowUpPanel.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import FollowUpPanel from '../FollowUpPanel';

// Mock API
vi.mock('../../api/followUp', () => ({
  listFollowUps: vi.fn(),
  createFollowUp: vi.fn(),
  updateFollowUp: vi.fn(),
  deleteFollowUp: vi.fn(),
}));

// Mock useIsMobile
vi.mock('../../hooks/useIsMobile', () => ({ default: () => false }));

// Mock useAuth
vi.mock('../../store/auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

import { listFollowUps, updateFollowUp } from '../../api/followUp';

const mockFollowUps = [
  {
    id: 1, tenant_id: 1, patient_id: 10, record_id: 100,
    patient_name: '张三', patient_phone: '13800000000',
    record_diagnosis: '感冒', record_visit_date: '2026-03-01',
    planned_date: '2020-01-01', actual_date: null,
    status: 'overdue', method: '电话', content: '询问退热情况',
    is_recovered: false, created_by: 1, created_by_name: '医生',
    created_at: '2026-03-01', updated_at: '2026-03-01',
  },
  {
    id: 2, tenant_id: 1, patient_id: 10, record_id: 100,
    patient_name: '张三', patient_phone: '13800000000',
    record_diagnosis: '感冒', record_visit_date: '2026-03-01',
    planned_date: '2099-04-01', actual_date: null,
    status: 'pending', method: '微信', content: '复查',
    is_recovered: false, created_by: 1, created_by_name: '医生',
    created_at: '2026-03-01', updated_at: '2026-03-01',
  },
];

describe('FollowUpPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listFollowUps as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { list: mockFollowUps, total: 2 },
    });
  });

  it('renders follow-up list after loading', async () => {
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      expect(screen.getByText(/逾期/)).toBeInTheDocument();
      expect(screen.getByText(/待回访/)).toBeInTheDocument();
    });
  });

  it('shows empty state when no follow-ups', async () => {
    (listFollowUps as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { list: [], total: 0 },
    });
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      expect(screen.getByText(/暂无/)).toBeInTheDocument();
    });
  });

  it('calls updateFollowUp when clicking complete', async () => {
    (updateFollowUp as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      expect(screen.getAllByText('完成').length).toBeGreaterThan(0);
    });
    await userEvent.click(screen.getAllByText('完成')[0]);
    expect(updateFollowUp).toHaveBeenCalledWith(1, expect.objectContaining({
      actual_date: expect.any(String),
    }));
  });

  it('shows new follow-up button', async () => {
    render(<FollowUpPanel recordId={100} patientId={10} patientName="张三" />);
    await waitFor(() => {
      expect(screen.getByText(/新建回访/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/__tests__/FollowUpPanel.test.tsx`
Expected: FAIL — cannot find module `../FollowUpPanel`

- [ ] **Step 3: Implement FollowUpPanel component**

Create `web/src/components/FollowUpPanel.tsx`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { Form, Input, DatePicker, Select, Modal, Button, Switch, Tag, message, Spin } from 'antd';
import { DownOutlined, RightOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { listFollowUps, createFollowUp, updateFollowUp, deleteFollowUp } from '../api/followUp';
import type { FollowUpListItem, CreateFollowUpReq, UpdateFollowUpReq } from '../api/followUp';
import { useAuth } from '../store/auth';
import useIsMobile from '../hooks/useIsMobile';

const { TextArea } = Input;

interface FollowUpPanelProps {
  recordId: number;
  patientId: number;
  patientName: string;
  highlightFollowUpId?: number;
}

const statusConfig: Record<string, { label: string; bg: string; color: string }> = {
  overdue: { label: '逾期', bg: '#fff2f0', color: '#ff4d4f' },
  pending: { label: '待回访', bg: '#e6f4ff', color: '#1677ff' },
  completed: { label: '已完成', bg: '#f6ffed', color: '#52c41a' },
};

const METHOD_OPTIONS = [
  { label: '电话', value: '电话' },
  { label: '微信', value: '微信' },
  { label: '到诊', value: '到诊' },
  { label: '其他', value: '其他' },
];

export default function FollowUpPanel({ recordId, patientId, patientName, highlightFollowUpId }: FollowUpPanelProps) {
  const isMobile = useIsMobile();
  const { hasPermission } = useAuth();

  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<FollowUpListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FollowUpListItem | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [isOtherMethod, setIsOtherMethod] = useState(false);
  const [form] = Form.useForm();
  const highlightRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listFollowUps({ record_id: recordId, size: 100 });
      const body = res as any;
      const list: FollowUpListItem[] = body.data?.list || [];
      // Sort: overdue → pending → completed
      const order = { overdue: 0, pending: 1, completed: 2 };
      list.sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
      setItems(list);

      // Auto-expand if has highlight or has active follow-ups
      if (highlightFollowUpId || list.some(i => i.status !== 'completed')) {
        setExpanded(true);
      }
    } catch { /* interceptor handles */ }
    finally { setLoading(false); }
  }, [recordId, highlightFollowUpId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Scroll to highlighted item
  useEffect(() => {
    if (highlightFollowUpId && highlightRef.current && !loading) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [highlightFollowUpId, loading, items]);

  const statusSummary = () => {
    const counts = { overdue: 0, pending: 0, completed: 0 };
    items.forEach(i => { counts[i.status as keyof typeof counts] = (counts[i.status as keyof typeof counts] || 0) + 1; });
    return counts;
  };

  const handleComplete = async (item: FollowUpListItem) => {
    try {
      const today = dayjs().format('YYYY-MM-DD');
      await updateFollowUp(item.id, { actual_date: today });
      message.success('已标记完成');
      fetchData();
      window.dispatchEvent(new Event('followup-data-changed'));
    } catch { message.error('操作失败'); }
  };

  const handleEdit = (item: FollowUpListItem) => {
    setEditing(item);
    const isOther = !['电话', '微信', '到诊'].includes(item.method);
    setIsOtherMethod(isOther);
    form.setFieldsValue({
      planned_date: item.planned_date ? dayjs(item.planned_date) : undefined,
      actual_date: item.actual_date ? dayjs(item.actual_date) : undefined,
      method: isOther ? '其他' : item.method,
      custom_method: isOther ? item.method : undefined,
      content: item.content,
      is_recovered: item.is_recovered,
    });
    setModalOpen(true);
  };

  const handleAdd = () => {
    form.resetFields();
    setEditing(null);
    setIsOtherMethod(false);
    form.setFieldsValue({
      planned_date: dayjs().add(15, 'day'),
      method: '电话',
    });
    setModalOpen(true);
  };

  const handleModalOk = async () => {
    const values = await form.validateFields();
    setConfirmLoading(true);
    try {
      const method = values.method === '其他' ? (values.custom_method || '其他') : values.method;
      if (editing) {
        const req: UpdateFollowUpReq = {
          planned_date: values.planned_date?.format('YYYY-MM-DD'),
          actual_date: values.actual_date?.format('YYYY-MM-DD') ?? null,
          method,
          content: values.content || '',
          is_recovered: values.is_recovered ?? false,
        };
        await updateFollowUp(editing.id, req);
        message.success('更新成功');
      } else {
        const req: CreateFollowUpReq = {
          patient_id: patientId,
          record_id: recordId,
          planned_date: values.planned_date.format('YYYY-MM-DD'),
          method,
          content: values.content || '',
        };
        await createFollowUp(req);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchData();
      window.dispatchEvent(new Event('followup-data-changed'));
    } catch { message.error('操作失败'); }
    finally { setConfirmLoading(false); }
  };

  const counts = statusSummary();

  return (
    <>
      <div style={{
        background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f5 100%)',
        borderRadius: 8,
        border: '1px solid #f0f0f0',
        marginTop: 16,
      }}>
        {/* Header */}
        <div
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: isMobile ? '10px 12px' : '12px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <div>
            <span style={{ fontWeight: 600, fontSize: isMobile ? 13 : 14 }}>回访</span>
            {items.length === 0 && !loading && (
              <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>· 暂无</span>
            )}
            {items.length > 0 && (
              <span style={{ marginLeft: 8 }}>
                {counts.overdue > 0 && (
                  <span style={{ background: '#ff4d4f', color: '#fff', padding: '0 6px', borderRadius: 8, fontSize: 11, marginRight: 4 }}>
                    {counts.overdue}{isMobile ? '逾' : '逾期'}
                  </span>
                )}
                {counts.pending > 0 && (
                  <span style={{ background: '#e6f4ff', color: '#1677ff', padding: '0 6px', borderRadius: 8, fontSize: 11, marginRight: 4 }}>
                    {counts.pending}{isMobile ? '待' : '待回访'}
                  </span>
                )}
                {counts.completed > 0 && (
                  <span style={{ background: '#f6ffed', color: '#52c41a', padding: '0 6px', borderRadius: 8, fontSize: 11 }}>
                    {counts.completed}{isMobile ? '完成' : '已完成'}
                  </span>
                )}
              </span>
            )}
          </div>
          {expanded ? <DownOutlined style={{ color: '#999', fontSize: 12 }} /> : <RightOutlined style={{ color: '#999', fontSize: 12 }} />}
        </div>

        {/* Content */}
        {expanded && (
          <div style={{ padding: isMobile ? '0 12px 8px' : '0 16px 12px' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>
            ) : (
              <>
                {items.map((item) => {
                  const cfg = statusConfig[item.status] || statusConfig.pending;
                  const isHighlight = highlightFollowUpId === item.id;
                  return (
                    <div
                      key={item.id}
                      ref={isHighlight ? highlightRef : undefined}
                      className={isHighlight ? 'followup-highlight' : ''}
                      style={{ padding: isMobile ? '8px 0' : '10px 0', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ background: cfg.bg, color: cfg.color, padding: '1px 8px', borderRadius: 10, fontSize: 11 }}>{cfg.label}</span>
                        <span style={{ marginLeft: 6, fontSize: 13 }}>{item.planned_date} · {item.method}</span>
                        {item.content && (
                          <div style={{ color: '#888', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {item.content}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 8 }}>
                        {item.status !== 'completed' && hasPermission('followup:update') && (
                          <a style={{ color: '#52c41a', fontSize: 12 }} onClick={() => handleComplete(item)}>完成</a>
                        )}
                        {hasPermission('followup:update') && (
                          <a style={{ color: '#1677ff', fontSize: 12 }} onClick={() => handleEdit(item)}>
                            {item.status === 'completed' ? '查看' : '编辑'}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
                {hasPermission('followup:create') && (
                  <div style={{ padding: isMobile ? '8px 0' : '12px 0', textAlign: 'center' }}>
                    <div
                      onClick={handleAdd}
                      style={{ display: 'inline-block', padding: '4px 16px', border: '1px dashed #d9d9d9', borderRadius: 6, color: '#1677ff', fontSize: 13, cursor: 'pointer' }}
                    >
                      <PlusOutlined style={{ marginRight: 4 }} /> 新建回访
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal
        title={editing ? '编辑回访' : '新建回访'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        confirmLoading={confirmLoading}
        width={isMobile ? 'calc(100vw - 32px)' : 520}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
            患者：{patientName}
          </div>
          <Form.Item name="planned_date" label="计划回访日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="method" label="回访方式" rules={[{ required: true, message: '请选择方式' }]}>
            <Select options={METHOD_OPTIONS} onChange={(v) => setIsOtherMethod(v === '其他')} />
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
          {editing && (
            <Form.Item name="is_recovered" label="是否康复" valuePropName="checked">
              <Switch checkedChildren="已康复" unCheckedChildren="未康复" />
            </Form.Item>
          )}
          <Form.Item name="content" label="回访内容">
            <TextArea rows={4} maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <style>{`
        @keyframes followup-highlight {
          0% { background-color: #e6f4ff; }
          100% { background-color: transparent; }
        }
        .followup-highlight {
          animation: followup-highlight 2s ease-out;
        }
      `}</style>
    </>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/components/__tests__/FollowUpPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FollowUpPanel.tsx web/src/components/__tests__/FollowUpPanel.test.tsx
git commit -m "feat: add FollowUpPanel component with collapsible list and highlight"
```

---

## Chunk 4: RecordForm 集成 + 清理 + 来源定位

### Task 6: RecordForm 替换 FollowUpDrawer 为 FollowUpPanel

**Files:**
- Modify: `web/src/pages/records/RecordForm.tsx`
- Delete: `web/src/components/FollowUpDrawer.tsx`

- [ ] **Step 1: Replace import**

In `RecordForm.tsx`, change:
```typescript
import FollowUpDrawer from '../../components/FollowUpDrawer';
```
to:
```typescript
import FollowUpPanel from '../../components/FollowUpPanel';
```

- [ ] **Step 2: Read followup_id from URL**

Near the top of the component (after `useParams` and existing `useSearchParams`), add:

```typescript
const followUpIdParam = searchParams.get('followup_id');
const highlightFollowUpId = followUpIdParam ? Number(followUpIdParam) : undefined;
```

Note: `searchParams` is already available from the existing `useSearchParams()` call.

- [ ] **Step 3: Remove FollowUpDrawer state and button**

Remove:
```typescript
const [followUpDrawerOpen, setFollowUpDrawerOpen] = useState(false);
```

Remove the "回访" button from the form actions area (around line 1384-1391):
```typescript
{isEdit && hasPermission('followup:create') && (
  <Button
    icon={<ScheduleOutlined />}
    onClick={() => setFollowUpDrawerOpen(true)}
  >
    {isMobile ? '回访' : '创建回访'}
  </Button>
)}
```

- [ ] **Step 4: Replace FollowUpDrawer JSX with FollowUpPanel**

Replace the FollowUpDrawer block (lines ~1777-1788):
```tsx
{/* 快速创建回访抽屉 */}
{isEdit && (
  <FollowUpDrawer
    open={followUpDrawerOpen}
    ...
  />
)}
```

with FollowUpPanel placed after the prescription section (after the closing `</>` of the prescription area, before the patient modal). Find the right insertion point — after the prescription block's closing divs and before `{/* 新建患者弹窗 */}`:

```tsx
{/* 回访折叠面板 */}
{isEdit && hasPermission('followup:read') && recordPatient && (
  <div style={{ marginTop: 16 }}>
    <FollowUpPanel
      recordId={Number(id)}
      patientId={recordPatient.id}
      patientName={recordPatient.name}
      highlightFollowUpId={highlightFollowUpId}
    />
  </div>
)}
```

- [ ] **Step 5: Clean up unused imports**

Remove `ScheduleOutlined` from imports if no longer used elsewhere.
Remove the `FollowUpDrawer` import.

- [ ] **Step 6: Delete FollowUpDrawer.tsx**

```bash
rm web/src/components/FollowUpDrawer.tsx
```

- [ ] **Step 7: Verify build**

Run: `cd web && npx tsc --noEmit && cd ../server && go build ./...`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/records/RecordForm.tsx
git rm web/src/components/FollowUpDrawer.tsx
git commit -m "feat: replace FollowUpDrawer with inline FollowUpPanel in RecordForm"
```

---

### Task 7: 回访列表页来源定位链接

**Files:**
- Modify: `web/src/pages/followup/FollowUpList.tsx`

- [ ] **Step 1: Update the "查看详情" link**

In `FollowUpList.tsx`, find the column render for "关联诊疗" (around line 233-238). Change the navigation link from:

```tsx
onClick={() => navigate(`/records/${record.record_id}`)}
```

to:

```tsx
onClick={() => navigate(`/records/${record.record_id}?followup_id=${record.id}`)}
```

- [ ] **Step 2: Also update mobile card link**

In `renderMobileCard`, find the similar link (around line 332) and update:

```tsx
onClick={() => navigate(`/records/${item.record_id}`)}
```

to:

```tsx
onClick={() => navigate(`/records/${item.record_id}?followup_id=${item.id}`)}
```

- [ ] **Step 3: Verify build**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/followup/FollowUpList.tsx
git commit -m "feat: add followup_id to record link for source highlight"
```

---

### Task 8: 全量测试 + 回归

- [ ] **Step 1: Run backend tests**

```bash
cd server && go test ./... -v
```
Expected: ALL PASS

- [ ] **Step 2: Run frontend tests**

```bash
cd web && npx vitest run
```
Expected: ALL PASS

- [ ] **Step 3: Build check**

```bash
cd server && go build ./... && cd ../web && npm run build
```
Expected: No errors

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "test: fix regression tests for follow-up enhancement"
```
