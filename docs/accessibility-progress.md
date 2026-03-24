# 大字版本适配进度

## Phase 1：基础框架 ✅
- [x] AccessibilityProvider (`store/accessibility.tsx`)
- [x] accessibilityThemes (`theme/accessibilityThemes.ts`)
- [x] accessibility.css (`styles/accessibility.css`)
- [x] AccessibilityToggle (`components/AccessibilityToggle.tsx`)
- [x] AccessibilityFab (`components/AccessibilityFab.tsx`)
- [x] App.tsx 集成
- [x] Layout.tsx 集成（Header 按钮 + 侧边栏自动收起）
- [x] LoginNew.tsx 集成（浮动按钮）
- [x] 键盘快捷键 (Cmd/Ctrl+Shift+A/H)
- [x] 构建验证通过

**产出：全部 22 页自动大字，可发布。**

## Phase 2：核心表格页 ✅
- [x] useAccessibleColumns hook (`hooks/useAccessibleColumns.ts`)
- [x] HiddenColumnsHint 组件 (`components/HiddenColumnsHint.tsx`)
- [x] PatientList 列 priority（P0:姓名/性别/年龄/电话/操作, P1:备注, P2:地址/生日）
- [x] RecordList 列 priority（P0:姓名/日期/诊断/操作, P2:年龄）
- [x] OpLogList 列 priority（P0:时间/操作人/类型/操作, P2:资源类型/资源ID）
- [x] RecordForm 大字模式竖排（CSS `.form-row` flex-direction:column）
- [x] 构建验证通过

**产出：3个核心表格页自动隐藏次要列 + "展开更多列"兜底 + RecordForm竖排布局。**

## Phase 3：剩余适配 ✅
- [x] TenantList 列 priority（P0:名称/状态/时间/操作, P2:ID/编码）
- [x] UserList 列 priority（P0:用户名/姓名/角色/状态/操作, P1:手机号, P2:备注/诊所）
- [x] DrugList 列 priority（P0:名称/库存/状态/操作, P1:货架号/出售价, P2:进货价/备注）
- [x] InventoryAlert 列 priority（P0:药物名/库存/操作, P1:货架号, P2:分类/阈值/缺口量）
- [x] Statistics SummaryCards grid 列数（大字模式 4列→2列）
- [x] WuyunLiuqi markdown 表格横向滚动（CSS overflow-x:auto）
- [x] Meridians 穴位标注放大（CSS .acupoint-info-card 字号覆盖）
- [x] 构建验证通过

**产出：全部页面适配完成，三阶段全部交付。**
