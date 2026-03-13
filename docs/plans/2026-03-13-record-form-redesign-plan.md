# 诊疗记录表单 UI 重设计实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 RecordForm.tsx 的布局，从混乱的内联样式改为 4 张卡片分区的清晰布局，统一字段宽度，适配桌面端和移动端。

**Architecture:** 保持现有业务逻辑不变，仅调整 JSX 结构和样式。抽取 SectionCard 和 AiResultCard 两个可复用组件。在 index.css 中添加表单布局 CSS class 替代内联样式。

**Tech Stack:** React 19, Ant Design 6, CSS (global classes in index.css), useIsMobile hook

**Spec:** `docs/plans/2026-03-13-record-form-redesign-design.md`

---

## Chunk 1: 基础组件和样式

### Task 1: 添加表单布局 CSS classes

**Files:**
- Modify: `web/src/index.css`

- [ ] **Step 1: 在 index.css 末尾添加表单布局样式**

```css
/* ===== Record Form Section Card Layout ===== */
.section-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.section-card-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-card-icon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  flex-shrink: 0;
}

.form-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.form-row:last-child {
  margin-bottom: 0;
}

/* AI Result Card - unified style for tongue & diagnosis */
.ai-result-card {
  border-radius: 8px;
  background: linear-gradient(135deg, #f0f7ff 0%, #e8f4f8 50%, #f0f0ff 100%);
  border: 1px solid #d6e4ff;
  overflow: hidden;
}

.ai-result-card-header {
  padding: 10px 16px;
  background: linear-gradient(90deg, #1677ff, #4096ff);
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-weight: 600;
  font-size: 14px;
}

.ai-result-card-body {
  padding: 16px 20px;
  max-height: 400px;
  overflow: auto;
  font-size: 14px;
  line-height: 1.9;
  color: #333;
}

.ai-result-card-footer {
  padding: 8px 16px;
  border-top: 1px dashed #d6e4ff;
  text-align: center;
  font-size: 12px;
  color: #8c8c8c;
  background: rgba(255, 255, 255, 0.6);
}

/* Mobile overrides */
@media (max-width: 768px) {
  .section-card {
    padding: 14px 16px;
    margin-bottom: 8px;
  }

  .form-row {
    flex-direction: column;
    gap: 12px;
  }

  .record-form-actions {
    display: flex;
    gap: 8px;
  }

  .record-form-actions .ant-btn {
    flex: 1;
  }
}
```

- [ ] **Step 2: 验证前端能编译**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add web/src/index.css
git commit -m "feat: add CSS classes for record form section card layout"
```

### Task 2: 重构 RecordForm.tsx — Card 1 基本信息 + Card 2 四诊采集

**Files:**
- Modify: `web/src/pages/records/RecordForm.tsx`

这个 Task 将 RecordForm 的前半部分（患者/日期/主诉/脉象/舌象）用 section-card 包裹，并统一字段宽度。

- [ ] **Step 1: 将外层 Card 改为普通 div，删除 Ant Card 包裹**

将 `<Card title={isEdit ? '编辑诊疗记录' : '新增诊疗记录'}>` 改为：

```tsx
<div>
  <div style={{
    background: '#fff',
    borderRadius: 8,
    padding: '16px 24px',
    marginBottom: 12,
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
    fontSize: 18,
    fontWeight: 600,
  }}>
    {isEdit ? '编辑诊疗记录' : '新增诊疗记录'}
  </div>
```

并将对应的闭合 `</Card>` 改为 `</div>`。

- [ ] **Step 2: 用 section-card 包裹 Card 1 — 基本信息**

将患者选择+日期+主诉这 3 个字段包裹在 section-card 中：

```tsx
{/* Card 1: 基本信息 */}
<div className="section-card">
  <div className="section-card-title">
    <div className="section-card-icon" style={{ background: '#1677ff' }}>i</div>
    基本信息
  </div>

  <div className="form-row" style={{ flexDirection: isMobile ? 'column' : 'row' }}>
    <Form.Item
      label="患者"
      name="patient_id"
      rules={[{ required: true, message: '请选择患者' }]}
      style={{ flex: 1, marginBottom: 0 }}
    >
      {/* Select 内容保持不变 */}
    </Form.Item>

    <Form.Item
      label="就诊日期"
      name="visit_date"
      rules={[{ required: true, message: '请选择就诊日期' }]}
      style={{ width: isMobile ? '100%' : 200, marginBottom: 0 }}
    >
      <DatePicker style={{ width: '100%' }} />
    </Form.Item>
  </div>

  <div style={{ marginTop: 16 }}>
    <Form.Item label="主诉" name="chief_complaint" style={{ marginBottom: 0 }}>
      <Input.TextArea rows={2} placeholder="请输入主诉（主要症状和持续时间）" />
    </Form.Item>
  </div>
</div>
```

- [ ] **Step 3: 用 section-card 包裹 Card 2 — 四诊采集**

将脉象+舌象区域包裹在第二个 section-card 中：

```tsx
{/* Card 2: 四诊采集 */}
<div className="section-card">
  <div className="section-card-title">
    <div className="section-card-icon" style={{ background: '#52c41a' }}>四</div>
    四诊采集
  </div>

  {/* 脉象 - 保持现有 Select + pulse detail 逻辑不变 */}
  <Form.Item label="脉象" name="pulse_id" style={{ marginBottom: selectedPulse ? 8 : 16 }}>
    {/* Select 内容保持不变 */}
  </Form.Item>
  <Form.Item name="pulse_name" hidden><Input /></Form.Item>
  {selectedPulse && (
    <div style={{ /* 保持现有 pulse detail 样式 */ }}>
      {/* 内容保持不变 */}
    </div>
  )}

  {/* 舌象 */}
  <div className="form-row" style={{ flexDirection: isMobile ? 'column' : 'row', alignItems: 'flex-start', marginBottom: 0 }}>
    <div style={{ width: isMobile ? '100%' : 160, flexShrink: 0 }}>
      {/* 舌象图片 - 保持现有逻辑不变 */}
    </div>
    <div style={{ flex: 1 }}>
      {/* 舌象描述 - 保持现有逻辑不变 */}
    </div>
  </div>

  {/* 舌象 AI 分析结果 - 改用统一的 ai-result-card 样式 */}
  {tongueResult && (
    <div className="ai-result-card" style={{ marginTop: 12 }}>
      <div className="ai-result-card-header">
        <RobotOutlined style={{ fontSize: 16 }} />
        <span>舌象 AI 分析结果</span>
      </div>
      <div className="ai-result-card-body">
        <div className="ai-analysis-content">
          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {tongueResult}
          </Markdown>
        </div>
      </div>
      <div className="ai-result-card-footer">
        以上分析由 AI 生成，仅供参考
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 4: 验证前端能编译**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/records/RecordForm.tsx
git commit -m "feat: wrap record form top section in Card 1 & Card 2 section cards"
```

### Task 3: 重构 RecordForm.tsx — Card 3 诊断治疗 + Card 4 备注附件

**Files:**
- Modify: `web/src/pages/records/RecordForm.tsx`

- [ ] **Step 1: Card 3 — 诊断治疗改为上下堆叠**

将现有的诊断+治疗并排布局改为上下堆叠，包裹在 section-card 中：

```tsx
{/* Card 3: 诊断治疗 */}
<div className="section-card">
  <div className="section-card-title">
    <div className="section-card-icon" style={{ background: '#fa8c16' }}>诊</div>
    诊断治疗
  </div>

  <Form.Item
    label={
      <Space wrap>
        <span>诊断</span>
        <Button type="primary" ghost size="small" icon={<RobotOutlined />}
          loading={aiAnalyzing} onClick={() => handleAiAnalysis()}>
          AI辅助分析
        </Button>
        {aiResult && !aiDrawerOpen && (
          <Tooltip title="已有分析结果，点击查看">
            <Tag color="green" style={{ cursor: 'pointer' }} onClick={() => setAiDrawerOpen(true)}>
              已有分析
            </Tag>
          </Tooltip>
        )}
      </Space>
    }
    name="diagnosis"
  >
    <Input.TextArea rows={isMobile ? 12 : 20} placeholder="请输入诊断内容" />
  </Form.Item>

  <Form.Item label="治疗方案" name="treatment" style={{ marginBottom: 0 }}>
    <Input.TextArea rows={isMobile ? 4 : 6} placeholder="请输入治疗方案" />
  </Form.Item>
</div>
```

注意：删除原来包裹诊断+治疗的 `<div style={{ display: 'flex', gap: 16, ... }}>` 外层。

- [ ] **Step 2: Card 4 — 备注附件**

将现有的 Divider + 备注/附件改为 section-card：

```tsx
{/* Card 4: 备注附件 */}
<div className="section-card">
  <div className="section-card-title">
    <div className="section-card-icon" style={{ background: '#8c8c8c' }}>+</div>
    备注附件
  </div>

  <div className="form-row" style={{ flexDirection: isMobile ? 'column' : 'row', alignItems: 'flex-start' }}>
    <Form.Item label="备注" name="notes" style={{ flex: 1, marginBottom: 0 }}>
      <Input.TextArea rows={4} placeholder="请输入备注" style={{ resize: 'none' }} />
    </Form.Item>

    <Form.Item label="附件上传" name="attachments" style={{ flex: 1, marginBottom: 0 }}>
      <FileUpload />
    </Form.Item>
  </div>
</div>
```

注意：删除原有的 `<Divider style={{ margin: '8px 0 16px' }} />` 和 `<div style={{ height: 24 }} />`。

- [ ] **Step 3: 调整操作按钮区域**

```tsx
{/* 按钮 */}
<Form.Item style={{ marginTop: 8 }}>
  <div className={isMobile ? 'record-form-actions' : undefined}>
    <Space>
      <Button type="primary" htmlType="submit" loading={submitting}>
        保存
      </Button>
      {hasPermission('prescription:create') && (
        <Button type="primary" ghost icon={<PlusOutlined />}
          onClick={/* 保持现有逻辑不变 */}
          loading={submitting}>
          开方
        </Button>
      )}
      {!isMobile && (
        <Button onClick={() => navigate('/records')}>取消</Button>
      )}
    </Space>
  </div>
</Form.Item>
```

- [ ] **Step 4: 验证前端能编译**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/records/RecordForm.tsx
git commit -m "feat: wrap diagnosis/treatment/notes in Card 3 & Card 4 section cards"
```

## Chunk 2: 样式统一和部署验证

### Task 4: 统一舌象 AI 分析结果的内联样式为 CSS class

**Files:**
- Modify: `web/src/pages/records/RecordForm.tsx`

- [ ] **Step 1: 替换舌象 AI 分析结果的内联样式**

在 Task 2 Step 3 中已将舌象分析结果改为使用 `ai-result-card` CSS class。此步骤验证替换是否完整：
- 删除舌象分析区域所有内联 `style` 对象（gradient background、padding、border 等）
- 确认只使用 `className="ai-result-card"` / `ai-result-card-header` / `ai-result-card-body` / `ai-result-card-footer`

- [ ] **Step 2: 检查备注 TextArea 行数从 6 改为 4**

确认 notes 字段：`<Input.TextArea rows={4} ...`（从原来的 6 行减少到 4 行）

- [ ] **Step 3: 验证前端能编译**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/records/RecordForm.tsx
git commit -m "refactor: unify AI result card styles and clean up inline styles"
```

### Task 5: 构建 + 部署到 Docker 容器验证

**Files:** 无代码修改

- [ ] **Step 1: 构建前端**

Run: `cd /Users/xiayanji/qbox/menzhen/web && npm run build`
Expected: 构建成功

- [ ] **Step 2: 部署到 Docker 容器**

```bash
docker cp /Users/xiayanji/qbox/menzhen/web/dist/. menzhen-web-1:/usr/share/nginx/html/
docker exec menzhen-nginx-1 nginx -s reload
```

- [ ] **Step 3: 通知用户验证**

告知用户在 http://localhost 访问，检查诊疗记录新增/编辑页面的桌面端和移动端布局。

### Task 6: 更新文档

**Files:**
- Modify: `docs/codebase.md` — 更新 RecordForm 相关描述
- Modify: `CLAUDE.md` — 如有新经验教训则追加

- [ ] **Step 1: 更新 codebase.md 中关于 RecordForm 的描述**

添加或更新关于 RecordForm 使用 4 张 section-card 分区布局的描述。

- [ ] **Step 2: Commit**

```bash
git add docs/codebase.md CLAUDE.md
git commit -m "docs: update codebase docs for record form redesign"
```
