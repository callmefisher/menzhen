# 方剂查询界面增强 - 设计方案

日期：2026-02-26

## 需求

1. 方剂查询页面中，方剂名可编辑
2. 方剂查询页面中，展开行的药物名称可编辑
3. 点击药物名时，弹出中药详情 Modal（与中药查询页展开行内容一致）
4. 处方弹窗（按方开药 + 自由开方）中的药物名也支持点击查看详情

## 方案

### 新增文件

- `web/src/components/HerbDetailModal.tsx` — 通用中药详情弹窗组件

### 修改文件

- `web/src/pages/formulas/FormulaSearch.tsx` — 方剂名可编辑 + 展开行药物可编辑/查看详情
- `web/src/components/PrescriptionModal.tsx` — 药物列表增加查看详情按钮
- `server/handler/formula.go` — 新增 UpdateName handler
- `server/service/formula.go` — 新增 UpdateName 方法
- `server/router/router.go` — 注册 PUT /formulas/:id/name 路由
- `web/src/api/formula.ts` — 新增 updateFormulaName API

### 模块设计

#### 1. HerbDetailModal 组件

- Props: `open: boolean`, `herbName: string`, `onClose: () => void`
- 打开时调用 `listHerbs({ name: herbName })` 查询
- 展示字段：别名、分类、性味归经、功效、主治、来源
- 加载中显示 Spin，查不到显示 Empty

#### 2. FormulaSearch 改造

- 列表「方剂名」列：文本变为可点击编辑（Input），失焦/回车调 `PUT /formulas/:id/name` 保存
- 展开行组成表格：「药物」列改为 Input + InfoCircle 图标，点击图标弹出 HerbDetailModal
- 展开行底部增加「保存」「添加药物」按钮，调用已有 `updateFormulaComposition` 保存
- 编辑功能仅管理员可见（`role:manage` 权限）

#### 3. PrescriptionModal 改造

- 药物列表「药名」列：Input 旁增加 InfoCircle 图标按钮，点击弹出 HerbDetailModal
- 按方开药和自由开方共用同一药物列表，改动一次即可

#### 4. 后端 API

- `PUT /api/v1/formulas/:id/name`
- Body: `{ "name": "新名称" }`
- 权限: `role:manage`
- 校验: name 不为空，长度不超过 100

## 交互流程

```
方剂查询页：
  列表 → 方剂名点击 → 变为 Input → 编辑 → 失焦保存
  展开行 → 组成表格 → 药物名可编辑 + 🔍查看详情按钮 → 点击 → HerbDetailModal
  展开行 → 保存按钮 → 调用 updateFormulaComposition

处方弹窗：
  药物列表 → 药名 Input 旁 🔍按钮 → 点击 → HerbDetailModal
```
