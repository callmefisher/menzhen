# 预约热力矩阵总览 设计文档

## 背景与问题

当前预约管理页只支持单日查看，需要逐天翻页才能了解本周各医生的预约分布。医生/前台无法快速判断哪天哪位医生最忙、本周总量如何。

## 设计方案

在预约管理页的筛选栏**上方**嵌入一个「医生 × 日期」热力矩阵，用色深表示预约密度：

```
医生  | 周一 | 周二 | 今天 | 周四 | 周五 | 周六 | 周日 | 合计
王医生|  3   |  8   |  12▣ |  5   |  0   |  0   |  0   |  28
赵医生|  2   |  6   |   9  |  2   |  2   |  0   |  0   |  24
──────────────────────────────────────────────────────────────
每日  | 10   | 17   |  25  | 15   |  2   |  0   |  0   |  74
```

- **点击格子** → 切换日期 + 自动按该医生过滤明细表
- **首列固定（sticky）** → 移动端横滑时医生名始终可见
- **横向滚动** → 窄屏 / 手机端自然适配
- **触控格子** ≥ 44px 高（iOS HIG 标准）

## API 设计

### `GET /appointments/matrix?start=YYYY-MM-DD`

- `start`：周起始日（默认本周一）
- 权限：`appointment:read`（复用现有权限码，无需新增）

**响应**：
```json
{
  "code": 0,
  "data": {
    "doctors": [
      { "doctor_id": 1, "doctor_name": "王医生" }
    ],
    "days": ["2026-04-07", "2026-04-08", "..."],
    "counts": {
      "1": { "2026-04-07": 3, "2026-04-08": 8 }
    },
    "row_totals": { "1": 28 },
    "col_totals": { "2026-04-07": 10 },
    "grand_total": 74
  }
}
```

统计范围：仅 `pending` + `queued` 状态（不含 cancelled / no_show）。

## 前端组件

### `AppointmentMatrix`（新组件）

```
Props:
  selectedDate: Dayjs          — 当前选中日期（用于高亮今日列）
  onDateChange(date, doctorId?) — 点击格子时回调（切换日期+可选医生过滤）
```

- 内部维护 `weekStart` 状态（从 `selectedDate` 派生本周一）
- 自动刷新：`weekStart` 变化时重新拉取 matrix 数据
- 色阶：0灰 / 1-3浅蓝 / 4-6中蓝 / 7-9深蓝 / 10+最深蓝

### `AppointmentManage` 修改

- 在筛选栏 toolbar 上方插入 `<AppointmentMatrix>`
- 接收矩阵的 `onDateChange` 回调，同时更新 `selectedDate` 和 `doctorFilter`

## 移动端适配要点

1. `overflow-x: auto` + `-webkit-overflow-scrolling: touch`
2. 首列 `position: sticky; left: 0`，背景白色（防穿透）
3. 格子 `min-height: 44px`，移动端字号适当缩小
4. 导航栏上方显示「← 左右滑动查看全周」提示（仅在 `window.innerWidth < 640` 时）

## 不在本次范围内

- 超出一周的时间范围切换（可后续迭代）
- 矩阵内显示预约患者名单（点击后明细表已满足）
- 导出/打印功能
