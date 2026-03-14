# 节气功能设计方案

## 概述

在中医药模块下新增「节气」入口，展示二十四节气圆环可视化 + 每个节气的养生内容（Markdown 格式）。支持编辑/删除养生内容，适配桌面端和移动端。

## 需求确认

| 项目 | 决定 |
|------|------|
| 编辑范围 | 24节气基础信息（名称、日期）固定，仅编辑养生内容 |
| 可视化方案 | 单圈圆环年轮，四季色彩区分 |
| 圆心信息 | 当前节气名 + 日期区间 + 第N/24节气 + 下一节气倒计时 |
| 详情交互 | 侧边抽屉（桌面右侧，移动底部） |
| 内容格式 | Markdown 富文本，渲染展示 + 编辑器切换 |
| 数据存储 | 后端数据库，全局数据（无租户隔离） |
| 响应式 | 桌面端 + 移动端双端适配 |

## 数据模型

### SolarTerm 表（solar_terms）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uint64 PK | 自增主键 |
| name | varchar(20) NOT NULL | 节气名称（立春、雨水...） |
| season | varchar(10) NOT NULL | 所属季节（春/夏/秋/冬） |
| order_index | int NOT NULL | 序号 1-24 |
| month | int NOT NULL | 月份 |
| day | int NOT NULL | 日期（公历近似值，如立春=2月3日） |
| end_month | int NOT NULL | 结束月份 |
| end_day | int NOT NULL | 结束日期 |
| content | longtext | 养生内容（Markdown 格式） |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

**说明**：
- 全局数据，无 tenant_id（类似 herbs/formulas/pulses）
- 24 条固定记录，通过 seed 初始化
- content 字段可为空（表示该节气暂无养生内容）
- 日期为公历近似固定值，实际每年节气日期有 1-2 天浮动，取常用值即可

### Seed 数据

初始化 24 条记录，每条包含 name、season、order_index、month、day、end_month、end_day，content 默认为空。

```
立春(2/3-2/18) → 雨水(2/18-3/5) → 惊蛰(3/5-3/20) → 春分(3/20-4/4)
→ 清明(4/4-4/19) → 谷雨(4/19-5/5) → 立夏(5/5-5/20) → 小满(5/20-6/5)
→ 芒种(6/5-6/21) → 夏至(6/21-7/6) → 小暑(7/6-7/22) → 大暑(7/22-8/7)
→ 立秋(8/7-8/22) → 处暑(8/22-9/7) → 白露(9/7-9/22) → 秋分(9/22-10/8)
→ 寒露(10/8-10/23) → 霜降(10/23-11/7) → 立冬(11/7-11/22) → 小雪(11/22-12/6)
→ 大雪(12/6-12/21) → 冬至(12/21-1/5) → 小寒(1/5-1/20) → 大寒(1/20-2/3)
```

## API 设计

### GET /api/v1/solar-terms

获取全部 24 条节气数据。无分页（固定 24 条）。

**响应**：
```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "name": "立春",
      "season": "春",
      "order_index": 1,
      "month": 2, "day": 3,
      "end_month": 2, "end_day": 18,
      "content": "## 养生原则\n...",
      "updated_at": "2026-03-14T10:00:00Z"
    }
  ]
}
```

### PUT /api/v1/solar-terms/:id

更新节气养生内容。

**请求**：
```json
{
  "content": "## 养生原则\n惊蛰时节..."
}
```

**权限**：`role:manage`（管理员可编辑）

### DELETE /api/v1/solar-terms/:id/content

清空节气养生内容（不删除节气记录本身）。

**权限**：`role:manage`

## 前端设计

### 路由

- 路径：`/solar-terms`
- 菜单位置：中医药 → 节气（在「临床经验集」后面）
- 图标：`CalendarOutlined`

### 页面结构

#### 圆环可视化（SVG）

- 单圈四季色环：春(#52c41a) / 夏(#fa8c16) / 秋(#1890ff) / 冬(#722ed1)
- 24 个节气圆点均匀分布在环上（每隔 15°）
- 已过节气圆点不透明度较高，未来节气半透明
- 当前节气：红色(#ff4d4f) + 脉动动画
- 下一节气：绿色虚线圈标记
- 四个"立"节气（立春/立夏/立秋/立冬）显示名称标签
- 四季文字标签（春/夏/秋/冬）在对应象限
- 圆心信息区：
  - 当前节气名（大字）
  - 日期区间
  - 第 N / 24 节气
  - ↓ 下一节气 · X天后

#### 交互逻辑

- 进入页面 → 自动计算当前节气 → 打开当前节气抽屉
- 点击圆环上任意节气点 → 打开对应抽屉
- hover 节气点 → 显示 tooltip（节气名 + 日期）

#### 侧边抽屉

**桌面端**（Ant Design Drawer，右侧 420px）：
- 头部：节气名 + 日期区间 + 编辑/删除按钮
- 内容区：Markdown 渲染（使用 react-markdown + rehype-raw）
- 编辑模式：textarea 替换内容区，保存/取消按钮
- 空状态：「暂无养生内容，点击编辑添加」

**移动端**（Ant Design Drawer，底部弹出）：
- placement="bottom"，height="75vh"
- 拖拽手柄 + 头部操作按钮
- 内容同桌面端，字体适当缩小

#### 编辑流程

1. 点击「编辑」→ 内容区切换为 textarea（保留原始 Markdown）
2. 编辑完成 → 点击「保存」→ PUT API → 刷新渲染
3. 点击「取消」→ 恢复渲染模式

#### 删除流程

1. 点击「删除」→ Popconfirm 确认
2. 确认 → DELETE API → 清空 content → 显示空状态
3. 节气记录本身不删除

### 响应式适配

| 场景 | 桌面端 | 移动端 |
|------|--------|--------|
| 圆环尺寸 | 300-320px | 240px |
| 抽屉 | 右侧 420px | 底部 75vh |
| 节气点大小 | 3-4.5px | 4-5px（更大的点击区域） |
| 编辑器 | textarea 高度 300px | textarea 高度 200px |
| 页面标题 | 显示副标题 | 仅标题 |

### 当前节气计算逻辑（前端）

```
根据当前日期（月/日）遍历 24 节气的 month/day：
- 找到最后一个 month/day <= 当前日期的节气 → 当前节气
- 下一个节气 = 当前节气 order_index + 1（24 则循环到 1）
- 倒计时 = 下一节气日期 - 当前日期
```

## 文件清单

### 后端

| 文件 | 说明 |
|------|------|
| `server/model/solar_term.go` | SolarTerm 模型 |
| `server/service/solar_term.go` | Service 层（List/Update/DeleteContent） |
| `server/handler/solar_term.go` | Handler 层 |
| `server/database/seed.go` | 新增 seedSolarTerms() |
| `server/database/database.go` | AutoMigrate 添加 SolarTerm |
| `server/router/router.go` | 注册路由 |

### 前端

| 文件 | 说明 |
|------|------|
| `web/src/pages/solar-terms/SolarTerms.tsx` | 主页面（圆环 + 抽屉） |
| `web/src/api/solarTerm.ts` | API 层 |
| `web/src/App.tsx` | 添加路由 |
| `web/src/components/Layout.tsx` | 添加菜单项 |

### 测试

| 文件 | 说明 |
|------|------|
| `server/service/solar_term_test.go` | Service 层测试 |
| `server/handler/solar_term_handler_test.go` | Handler 层测试 |
| `web/src/pages/solar-terms/__tests__/SolarTerms.test.tsx` | 前端组件测试 |
