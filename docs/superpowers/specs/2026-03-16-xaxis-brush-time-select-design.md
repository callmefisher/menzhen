# 设计文档：统计概览 X 轴拖选时间范围

## 概述

在统计概览页面的收入趋势主图表上，增加基于 ECharts dataZoom 的 X 轴拖选/缩放交互，让桌面端用户可以通过鼠标直接在图表横坐标上选择任意时间区间。选区确定后，所有图表和摘要卡片联动刷新。

## 交互设计

### 核心交互（仅桌面端）

| 操作 | 行为 |
|------|------|
| 鼠标拖选 | 在收入趋势图 X 轴区域按住拖动，蓝色半透覆盖选区，松开后触发数据刷新 |
| dataZoom 滑块 | 图表下方显示缩略滑块，可拖拽手柄调整时间范围 |
| 双击重置 | 监听 ECharts `dblclick` 事件，调用 `dispatchAction({ type: 'dataZoom', start: 0, end: 100 })` 重置为全量范围，同时将 `quickRange` 恢复为上一次的快捷值（通过 `useRef` 缓存） |
| 悬停游标 | 复用 ECharts 自带 tooltip，鼠标移动时显示当日数据 |

### 移动端

不显示 dataZoom 组件，保持现有交互方式不变。

## 技术方案

### 核心组件：ECharts dataZoom

使用 ECharts 内置 `dataZoom` 组件（`slider` 类型），放在 X 轴下方：

- **slider dataZoom**：显示数据缩略图，用户可拖拽两端手柄或中间区域调整可见范围
- **inside dataZoom**：支持鼠标滚轮缩放（需按住 Shift 键触发，`zoomOnMouseWheel: 'shift'`，避免干扰页面滚动）

选区变化后通过 `onEvents.datazoom` 回调通知父组件。

### 聚合模式与 dataZoom 的关系

| quickRange | 聚合方式 | dataZoom 行为 |
|------------|----------|---------------|
| today / week / month / custom | 不聚合（按天） | 启用，索引与 `rawDates` 一一对应 |
| quarter / year | 按周/月聚合 | **禁用**，X 轴为聚合 bucket，索引映射无意义 |

当 `quickRange` 为 `quarter` 或 `year` 时，`dataZoom` 配置为空数组 `[]`，不渲染滑块。此设计避免了聚合后索引与原始日期不一致的问题。

### 数据流

```
用户拖选/缩放 dataZoom
  ↓
ECharts datazoom 事件触发
  ↓
通过 echartsRef.getEchartsInstance().getOption().dataZoom[0]
读取 startValue / endValue（实际数据索引，非百分比）
  ↓
用 rawDates[startValue] 和 rawDates[endValue] 获取 YYYY-MM-DD 日期
  ↓
300ms 防抖后调用 onBrushSelect(startDate, endDate) 回调父组件
  ↓
StatsDashboard: setQuickRange('custom') + setDateRange([start, end])
  ↓
触发 useEffect → getDashboard(start, end) API 请求
  ↓
API 返回新数据 → quickRange='custom' → aggregateForCharts 不聚合
  ↓
所有子组件用新数据重新渲染（dataZoom 随新 option 重置为 start:0, end:100）
  ↓
RangePicker 显示选中的自定义日期范围
```

### 防抖策略

dataZoom 拖拽过程中会连续触发事件。使用手写 `useRef` + `setTimeout` 实现 300ms 防抖（零新增依赖），仅在用户停止操作后才发起 API 请求。防抖期间不触发全局 `loading` Spin，避免打断拖拽操作。

```typescript
// 手写防抖，不引入外部库
const timerRef = useRef<ReturnType<typeof setTimeout>>();
const debouncedBrushSelect = useCallback((start: string, end: string) => {
  clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => onBrushSelect?.(start, end), 300);
}, [onBrushSelect]);
```

### 双击重置实现

```typescript
// 在 onEvents 中注册 dblclick 事件
const onEvents = {
  datazoom: handleDataZoom,
  dblclick: () => {
    // 通过 ref 获取 ECharts 实例，重置 dataZoom 到全量
    echartsRef.current?.getEchartsInstance().dispatchAction({
      type: 'dataZoom', start: 0, end: 100,
    });
    // 通知父组件重置（可选：恢复到上次 quickRange）
    onReset?.();
  },
};
```

## 改动范围

### RevenueTrendChart.tsx

**新增 Props：**

```typescript
interface Props {
  data: DailyTrendItem[];
  rawDates?: string[];          // 原始 daily_trend 的 YYYY-MM-DD 日期数组，用于索引映射
  onBrushSelect?: (startDate: string, endDate: string) => void;
  onReset?: () => void;         // 双击重置回调
  isMobile?: boolean;
  enableDataZoom?: boolean;     // 由父组件根据 quickRange 计算，quarter/year 时为 false
}
```

**ECharts 配置新增：**

```typescript
const showDataZoom = !isMobile && enableDataZoom !== false;

// dataZoom 配置
dataZoom: showDataZoom ? [
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
    zoomOnMouseWheel: 'shift',   // 按住 Shift 才缩放，避免干扰页面滚动
  },
] : [],

// grid.bottom 桌面端调大为 56px，为 dataZoom 滑块留空间
grid: { left: 60, right: 60, bottom: showDataZoom ? 56 : 30, top: 40 },
```

**事件处理（通过 echartsRef 获取实例索引）：**

```typescript
const echartsRef = useRef<ReactECharts>(null);

const onEvents = useMemo(() => {
  if (!onBrushSelect || !rawDates?.length) return {};

  const timerRef = { current: undefined as ReturnType<typeof setTimeout> | undefined };

  const handleDataZoom = () => {
    const instance = echartsRef.current?.getEchartsInstance();
    if (!instance) return;
    const opt = instance.getOption() as any;
    const dz = opt.dataZoom?.[0];
    if (!dz) return;
    const startIdx = Math.round(dz.startValue);
    const endIdx = Math.round(dz.endValue);
    // 最小选择 1 天：startIdx !== endIdx
    if (startIdx === endIdx) return;
    const startDate = rawDates[startIdx];
    const endDate = rawDates[endIdx];
    if (!startDate || !endDate) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onBrushSelect(startDate, endDate), 300);
  };

  return { datazoom: handleDataZoom };
}, [onBrushSelect, rawDates]);
```

### StatsDashboard.tsx

**变更：**

1. 计算 `rawDates`：`data?.daily_trend.map(d => d.date) ?? []`
2. 计算 `enableDataZoom`：`quickRange !== 'quarter' && quickRange !== 'year'`
3. 新增 `handleBrushSelect` 回调：

```typescript
const handleBrushSelect = useCallback((startDate: string, endDate: string) => {
  setQuickRange('custom');
  setDateRange([dayjs(startDate), dayjs(endDate)]);
}, []);
```

4. 新增 `handleBrushReset` 回调（双击重置时恢复本月）：

```typescript
const handleBrushReset = useCallback(() => {
  setQuickRange('month');
  setDateRange(getDateRange('month'));
}, []);
```

5. 传入 `isMobile`、`enableDataZoom`、`rawDates`、`onBrushSelect`、`onReset` props

### StatsDashboard.test.tsx

新增测试用例：
- 桌面端渲染时 RevenueTrendChart 接收 `onBrushSelect` 和 `enableDataZoom` props
- `quarter`/`year` 模式下 `enableDataZoom` 为 false

### RevenueTrendChart.test.tsx（新增文件）

独立单元测试：
- 传入 `enableDataZoom=true` 时 option 包含 dataZoom 配置
- 传入 `enableDataZoom=false` 时 option 不含 dataZoom
- 传入 `isMobile=true` 时 option 不含 dataZoom
- `onBrushSelect` 回调参数验证（直接调用 prop 函数，不模拟 ECharts 内部事件）
- 空 `rawDates` 时 onEvents 为空对象

## 约束

- **仅桌面端**：`isMobile` 为 true 时不渲染 dataZoom
- **聚合模式禁用**：`quarter`/`year` 模式下不渲染 dataZoom，避免索引映射问题
- **最小选择 1 天**：`startIdx === endIdx` 时忽略回调
- **空数据保护**：`rawDates` 为空或长度 < 2 时不渲染 dataZoom
- **不改变后端**：复用现有 `GET /statistics/dashboard` API
- **快捷按钮联动**：拖选后 Radio.Group 自动切到 `custom` 状态
- **零新增依赖**：防抖用 `useRef` + `setTimeout` 手写，完全基于已有的 echarts-for-react
- **滚轮不冲突**：`inside` dataZoom 设置 `zoomOnMouseWheel: 'shift'`，需按住 Shift 才触发缩放

## 测试计划

- [ ] 桌面端 + 非聚合模式（today/week/month/custom）：主图表显示 dataZoom 滑块
- [ ] 移动端不显示 dataZoom
- [ ] quarter/year 模式不显示 dataZoom
- [ ] 空数据或单条数据时不显示 dataZoom
- [ ] 拖选后快捷按钮变为自定义状态
- [ ] 拖选后 RangePicker 显示对应日期
- [ ] 拖选触发 API 请求，所有图表和卡片数据更新
- [ ] 双击重置恢复默认范围（本月）
- [ ] 防抖：快速连续操作只触发一次请求
- [ ] 选区 startIdx === endIdx 时不触发
- [ ] RevenueTrendChart 组件 Props 正确传递和处理
