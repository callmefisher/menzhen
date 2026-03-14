# 易理（卦象）功能设计

> 日期: 2026-03-14
> 状态: 已批准

## 概述

在中医药模块下新增「易理」功能，展示和管理易经 64 卦卦象数据。系统预置 64 卦基础数据，用户可查看、搜索、编辑、删除卦象，点击卦象卡片后通过抽屉展示详细阐述。

## 数据模型

### `hexagrams` 表（全局数据，无 tenant_id）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | uint64 | PK, auto-increment | 主键 |
| `number` | int | unique, not null | 卦序（1-64） |
| `name` | varchar(20) | unique, not null | 卦名（乾、坤…） |
| `symbol` | varchar(20) | not null | 卦象符号（☰☷等组合） |
| `upper_trigram` | varchar(10) | index | 上卦（乾/坤/震/巽/坎/离/艮/兑） |
| `lower_trigram` | varchar(10) | index | 下卦 |
| `judgment` | text | | 卦辞 |
| `yao_texts` | JSON | | 六爻爻辞 `[{position:1,name:"初九",text:"潜龙勿用"},...]` |
| `commentary` | text | | 传文（彖传、象传等，Markdown 格式） |
| `tcm_application` | text | | 中医应用阐述（Markdown 格式） |
| `related_hexagrams` | JSON | | 关联卦 `{mutual:"既济",opposite:"坤",reverse:"乾"}` |
| `description` | text | | 总体描述/注解 |
| `created_at` | datetime | auto | 创建时间 |
| `updated_at` | datetime | auto | 更新时间 |

## API 设计

### 路由

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/hexagrams` | 认证即可 | 列表（name/upper_trigram/lower_trigram 搜索 + 分页） |
| GET | `/api/v1/hexagrams/trigrams` | 认证即可 | 八卦分类列表 |
| GET | `/api/v1/hexagrams/:id` | 认证即可 | 单个卦象详情 |
| POST | `/api/v1/hexagrams` | `hexagram:manage` | 创建 |
| PUT | `/api/v1/hexagrams/:id` | `hexagram:manage` | 更新 |
| DELETE | `/api/v1/hexagrams/:id` | `hexagram:manage` | 删除 |

### 查询参数（GET /hexagrams）

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | "" | 卦名模糊搜索 |
| `upper_trigram` | string | "" | 上卦精确筛选 |
| `lower_trigram` | string | "" | 下卦精确筛选 |
| `page` | int | 1 | 页码 |
| `size` | int | 20 | 每页条数 |

### 响应格式

```json
{
  "total": 64,
  "items": [
    {
      "id": 1,
      "number": 1,
      "name": "乾",
      "symbol": "☰☰",
      "upper_trigram": "乾",
      "lower_trigram": "乾",
      "judgment": "元亨利贞",
      "yao_texts": [
        {"position": 1, "name": "初九", "text": "潜龙勿用"},
        {"position": 2, "name": "九二", "text": "见龙在田，利见大人"},
        {"position": 3, "name": "九三", "text": "君子终日乾乾，夕惕若厉，无咎"},
        {"position": 4, "name": "九四", "text": "或跃在渊，无咎"},
        {"position": 5, "name": "九五", "text": "飞龙在天，利见大人"},
        {"position": 6, "name": "上九", "text": "亢龙有悔"}
      ],
      "commentary": "彖曰：大哉乾元...",
      "tcm_application": "",
      "related_hexagrams": {"mutual": "", "opposite": "坤", "reverse": "乾"},
      "description": "",
      "created_at": "2026-03-14T00:00:00Z",
      "updated_at": "2026-03-14T00:00:00Z"
    }
  ]
}
```

## 前端设计

### 导航

中医药菜单组下新增「易理」项，路径 `/yijing`，图标使用 `ReadOutlined` 或 `BookOutlined`。

### 列表页

**桌面端**：
- 顶部：搜索栏（卦名输入 + 上卦下拉 + 下卦下拉） + 新增按钮（需 `hexagram:manage` 权限）
- 主体：卡片网格（4 列，`gutter: [16, 16]`）
- 每卡：卦象符号（大号 32px）+ 卦名 + 第 N 卦 + 上下卦标签
- 底部：Pagination 分页器

**移动端**：
- 卡片网格改为 2 列
- 卡片简化（符号 + 卦名 + 卦序）
- 分页 `<Pagination size="small" simple />`

### 详情抽屉（Drawer）

点击卦象卡片弹出右侧 Drawer：
- **桌面端宽度**：520px
- **移动端宽度**：`calc(100vw - 32px)`

Drawer 内部分 Tab：
1. **概述** — 卦象符号、上下卦、卦辞、总体描述
2. **爻辞** — 六爻逐行展示（初九/九二/…/上九 或 初六/六二/…/上六）
3. **传文** — Markdown 渲染
4. **中医应用** — Markdown 渲染
5. **关联卦** — 互卦/错卦/综卦（可点击切换到对应卦的详情）

右上角操作按钮：编辑 / 删除（需 `hexagram:manage` 权限）

### 编辑模式

在抽屉内点「编辑」切换为编辑模式：
- 各字段变为 Input / TextArea 可编辑状态
- 爻辞以 6 行独立 TextArea 编辑
- 底部显示「保存」/「取消」按钮
- 保存后回到只读模式

### 新增

顶部「新增」按钮打开 Modal：
- 表单包含所有字段
- 保存后刷新列表

## 权限

新增权限码：
- `hexagram:read` — 查看卦象（可选，默认认证即可读取）
- `hexagram:manage` — 创建/编辑/删除卦象

在 `seed.go` 中新增以上权限。

## Seed 数据

系统预置完整 64 卦基础数据：

| 预置字段 | 说明 |
|----------|------|
| `number` | 1-64 卦序 |
| `name` | 64 卦标准卦名 |
| `symbol` | 卦象符号（上下卦三划组合） |
| `upper_trigram` | 上卦名 |
| `lower_trigram` | 下卦名 |
| `judgment` | 标准卦辞 |
| `yao_texts` | 标准六爻爻辞 |

以下字段初始为空，由用户补充：
- `commentary`（传文）
- `tcm_application`（中医应用）
- `related_hexagrams`（关联卦）
- `description`（描述）

## 文件清单

### 后端（Go）
1. `server/model/hexagram.go` — 数据模型
2. `server/service/hexagram.go` — 业务逻辑
3. `server/handler/hexagram.go` — HTTP 处理器
4. `server/database/seed.go` — 新增权限 + 64 卦 seed 数据
5. `server/database/database.go` — AutoMigrate 新增 Hexagram
6. `server/router/router.go` — 注册路由

### 前端（React + TypeScript）
7. `web/src/api/yijing.ts` — API 客户端
8. `web/src/pages/yijing/YijingList.tsx` — 列表页（卡片网格 + 搜索 + 分页）
9. `web/src/pages/yijing/HexagramDrawer.tsx` — 详情抽屉（Tab + 编辑模式）
10. `web/src/App.tsx` — 添加路由
11. `web/src/components/Layout.tsx` — 添加菜单项

### 测试
12. `server/service/hexagram_test.go` — Service 层测试
13. `server/handler/hexagram_handler_test.go` — Handler 层测试
14. `web/src/pages/yijing/__tests__/YijingList.test.tsx` — 前端测试

### 文档
15. `docs/codebase.md` — 更新数据模型和 API 路由
16. `CLAUDE.md` — 引用设计文档
