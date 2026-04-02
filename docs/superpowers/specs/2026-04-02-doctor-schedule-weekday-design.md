# 医生出诊星期配置 — 设计文档

**日期：** 2026-04-02  
**状态：** 待实施  
**范围：** 为每位医生配置可出诊的星期（如「周一、三、五」），并在患者预约弹窗中过滤可选日期。

---

## 1. 背景与目标

现有预约系统允许患者选择明天起至 +15 天内的任意日期预约。  
**新需求：** 管理员可为每位医生指定出诊星期（0-6，0=周日），患者在预约时日期选择器自动屏蔽非出诊日。

**规则（AND 交集）：**  
`可选日期 = 在日期范围内（+1 ~ +advanceDays 天） AND 是该医生的出诊星期`

- 若医生未配置出诊星期，等价于「所有星期均可」，现有逻辑不变。
- 只配置星期、不配置范围：使用全局默认日期范围（`appointment_advance_days`）。
- 两者都配置：取交集。

---

## 2. 数据模型

### 2.1 新增表：`doctor_schedule_configs`

```sql
CREATE TABLE doctor_schedule_configs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  doctor_id   BIGINT UNSIGNED NOT NULL,        -- 对应 queue_doctors.user_id
  weekdays    TINYINT UNSIGNED NOT NULL DEFAULT 0,  -- bitmask: bit0=周日,bit1=周一,...,bit6=周六
  range_start INT UNSIGNED NOT NULL DEFAULT 1, -- 起始偏移天数（>=1，相对今天）
  range_end   INT UNSIGNED NOT NULL DEFAULT 15,-- 结束偏移天数
  UNIQUE KEY uk_doctor_schedule (tenant_id, doctor_id)
);
```

**weekdays bitmask 编码：**
| bit | 含义 |
|-----|------|
| 0 (LSB) | 周日 (0) |
| 1 | 周一 (1) |
| 2 | 周二 (2) |
| 3 | 周三 (3) |
| 4 | 周四 (4) |
| 5 | 周五 (5) |
| 6 | 周六 (6) |

`weekdays = 0` 代表未配置（不限制星期）。

**range_start / range_end** 存储相对今天的天数偏移（如 1 = 明天，15 = 今天 +15 天）。  
默认值 `range_start=1, range_end=15` 与现有逻辑一致，`weekdays=0` 时行为完全不变。

### 2.2 Go Model

```go
// server/model/appointment.go 新增
type DoctorScheduleConfig struct {
    ID         uint   `gorm:"primaryKey;autoIncrement" json:"id"`
    TenantID   uint   `gorm:"column:tenant_id;not null" json:"tenant_id"`
    DoctorID   uint   `gorm:"column:doctor_id;not null" json:"doctor_id"`
    Weekdays   uint8  `gorm:"column:weekdays;not null;default:0" json:"weekdays"`
    RangeStart int    `gorm:"column:range_start;not null;default:1" json:"range_start"`
    RangeEnd   int    `gorm:"column:range_end;not null;default:15" json:"range_end"`
}
func (DoctorScheduleConfig) TableName() string { return "doctor_schedule_configs" }
```

---

## 3. 后端接口

### 3.1 GET `/api/v1/queue-doctors/:id/schedule`

返回医生的出诊配置，若不存在返回默认值（weekdays=0, range_start=1, range_end=15）。

**Response:**
```json
{
  "code": 0,
  "data": {
    "doctor_id": 5,
    "weekdays": 42,
    "range_start": 1,
    "range_end": 15
  }
}
```

### 3.2 PUT `/api/v1/queue-doctors/:id/schedule`

创建或更新（upsert）医生的出诊配置。

**Request:**
```json
{
  "weekdays": 42,
  "range_start": 1,
  "range_end": 20
}
```

**Validation:**
- `range_start >= 1`（不允许当天预约）
- `range_end >= range_start`
- `range_end <= 180`（最多未来半年）
- `weekdays` 在 0~127 范围内（7 bits）

**Permission:** `appointment:update`

### 3.3 GET `/api/v1/appointments/slots` (现有接口) — 无需修改

时间段查询不涉及星期过滤，星期过滤仅在前端日期选择器处理。

---

## 4. Service 层

新增 `DoctorScheduleService`，文件 `server/service/doctor_schedule.go`：

```go
type DoctorScheduleService struct { DB *gorm.DB }

// Get 返回医生配置，不存在时返回默认值（不写库）
func (s *DoctorScheduleService) Get(tenantID, doctorID uint) (*model.DoctorScheduleConfig, error)

// Upsert 创建或更新
func (s *DoctorScheduleService) Upsert(tenantID, doctorID uint, in UpsertScheduleInput) (*model.DoctorScheduleConfig, error)
```

`UpsertScheduleInput`:
```go
type UpsertScheduleInput struct {
    Weekdays   uint8
    RangeStart int
    RangeEnd   int
}
```

---

## 5. 前端修改

### 5.1 API 类型（`web/src/api/queue-doctor.ts`）

新增：
```ts
export interface DoctorScheduleConfig {
  doctor_id: number;
  weekdays: number;    // bitmask, 0=未配置
  range_start: number;
  range_end: number;
}
export function getDoctorSchedule(doctorId: number): Promise<unknown>
export function setDoctorSchedule(doctorId: number, data: Omit<DoctorScheduleConfig,'doctor_id'>): Promise<unknown>
```

### 5.2 设置页面：`AppointmentSlots.tsx`

在「医生个人时间段配置」Card 下方，新增「**出诊日期规则**」Section：

```
[ 出诊星期 ]
☑ 周一  ☑ 周二  ☑ 周三  ☑ 周四  ☑ 周五  ☐ 周六  ☐ 周日
（全不勾 = 不限制，所有日期均可）

[ 可预约日期范围 ]
从今天起 [1] 天后  到  [15] 天内
                              [ 保存 ]
```

- 切换医生时异步加载该医生配置并填充表单
- 「保存」调用 PUT 接口
- 星期全不选 = weekdays=0（不限制）
- 默认值回显 range_start=1, range_end=15

**Checkbox ↔ bitmask 互转：**
```ts
// bit i = 1 << weekdayIndex (0=Sun, 1=Mon, ..., 6=Sat)
const weekdayToBit = (d: number) => 1 << d;
const fromBitmask = (mask: number) => [0,1,2,3,4,5,6].filter(d => (mask >> d) & 1);
const toBitmask = (days: number[]) => days.reduce((acc, d) => acc | (1 << d), 0);
```

### 5.3 预约弹窗：`AppointmentModal.tsx`

预约弹窗需获取所选医生的出诊配置，并据此设置 `disabledDate`：

**加载时机：** 当 `doctorId` 变化时，调用 `getDoctorSchedule(doctorId)` 获取配置。

**disabledDate 逻辑：**
```ts
const today = dayjs();
disabledDate = (d: Dayjs) => {
  // Range check
  const startDay = today.add(rangeStart, 'day');
  const endDay   = today.add(rangeEnd, 'day');
  if (!d.isAfter(today, 'day') || d.isAfter(endDay, 'day')) return true;
  // Weekday check (weekdays=0 means no restriction)
  if (weekdays !== 0) {
    const dow = d.day(); // 0=Sun, 1=Mon, ...6=Sat
    if (!((weekdays >> dow) & 1)) return true;
  }
  return false;
};
```

Loading state：加载配置时先用默认值（range 1~15，无星期限制），加载完成后更新。

---

## 6. 数据库迁移

GORM `AutoMigrate` 已在 `main.go` 中自动运行，只需在 `AutoMigrate` 调用中添加 `&model.DoctorScheduleConfig{}`。

---

## 7. 测试计划

### 7.1 后端单元测试（`server/service/doctor_schedule_test.go`）

| 场景 | 断言 |
|------|------|
| Get 不存在时返回默认值 | weekdays=0, range=1~15 |
| Upsert 新建 | 成功写库，返回正确值 |
| Upsert 更新 | 覆盖旧值，不新增行 |
| weekdays=0 含义 | 不限制，不过滤任何星期 |
| range_start < 1 | 返回 ErrInvalidRange |
| range_end < range_start | 返回 ErrInvalidRange |
| 跨租户隔离 | 租户B查询不到租户A的配置 |

### 7.2 前端集成验证

| 场景 | 预期 |
|------|------|
| 医生未配置星期 | 日期选择器行为与之前一致 |
| 医生配置周一三五，范围1~10天 | 只有未来10天内的周一三五可选 |
| 切换医生 | 日期配置即时更新 |
| 医生配置全部7天 | 等效无星期限制，与weekdays=0一致 |

---

## 8. 不在范围内

- 按具体日期的「例外排班」（如特定节假日取消出诊）— 单独需求
- 排班日历视图 — 单独需求
- 患者端（公众号/小程序）— 当前系统只有诊所内网端
