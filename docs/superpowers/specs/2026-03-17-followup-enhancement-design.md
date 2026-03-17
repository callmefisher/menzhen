# 回访功能增强设计

> 日期：2026-03-17
> 状态：已确认

## 概述

三项增强：
1. 回访列表页统计标签栏重构（Badge Pill）
2. 诊疗记录页内嵌回访折叠面板（替代 FollowUpDrawer）
3. 回访来源定位（从列表页跳转到诊疗记录自动高亮）

---

## 1. 回访列表页 — Badge Pill 标签栏

### 变更

- **删除**：原有统计卡片（Row + Card + Statistic，3 个卡片）
- **删除**：状态下拉筛选（Select status）
- **删除**：快速日期按钮（今日/本周/本月），功能被标签栏的"今日"替代，本周/本月保留在日期区间选择器中
- **新增**：一行药丸标签替代上述统计+筛选

### 标签定义

| 标签 | 过滤行为 | 颜色 | 数据源 |
|------|---------|------|--------|
| 全部 | 无状态过滤 | 选中态蓝底白字，未选中灰底 | total_count（新增） |
| 待回访 | status=pending | 蓝色系 #e6f4ff / #1677ff | pending_count |
| 今日 | planned_date=today | 橙色系 #fff7e6 / #fa8c16 | today_count |
| 逾期 | status=overdue | 红色系 #fff2f0 / #ff4d4f | overdue_count |
| 已完成 | status=completed | 绿色系 #f6ffed / #52c41a | completed_count |

### 交互

- 点击标签 → 激活过滤，清除原有状态/日期过滤
- 再次点击同一标签 → 取消过滤（回到"全部"）
- "全部"始终可点击回到无过滤状态
- "今日"标签设置 `planned_date_from` 和 `planned_date_to` 为今天，并设 `status` 为空

### 响应式

- **桌面端**：`display: flex; flex-wrap: wrap; gap: 8px`
- **移动端**：`overflow-x: auto; white-space: nowrap; flex-wrap: nowrap`，横向滚动

### 后端变更

**1. Stats API** — `GET /api/v1/follow-ups/stats` 新增 `total_count`：

```go
type FollowUpStats struct {
    PendingCount   int64 `json:"pending_count"`
    OverdueCount   int64 `json:"overdue_count"`
    TodayCount     int64 `json:"today_count"`
    CompletedCount int64 `json:"completed_count"`
    TotalCount     int64 `json:"total_count"` // 新增：= pending + overdue + completed
}
```

`total_count` = 所有非软删除回访的总数（`pending_count + overdue_count + completed_count`）。

**2. List API** — `GET /api/v1/follow-ups` 新增 `record_id` 过滤参数：

- Handler 层解析 query param `record_id`（uint64，可选）
- Service 层 `List()` 方法增加 `recordID` 参数，WHERE 条件增加 `record_id = ?`
- 用于 FollowUpPanel 按诊疗记录查询回访列表

### 前端 API 变更

`web/src/api/followUp.ts`：
- `FollowUpStats` 增加 `total_count: number`
- `FollowUpListParams` 增加 `record_id?: number`

---

## 2. 诊疗记录页 — 回访折叠面板

### 变更

- **删除**：`FollowUpDrawer` 组件及其在 RecordForm 中的引用
- **新增**：`FollowUpPanel` 组件，内嵌在 RecordForm 处方区域下方

### 组件：FollowUpPanel

**Props：**
```typescript
interface FollowUpPanelProps {
  recordId: number;
  patientId: number;
  patientName: string;
  highlightFollowUpId?: number; // 来源定位用
}
```

**折叠状态（标题栏）：**
- 文字："回访"
- 右侧：状态摘要 badge（`N逾期` `N待回访` `N已完成`）
- 无回访时：显示"回访 · 暂无"
- 默认收起；有 `highlightFollowUpId` 或有逾期/待回访时自动展开

**展开状态：**
- 调用 `GET /api/v1/follow-ups?record_id=xxx` 获取该诊疗记录的回访列表
- 排序：逾期 → 待回访 → 已完成
- 每条回访显示：
  - 状态 pill（与列表页一致的颜色方案）
  - 计划日期 · 回访方式
  - 回访内容（摘要，最多 2 行）
  - 操作：待回访/逾期 → 「完成」「编辑」；已完成 → 「查看」
- 底部：虚线框 `+ 新建回访` 按钮

**「完成」操作：**
- 调用 `PUT /api/v1/follow-ups/:id`，设 `actual_date` 为今天
- 无需弹窗确认（轻量操作）

**「编辑」/「新建」操作：**
- 打开 Modal 表单
- `patient_id` 和 `record_id` 预填且只读（仍传给 API，`UpdateFollowUpReq` 这两个字段为可选 pointer，不传亦可）
- 表单字段：计划日期、实际日期（编辑时）、回访方式（含"其他"自定义逻辑）、回访内容、是否康复（编辑时）

**事件通知：**
- 创建/更新/删除回访后，触发 `window.dispatchEvent(new Event('followup-data-changed'))` 以更新全局菜单 badge
- 同时刷新面板自身的回访列表

### 视觉风格

与处方区域一致：
- `background: linear-gradient(180deg, #fafafa, #f5f5f5)`
- 圆角 8px
- 边框 `1px solid #f0f0f0`

### 响应式

- **桌面端**：宽度跟随表单容器
- **移动端**：满宽，状态 badge 缩略（`1逾期` → `1逾`），操作按钮缩小

---

## 3. 回访来源定位

### 场景

从回访列表页点击"关联诊疗 → 查看详情"，跳转到诊疗记录页并定位到来源回访。

### 实现

- 回访列表页链接改为：`/records/:recordId?followup_id=123`
- RecordForm 读取 URL 参数 `followup_id`，传入 FollowUpPanel 的 `highlightFollowUpId`
- FollowUpPanel 行为：
  1. 自动展开折叠面板
  2. 数据加载后，滚动到对应回访条目
  3. 高亮闪烁 2 秒（CSS animation，浅蓝背景淡出）

### CSS 高亮动画

写在 FollowUpPanel 组件内联 `<style>` 标签中（与 FollowUpList 的 `.follow-up-overdue-row` 做法一致）：

```css
@keyframes followup-highlight {
  0% { background-color: #e6f4ff; }
  100% { background-color: transparent; }
}
.followup-highlight {
  animation: followup-highlight 2s ease-out;
}
```

---

## 文件影响范围

| 文件 | 变更类型 |
|------|---------|
| `server/service/follow_up.go` | 修改：Stats 增加 total_count；List 增加 record_id 过滤 |
| `server/handler/follow_up.go` | 修改：List handler 解析 record_id 参数 |
| `server/service/follow_up_test.go` | 修改：测试 total_count 和 record_id 过滤 |
| `web/src/api/followUp.ts` | 修改：FollowUpStats 增加 total_count；FollowUpListParams 增加 record_id |
| `web/src/pages/followup/FollowUpList.tsx` | 修改：标签栏替代统计卡片+下拉筛选+快速日期按钮 |
| `web/src/pages/followup/__tests__/FollowUpList.test.tsx` | 修改：更新测试 |
| `web/src/components/FollowUpPanel.tsx` | **新增**：回访折叠面板组件 |
| `web/src/components/__tests__/FollowUpPanel.test.tsx` | **新增**：面板测试 |
| `web/src/pages/records/RecordForm.tsx` | 修改：替换 FollowUpDrawer 为 FollowUpPanel；读取 followup_id URL 参数（已有 useSearchParams） |
| `web/src/components/FollowUpDrawer.tsx` | **删除** |
