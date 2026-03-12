# 诊疗记录增强设计：主诉、脉象、舌象

> 日期：2026-03-12
> 状态：设计确认

## 需求概述

1. 诊疗记录页面新增 3 个字段：主诉、脉象（联动脉象知识库 + DeepSeek 回退）、舌象（图片上传 + AI 文字分析）
2. 诊疗内容模版前置患者信息：性别、年龄、出生年月、主诉、脉象（动态自动填充）

## 数据模型变更

### `medical_records` 表新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `chief_complaint` | text | 主诉 |
| `pulse_id` | uint64, nullable | FK → pulses.id |
| `pulse_name` | varchar(100) | 冗余脉象名称（展示/查询用） |
| `tongue_image` | varchar(500) | 舌象图片 MinIO key |
| `tongue_description` | text | 舌象文字描述（用户输入） |
| `tongue_analysis` | text | DeepSeek 舌象分析结果（缓存） |

### Go Model 修改

```go
type MedicalRecord struct {
    // ... existing fields ...
    ChiefComplaint    string  `gorm:"column:chief_complaint;type:text"`
    PulseID           *uint64 `gorm:"column:pulse_id;index"`
    PulseName         string  `gorm:"column:pulse_name;type:varchar(100)"`
    TongueImage       string  `gorm:"column:tongue_image;type:varchar(500)"`
    TongueDescription string  `gorm:"column:tongue_description;type:text"`
    TongueAnalysis    string  `gorm:"column:tongue_analysis;type:text"`

    Pulse *Pulse `gorm:"foreignKey:PulseID"` // 关联脉象
}
```

GORM AutoMigrate 自动加字段，无需手动迁移脚本。

## 后端 API 变更

### 1. 诊疗记录 CRUD（修改现有）

`CreateRecordRequest` / `UpdateRecordRequest` 新增：

```go
ChiefComplaint    string  // 主诉
PulseID           *uint64 // 脉象ID
PulseName         string  // 脉象名称
TongueImage       string  // 舌象图片路径
TongueDescription string  // 舌象描述
TongueAnalysis    string  // 舌象分析结果
```

`RecordListItem` 新增 `ChiefComplaint` 和 `PulseName`。

### 2. 脉象搜索增强（修改 PulseService.Search）

当搜索无结果 + 有 name 参数 + DeepSeek 可用时：
1. 调用 `DeepSeekService.QueryPulse(name)` → 返回 JSON
2. 验证结果有效 → 自动存入 pulses 表
3. 响应标记 `source: "deepseek"`

参照 `HerbService.Search()` 的 fallback 模式。

### 3. DeepSeek 新增方法

**`QueryPulse(name string) (*PulseAIResult, error)`**
- 系统 prompt：中医脉学专家，返回 JSON（name, category, description, clinical_meaning, common_conditions）
- 参照 `QueryHerb()` 的 JSON 解析 + markdown code fence strip

**`AnalyzeTongue(description string) (string, error)`**
- 系统 prompt：中医舌诊专家，根据舌象描述进行辨证分析
- 返回 markdown 文本
- 参照 `AnalyzeDiagnosis()` 的实现模式

### 4. 舌象分析 API（新增）

```
POST /api/v1/ai/analyze-tongue
```

请求体：
```json
{
  "description": "舌质淡红，舌苔薄白",
  "record_id": 123,
  "force": false
}
```

缓存逻辑：
- 有 record_id → 查 `medical_records.tongue_analysis`
- 非空且 force=false → 返回缓存
- 否则 → DeepSeek 查询 → 更新 `tongue_analysis` 字段 → 返回

## 前端变更

### RecordForm 表单布局

新增区域位于 visit_date 之后、diagnosis 之前：

```
患者选择  |  就诊日期
──────────────────────
主诉: [多行文本框]
──────────────────────
脉象: [搜索下拉 ▼]  [脉象详情卡片]
      搜索无结果时底部显示 [查询AI] 按钮
      选中后右侧展示：分类、特征描述、临床意义
──────────────────────
舌象:
  [上传图片]          [舌象描述文本框]
                     [分析舌象] 按钮
  AI分析结果 (Markdown, 可折叠)
──────────────────────
诊疗内容 (diagnosis):  ← 模版自动填充
治疗方案 (treatment):
备注 (notes):
附件上传
```

### 脉象搜索下拉交互

1. 输入关键字 → debounce 300ms → `GET /pulses?name=xxx`
2. 下拉展示匹配结果（name + category）
3. 无结果时下拉底部显示"查询 AI"按钮
4. 点击后 loading → 后端自动触发 DeepSeek fallback → 返回结果
5. 选中脉象 → 填充 pulse_id + pulse_name，展示详情卡片

### 舌象区交互

1. 图片上传：复用 FileUpload 组件（限图片，单张）
2. 舌象描述：TextArea 手动输入
3. 分析按钮：调 `POST /ai/analyze-tongue`，loading 状态
4. 分析结果：ReactMarkdown + rehype-raw 渲染，可折叠
5. 编辑模式自动加载缓存结果

### 诊疗内容模版更新

在现有 20 项模版前面插入患者信息区块：

```
性别：{gender}
年龄：{age}岁
出生年月：{birthDate}
主诉：{chief_complaint}
脉象：{pulse_name}
---
1. 大便：
2. 小便：
...（现有20项）
```

动态同步逻辑：
- 选择患者 → 填充性别、年龄、出生年月
- 输入主诉 → 同步到模版主诉行
- 选择脉象 → 同步到模版脉象行
- 使用 `useEffect` 监听字段变化，正则替换对应行

### 前端 API 新增

```typescript
// api/record.ts
analyzeTongue(data: { description: string; record_id?: number; force?: boolean })

// api/pulse.ts (已有，无需修改)
```

### 前端类型更新

```typescript
interface RecordFormValues {
  // existing...
  chief_complaint: string;
  pulse_id?: number;
  pulse_name?: string;
  tongue_image?: string;
  tongue_description?: string;
  tongue_analysis?: string;
}
```

## 影响范围

### 后端文件
- `server/model/medical_record.go` — 新增字段
- `server/service/record.go` — CRUD 处理新字段
- `server/handler/record.go` — 请求/响应新字段
- `server/service/deepseek.go` — 新增 QueryPulse + AnalyzeTongue
- `server/service/pulse.go` — 新增 DeepSeek fallback
- `server/handler/ai_analysis.go` — 新增舌象分析 handler
- `server/router/router.go` — 新增舌象分析路由

### 前端文件
- `web/src/pages/records/RecordForm.tsx` — 主要改动
- `web/src/api/record.ts` — 新增 API 方法
- `web/src/api/pulse.ts` — 可能无需改动

### 不受影响
- RecordList.tsx（可选：列表增加主诉/脉象列）
- 脉象管理页 PulseList.tsx
- 其他模块
