# 中医药模块移动端 UI 优化设计

## 概述

对中医药模块下 7 个页面进行移动端 UI 优化，将表格类页面改为卡片列表展示、开方页面药物改为垂直堆叠布局、五运六气页面添加纵向堆叠适配。**不修改桌面端逻辑**，复用桌面端数据获取、分页等功能。

## 涉及页面

| # | 页面 | 文件 | 改动类型 |
|---|------|------|----------|
| 1 | 中药查询 | `web/src/pages/herbs/HerbSearch.tsx` | 表格 → 卡片列表 |
| 2 | 方剂查询 | `web/src/pages/formulas/FormulaSearch.tsx` | 表格 → 卡片列表 |
| 3 | 脉象 | `web/src/pages/pulses/PulseList.tsx` | 表格 → 卡片列表 |
| 4 | 临床经验集 | `web/src/pages/clinical-experience/ClinicalExperienceList.tsx` | 表格 → 卡片列表 |
| 5 | 五运六气 | `web/src/pages/wuyun/WuyunLiuqi.tsx` | 纵向堆叠适配 |
| 6 | 开方 | `web/src/components/PrescriptionModal.tsx` | 药物表格 → 垂直堆叠 |
| 7 | 经络穴位 | `web/src/pages/meridians/MeridianView.tsx` | 保持现有 Drawer 方案 |

## 设计原则

1. **条件渲染**: `isMobile ? <MobileView /> : <DesktopTable />` — 桌面端代码零改动
2. **复用逻辑**: 分页 state (`page`, `size`, `total`)、数据获取 (`fetchXxx`)、编辑逻辑全部复用
3. **触屏优先**: 点击区域 ≥ 44px，间距适中，单手可操作
4. **信息层级**: 卡片默认显示关键字段，展开查看详情

## 1. 表格类页面 → 卡片列表

### 适用范围

HerbSearch、FormulaSearch、PulseList、ClinicalExperienceList

### 布局结构

```
┌─────────────────────────┐
│ [搜索框 100%宽]          │
│ [分类筛选 100%宽] [+新增] │
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ 名称          [编辑] │ │
│ │ 字段1: 值1           │ │
│ │ 字段2: 值2           │ │
│ │ [展开详情 ▼]         │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ 名称          [编辑] │ │
│ │ ...                  │ │
│ └─────────────────────┘ │
│     共 N 条 · 第 x/y 页  │
│   [上一页] 1 2 3 [下一页] │
└─────────────────────────┘
```

### 各页面卡片字段

**中药查询 (HerbSearch)**
- 标题: `name`
- 摘要字段: `category`, `properties` (性味归经)
- 展开: `alias`, `effects`, `indications`, `origin`, `source` 标签
- 编辑: 展开后显示编辑表单（复用现有 expandedRowRender 逻辑）

**方剂查询 (FormulaSearch)**
- 标题: `name` (可点击编辑)
- 摘要字段: 组成药物数量, `source` 标签
- 展开: `effects`, `indications`, `notes`, 组成列表, 编辑组成按钮
- 编辑组成: 展开后在卡片内编辑（复用现有 inline 编辑逻辑）

**脉象 (PulseList)**
- 标题: `name`
- 摘要字段: `category`, `description` (截断)
- 展开: 完整 `description`, `clinical_meaning`, `common_conditions`
- 编辑: 展开后显示编辑表单

**临床经验集 (ClinicalExperienceList)**
- 标题: `source` (出处)
- 摘要字段: `category`, `herbs` (截断)
- 展开: 完整 `herbs`, `formula`, `experience`
- 编辑: 打开 Modal（复用现有 Modal）

### 卡片组件实现

不新建共享组件（避免过度抽象，各页面卡片字段差异大）。每个页面在 `isMobile` 时条件渲染卡片列表，复用已有 state 和函数。卡片使用纯 `div` + inline style，不使用 Ant Design Card 组件（避免与 `index.css` 中 `.ant-card-body { padding: 12px }` 冲突）。

```tsx
// 模式：在现有 return 中 Table 前加条件
{isMobile ? (
  <div>
    {loading ? (
      <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
    ) : items.length === 0 ? (
      <Empty description="暂无数据" />
    ) : (
      items.map(item => (
        <div key={item.id} style={{ background: '#fafafa', borderRadius: 8, padding: 12, marginBottom: 8 }}>
          {/* 卡片内容 */}
        </div>
      ))
    )}
    <Pagination
      current={page} pageSize={size} total={total}
      onChange={(p, s) => handleTableChange({ current: p, pageSize: s })}
      size="small" simple
      style={{ textAlign: 'center', marginTop: 16 }}
    />
  </div>
) : (
  <Table ... /> // 桌面端不变
)}
```

### 分页

移动端使用 Ant Design `<Pagination>` 独立组件（从 Table 中分离），设置 `size="small" simple` 模式（紧凑显示为 "x/y" 形式），复用 `page/size/total` state 和 `handleTableChange`。

### 空状态和加载

- `loading === true` 时: 显示居中 `<Spin />`
- `items.length === 0` 时: 显示 `<Empty description="暂无数据" />`
- 复用已有 `loading` state，无需额外逻辑

## 2. 开方页面 → 药物垂直堆叠

### 当前问题

`PrescriptionModal` 的药物 Table 有 4 列固定宽度:
- 药名: 弹性 (被压缩至不可用)
- 用量: `width: 140`
- 备注: `width: 150`
- 操作: `width: 60`

Modal 在移动端 `width: 100%` (~375px)，350px 固定列 + 药名列 → 药名被挤压。

### 移动端方案

替换 Table 为垂直堆叠卡片列表:

```
┌─────────────────────────┐
│ 当归                 [×] │
│ ┌──────┐ ┌────────────┐ │
│ │ 10 克 │ │ 先煎       │ │
│ └──────┘ └────────────┘ │
│ ⚠ 库存不足: 需70克       │
├─────────────────────────┤
│ 黄芪                 [×] │
│ ┌──────┐ ┌────────────┐ │
│ │ 15 克 │ │            │ │
│ └──────┘ └────────────┘ │
│ ✓ 库存充足              │
├─────────────────────────┤
│      [+ 添加药物]        │
└─────────────────────────┘
```

### 实现方式

```tsx
// PrescriptionModal.tsx 药物列表区域
{isMobile ? (
  <div>
    {herbRows.map(row => (
      <div key={row.key} style={{ background: '#fafafa', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Input value={row.herb_name} onChange={...} placeholder="药名" style={{ flex: 1, marginRight: 8 }} />
          <Button type="text" icon={<InfoCircleOutlined />} ... />
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeHerbRow(row.key)} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <InputNumber value={...} onChange={...} placeholder="用量" addonAfter="克" style={{ width: 110 }} />
          <Input value={row.notes} onChange={...} placeholder="备注" style={{ flex: 1 }} />
        </div>
        {stockHint && <div style={{ marginTop: 4 }}>{stockHint}</div>}
      </div>
    ))}
    <Button type="dashed" block icon={<PlusOutlined />} onClick={addHerbRow}>添加药物</Button>
  </div>
) : (
  <Table ... /> // 桌面端不变
)}
```

### 库存提示

移动端卡片底部显示库存状态。复用现有 `herbColumns` 中药名列的 `stockHint` 计算逻辑（基于 `inventoryMap`, `watchedTotalDoses`, `dosageNum`），将其提取为独立函数 `renderStockHint(row: HerbRow)` 供桌面端和移动端共用。颜色编码与桌面端一致:
- 红色 `#ff4d4f`: 库存不足
- 绿色 `#52c41a`: 库存充足
- 灰色 `#999`: 未录入

## 3. 五运六气 → 纵向堆叠

### 前置改动

当前 `WuyunLiuqi.tsx` 未导入 `useIsMobile`，需要新增:
```tsx
import useIsMobile from '../../hooks/useIsMobile';
// 组件内:
const isMobile = useIsMobile();
```

### 当前问题

Header 区域 `display: flex, flexWrap: wrap` 但无 `isMobile` 判断:
- 标题 + 年份选择 + 查询 + 取消 + 强制重新查询横向排列
- 状态标签行 Tag + 时间 + 编辑/删除按钮也横排
- 窄屏下换行混乱

### 移动端方案

```tsx
// 移动端: 标题独立一行，年份+按钮分行
{isMobile ? (
  <>
    <Title level={4} style={{ margin: '0 0 8px' }}>五运六气</Title>
    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      <InputNumber min={1} max={9999} value={year} onChange={handleYearChange} style={{ flex: 1 }} disabled={streaming} />
      <Button type="primary" icon={<SearchOutlined />} onClick={() => handleQuery(false)} loading={streaming}>查询</Button>
      {streaming && <Button onClick={handleCancel}>取消</Button>}
    </div>
    {isAdmin && !streaming && (
      <Button icon={<ReloadOutlined />} onClick={() => handleQuery(true)} size="small" block style={{ marginBottom: 12 }}>
        强制重新查询
      </Button>
    )}
  </>
) : (
  // 桌面端保持不变
)}
```

状态标签行在移动端也纵向排列:
```tsx
// 移动端: Tag + 时间独立一行, 按钮独立一行
{isMobile ? (
  <div style={{ marginBottom: 12 }}>
    <div style={{ marginBottom: 4 }}>
      <Tag ...>AI 生成</Tag>
      <Text type="secondary" style={{ fontSize: 12 }}>更新: ...</Text>
    </div>
    {isAdmin && (
      <Space size="small">
        <Button size="small" icon={<EditOutlined />} onClick={handleEdit}>编辑</Button>
        <Popconfirm ...><Button size="small" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
      </Space>
    )}
  </div>
) : (
  // 桌面端不变
)}
```

Markdown 内容区域添加移动端样式:
```tsx
// 移动端缩小字号和边距
style={{
  fontSize: isMobile ? 13 : 14,
  lineHeight: 1.8,
  ...
}}
```

## 4. 经络穴位

保持现有方案不变（已有 Drawer + 底部抽屉适配）。

## 全局 CSS 补充

在 `web/src/index.css` 现有 `@media (max-width: 767px)` 块中添加一条新规则:

```css
/* 追加到已有 @media (max-width: 767px) 块内 */
.wuyun-content table { display: block; overflow-x: auto; }
```

## 不变的部分

- 所有桌面端代码和逻辑
- 数据获取函数 (`fetchHerbs`, `fetchFormulas` 等)
- 分页 state (`page`, `size`, `total`)
- 编辑/删除/创建等业务逻辑
- 后端 API
- 路由配置
- `useIsMobile` hook

## 测试要点

- 各页面在 375px (iPhone SE) 和 414px (iPhone 14) 下正常显示
- 卡片列表分页切换正常，与桌面端 Table 分页一致
- 开方 Modal 药物输入框可正常输入和显示
- 库存提示在移动端正确显示
- 五运六气 AI 查询/编辑/删除在移动端正常工作
- 桌面端 (≥768px) 无任何变化
