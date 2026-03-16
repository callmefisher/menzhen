# 设计文档：统计概览 X 轴拖选时间范围

## 概述

在统计概览页面的收入趋势主图表上，增加基于 ECharts dataZoom 的 X 轴拖选/缩放交互，让桌面端用户可以通过鼠标直接在图表横坐标上选择任意时间区间。选区确定后，所有图表和摘要卡片联动刷新。

## 交互设计

### 核心交互（仅桌面端）

| 操作 | 行为 |
|------|------|
| 鼠标拖选 | 在收入趋势图 X 轴区域按住拖动，蓝色半透覆盖选区，松开后触发数据刷新 |
| dataZoom 滑块 | 图表下方显示缩略滑块，可拖拽手柄调整时间范围 |
| 双击重置 | 恢复到当前快捷按钮对应的默认范围 |
| 悬停游标 | 复用 ECharts 自带 tooltip，鼠标移动时显示当日数据 |

### 移动端

不显示 dataZoom 组件，保持现有交互方式不变。

## 技术方案

### 核心组件：ECharts dataZoom

使用 ECharts 内置 `dataZoom` 组件（`slider` 类型），放在 X 轴下方：

- **slider dataZoom**：显示数据缩略图，用户可拖拽两端手柄或中间区域调整可见范围
- **inside dataZoom**：支持鼠标滚轮缩放和拖拽平移（桌面端）

选区变化后通过 `onEvents.datazoom` 回调通知父组件。

### 数据流

```
用户拖选/缩放 dataZoom
  ↓
ECharts datazoom 事件回调（含 startValue / endValue 索引）
  ↓
通过原始 daily_trend 数据映射索引 → 日期字符串
  ↓
调用 onBrushSelect(startDate, endDate) 回调父组件
  ↓
StatsDashboard: setQuickRange('custom') + setDateRange([start, end])
  ↓
触发 useEffect → getDashboard(start, end) API 请求
  ↓
所有子组件用新数据重新渲染
  ↓
RangePicker 显示选中的自定义日期范围
```

### 防抖策略

dataZoom 拖拽过程中会连续触发事件。使用 300ms 防抖，仅在用户停止操作后才发起 API 请求。

## 改动范围

### RevenueTrendChart.tsx

**新增 Props：**

```typescript
interface Props {
  data: DailyTrendItem[];
  rawDates?: string[];          // 原始 daily_trend 的 YYYY-MM-DD 日期数组，用于索引映射
  onBrushSelect?: (startDate: string, endDate: string) => void;
  isMobile?: boolean;
}
```

**ECharts 配置新增：**

```typescript
// dataZoom 配置（仅桌面端）
dataZoom: isMobile ? [] : [
  {
    type: 'slider',
    xAxisIndex: 0,
    start: 0,
    end: 100,
    height: 24,
    bottom: 0,
    borderColor: 'transparent',
    backgroundColor: 'rgba(24,144,255,0.05)',
    fillerColor: 'rgba(24,144,255,0.15)',
    handleStyle: { color: '#1890ff' },
    textStyle: { color: '#999' },
  },
  {
    type: 'inside',
    xAxisIndex: 0,
  },
],
```

**事件处理：**

```typescript
const onEvents = useMemo(() => {
  if (!onBrushSelect || !rawDates?.length) return {};
  const handleDataZoom = debounce((params: any) => {
    // 从 ECharts 实例获取当前可见范围的起止索引
    // 映射到 rawDates 获取日期字符串
    // 调用 onBrushSelect(startDate, endDate)
  }, 300);
  return { datazoom: handleDataZoom };
}, [onBrushSelect, rawDates]);
```

### StatsDashboard.tsx

**变更：**

1. 将原始 `daily_trend` 日期数组传给 RevenueTrendChart 的 `rawDates` prop
2. 新增 `handleBrushSelect` 回调：

```typescript
const handleBrushSelect = useCallback((startDate: string, endDate: string) => {
  setQuickRange('custom');
  setDateRange([dayjs(startDate), dayjs(endDate)]);
}, []);
```

3. 传入 `isMobile` prop 控制 dataZoom 显示
4. grid.bottom 在桌面端调大，为 dataZoom 滑块留空间

### StatsDashboard.test.tsx

新增测试用例：
- 桌面端渲染时 RevenueTrendChart 接收 onBrushSelect prop
- onBrushSelect 被调用后，quickRange 变为 custom，触发新的 API 请求

## 约束

- **仅桌面端**：`isMobile` 为 true 时不渲染 dataZoom
- **最小选择 1 天**：选区覆盖不足 1 天时忽略回调
- **不改变后端**：复用现有 `GET /statistics/dashboard` API
- **快捷按钮联动**：拖选后 Radio.Group 自动切到 `custom` 状态
- **零新增依赖**：完全基于已有的 echarts-for-react

## 测试计划

- [ ] 桌面端主图表显示 dataZoom 滑块
- [ ] 移动端不显示 dataZoom
- [ ] 拖选后快捷按钮变为自定义状态
- [ ] 拖选后 RangePicker 显示对应日期
- [ ] 拖选触发 API 请求，所有图表和卡片数据更新
- [ ] 双击重置恢复默认范围
- [ ] 防抖：快速连续拖动只触发一次请求
- [ ] 选区不足 1 天时不触发
