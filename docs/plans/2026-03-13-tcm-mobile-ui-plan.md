# 中医药模块移动端 UI 优化实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将中医药模块 6 个页面优化为移动端友好布局，桌面端零改动。

**Architecture:** 条件渲染 `isMobile ? <Mobile/> : <Desktop/>`。表格类页面替换为卡片列表，开方药物替换为垂直堆叠，五运六气添加纵向布局。复用所有已有 state 和函数。

**Tech Stack:** React 19, TypeScript, Ant Design 6, useIsMobile hook

**Spec:** [设计文档](2026-03-13-tcm-mobile-ui-design.md)

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `web/src/index.css` | 修改 | 追加 wuyun-content table 溢出规则 |
| `web/src/pages/herbs/HerbSearch.tsx` | 修改 | 移动端卡片列表 + 展开编辑 |
| `web/src/pages/formulas/FormulaSearch.tsx` | 修改 | 移动端卡片列表 + 组成展开 |
| `web/src/pages/pulses/PulseList.tsx` | 修改 | 移动端卡片列表 + 展开编辑 |
| `web/src/pages/clinical-experience/ClinicalExperienceList.tsx` | 修改 | 移动端卡片列表 |
| `web/src/components/PrescriptionModal.tsx` | 修改 | 药物垂直堆叠 + stockHint 提取 |
| `web/src/pages/wuyun/WuyunLiuqi.tsx` | 修改 | 导入 useIsMobile + 纵向堆叠 |

---

## Task 1: 全局 CSS 补充

**Files:**
- Modify: `web/src/index.css`

- [ ] **Step 1: 在现有 @media 块内追加规则**

在 `web/src/index.css` 的 `@media (max-width: 767px)` 块末尾追加:

```css
.wuyun-content table { display: block; overflow-x: auto; }
```

- [ ] **Step 2: 验证构建**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add web/src/index.css
git commit -m "fix: add wuyun markdown table overflow rule for mobile"
```

---

## Task 2: 中药查询 HerbSearch 移动端卡片

**Files:**
- Modify: `web/src/pages/herbs/HerbSearch.tsx`

- [ ] **Step 1: 添加 Pagination, Spin, Empty 导入**

在现有 antd import 中追加 `Pagination, Spin, Empty`:

```tsx
import { Input, Table, Tag, message, Button, Popconfirm, Select, Space, Pagination, Spin, Empty } from 'antd';
```

- [ ] **Step 2: 在 Table 前添加移动端卡片条件渲染**

将 `<Table<HerbItem> ...>` 整体替换为 `{isMobile ? (...mobile...) : (<Table .../>)}`。

移动端渲染逻辑:

```tsx
{isMobile ? (
  <div>
    {loading ? (
      <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
    ) : herbs.length === 0 ? (
      <Empty description="暂无数据" />
    ) : (
      herbs.map((herb) => {
        const isExpanded = expandedRowKeys.includes(herb.id);
        const isEditing = editingId === herb.id;
        return (
          <div key={herb.id} style={{ background: '#fafafa', borderRadius: 8, padding: 12, marginBottom: 8 }}>
            {/* 标题行 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{herb.name}</span>
              <Space size="small">
                {herb.source === 'deepseek' && <Tag icon={<RobotOutlined />} color="blue">AI</Tag>}
                {hasPermission('role:manage') && (
                  <>
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => startEdit(herb)} />
                    <Popconfirm title="确定删除此中药？" onConfirm={() => handleDelete(herb.id)} okText="删除" cancelText="取消">
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </>
                )}
              </Space>
            </div>
            {/* 摘要字段 */}
            <div style={{ fontSize: 13, color: '#666', lineHeight: '22px' }}>
              {herb.category && <span style={{ marginRight: 12 }}>分类: <span style={{ color: '#333' }}>{herb.category}</span></span>}
              {herb.properties && <span>性味归经: <span style={{ color: '#333' }}>{herb.properties}</span></span>}
            </div>
            {/* 展开/收起 */}
            {!isEditing && (
              <div
                style={{ textAlign: 'center', color: '#888', fontSize: 12, paddingTop: 6, cursor: 'pointer' }}
                onClick={() => setExpandedRowKeys(isExpanded ? expandedRowKeys.filter(k => k !== herb.id) : [...expandedRowKeys, herb.id])}
              >
                {isExpanded ? '收起 ▲' : '展开详情 ▼'}
              </div>
            )}
            {/* 展开内容 (复用 expandedRowRender 逻辑) */}
            {(isExpanded || isEditing) && (
              <div style={{ paddingTop: 8, borderTop: '1px solid #e8e8e8', marginTop: 6 }}>
                {isEditing ? (
                  <>
                    <div style={{ marginBottom: 8 }}><strong>药名：</strong><Input size="small" value={editingData.name} onChange={(e) => setEditingData((d) => ({ ...d, name: e.target.value }))} style={{ width: '100%' }} /></div>
                    <div style={{ marginBottom: 8 }}><strong>别名：</strong><Input size="small" value={editingData.alias} onChange={(e) => setEditingData((d) => ({ ...d, alias: e.target.value }))} /></div>
                    <div style={{ marginBottom: 8 }}><strong>分类：</strong><Input size="small" value={editingData.category} onChange={(e) => setEditingData((d) => ({ ...d, category: e.target.value }))} style={{ width: '100%' }} /></div>
                    <div style={{ marginBottom: 8 }}><strong>性味归经：</strong><Input size="small" value={editingData.properties} onChange={(e) => setEditingData((d) => ({ ...d, properties: e.target.value }))} /></div>
                    <div style={{ marginBottom: 8 }}><strong>功效：</strong><Input.TextArea rows={2} value={editingData.effects} onChange={(e) => setEditingData((d) => ({ ...d, effects: e.target.value }))} /></div>
                    <div style={{ marginBottom: 8 }}><strong>主治：</strong><Input.TextArea rows={2} value={editingData.indications} onChange={(e) => setEditingData((d) => ({ ...d, indications: e.target.value }))} /></div>
                    <div style={{ marginBottom: 8 }}><strong>道地产区：</strong><Input size="small" value={editingData.origin} onChange={(e) => setEditingData((d) => ({ ...d, origin: e.target.value }))} /></div>
                    <Space>
                      <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
                      <Button size="small" icon={<ThunderboltOutlined />} loading={aiRefreshing} onClick={handleAiRefresh}>AI查询</Button>
                      <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingId(null)}>取消</Button>
                    </Space>
                  </>
                ) : (
                  <>
                    <p style={{ margin: '4px 0' }}><strong>别名：</strong>{herb.alias || '无'}</p>
                    <p style={{ margin: '4px 0' }}><strong>功效：</strong>{herb.effects || '无'}</p>
                    <p style={{ margin: '4px 0' }}><strong>主治：</strong>{herb.indications || '无'}</p>
                    <p style={{ margin: '4px 0' }}><strong>道地产区：</strong>{herb.origin || '无'}</p>
                    {herb.source === 'deepseek' && (
                      <Tag icon={<RobotOutlined />} color="blue" style={{ marginTop: 4 }}>
                        数据来源：DeepSeek AI（仅供参考）
                      </Tag>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })
    )}
    <Pagination
      current={page}
      pageSize={size}
      total={total}
      onChange={(p, s) => handleTableChange({ current: p, pageSize: s })}
      size="small"
      simple
      style={{ textAlign: 'center', marginTop: 16 }}
    />
  </div>
) : (
  <Table<HerbItem> ... /> // 保持桌面端 Table 不变
)}
```

- [ ] **Step 3: 验证构建**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/herbs/HerbSearch.tsx
git commit -m "feat: add mobile card list for herb search page"
```

---

## Task 3: 方剂查询 FormulaSearch 移动端卡片

**Files:**
- Modify: `web/src/pages/formulas/FormulaSearch.tsx`

- [ ] **Step 1: 添加 Pagination, Spin, Empty 导入**

在现有 antd import 中追加 `Pagination, Spin, Empty`。

- [ ] **Step 2: 在 Table 前添加移动端卡片条件渲染**

将 `<Table<FormulaItem> ...>` 整体替换为条件渲染。

移动端卡片结构:
- 标题: `name` (有权限时可点击编辑，复用 editingNameId/editingNameValue 逻辑)
- 摘要: 组成药物数量 `(record.composition || []).length + '味药'`，source 标签
- 展开详情: effects, indications, notes(可编辑), 组成列表(卡片内列表而非嵌套 Table), 编辑组成按钮
- 编辑组成时: 在展开区域内显示药物输入行列表 + 添加/保存/取消按钮 (复用 inlineEditId, inlineComposition, handleSaveInline 等)
- 分页: `<Pagination simple size="small" />`

- [ ] **Step 3: 组成列表移动端用简单列表替代嵌套 Table**

展开区域中的组成列表，在移动端不使用嵌套 Table，改为:

```tsx
{comp.map((c, idx) => (
  <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
    {isEditing ? (
      <>
        <Input size="small" value={inlineComposition[idx]?.herb_name} onChange={(e) => updateInlineRow(idx, 'herb_name', e.target.value)} placeholder="药名" style={{ flex: 1 }} />
        <Input size="small" value={inlineComposition[idx]?.default_dosage} onChange={(e) => updateInlineRow(idx, 'default_dosage', e.target.value)} placeholder="用量" style={{ width: 70 }} />
        <Button type="text" size="small" icon={<InfoCircleOutlined />} onClick={() => openHerbDetail(inlineComposition[idx]?.herb_name || '')} />
        <Button type="text" danger size="small" icon={<MinusCircleOutlined />} onClick={() => removeInlineRow(idx)} />
      </>
    ) : (
      <>
        <span>{c.herb_name}</span>
        <span style={{ color: '#888' }}>{c.default_dosage}</span>
        <Button type="text" size="small" icon={<InfoCircleOutlined />} onClick={() => openHerbDetail(c.herb_name)} />
      </>
    )}
  </div>
))}
```

- [ ] **Step 4: 验证构建**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/formulas/FormulaSearch.tsx
git commit -m "feat: add mobile card list for formula search page"
```

---

## Task 4: 脉象 PulseList 移动端卡片

**Files:**
- Modify: `web/src/pages/pulses/PulseList.tsx`

- [ ] **Step 1: 添加 Pagination, Spin, Empty 导入**

- [ ] **Step 2: 在 Table 前添加移动端卡片条件渲染**

卡片结构:
- 标题: `name`
- 操作: 编辑/删除按钮 (有权限时)
- 摘要: `category`, `description` 截断 (最多 50 字 + '...')
- 展开: 完整 description, clinical_meaning, common_conditions
- 编辑模式: 复用 editingId/editingData，展开区域显示表单 (与桌面端 expandedRowRender 逻辑一致)
- 分页: `<Pagination simple size="small" />`

- [ ] **Step 3: 验证构建**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/pulses/PulseList.tsx
git commit -m "feat: add mobile card list for pulse types page"
```

---

## Task 5: 临床经验集 ClinicalExperienceList 移动端卡片

**Files:**
- Modify: `web/src/pages/clinical-experience/ClinicalExperienceList.tsx`

- [ ] **Step 1: 添加 Pagination, Spin, Empty 导入**

- [ ] **Step 2: 在 Table 前添加移动端卡片条件渲染**

卡片结构:
- 标题: `source` (出处)
- 操作: 编辑(打开 Modal)/删除 (有权限时)
- 摘要: `category`, `herbs` 截断 (最多 40 字)
- 展开: 完整 herbs, formula, experience
- 编辑: 点击编辑按钮调用 `openEditModal(record)`（复用现有 Modal）
- 分页: `<Pagination simple size="small" />`

- [ ] **Step 3: 验证构建**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/clinical-experience/ClinicalExperienceList.tsx
git commit -m "feat: add mobile card list for clinical experience page"
```

---

## Task 6: 开方 PrescriptionModal 移动端药物垂直堆叠

**Files:**
- Modify: `web/src/components/PrescriptionModal.tsx`

- [ ] **Step 1: 提取 renderStockHint 函数**

将 `herbColumns` 中药名列的库存提示逻辑提取为独立函数，供桌面端列和移动端卡片共用:

```tsx
const renderStockHint = (row: HerbRow) => {
  const inv = inventoryMap[row.herb_name?.trim()];
  const unit = inv ? (inv.category === 'herb' ? '克' : '盒') : '';
  const totalDoses = watchedTotalDoses || 7;
  const dosageNum = row.dosage ? Number(row.dosage) || 0 : 0;
  const needed = totalDoses * dosageNum;

  if (!row.herb_name?.trim()) return null;

  if (inv) {
    if (needed > 0) {
      return inv.stock < needed
        ? <span style={{ fontSize: 11, color: '#ff4d4f' }}>库存不足: 需{needed}{unit}, 库存{inv.stock}{unit}</span>
        : <span style={{ fontSize: 11, color: '#52c41a' }}>库存充足: 需{needed}{unit}, 库存{inv.stock}{unit}</span>;
    }
    return <span style={{ fontSize: 11, color: '#999' }}>库存: {inv.stock}{unit}</span>;
  }
  return <span style={{ fontSize: 11, color: '#999' }}>未录入库存</span>;
};
```

然后在桌面端 `herbColumns` 的药名列 render 中调用 `renderStockHint(record)` 替换原有内联逻辑。

- [ ] **Step 2: 添加移动端药物垂直堆叠渲染**

将药物列表区域 `<Table ...>` 替换为条件渲染:

```tsx
{isMobile ? (
  <div>
    {herbRows.map((row) => {
      const stockHint = renderStockHint(row);
      return (
        <div key={row.key} style={{ background: '#fafafa', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <Input
              value={row.herb_name}
              onChange={(e) => updateHerbRow(row.key, 'herb_name', e.target.value)}
              placeholder="药名"
              style={{ flex: 1 }}
            />
            <Button
              type="text"
              size="small"
              icon={<InfoCircleOutlined />}
              onClick={() => { if (row.herb_name.trim()) { setHerbDetailName(row.herb_name.trim()); setHerbDetailOpen(true); } }}
              disabled={!row.herb_name.trim()}
            />
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => removeHerbRow(row.key)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Space.Compact style={{ width: 110, flexShrink: 0 }}>
              <InputNumber
                value={row.dosage ? Number(row.dosage) || undefined : undefined}
                onChange={(val) => updateHerbRow(row.key, 'dosage', val != null ? String(val) : '')}
                placeholder="用量"
                min={0}
                max={999}
                style={{ width: 70 }}
              />
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 6px', background: '#fafafa', border: '1px solid #d9d9d9', borderLeft: 'none', borderRadius: '0 6px 6px 0', color: '#666', fontSize: 13 }}>克</span>
            </Space.Compact>
            <Input
              value={row.notes}
              onChange={(e) => updateHerbRow(row.key, 'notes', e.target.value)}
              placeholder="先煎/后下等"
              style={{ flex: 1 }}
            />
          </div>
          {stockHint && <div style={{ marginTop: 4 }}>{stockHint}</div>}
        </div>
      );
    })}
    <Button type="dashed" block icon={<PlusOutlined />} onClick={addHerbRow} style={{ marginTop: 4 }}>
      添加药物
    </Button>
  </div>
) : (
  <Table ... /> // 桌面端不变
)}
```

- [ ] **Step 3: 同时更新"添加药物"按钮位置**

桌面端的"添加药物"按钮在 Table 上方 header 中。移动端改为在卡片列表下方全宽按钮。需要将桌面端 header 区域的按钮也放在条件渲染中:

```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
  <strong>药物列表</strong>
  {!isMobile && (
    <Button type="dashed" icon={<PlusOutlined />} onClick={addHerbRow} size="small">添加药物</Button>
  )}
</div>
```

- [ ] **Step 4: 验证构建**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PrescriptionModal.tsx
git commit -m "feat: add mobile vertical stacked herb list for prescription modal"
```

---

## Task 7: 五运六气 WuyunLiuqi 移动端纵向堆叠

**Files:**
- Modify: `web/src/pages/wuyun/WuyunLiuqi.tsx`

- [ ] **Step 1: 添加 useIsMobile 导入和调用**

```tsx
import useIsMobile from '../../hooks/useIsMobile';
// 在组件内 useAuth() 后:
const isMobile = useIsMobile();
```

- [ ] **Step 2: 改造 Header 区域为条件渲染**

将现有 Header div (第156-186行) 替换为:

```tsx
{/* Header */}
{isMobile ? (
  <div style={{ marginBottom: 16 }}>
    <Title level={4} style={{ margin: '0 0 8px' }}>五运六气</Title>
    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      <InputNumber min={1} max={9999} value={year} onChange={handleYearChange} style={{ flex: 1 }} disabled={streaming} />
      <Button type="primary" icon={<SearchOutlined />} onClick={() => handleQuery(false)} loading={streaming}>
        查询
      </Button>
      {streaming && <Button onClick={handleCancel}>取消</Button>}
    </div>
    {isAdmin && !streaming && (
      <Button icon={<ReloadOutlined />} onClick={() => handleQuery(true)} size="small" block style={{ marginBottom: 4 }}>
        强制重新查询
      </Button>
    )}
  </div>
) : (
  <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
    {/* 桌面端保持原样 */}
    <Title level={4} style={{ margin: 0 }}>五运六气</Title>
    <InputNumber min={1} max={9999} value={year} onChange={handleYearChange} style={{ width: 120 }} disabled={streaming} />
    <Button type="primary" icon={<SearchOutlined />} onClick={() => handleQuery(false)} loading={streaming}>查询</Button>
    {streaming && <Button onClick={handleCancel}>取消</Button>}
    {isAdmin && !streaming && (
      <Button icon={<ReloadOutlined />} onClick={() => handleQuery(true)} disabled={streaming}>强制重新查询</Button>
    )}
  </div>
)}
```

- [ ] **Step 3: 改造状态标签行为条件渲染**

将现有状态标签行 (第189-211行) 替换为:

```tsx
{record && !editing && (
  isMobile ? (
    <div style={{ marginBottom: 12 }}>
      <div style={{ marginBottom: 4 }}>
        <Tag color={record.source === 'ai' ? 'blue' : 'green'}>
          {record.source === 'ai' ? 'AI 生成' : '手动编辑'}
        </Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          更新: {new Date(record.updated_at).toLocaleString('zh-CN')}
        </Text>
      </div>
      {isAdmin && (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={handleEdit}>编辑</Button>
          <Popconfirm title="确认删除？" description="删除后需重新查询 AI 获取数据" onConfirm={handleDelete} okText="确认" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )}
    </div>
  ) : (
    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* 桌面端保持原样 */}
      <Tag color={record.source === 'ai' ? 'blue' : 'green'}>
        {record.source === 'ai' ? 'AI 生成' : '手动编辑'}
      </Tag>
      <Text type="secondary" style={{ fontSize: 12 }}>
        更新时间: {new Date(record.updated_at).toLocaleString('zh-CN')}
      </Text>
      {isAdmin && (
        <Space size="small" style={{ marginLeft: 'auto' }}>
          <Button size="small" icon={<EditOutlined />} onClick={handleEdit}>编辑</Button>
          <Popconfirm title="确认删除？" description="删除后需重新查询 AI 获取数据" onConfirm={handleDelete} okText="确认" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )}
    </div>
  )
)}
```

- [ ] **Step 4: Markdown 内容区域添加 isMobile 字号**

修改内容显示 div 的 style:

```tsx
style={{
  fontSize: isMobile ? 13 : 14,
  lineHeight: 1.8,
  color: '#333',
}}
```

- [ ] **Step 5: 验证构建**

Run: `cd web && npm run build`
Expected: 构建成功

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/wuyun/WuyunLiuqi.tsx
git commit -m "feat: add mobile responsive layout for wuyun liuqi page"
```

---

## Task 8: 最终验证与部署

**Files:** 全部已改文件

- [ ] **Step 1: 完整构建验证**

Run: `cd web && npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 2: 部署到 Docker 容器**

```bash
cd web && npm run build && docker cp dist/. menzhen-web-1:/usr/share/nginx/html/ && docker exec menzhen-nginx-1 nginx -s reload
```

- [ ] **Step 3: 在手机或 DevTools 移动端模式验证各页面**

检查项:
- [ ] 中药查询: 卡片列表 + 展开 + 编辑 + 分页
- [ ] 方剂查询: 卡片列表 + 组成展开 + 编辑 + 分页
- [ ] 脉象: 卡片列表 + 展开 + 编辑 + 分页
- [ ] 临床经验集: 卡片列表 + Modal 编辑 + 分页
- [ ] 开方: 药物垂直堆叠 + 库存提示 + 添加/删除
- [ ] 五运六气: 纵向布局 + AI查询 + 编辑/删除
- [ ] 桌面端: 以上所有页面无变化

- [ ] **Step 4: 更新文档**

更新 `docs/codebase.md` 和 `CLAUDE.md`（如需要记录移动端适配模式）。

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "docs: update codebase docs for TCM mobile UI optimization"
```
