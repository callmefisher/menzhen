# 方剂查询界面增强 - 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 方剂名和药物名可编辑，点击药物名弹出中药详情；处方弹窗中也支持查看药物详情。

**Architecture:** 新建通用 HerbDetailModal 组件，在 FormulaSearch 和 PrescriptionModal 中复用。后端新增方剂名更新 API。

**Tech Stack:** React + TypeScript + Ant Design 6 (前端), Go + Gin + GORM (后端)

---

### Task 1: 后端 - FormulaService 新增 UpdateName 方法

**Files:**
- Modify: `server/service/formula.go:84` (在 UpdateComposition 方法后新增)

**Step 1: 实现 UpdateName 方法**

在 `server/service/formula.go` 中 `UpdateComposition` 方法后添加：

```go
// UpdateName updates the name of a formula by ID.
func (s *FormulaService) UpdateName(id uint64, name string) error {
	var formula model.Formula
	if err := s.DB.First(&formula, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrFormulaNotFound
		}
		return err
	}
	return s.DB.Model(&formula).Update("name", name).Error
}
```

**Step 2: 验证编译通过**

Run: `cd server && go build ./...`
Expected: 编译成功，无错误

**Step 3: Commit**

```bash
git add server/service/formula.go
git commit -m "feat: add UpdateName method to FormulaService"
```

---

### Task 2: 后端 - FormulaHandler 新增 UpdateName handler

**Files:**
- Modify: `server/handler/formula.go:100` (在 UpdateComposition 方法后新增)

**Step 1: 实现 UpdateName handler**

在 `server/handler/formula.go` 中 `UpdateComposition` 方法后添加：

```go
// UpdateName handles PUT /api/v1/formulas/:id/name
func (h *FormulaHandler) UpdateName(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		Error(c, http.StatusBadRequest, "invalid formula id")
		return
	}

	var req struct {
		Name string `json:"name" binding:"required,max=100"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "invalid request body: name is required and max 100 chars")
		return
	}

	svc := service.NewFormulaService(h.db, h.deepSeek)
	if err := svc.UpdateName(id, req.Name); err != nil {
		if errors.Is(err, service.ErrFormulaNotFound) {
			Error(c, http.StatusNotFound, "formula not found")
			return
		}
		Error(c, http.StatusInternalServerError, "failed to update formula name")
		return
	}

	Success(c, nil)
}
```

**Step 2: 验证编译通过**

Run: `cd server && go build ./...`
Expected: 编译成功

---

### Task 3: 后端 - 注册路由

**Files:**
- Modify: `server/router/router.go:153` (在 formulas 路由组中新增一行)

**Step 1: 添加路由**

在 `server/router/router.go` 第 153 行（`formulas.PUT("/:id/composition", ...)`）之后添加：

```go
formulas.PUT("/:id/name", middleware.RequirePermission(db, "role:manage"), formulaHandler.UpdateName)
```

**Step 2: 验证编译通过**

Run: `cd server && go build ./...`
Expected: 编译成功

**Step 3: Commit**

```bash
git add server/handler/formula.go server/router/router.go
git commit -m "feat: add PUT /formulas/:id/name API endpoint"
```

---

### Task 4: 前端 - 新增 updateFormulaName API

**Files:**
- Modify: `web/src/api/formula.ts` (末尾新增)

**Step 1: 添加 API 函数**

在 `web/src/api/formula.ts` 末尾追加：

```typescript
export function updateFormulaName(id: number, name: string) {
  return request.put(`/formulas/${id}/name`, { name });
}
```

**Step 2: 验证 TypeScript 编译通过**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add web/src/api/formula.ts
git commit -m "feat: add updateFormulaName frontend API"
```

---

### Task 5: 前端 - 创建 HerbDetailModal 组件

**Files:**
- Create: `web/src/components/HerbDetailModal.tsx`

**Step 1: 实现 HerbDetailModal**

创建 `web/src/components/HerbDetailModal.tsx`：

```tsx
import { useState, useEffect } from 'react';
import { Modal, Spin, Descriptions, Tag, Empty } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { listHerbs } from '../api/herb';
import type { HerbItem } from '../api/herb';

interface HerbDetailModalProps {
  open: boolean;
  herbName: string;
  onClose: () => void;
}

export default function HerbDetailModal({ open, herbName, onClose }: HerbDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [herb, setHerb] = useState<HerbItem | null>(null);

  useEffect(() => {
    if (!open || !herbName) return;
    setLoading(true);
    setHerb(null);
    listHerbs({ name: herbName, page: 1, size: 10 })
      .then((res) => {
        const body = res as unknown as { data: { list: HerbItem[]; total: number } };
        const list = body.data.list || [];
        // 精确匹配优先，否则取第一个
        const exact = list.find((h) => h.name === herbName);
        setHerb(exact || list[0] || null);
      })
      .catch(() => {
        setHerb(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, herbName]);

  return (
    <Modal
      title={`${herbName} - 中药详情`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin tip="查询中..." />
        </div>
      ) : herb ? (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="药名">{herb.name}</Descriptions.Item>
          <Descriptions.Item label="别名">{herb.alias || '无'}</Descriptions.Item>
          <Descriptions.Item label="分类">{herb.category || '无'}</Descriptions.Item>
          <Descriptions.Item label="性味归经">{herb.properties || '无'}</Descriptions.Item>
          <Descriptions.Item label="功效">{herb.effects || '无'}</Descriptions.Item>
          <Descriptions.Item label="主治">{herb.indications || '无'}</Descriptions.Item>
          <Descriptions.Item label="来源">
            {herb.source === 'deepseek' ? (
              <Tag icon={<RobotOutlined />} color="blue">
                DeepSeek AI（仅供参考）
              </Tag>
            ) : (
              <Tag color="green">本地</Tag>
            )}
          </Descriptions.Item>
        </Descriptions>
      ) : (
        <Empty description={`未找到「${herbName}」的详细信息`} />
      )}
    </Modal>
  );
}
```

**Step 2: 验证 TypeScript 编译通过**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

**Step 3: Commit**

```bash
git add web/src/components/HerbDetailModal.tsx
git commit -m "feat: create reusable HerbDetailModal component"
```

---

### Task 6: 前端 - FormulaSearch 方剂名可编辑

**Files:**
- Modify: `web/src/pages/formulas/FormulaSearch.tsx`

**Step 1: 添加 import 和状态**

在文件顶部 import 中：
- 添加 `updateFormulaName` 到 formula API import
- 添加 `InfoCircleOutlined` 到 icons import

新增状态：
```tsx
// 方剂名编辑状态
const [editingNameId, setEditingNameId] = useState<number | null>(null);
const [editingNameValue, setEditingNameValue] = useState('');
```

**Step 2: 添加方剂名保存逻辑**

```tsx
const handleSaveName = async (id: number) => {
  const trimmed = editingNameValue.trim();
  if (!trimmed) {
    message.warning('方剂名不能为空');
    return;
  }
  try {
    await updateFormulaName(id, trimmed);
    message.success('方剂名更新成功');
    fetchFormulas(searchName, page, size);
  } catch {
    // Error handled by interceptor
  } finally {
    setEditingNameId(null);
  }
};
```

**Step 3: 修改方剂名列渲染**

将 columns 中方剂名列（第 112-118 行）替换为：

```tsx
{
  title: '方剂名',
  dataIndex: 'name',
  key: 'name',
  width: 150,
  render: (name: string, record: FormulaItem) => {
    if (hasPermission('role:manage') && editingNameId === record.id) {
      return (
        <Input
          size="small"
          value={editingNameValue}
          onChange={(e) => setEditingNameValue(e.target.value)}
          onBlur={() => handleSaveName(record.id)}
          onPressEnter={() => handleSaveName(record.id)}
          autoFocus
        />
      );
    }
    return hasPermission('role:manage') ? (
      <a onClick={() => { setEditingNameId(record.id); setEditingNameValue(name); }}>
        {name}
      </a>
    ) : (
      name
    );
  },
},
```

**Step 4: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

**Step 5: Commit**

```bash
git add web/src/pages/formulas/FormulaSearch.tsx web/src/api/formula.ts
git commit -m "feat: make formula name editable in search table"
```

---

### Task 7: 前端 - FormulaSearch 展开行药物可编辑 + 查看详情

**Files:**
- Modify: `web/src/pages/formulas/FormulaSearch.tsx`

**Step 1: 添加 HerbDetailModal import 和状态**

```tsx
import HerbDetailModal from '../../components/HerbDetailModal';

// Herb detail modal state
const [herbDetailOpen, setHerbDetailOpen] = useState(false);
const [herbDetailName, setHerbDetailName] = useState('');

// Inline composition edit state (per expanded row)
const [inlineEditId, setInlineEditId] = useState<number | null>(null);
const [inlineComposition, setInlineComposition] = useState<FormulaCompositionItem[]>([]);
const [inlineSaving, setInlineSaving] = useState(false);
```

**Step 2: 添加内联编辑逻辑**

```tsx
const startInlineEdit = (record: FormulaItem) => {
  setInlineEditId(record.id);
  setInlineComposition((record.composition || []).map((c) => ({ ...c })));
};

const updateInlineRow = (index: number, field: keyof FormulaCompositionItem, value: string) => {
  setInlineComposition(
    inlineComposition.map((item, i) => (i === index ? { ...item, [field]: value } : item))
  );
};

const addInlineRow = () => {
  setInlineComposition([...inlineComposition, { herb_name: '', default_dosage: '' }]);
};

const removeInlineRow = (index: number) => {
  setInlineComposition(inlineComposition.filter((_, i) => i !== index));
};

const handleSaveInline = async () => {
  if (inlineEditId === null) return;
  const valid = inlineComposition.filter((c) => c.herb_name.trim() !== '');
  if (valid.length === 0) {
    message.warning('请至少添加一味药物');
    return;
  }
  setInlineSaving(true);
  try {
    await updateFormulaComposition(inlineEditId, valid);
    message.success('组成更新成功');
    setInlineEditId(null);
    fetchFormulas(searchName, page, size);
  } catch {
    // Error handled by interceptor
  } finally {
    setInlineSaving(false);
  }
};

const openHerbDetail = (herbName: string) => {
  if (!herbName.trim()) return;
  setHerbDetailName(herbName.trim());
  setHerbDetailOpen(true);
};
```

**Step 3: 重写 expandedRowRender**

替换 `expandable.expandedRowRender`（第 247-287 行）中的组成表格部分。当管理员点击"编辑组成"时，表格变为可编辑模式；药物名旁有查看详情按钮（所有用户可用）。

展开行中的组成表格列定义：

```tsx
expandedRowRender: (record) => {
  const isEditing = hasPermission('role:manage') && inlineEditId === record.id;
  const comp = isEditing ? inlineComposition : (record.composition || []);

  return (
    <div style={{ padding: '8px 0' }}>
      <p><strong>功效：</strong>{record.effects || '无'}</p>
      <p><strong>主治：</strong>{record.indications || '无'}</p>
      <p><strong>组成：</strong></p>
      {comp.length > 0 || isEditing ? (
        <Table
          dataSource={comp.map((c: FormulaCompositionItem, idx: number) => ({ ...c, key: idx }))}
          columns={[
            {
              title: '药物',
              dataIndex: 'herb_name',
              key: 'herb_name',
              render: (_: unknown, _rec: FormulaCompositionItem & { key: number }, index: number) => (
                <Space>
                  {isEditing ? (
                    <Input
                      size="small"
                      value={inlineComposition[index]?.herb_name}
                      onChange={(e) => updateInlineRow(index, 'herb_name', e.target.value)}
                      placeholder="药名"
                    />
                  ) : (
                    <span>{(record.composition || [])[index]?.herb_name}</span>
                  )}
                  <Button
                    type="text"
                    size="small"
                    icon={<InfoCircleOutlined />}
                    onClick={() => openHerbDetail(
                      isEditing
                        ? (inlineComposition[index]?.herb_name || '')
                        : ((record.composition || [])[index]?.herb_name || '')
                    )}
                  />
                </Space>
              ),
            },
            {
              title: '用量',
              dataIndex: 'default_dosage',
              key: 'default_dosage',
              width: 150,
              render: isEditing
                ? (_: unknown, _rec: FormulaCompositionItem & { key: number }, index: number) => (
                    <Input
                      size="small"
                      value={inlineComposition[index]?.default_dosage}
                      onChange={(e) => updateInlineRow(index, 'default_dosage', e.target.value)}
                      placeholder="如 10g"
                    />
                  )
                : undefined,
            },
            ...(isEditing
              ? [
                  {
                    title: '操作',
                    key: 'action',
                    width: 60,
                    render: (_: unknown, _rec: FormulaCompositionItem & { key: number }, index: number) => (
                      <Button
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        onClick={() => removeInlineRow(index)}
                        size="small"
                      />
                    ),
                  },
                ]
              : []),
          ]}
          pagination={false}
          size="small"
          bordered
        />
      ) : (
        <span>无组成信息</span>
      )}
      <Space style={{ marginTop: 8 }}>
        {record.source === 'deepseek' && (
          <Tag icon={<RobotOutlined />} color="blue">
            数据来源：DeepSeek AI（仅供参考，请结合临床经验）
          </Tag>
        )}
        {hasPermission('role:manage') && !isEditing && (
          <Button
            type="primary"
            size="small"
            icon={<EditOutlined />}
            onClick={() => startInlineEdit(record)}
          >
            编辑组成
          </Button>
        )}
        {isEditing && (
          <>
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addInlineRow}>
              添加药物
            </Button>
            <Button type="primary" size="small" loading={inlineSaving} onClick={handleSaveInline}>
              保存
            </Button>
            <Button size="small" onClick={() => setInlineEditId(null)}>
              取消
            </Button>
          </>
        )}
      </Space>
    </div>
  );
},
```

**Step 4: 在组件 return 最外层 div 末尾（Modal 后）添加 HerbDetailModal**

```tsx
<HerbDetailModal
  open={herbDetailOpen}
  herbName={herbDetailName}
  onClose={() => setHerbDetailOpen(false)}
/>
```

**Step 5: 删除旧的编辑 Modal**

删除原有的编辑 Modal（第 291-317 行）及其相关状态（`editModalOpen`, `editFormulaId`, `editFormulaName`, `editComposition`, `saving`）和方法（`openEditModal`, `addRow`, `removeRow`, `updateRow`, `handleSaveComposition`, `editColumns`），因为已被内联编辑替代。

**Step 6: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

**Step 7: Commit**

```bash
git add web/src/pages/formulas/FormulaSearch.tsx web/src/components/HerbDetailModal.tsx
git commit -m "feat: inline herb editing and detail modal in formula search"
```

---

### Task 8: 前端 - PrescriptionModal 药物名增加查看详情

**Files:**
- Modify: `web/src/components/PrescriptionModal.tsx`

**Step 1: 添加 import 和状态**

```tsx
import { InfoCircleOutlined } from '@ant-design/icons';
import HerbDetailModal from './HerbDetailModal';

// 在组件内新增状态
const [herbDetailOpen, setHerbDetailOpen] = useState(false);
const [herbDetailName, setHerbDetailName] = useState('');
```

**Step 2: 修改 herbColumns 中的药名列**

将第 174-186 行的药名列渲染替换为：

```tsx
{
  title: '药名',
  dataIndex: 'herb_name',
  key: 'herb_name',
  render: (_: string, record: HerbRow) => (
    <Space>
      <Input
        value={record.herb_name}
        onChange={(e) => updateHerbRow(record.key, 'herb_name', e.target.value)}
        placeholder="药名"
      />
      <Button
        type="text"
        size="small"
        icon={<InfoCircleOutlined />}
        onClick={() => {
          if (record.herb_name.trim()) {
            setHerbDetailName(record.herb_name.trim());
            setHerbDetailOpen(true);
          }
        }}
        disabled={!record.herb_name.trim()}
      />
    </Space>
  ),
},
```

**Step 3: 在 Modal 组件内末尾（</Modal> 前）添加 HerbDetailModal**

```tsx
<HerbDetailModal
  open={herbDetailOpen}
  herbName={herbDetailName}
  onClose={() => setHerbDetailOpen(false)}
/>
```

**Step 4: 验证编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

**Step 5: Commit**

```bash
git add web/src/components/PrescriptionModal.tsx
git commit -m "feat: add herb detail lookup in prescription modal"
```

---

### Task 9: 运行测试并修复

**Step 1: 运行后端测试**

Run: `cd server && go test ./...`
Expected: 全部通过

**Step 2: 运行前端测试**

Run: `cd web && npm run test -- --run`
Expected: 全部通过。如有因新 import 导致的 mock 缺失，需更新测试文件中的 mock。

**Step 3: 构建前端**

Run: `cd web && npm run build`
Expected: 构建成功

**Step 4: Commit (如有修复)**

```bash
git add -A
git commit -m "fix: update tests for formula herb detail features"
```

---

### Task 10: 更新 codebase 文档

**Files:**
- Modify: `docs/codebase.md` (如存在，新增 HerbDetailModal 组件说明和新 API 路由)
- Modify: `CLAUDE.md` (API 路由表中新增 PUT /formulas/:id/name)

**Step 1: 更新文档**

在 CLAUDE.md 的中医药 API 路由表中添加：

```
| PUT | `/api/v1/formulas/:id/name` | role:manage | 更新方剂名称 |
```

**Step 2: Commit**

```bash
git add CLAUDE.md docs/codebase.md
git commit -m "docs: update API docs for formula name update endpoint"
```
