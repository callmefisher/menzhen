# 预约热力矩阵总览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在预约管理页嵌入「医生 × 日期」热力矩阵，支持行列汇总、点击跳转、首列固定、移动端横向滚动。

**Architecture:** 后端新增 `GET /appointments/matrix` 接口，一次 SQL GROUP BY 聚合本周7天所有医生的预约数；前端新建 `AppointmentMatrix` 组件，嵌入现有 `AppointmentManage` 页面筛选栏上方。

**Tech Stack:** Go/Gin/GORM（后端）、React/TypeScript/Ant Design（前端）、CSS sticky + overflow-x scroll（移动适配）

---

## 文件清单

| 操作 | 路径 |
|------|------|
| 修改 | `server/service/appointment.go` — 新增 `WeeklyMatrix` 方法 |
| 修改 | `server/handler/appointment.go` — 新增 `Matrix` handler |
| 修改 | `server/router/router.go` — 注册 `GET /appointments/matrix` |
| 修改 | `server/service/appointment_test.go` — 新增矩阵测试 |
| 修改 | `web/src/api/appointment.ts` — 新增 `getAppointmentMatrix` |
| 创建 | `web/src/components/AppointmentMatrix.tsx` — 热力矩阵组件 |
| 修改 | `web/src/pages/appointments/AppointmentManage.tsx` — 嵌入矩阵 |

---

## Task 1: 后端 Service — `WeeklyMatrix` 方法

**Files:**
- Modify: `server/service/appointment.go`
- Test: `server/service/appointment_test.go`

### 1.1 在 `appointment_test.go` 末尾写失败测试

```go
func TestWeeklyMatrix(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewAppointmentService(db)
	tenantID := uint(1)

	// Create 2 doctors, 3 appointments spread across 2 days
	_ = db.Create(&model.Appointment{
		TenantID: tenantID, DoctorID: 10, DoctorName: "王医生",
		AppointDate: "2026-04-07", SlotStart: "09:00", SlotEnd: "09:30",
		PatientName: "张三", Status: model.AppointmentStatusPending,
	})
	_ = db.Create(&model.Appointment{
		TenantID: tenantID, DoctorID: 10, DoctorName: "王医生",
		AppointDate: "2026-04-07", SlotStart: "09:30", SlotEnd: "10:00",
		PatientName: "李四", Status: model.AppointmentStatusQueued,
	})
	_ = db.Create(&model.Appointment{
		TenantID: tenantID, DoctorID: 20, DoctorName: "赵医生",
		AppointDate: "2026-04-08", SlotStart: "10:00", SlotEnd: "10:30",
		PatientName: "王五", Status: model.AppointmentStatusPending,
	})
	// cancelled — must NOT be counted
	_ = db.Create(&model.Appointment{
		TenantID: tenantID, DoctorID: 10, DoctorName: "王医生",
		AppointDate: "2026-04-07", SlotStart: "11:00", SlotEnd: "11:30",
		PatientName: "取消人", Status: model.AppointmentStatusCancelled,
	})

	result, err := svc.WeeklyMatrix(tenantID, "2026-04-07")
	assert.NoError(t, err)

	// Doctors present in result
	assert.Len(t, result.Doctors, 2)

	// Days: 7 days starting 2026-04-07
	assert.Len(t, result.Days, 7)
	assert.Equal(t, "2026-04-07", result.Days[0])
	assert.Equal(t, "2026-04-13", result.Days[6])

	// Counts: 王医生 on 4/7 = 2
	assert.Equal(t, 2, result.Counts[10]["2026-04-07"])
	// 赵医生 on 4/8 = 1
	assert.Equal(t, 1, result.Counts[20]["2026-04-08"])
	// 王医生 on 4/8 = 0 (key absent or zero)
	assert.Equal(t, 0, result.Counts[10]["2026-04-08"])

	// Row totals
	assert.Equal(t, 2, result.RowTotals[10]) // 王医生
	assert.Equal(t, 1, result.RowTotals[20]) // 赵医生

	// Col totals
	assert.Equal(t, 2, result.ColTotals["2026-04-07"])
	assert.Equal(t, 1, result.ColTotals["2026-04-08"])

	// Grand total
	assert.Equal(t, 3, result.GrandTotal)
}

func TestWeeklyMatrix_OtherTenantIsolation(t *testing.T) {
	db := testutil.SetupTestDB(t)
	svc := NewAppointmentService(db)

	// Tenant 2 appointment — must NOT appear in tenant 1's matrix
	_ = db.Create(&model.Appointment{
		TenantID: 2, DoctorID: 99, DoctorName: "他院医生",
		AppointDate: "2026-04-07", SlotStart: "09:00", SlotEnd: "09:30",
		PatientName: "隔离患者", Status: model.AppointmentStatusPending,
	})

	result, err := svc.WeeklyMatrix(1, "2026-04-07")
	assert.NoError(t, err)
	assert.Len(t, result.Doctors, 0)
	assert.Equal(t, 0, result.GrandTotal)
}
```

- [ ] **Step 1.1:** 将上述测试追加到 `server/service/appointment_test.go`

- [ ] **Step 1.2: 确认测试失败**

```bash
cd server && go test ./service/ -run TestWeeklyMatrix -v
```

预期：编译错误 `svc.WeeklyMatrix undefined`

### 1.2 实现 `WeeklyMatrix`

- [ ] **Step 1.3:** 在 `server/service/appointment.go` 末尾追加以下代码：

```go
// MatrixRow is a (doctor_id, doctor_name, appoint_date) count row from the DB.
type MatrixRow struct {
	DoctorID   uint
	DoctorName string
	AppointDate string
	Count      int
}

// MatrixDoctor is a distinct doctor entry for the matrix header.
type MatrixDoctor struct {
	DoctorID   uint   `json:"doctor_id"`
	DoctorName string `json:"doctor_name"`
}

// WeeklyMatrixResult holds all data needed to render the heat matrix.
type WeeklyMatrixResult struct {
	Doctors    []MatrixDoctor          `json:"doctors"`
	Days       []string                `json:"days"`
	Counts     map[uint]map[string]int `json:"counts"`
	RowTotals  map[uint]int            `json:"row_totals"`
	ColTotals  map[string]int          `json:"col_totals"`
	GrandTotal int                     `json:"grand_total"`
}

// WeeklyMatrix returns appointment counts grouped by doctor and date for a 7-day window
// starting from startDate (inclusive). Only pending and queued appointments are counted.
// startDate must be "YYYY-MM-DD".
func (s *AppointmentService) WeeklyMatrix(tenantID uint, startDate string) (WeeklyMatrixResult, error) {
	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return WeeklyMatrixResult{}, fmt.Errorf("WeeklyMatrix: parse startDate: %w", err)
	}
	end := start.AddDate(0, 0, 6)
	endStr := end.Format("2006-01-02")

	// Build the 7-day slice upfront so the result always has all days.
	days := make([]string, 7)
	for i := 0; i < 7; i++ {
		days[i] = start.AddDate(0, 0, i).Format("2006-01-02")
	}

	var rows []MatrixRow
	err = s.DB.Model(&model.Appointment{}).
		Select("doctor_id, doctor_name, appoint_date, COUNT(*) as count").
		Where("tenant_id = ? AND appoint_date >= ? AND appoint_date <= ? AND status IN (?,?)",
			tenantID, startDate, endStr,
			model.AppointmentStatusPending, model.AppointmentStatusQueued).
		Group("doctor_id, doctor_name, appoint_date").
		Order("doctor_name ASC, appoint_date ASC").
		Scan(&rows).Error
	if err != nil {
		return WeeklyMatrixResult{}, fmt.Errorf("WeeklyMatrix: query: %w", err)
	}

	// Build result maps.
	doctorOrder := make([]uint, 0)
	doctorMap := make(map[uint]string)
	counts := make(map[uint]map[string]int)
	rowTotals := make(map[uint]int)
	colTotals := make(map[string]int)
	grandTotal := 0

	for _, r := range rows {
		if _, seen := doctorMap[r.DoctorID]; !seen {
			doctorOrder = append(doctorOrder, r.DoctorID)
			doctorMap[r.DoctorID] = r.DoctorName
			counts[r.DoctorID] = make(map[string]int)
		}
		counts[r.DoctorID][r.AppointDate] = r.Count
		rowTotals[r.DoctorID] += r.Count
		colTotals[r.AppointDate] += r.Count
		grandTotal += r.Count
	}

	doctors := make([]MatrixDoctor, 0, len(doctorOrder))
	for _, id := range doctorOrder {
		doctors = append(doctors, MatrixDoctor{DoctorID: id, DoctorName: doctorMap[id]})
	}

	return WeeklyMatrixResult{
		Doctors:    doctors,
		Days:       days,
		Counts:     counts,
		RowTotals:  rowTotals,
		ColTotals:  colTotals,
		GrandTotal: grandTotal,
	}, nil
}
```

- [ ] **Step 1.4: 确认测试通过**

```bash
cd server && go test ./service/ -run TestWeeklyMatrix -v
```

预期：`PASS`，包含 `TestWeeklyMatrix` 和 `TestWeeklyMatrix_OtherTenantIsolation`

- [ ] **Step 1.5: Commit**

```bash
cd server && git add service/appointment.go service/appointment_test.go
git commit -m "feat: add WeeklyMatrix service method for appointment heat matrix"
```

---

## Task 2: 后端 Handler + 路由

**Files:**
- Modify: `server/handler/appointment.go`
- Modify: `server/router/router.go`

- [ ] **Step 2.1:** 在 `server/handler/appointment.go` 末尾追加 `Matrix` handler：

```go
// Matrix handles GET /appointments/matrix?start=YYYY-MM-DD
// start defaults to the Monday of the current week if omitted.
// Success 200: { code: 0, data: WeeklyMatrixResult }
func (h *AppointmentHandler) Matrix(c *gin.Context) {
	tenantID := middleware.GetTenantID(c)
	if tenantID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 1, "message": "missing tenant"})
		return
	}

	startStr := c.Query("start")
	if startStr == "" {
		// Default to Monday of current week.
		now := time.Now()
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7 // Sunday → treat as day 7
		}
		monday := now.AddDate(0, 0, -(weekday - 1))
		startStr = monday.Format("2006-01-02")
	} else {
		if _, err := time.Parse("2006-01-02", startStr); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": 1, "message": "start must be YYYY-MM-DD"})
			return
		}
	}

	result, err := h.svc.WeeklyMatrix(uint(tenantID), startStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 1, "message": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result})
}
```

- [ ] **Step 2.2:** 在 `server/router/router.go` 第 346 行（`appt.GET("/slots", ...)` 下方）插入：

```go
appt.GET("/matrix", middleware.RequirePermission(db, "appointment:read"), apptHandler.Matrix)
```

- [ ] **Step 2.3: 编译验证**

```bash
cd server && go build ./...
```

预期：无错误输出

- [ ] **Step 2.4: Commit**

```bash
git add server/handler/appointment.go server/router/router.go
git commit -m "feat: add GET /appointments/matrix endpoint"
```

---

## Task 3: 前端 API 类型 + 函数

**Files:**
- Modify: `web/src/api/appointment.ts`

- [ ] **Step 3.1:** 在 `web/src/api/appointment.ts` 末尾追加：

```typescript
export interface MatrixDoctor {
  doctor_id: number;
  doctor_name: string;
}

export interface WeeklyMatrixResult {
  doctors: MatrixDoctor[];
  days: string[];               // ["2026-04-07", ..., "2026-04-13"]
  counts: Record<number, Record<string, number>>;  // counts[doctorId][date]
  row_totals: Record<number, number>;              // row_totals[doctorId]
  col_totals: Record<string, number>;              // col_totals[date]
  grand_total: number;
}

export const getAppointmentMatrix = (start?: string) =>
  request.get<{ code: number; data: WeeklyMatrixResult }>('/appointments/matrix', {
    params: start ? { start } : undefined,
  });
```

- [ ] **Step 3.2: TypeScript 编译检查**

```bash
cd web && npx tsc --noEmit
```

预期：无错误

- [ ] **Step 3.3: Commit**

```bash
git add web/src/api/appointment.ts
git commit -m "feat: add getAppointmentMatrix API function and types"
```

---

## Task 4: 前端 `AppointmentMatrix` 组件

**Files:**
- Create: `web/src/components/AppointmentMatrix.tsx`

- [ ] **Step 4.1:** 创建文件 `web/src/components/AppointmentMatrix.tsx`：

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Button, Spin, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { getAppointmentMatrix, type WeeklyMatrixResult } from '../api/appointment';

interface Props {
  selectedDate: Dayjs;
  onDateChange: (date: Dayjs, doctorId?: number) => void;
}

// Color thresholds: 0, 1-3, 4-6, 7-9, 10+
const heatColor = (count: number): { bg: string; color: string } => {
  if (count === 0) return { bg: '#f5f5f5', color: '#bbb' };
  if (count <= 3)  return { bg: '#dbeafe', color: '#1d4ed8' };
  if (count <= 6)  return { bg: '#93c5fd', color: '#1e40af' };
  if (count <= 9)  return { bg: '#3b82f6', color: '#fff' };
  return             { bg: '#1d4ed8', color: '#fff' };
};

// Monday of the week containing `date`
const weekMonday = (date: Dayjs): Dayjs => {
  const dow = date.day(); // 0=Sun
  return date.subtract(dow === 0 ? 6 : dow - 1, 'day').startOf('day');
};

// Day-of-week label
const DOW_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function AppointmentMatrix({ selectedDate, onDateChange }: Props) {
  const [weekStart, setWeekStart] = useState<Dayjs>(() => weekMonday(selectedDate));
  const [data, setData] = useState<WeeklyMatrixResult | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMatrix = useCallback(async (start: Dayjs) => {
    setLoading(true);
    try {
      const res = await getAppointmentMatrix(start.format('YYYY-MM-DD'));
      const body = res as unknown as { data?: WeeklyMatrixResult };
      setData(body.data ?? null);
    } catch {
      // non-critical — matrix is a summary overlay, silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatrix(weekStart);
  }, [weekStart, fetchMatrix]);

  // Keep weekStart in sync when selectedDate jumps to a different week
  useEffect(() => {
    const monday = weekMonday(selectedDate);
    if (!monday.isSame(weekStart, 'day')) {
      setWeekStart(monday);
    }
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrevWeek = () => setWeekStart((w) => w.subtract(7, 'day'));
  const handleNextWeek = () => setWeekStart((w) => w.add(7, 'day'));

  const today = dayjs().startOf('day');
  const isThisWeek =
    weekStart.isSame(weekMonday(today), 'day');

  if (!data && !loading) return null;

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #f0f0f0',
      borderRadius: 8,
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      {/* Nav bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid #f5f5f5',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Button size="small" icon={<LeftOutlined />} onClick={handlePrevWeek} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {weekStart.format('M月D日')}–{weekStart.add(6, 'day').format('M月D日')}
          </span>
          <Button size="small" icon={<RightOutlined />} onClick={handleNextWeek} />
          {!isThisWeek && (
            <Button size="small" onClick={() => setWeekStart(weekMonday(dayjs()))}>
              本周
            </Button>
          )}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#999' }}>
          {[
            { bg: '#f5f5f5', label: '0' },
            { bg: '#dbeafe', label: '1-3' },
            { bg: '#93c5fd', label: '4-6' },
            { bg: '#3b82f6', label: '7-9' },
            { bg: '#1d4ed8', label: '10+' },
          ].map(({ bg, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: bg, display: 'inline-block', border: bg === '#f5f5f5' ? '1px solid #e0e0e0' : undefined }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Scroll hint — only visible on narrow screens via CSS */}
      <div style={{ padding: '2px 12px', fontSize: 10, color: '#bbb' }}
           className="matrix-scroll-hint">
        ← 左右滑动查看全周
      </div>

      {/* Matrix table */}
      <Spin spinning={loading} size="small">
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 480 }}>
            <thead>
              <tr>
                {/* Sticky doctor column header */}
                <th style={{
                  ...stickyStyle,
                  textAlign: 'left', padding: '6px 8px 6px 14px',
                  fontSize: 10, fontWeight: 600, color: '#999',
                  background: '#fafafa', borderBottom: '1px solid #f0f0f0',
                  borderRight: '1px solid #f0f0f0', minWidth: 64,
                }}>
                  医生
                </th>
                {(data?.days ?? []).map((day, i) => {
                  const d = dayjs(day);
                  const isToday = d.isSame(today, 'day');
                  const isSelected = d.isSame(selectedDate, 'day');
                  return (
                    <th key={day} style={{
                      padding: '6px 4px', textAlign: 'center', fontSize: 10,
                      fontWeight: isToday ? 700 : 600,
                      color: isToday ? '#1677ff' : '#666',
                      background: isSelected ? 'rgba(22,119,255,0.06)' : '#fafafa',
                      borderBottom: '1px solid #f0f0f0',
                      whiteSpace: 'nowrap',
                    }}>
                      {DOW_LABELS[i]}<br />
                      <span style={{ fontWeight: isToday ? 700 : 400, fontSize: 9 }}>
                        {d.format('M/D')}
                      </span>
                    </th>
                  );
                })}
                <th style={{
                  padding: '6px 10px', textAlign: 'center', fontSize: 10,
                  fontWeight: 700, color: '#333',
                  background: '#f5f5f5',
                  borderBottom: '1px solid #f0f0f0',
                  borderLeft: '1px solid #e8e8e8',
                  whiteSpace: 'nowrap',
                }}>
                  合计
                </th>
              </tr>
            </thead>

            <tbody>
              {(data?.doctors ?? []).map((doc) => (
                <tr key={doc.doctor_id}>
                  {/* Sticky doctor name */}
                  <td style={{
                    ...stickyStyle,
                    padding: '3px 8px 3px 14px', fontSize: 12, fontWeight: 500,
                    borderRight: '1px solid #f0f0f0',
                    borderBottom: '1px solid #fafafa',
                    whiteSpace: 'nowrap',
                  }}>
                    {doc.doctor_name}
                  </td>
                  {(data?.days ?? []).map((day) => {
                    const count = data?.counts[doc.doctor_id]?.[day] ?? 0;
                    const { bg, color } = heatColor(count);
                    const d = dayjs(day);
                    const isSelected = d.isSame(selectedDate, 'day');
                    return (
                      <td key={day} style={{
                        padding: '3px 3px',
                        background: isSelected ? 'rgba(22,119,255,0.04)' : undefined,
                        borderBottom: '1px solid #fafafa',
                      }}>
                        <Tooltip title={count > 0 ? `${doc.doctor_name} ${d.format('M月D日')} ${count}人` : undefined}>
                          <div
                            onClick={() => onDateChange(d, count > 0 ? doc.doctor_id : undefined)}
                            style={{
                              display: 'flex', flexDirection: 'column',
                              alignItems: 'center', justifyContent: 'center',
                              borderRadius: 6, cursor: 'pointer',
                              background: bg, color,
                              fontWeight: 700, fontSize: 13,
                              minHeight: 44, minWidth: 34,
                              margin: '1px',
                              transition: 'transform 0.1s, filter 0.1s',
                              outline: isSelected ? '2px solid #1677ff' : undefined,
                              outlineOffset: isSelected ? 1 : undefined,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.08)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = ''; }}
                          >
                            {count === 0 ? '—' : count}
                            {count > 0 && <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.75, marginTop: 1 }}>人</span>}
                          </div>
                        </Tooltip>
                      </td>
                    );
                  })}
                  {/* Row total */}
                  <td style={{
                    padding: '3px 10px', textAlign: 'center',
                    fontWeight: 700, fontSize: 13, color: '#333',
                    background: '#fafafa', borderLeft: '1px solid #e8e8e8',
                    borderBottom: '1px solid #fafafa',
                  }}>
                    {data?.row_totals[doc.doctor_id] ?? 0}
                  </td>
                </tr>
              ))}
              {/* Empty state */}
              {!loading && (data?.doctors ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '16px', color: '#999', fontSize: 12 }}>
                    本周暂无预约
                  </td>
                </tr>
              )}
            </tbody>

            {/* Column totals row */}
            {(data?.doctors ?? []).length > 0 && (
              <tfoot>
                <tr>
                  <td style={{
                    ...stickyStyle,
                    padding: '5px 8px 5px 14px', fontSize: 11,
                    color: '#999', fontWeight: 500,
                    borderRight: '1px solid #f0f0f0',
                    borderTop: '1px solid #e8e8e8',
                    background: '#fafafa',
                  }}>
                    每日合计
                  </td>
                  {(data?.days ?? []).map((day) => {
                    const total = data?.col_totals[day] ?? 0;
                    const d = dayjs(day);
                    const isToday = d.isSame(today, 'day');
                    const isSelected = d.isSame(selectedDate, 'day');
                    return (
                      <td key={day} style={{
                        padding: '5px 3px', textAlign: 'center',
                        fontSize: 11, fontWeight: 700,
                        color: isToday ? '#1677ff' : '#555',
                        background: isSelected ? 'rgba(22,119,255,0.06)' : '#fafafa',
                        borderTop: '1px solid #e8e8e8',
                      }}>
                        {total || '—'}
                      </td>
                    );
                  })}
                  {/* Grand total */}
                  <td style={{
                    padding: '5px 10px', textAlign: 'center',
                    fontSize: 13, fontWeight: 700, color: '#333',
                    background: '#f0f0f0',
                    borderLeft: '1px solid #e8e8e8',
                    borderTop: '1px solid #e8e8e8',
                  }}>
                    {data?.grand_total ?? 0}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Spin>
    </div>
  );
}

// Shared sticky column style
const stickyStyle: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  background: '#fff',
  zIndex: 2,
};
```

- [ ] **Step 4.2: TypeScript 编译检查**

```bash
cd web && npx tsc --noEmit
```

预期：无错误

- [ ] **Step 4.3: Commit**

```bash
git add web/src/components/AppointmentMatrix.tsx
git commit -m "feat: add AppointmentMatrix heat matrix component"
```

---

## Task 5: 集成到 `AppointmentManage`

**Files:**
- Modify: `web/src/pages/appointments/AppointmentManage.tsx`

- [ ] **Step 5.1:** 在文件顶部 import 区末尾追加：

```tsx
import AppointmentMatrix from '../../components/AppointmentMatrix';
```

- [ ] **Step 5.2:** 在组件内新增 `doctorIdFilter` state（在 `doctorFilter` string filter 旁边），用于矩阵点击时按 doctorId 过滤：

在 `const [doctorFilter, setDoctorFilter] = useState('');` **下方**追加：

```tsx
const [selectedDoctorId, setSelectedDoctorId] = useState<number | undefined>(undefined);
```

- [ ] **Step 5.3:** 将 `filteredAppointments` 的 useMemo 更新为同时支持 doctorId 过滤：

将现有：
```tsx
const filteredAppointments = useMemo(() => {
  if (!doctorFilter.trim()) return appointments;
  const lower = doctorFilter.trim().toLowerCase();
  return appointments.filter((a) => a.doctor_name.toLowerCase().includes(lower));
}, [appointments, doctorFilter]);
```

替换为：
```tsx
const filteredAppointments = useMemo(() => {
  let result = appointments;
  if (selectedDoctorId !== undefined) {
    result = result.filter((a) => a.doctor_id === selectedDoctorId);
  } else if (doctorFilter.trim()) {
    const lower = doctorFilter.trim().toLowerCase();
    result = result.filter((a) => a.doctor_name.toLowerCase().includes(lower));
  }
  return result;
}, [appointments, doctorFilter, selectedDoctorId]);
```

- [ ] **Step 5.4:** 添加矩阵的 `onDateChange` 回调。在 `handleCancel` 定义**下方**追加：

```tsx
const handleMatrixDateChange = useCallback((date: Dayjs, doctorId?: number) => {
  setSelectedDate(date);
  setSelectedDoctorId(doctorId);
  if (doctorId === undefined) {
    setDoctorFilter('');
  }
}, []);
```

- [ ] **Step 5.5:** 在 JSX 中，将 `<AppointmentMatrix>` 插入到 `{/* Toolbar */}` div 的**上方**（即 `<div style={{ display: 'flex', alignItems: 'center'...}}` 之前）：

```tsx
{/* Matrix overview */}
<AppointmentMatrix
  selectedDate={selectedDate}
  onDateChange={handleMatrixDateChange}
/>
```

- [ ] **Step 5.6:** 当矩阵选中了某个医生（`selectedDoctorId` 有值）时，在 toolbar 的医生搜索框旁边显示重置按钮。在 `<Input allowClear ...doctorFilter...>` 的 `onChange` 里追加清除 selectedDoctorId：

将现有：
```tsx
onChange={(e) => setDoctorFilter(e.target.value)}
```

替换为：
```tsx
onChange={(e) => { setDoctorFilter(e.target.value); setSelectedDoctorId(undefined); }}
```

- [ ] **Step 5.7: 编译 + 类型检查**

```bash
cd web && npx tsc --noEmit && npm run build 2>&1 | tail -20
```

预期：无错误

- [ ] **Step 5.8: Commit**

```bash
git add web/src/pages/appointments/AppointmentManage.tsx
git commit -m "feat: integrate AppointmentMatrix into AppointmentManage page"
```

---

## Task 6: 移动端 CSS 优化

**Files:**
- Modify: `web/src/pages/appointments/AppointmentManage.tsx` 或全局 CSS（如有）

移动端需隐藏滚动提示（宽屏不显示）、缩减格子字号。用 inline style 实现，无需引入 CSS 文件。

- [ ] **Step 6.1:** 在 `AppointmentMatrix.tsx` 中，为「← 左右滑动」提示 div 加上响应式 style：

将：
```tsx
<div style={{ padding: '2px 12px', fontSize: 10, color: '#bbb' }}
     className="matrix-scroll-hint">
  ← 左右滑动查看全周
</div>
```

替换为（直接用 JS 判断，不依赖 CSS class）：

```tsx
{typeof window !== 'undefined' && window.innerWidth < 768 && (
  <div style={{ padding: '2px 12px 3px', fontSize: 10, color: '#bbb' }}>
    ← 左右滑动查看全周
  </div>
)}
```

- [ ] **Step 6.2:** 在热力格子的 div 中，针对移动端将字号自适应。在 `style` 里将固定 `fontSize: 13` 改为：

```tsx
fontSize: typeof window !== 'undefined' && window.innerWidth < 640 ? 12 : 13,
minHeight: typeof window !== 'undefined' && window.innerWidth < 640 ? 40 : 44,
```

- [ ] **Step 6.3: 编译验证**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 6.4: Commit**

```bash
git add web/src/components/AppointmentMatrix.tsx
git commit -m "feat: responsive scroll hint and cell size for mobile"
```

---

## Task 7: 全量测试 + 部署

- [ ] **Step 7.1: 后端全量测试**

```bash
cd server && go test ./... -v 2>&1 | tail -30
```

预期：所有测试 `PASS`，无 `FAIL`

- [ ] **Step 7.2: 前端全量测试**

```bash
cd web && npm run test -- --run 2>&1 | tail -20
```

预期：所有测试 `PASS`

- [ ] **Step 7.3: 前端构建**

```bash
cd web && npm run build 2>&1 | tail -10
```

预期：`built in Xs`，无错误

- [ ] **Step 7.4: 部署**

```bash
cd /Users/xiayanji/qbox/menzhen && bash deploy.sh
```

- [ ] **Step 7.5: 验证部署**

打开预约管理页，确认：
1. 矩阵在筛选栏上方正常展示
2. 热力色阶正确（0灰、少蓝、多深蓝）
3. 最右列「合计」和最底行「每日合计」数字正确
4. 点击格子 → 切换日期 + 按该医生过滤明细
5. 手机端首列固定、可横滑
6. 切换上/下周正常刷新

- [ ] **Step 7.6: 最终 Commit**

```bash
git add -A
git commit -m "chore: appointment matrix feature complete"
```
