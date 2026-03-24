# 大字版本（无障碍）设计文档

> 方案 E：独立双模式 + 自适应布局 + 无障碍增强层

## 1. 目标

为视力障碍用户提供大字版本，支持字号放大、高对比度、焦点增强、间距增大。要求：

- 大字版本与普通版本**完全独立、互不干扰**
- 覆盖全部页面（约 24 个路由，桌面端 + 移动端）
- 移动端大字模式只放大字号，不改变现有移动布局
- 提供快捷切换入口，偏好持久化
- ARIA 属性 + 屏幕阅读器兼容

## 2. 架构

```
AccessibilityProvider (新增，最外层)
  │
  ├─ 状态管理
  │   ├─ mode: 'normal' | 'large' | 'xlarge'
  │   ├─ highContrast: boolean
  │   ├─ looseSpacing: boolean
  │   └─ focusEnhanced: boolean
  │
  ├─ 持久化: localStorage key='accessibility-settings' (带 version 字段)
  │   └─ schema: { version: 1, mode, highContrast, looseSpacing, focusEnhanced }
  │   └─ 版本不匹配时 fallback 到默认值，不报错
  │
  ├─ body className 动态切换
  │   ├─ .a11y-large / .a11y-xlarge
  │   ├─ .high-contrast
  │   ├─ .spacing-loose
  │   └─ .focus-enhanced
  │
  └─ ConfigProvider theme 条件选择
      ├─ mode='normal' → normalTheme (现有主题对象，不动)
      ├─ mode='large'  → largeTheme  (warmTheme 深拷贝 + override fontSize:18 等)
      └─ mode='xlarge' → xlargeTheme (warmTheme 深拷贝 + override fontSize:22 等)

注：largeTheme / xlargeTheme 是 warmTheme 的深合并（deep merge），保留 colorPrimary、
borderRadius、component overrides 等所有现有配置，仅覆盖字号/间距相关 token。
```

### 2.1 完全独立性保证

`mode='normal'` 时：
- body 上无任何 `.a11y-*` class → 无障碍 CSS 规则全部不匹配
- ConfigProvider 收到现有 theme 原始对象（不是副本）
- `useAccessibleColumns` 返回原始全部列
- `shouldAdaptLayout` = false → 组件走现有逻辑
- 渲染路径与未安装此功能 100% 一致

### 2.2 移动端兼容

核心规则：**移动端布局优先，大字模式只叠加字号**。

| 维度 | 桌面端 + 大字 | 移动端 + 大字 |
|------|--------------|--------------|
| 侧边栏 | 收起为图标 | 不动，保持 Drawer |
| 表格 | 隐藏次要列 | 不动，保持卡片视图 |
| 弹窗 | 宽度增大到 640px | 不动，保持 100vw-32px |
| 字号 | 放大 1.25x / 1.5x | 放大 1.15x / 1.25x（减半） |
| 间距 | 正常加大 | 减半加大 |
| 高对比度 | 正常生效 | 正常生效 |
| 焦点增强 | 正常生效 | 正常生效 |

实现机制：

```typescript
const isMobile = useIsMobile();
const { mode } = useAccessibilityContext();

// 布局调整仅桌面端生效
const shouldAdaptLayout = mode !== 'normal' && !isMobile;

// 字号缩放：移动端幅度减半
const fontScale = isMobile
  ? (mode === 'large' ? 1.15 : mode === 'xlarge' ? 1.25 : 1)
  : (mode === 'large' ? 1.25 : mode === 'xlarge' ? 1.5  : 1);
```

CSS 用 `@media (min-width: 768px)` 限定布局变化只在桌面端生效。

## 3. 新增文件

| 文件 | 用途 |
|------|------|
| `src/store/accessibility.tsx` | AccessibilityProvider + Context + useAccessibility hook |
| `src/theme/accessibilityThemes.ts` | large / xlarge 两套独立 antd theme token 配置 |
| `src/hooks/useAccessibleColumns.ts` | 表格列按 priority 自动过滤 |
| `src/styles/accessibility.css` | `.a11y-large` `.high-contrast` `.spacing-loose` `.focus-enhanced` 全局 CSS |
| `src/components/AccessibilityToggle.tsx` | Header Aa 快捷按钮 + 展开设置面板（Popover） |
| `src/components/AccessibilityFab.tsx` | 登录页右下角浮动 Aa 按钮 |
| `docs/accessibility-progress.md` | 适配进度跟踪清单 |

## 4. 修改文件

| 文件 | 改动内容 |
|------|---------|
| `src/App.tsx` | 外层包裹 AccessibilityProvider；ConfigProvider theme 根据 mode 条件选择 |
| `src/components/Layout.tsx` | Header 加 AccessibilityToggle 组件；大字模式侧边栏默认收起（仅桌面端） |
| `src/pages/patients/PatientList.tsx` | 列加 priority + useAccessibleColumns |
| `src/pages/records/RecordList.tsx` | 列加 priority + useAccessibleColumns |
| `src/pages/OpLogList.tsx` | 列加 priority + useAccessibleColumns |
| `src/pages/settings/TenantList.tsx` | 列加 priority + useAccessibleColumns |
| `src/pages/settings/UserList.tsx` | 列加 priority + useAccessibleColumns |
| `src/pages/inventory/DrugList.tsx` | 列加 priority + useAccessibleColumns |
| `src/pages/inventory/InventoryAlert.tsx` | 列加 priority + useAccessibleColumns |
| `src/pages/records/RecordForm.tsx` | 大字模式 form-row 竖排（仅桌面端） |
| `src/pages/statistics/` | 大字模式 SummaryCards grid 列数减少 |
| `src/pages/wuyun/WuyunLiuqi.tsx` | markdown 表格加横向滚动 |
| `src/pages/meridians/` | 3D 标注文字放大 |
| `src/pages/Login.tsx` | 加 AccessibilityFab 浮动按钮 |

## 5. 适配层级策略

### L1：全局 CSS（零改动，自动覆盖全部 22 页）

通过 Ant Design ConfigProvider 切换 theme token + body CSS class：

- antd 所有组件（按钮、输入框、选择器、表格）自动放大
- 表格行高增大（padding 加倍）
- 行高从 1.5 增大到 1.8
- 标签/Badge 字号提升
- 侧边栏自动收起为图标模式（仅桌面端）
- 弹窗最小宽度增大（仅桌面端）

### L2：表格列 priority（7 个表格页，每页 3-5 行）

列优先级定义：

| 级别 | 规则 | 大字模式行为 |
|------|------|-------------|
| P0 (默认) | 识别身份 + 完成操作必需 | 始终显示 |
| P1 | 高频查看但非必需 | large 显示，xlarge 隐藏 |
| P2 | 冗余/技术字段/详情页可查 | large 和 xlarge 均隐藏 |

不加 priority 的列默认 P0（始终显示），未适配页面表现为"只字大了，列全在"。

隐藏列的兜底：表格下方显示「展开更多列: 地址 · 备注 · 出生日期」链接，用户可恢复，按页面记住选择。

#### 各页面列 priority 分配

**PatientList（8列 → 大字5列）：**
- P0: 姓名、性别、年龄、联系电话、操作
- P1: 备注
- P2: 现居住地、出生日期（与年龄冗余）

**RecordList（5列 → 大字4列）：**
- P0: 患者姓名、就诊日期、诊断摘要、操作
- P2: 年龄（患者详情已有）

**OpLogList（6列 → 大字4列）：**
- P0: 操作时间、操作人、操作类型、操作
- P2: 资源类型、资源ID（技术字段）

**TenantList（6列 → 大字4列）：**
- P0: 诊所名称、状态、创建时间、操作
- P2: 编码、ID（技术字段）

**UserList / DrugList / InventoryAlert：** 待适配时根据同样标准分配。

### L3：特殊页面定制（4 个页面）

- **RecordForm** — 大字模式下 `.form-row` 从横排切竖排（仅桌面端）
- **Statistics** — SummaryCards grid 从 4 列减为 2 列
- **WuyunLiuqi** — markdown 渲染的表格外层加 `overflow-x: auto`
- **Meridians 3D** — 穴位标注文字按 fontScale 放大

## 6. 切换入口

### 6.1 Header 快捷按钮（AccessibilityToggle）

位置：Header 右侧，主题选择器旁边。

- 显示当前状态的 `Aa` 胶囊按钮
- **点击**：循环切换 标准 → 大 → 超大 → 标准
- **移动端**：点击直接循环切换（无长按交互，避免与原生手势冲突）
- **桌面端右键**：打开完整设置面板（Popover）

设置面板内容：
- 字号大小：标准 / 大 / 超大（三选一）
- 高对比度：开关
- 加大间距：开关
- 焦点增强：开关
- 底部提示快捷键

### 6.2 键盘快捷键

- macOS: `Cmd+Shift+A` / 其他系统: `Ctrl+Shift+A` — 循环切换字号模式
- macOS: `Cmd+Shift+H` / 其他系统: `Ctrl+Shift+H` — 切换高对比度

通过全局 keydown 事件监听，在 AccessibilityProvider 中注册。检测 `e.metaKey`（Mac）或 `e.ctrlKey`（其他）。若快捷键被浏览器/插件拦截，用户可通过 Header 按钮操作。

### 6.3 登录页浮动按钮（AccessibilityFab）

位置：右下角固定浮动。

- 圆形 `Aa` 按钮，48x48px
- 点击打开与 Header 相同的设置面板
- 偏好存 localStorage，登录后自动应用

## 7. 渐进发布策略

### Phase 1：基础框架（L1 全部生效）

- AccessibilityProvider + Context + hook
- accessibilityThemes.ts（large / xlarge token）
- accessibility.css（全局 CSS）
- AccessibilityToggle（Header 按钮）
- AccessibilityFab（登录页按钮）
- App.tsx / Layout.tsx 集成
- 键盘快捷键

**产出：全部 22 页自动大字，可发布。**

### Phase 2：核心表格页（L2 高频页面）

- useAccessibleColumns hook
- PatientList 列 priority
- RecordList 列 priority
- OpLogList 列 priority
- RecordForm 大字模式竖排

### Phase 3：剩余适配（L2 + L3）

- TenantList / UserList / DrugList / InventoryAlert 列 priority
- Statistics grid 列数
- WuyunLiuqi 横向滚动
- Meridians 标注放大

## 8. 无障碍语义 & ARIA

### 8.1 模式切换通知

切换模式时通过 `aria-live="polite"` 区域通知屏幕阅读器：

```html
<div aria-live="polite" aria-atomic="true" class="sr-only">
  <!-- JS 动态更新文本："已切换到大字模式" -->
</div>
```

### 8.2 切换按钮 ARIA

```html
<button
  aria-label="字号切换，当前：标准"
  role="button"
  aria-haspopup="true"  <!-- 桌面端右键有弹出面板 -->
>Aa 标准</button>
```

### 8.3 CSS 媒体查询集成

```css
/* 如果系统偏好高对比度，自动启用 */
@media (prefers-contrast: more) {
  body:not(.high-contrast-off) { /* 应用高对比度样式 */ }
}

/* 尊重 prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  .a11y-large *, .a11y-xlarge * { transition: none !important; }
}
```

## 9. 高对比度 & 焦点增强 详细定义

### 9.1 高对比度模式 (.high-contrast)

目标：所有文字/背景对比度达到 WCAG AA（4.5:1）以上。

| 元素 | 普通模式 | 高对比度 |
|------|---------|---------|
| 正文文字 | #333 on #FAFAF5 | #000 on #FFFFFF |
| 次要文字 | #999 | #555 |
| 边框 | #e5e5dd | #333 |
| antd primary | #52C41A | #2D8A00（加深） |
| 表格斑马纹 | #fafaf5 | #f0f0f0 |
| 禁用状态 | #ccc text | #888 text + 删除线 |

对 antd 组件：通过 ConfigProvider 的 `algorithm: theme.compactAlgorithm` 不变，仅覆盖 token colorText / colorBgBase / colorBorder 等。

### 9.2 焦点增强 (.focus-enhanced)

```css
.focus-enhanced *:focus-visible {
  outline: 3px solid #1677FF !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 6px rgba(22, 119, 255, 0.15) !important;
}

.focus-enhanced .ant-btn:focus-visible {
  outline-color: #52C41A;
}
```

- 所有可交互元素获得 3px 粗焦点环
- 焦点环颜色：输入类蓝色(#1677FF)，按钮类绿色(#52C41A)
- 不改变 tab 顺序，仅增强视觉反馈
- 与 antd 内置 focus 样式共存（优先级覆盖）

## 10. 性能考量

- ConfigProvider theme 切换会触发子树 re-render，但 antd 内部有 memoization
- 切换频率极低（用户设置一次就不改了），不需要做 debounce
- body className 切换触发 CSS 重计算，但无 JavaScript 重渲染
- `useAccessibleColumns` 使用 useMemo 缓存过滤结果，columns 引用不变时不重算
- localStorage 读取仅在 Provider mount 时执行一次

## 11. 进度跟踪

创建 `docs/accessibility-progress.md`，格式：

```markdown
# 大字版本适配进度

## Phase 1：基础框架
- [ ] AccessibilityProvider
- [ ] accessibilityThemes
- [ ] accessibility.css
- [ ] AccessibilityToggle
- [ ] AccessibilityFab
- [ ] App.tsx 集成
- [ ] Layout.tsx 集成
- [ ] 键盘快捷键

## Phase 2：核心表格页
- [ ] useAccessibleColumns hook
- [ ] PatientList
- [ ] RecordList
- [ ] OpLogList
- [ ] RecordForm

## Phase 3：剩余适配
- [ ] TenantList
- [ ] UserList
- [ ] DrugList
- [ ] InventoryAlert
- [ ] Statistics
- [ ] WuyunLiuqi
- [ ] Meridians
```

未来对话中说「继续适配大字版本」即可，会自动读取此文件继续工作。

## 12. 测试要点

每个 Phase 完成后验证：

- 普通模式：全部页面渲染与改动前 100% 一致（回归测试）
- 大字模式（桌面端）：字号、布局、列隐藏、侧边栏收起
- 大字模式（移动端）：字号放大但布局不变
- 切换：标准↔大↔超大 来回切换无异常
- 持久化：刷新后偏好保持
- 高对比度 / 间距 / 焦点增强：独立切换
- 键盘快捷键：Ctrl+Shift+A / Ctrl+Shift+H
