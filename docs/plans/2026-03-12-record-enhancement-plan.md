# 诊疗记录增强实施计划：主诉、脉象、舌象

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在诊疗记录页面新增主诉、脉象（联动脉象库+DeepSeek回退）、舌象（图片+AI分析）三个字段，并让诊疗内容模版动态填充患者信息。

**Architecture:** 后端为 MedicalRecord 模型新增6个字段（GORM AutoMigrate 自动迁移），PulseService 新增 DeepSeek fallback（参照 HerbService），DeepSeekService 新增 QueryPulse + AnalyzeTongue 两个方法。前端 RecordForm 在就诊日期和诊断之间插入主诉/脉象/舌象三个区域，诊疗模版通过 useEffect 动态同步患者信息。

**Tech Stack:** Go/Gin/GORM (后端), React 19/TypeScript/Ant Design 6 (前端), DeepSeek API, MinIO

---

## Chunk 1: 后端数据模型 + 服务层

### Task 1: MedicalRecord 模型新增字段

**Files:**
- Modify: `server/model/medical_record.go`

- [ ] **Step 1: 修改 MedicalRecord 结构体**

在 `CreatedBy` 字段之后、关联字段之前插入新字段：

```go
ChiefComplaint    string  `gorm:"column:chief_complaint;type:text" json:"chief_complaint"`
PulseID           *uint64 `gorm:"column:pulse_id;index" json:"pulse_id"`
PulseName         string  `gorm:"column:pulse_name;type:varchar(100)" json:"pulse_name"`
TongueImage       string  `gorm:"column:tongue_image;type:varchar(500)" json:"tongue_image"`
TongueDescription string  `gorm:"column:tongue_description;type:text" json:"tongue_description"`
TongueAnalysis    string  `gorm:"column:tongue_analysis;type:text" json:"tongue_analysis"`
```

在 Associations 区新增：
```go
Pulse *model.Pulse `gorm:"foreignKey:PulseID" json:"pulse,omitempty"`
```

注意：`PulseID` 用 `*uint64` 允许 null。

- [ ] **Step 2: 验证编译通过**

Run: `cd server && go build ./...`
Expected: 编译成功，无错误

- [ ] **Step 3: 提交**

```bash
git add server/model/medical_record.go
git commit -m "feat: add chief_complaint, pulse, tongue fields to MedicalRecord model"
```

---

### Task 2: RecordService CRUD 支持新字段

**Files:**
- Modify: `server/service/record.go`

- [ ] **Step 1: 修改 CreateRecordRequest**

在 `VisitDate` 和 `Attachments` 之间新增：

```go
ChiefComplaint    string  `json:"chief_complaint"`
PulseID           *uint64 `json:"pulse_id"`
PulseName         string  `json:"pulse_name"`
TongueImage       string  `json:"tongue_image"`
TongueDescription string  `json:"tongue_description"`
```

- [ ] **Step 2: 修改 UpdateRecordRequest**

新增指针字段：

```go
ChiefComplaint    *string  `json:"chief_complaint"`
PulseID           *uint64  `json:"pulse_id"`
PulseName         *string  `json:"pulse_name"`
TongueImage       *string  `json:"tongue_image"`
TongueDescription *string  `json:"tongue_description"`
TongueAnalysis    *string  `json:"tongue_analysis"`
```

- [ ] **Step 3: 修改 RecordListItem**

新增：

```go
ChiefComplaint string `json:"chief_complaint"`
PulseName      string `json:"pulse_name"`
```

- [ ] **Step 4: 修改 CreateRecord 方法**

在构建 `record` 对象时填充新字段：

```go
record := model.MedicalRecord{
    PatientID:         req.PatientID,
    TenantID:          tenantID,
    Diagnosis:         req.Diagnosis,
    Treatment:         req.Treatment,
    Notes:             req.Notes,
    VisitDate:         visitDate,
    CreatedBy:         createdBy,
    ChiefComplaint:    req.ChiefComplaint,
    PulseID:           req.PulseID,
    PulseName:         req.PulseName,
    TongueImage:       req.TongueImage,
    TongueDescription: req.TongueDescription,
}
```

- [ ] **Step 5: 修改 ListRecords 方法的 Select 子句**

在 Select 中追加 `medical_records.chief_complaint, medical_records.pulse_name`：

```go
Select("medical_records.id, medical_records.patient_id, patients.name AS patient_name, patients.age AS patient_age, medical_records.diagnosis, medical_records.chief_complaint, medical_records.pulse_name, DATE_FORMAT(medical_records.visit_date, '%Y-%m-%d') AS visit_date, medical_records.created_at").
```

- [ ] **Step 6: 修改 UpdateRecord 方法的 updates map**

在 `if req.VisitDate != nil` 之后追加：

```go
if req.ChiefComplaint != nil {
    updates["chief_complaint"] = *req.ChiefComplaint
}
if req.PulseID != nil {
    updates["pulse_id"] = *req.PulseID
}
if req.PulseName != nil {
    updates["pulse_name"] = *req.PulseName
}
if req.TongueImage != nil {
    updates["tongue_image"] = *req.TongueImage
}
if req.TongueDescription != nil {
    updates["tongue_description"] = *req.TongueDescription
}
if req.TongueAnalysis != nil {
    updates["tongue_analysis"] = *req.TongueAnalysis
}
```

- [ ] **Step 7: 修改 GetRecord 增加 Preload Pulse**

```go
Preload("Pulse").
```

加在 `Preload("Attachments")` 之后。

- [ ] **Step 8: 验证编译通过**

Run: `cd server && go build ./...`
Expected: 编译成功

- [ ] **Step 9: 提交**

```bash
git add server/service/record.go
git commit -m "feat: extend RecordService CRUD for chief_complaint, pulse, tongue fields"
```

---

### Task 3: DeepSeekService 新增 QueryPulse + AnalyzeTongue

**Files:**
- Modify: `server/service/deepseek.go`

- [ ] **Step 1: 新增 PulseAIResult 类型**

在 `FormulaAIResult` 之后添加：

```go
// PulseAIResult is the parsed result from DeepSeek for pulse queries.
type PulseAIResult struct {
	Name             string `json:"name"`
	Category         string `json:"category"`
	Description      string `json:"description"`
	ClinicalMeaning  string `json:"clinical_meaning"`
	CommonConditions string `json:"common_conditions"`
}
```

- [ ] **Step 2: 新增 QueryPulse 方法**

在 `QueryFormula` 方法之后添加：

```go
// QueryPulse queries DeepSeek for information about a specific pulse type.
func (s *DeepSeekService) QueryPulse(name string) (*PulseAIResult, error) {
	if !s.IsEnabled() {
		return nil, ErrDeepSeekDisabled
	}

	systemPrompt := `你是一个中医脉学数据库助手。用户会查询脉象信息，请以严格的JSON格式返回。
不要返回任何其他文字，只返回JSON。
JSON格式如下:
{
  "name": "脉象名称",
  "category": "分类，如浮脉类、沉脉类、迟脉类、数脉类等",
  "description": "脉象特征描述",
  "clinical_meaning": "临床意义",
  "common_conditions": "常见病症"
}
如果你不确定该脉象信息，请返回你最了解的内容，不要编造。`

	userPrompt := fmt.Sprintf("请提供脉象「%s」的详细信息。", name)

	content, err := s.chat(systemPrompt, userPrompt)
	if err != nil {
		return nil, err
	}

	var result PulseAIResult
	if err := parseJSONFromContent(content, &result); err != nil {
		log.Printf("DeepSeek: failed to parse pulse response: %v, content: %s", err, content)
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}

	if result.Name == "" {
		result.Name = name
	}

	return &result, nil
}
```

- [ ] **Step 3: 新增 AnalyzeTongue 方法**

在 `QueryPulse` 之后添加：

```go
// AnalyzeTongue calls DeepSeek to analyze tongue diagnosis description.
func (s *DeepSeekService) AnalyzeTongue(description string) (string, error) {
	if !s.IsEnabled() {
		return "", ErrDeepSeekDisabled
	}

	systemPrompt := `你是一名中医舌诊专家，精通《舌鉴辨正》《察舌辨症新法》等舌诊经典著作，对舌质、舌苔、舌形、舌态的辨证分析有深入研究。

请根据用户描述的舌象，从以下角度进行辨证分析：
1. 舌象解读：对描述的舌质、舌苔等特征逐一分析
2. 脏腑辨证：舌象反映的脏腑状态
3. 病机分析：可能的病因病机
4. 证型判断：最可能的证型
5. 调治建议：饮食、生活调养建议

请以 Markdown 格式输出，使用标题、列表、加粗等格式，确保层次分明。`

	userPrompt := fmt.Sprintf("请分析以下舌象描述：\n\n%s", description)

	return s.chatLong(systemPrompt, userPrompt)
}
```

- [ ] **Step 4: 验证编译通过**

Run: `cd server && go build ./...`
Expected: 编译成功

- [ ] **Step 5: 提交**

```bash
git add server/service/deepseek.go
git commit -m "feat: add QueryPulse and AnalyzeTongue to DeepSeekService"
```

---

### Task 4: PulseService 新增 DeepSeek fallback

**Files:**
- Modify: `server/service/pulse.go`
- Modify: `server/handler/pulse.go`
- Modify: `server/router/router.go`

- [ ] **Step 1: 修改 PulseService 添加 DeepSeek 字段**

```go
type PulseService struct {
	DB       *gorm.DB
	DeepSeek *DeepSeekService
}

func NewPulseService(db *gorm.DB, ds *DeepSeekService) *PulseService {
	return &PulseService{DB: db, DeepSeek: ds}
}
```

- [ ] **Step 2: 修改 Search 方法添加 fallback 逻辑**

在 `return pulses, total, nil` 之前（`Find` 之后）添加：

```go
// If name search yielded no results and no category filter, try DeepSeek
if total == 0 && name != "" && category == "" && s.DeepSeek != nil && s.DeepSeek.IsEnabled() {
    pulse, err := s.queryAndSaveFromAI(name)
    if err != nil {
        log.Printf("DeepSeek pulse query failed for %q: %v", name, err)
        return pulses, 0, nil
    }
    return []model.Pulse{*pulse}, 1, nil
}
```

需要在文件顶部 import 中添加 `"log"`。

- [ ] **Step 3: 新增 isValidPulseResult 和 queryAndSaveFromAI 方法**

在 `DeleteByID` 方法之后添加：

```go
func isValidPulseResult(result *PulseAIResult) bool {
	return result.Description != "" || result.ClinicalMeaning != ""
}

func (s *PulseService) queryAndSaveFromAI(name string) (*model.Pulse, error) {
	result, err := s.DeepSeek.QueryPulse(name)
	if err != nil {
		return nil, err
	}

	pulse := model.Pulse{
		Name:             result.Name,
		Category:         result.Category,
		Description:      result.Description,
		ClinicalMeaning:  result.ClinicalMeaning,
		CommonConditions: result.CommonConditions,
	}

	if !isValidPulseResult(result) {
		log.Printf("AI pulse result for %q is invalid, skipping save", name)
		return &pulse, nil
	}

	if err := s.DB.Create(&pulse).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			var existing model.Pulse
			if err := s.DB.Where("name = ?", result.Name).First(&existing).Error; err == nil {
				return &existing, nil
			}
		}
		log.Printf("Failed to save AI pulse result: %v", err)
		return &pulse, nil
	}

	return &pulse, nil
}
```

- [ ] **Step 4: 修改 PulseHandler 接受 DeepSeekService**

修改 `server/handler/pulse.go`：

```go
type PulseHandler struct {
	db       *gorm.DB
	deepSeek *service.DeepSeekService
}

func NewPulseHandler(db *gorm.DB, ds *service.DeepSeekService) *PulseHandler {
	return &PulseHandler{db: db, deepSeek: ds}
}
```

修改 `List` 方法：
```go
svc := service.NewPulseService(h.db, h.deepSeek)
```

修改所有其他方法中的 `NewPulseService(h.db)` 为 `NewPulseService(h.db, nil)` 或传入 `h.deepSeek`：
- `Categories`: `NewPulseService(h.db, nil)` （不需要 AI）
- `Detail`: `NewPulseService(h.db, nil)`
- `Create`: `NewPulseService(h.db, nil)`
- `Update`: `NewPulseService(h.db, nil)`
- `Delete`: `NewPulseService(h.db, nil)`

- [ ] **Step 5: 修改 router.go 中 PulseHandler 创建**

将：
```go
pulseHandler := handler.NewPulseHandler(db)
```
改为：
```go
pulseHandler := handler.NewPulseHandler(db, deepSeekService)
```

- [ ] **Step 6: 验证编译通过**

Run: `cd server && go build ./...`
Expected: 编译成功

- [ ] **Step 7: 提交**

```bash
git add server/service/pulse.go server/handler/pulse.go server/router/router.go
git commit -m "feat: add DeepSeek AI fallback to PulseService search"
```

---

### Task 5: 舌象分析 API 端点

**Files:**
- Modify: `server/handler/ai_analysis.go`
- Modify: `server/router/router.go`

- [ ] **Step 1: 在 ai_analysis.go 中新增 AnalyzeTongue handler**

在 `AnalyzeStream` 方法之后添加：

```go
type tongueAnalysisRequest struct {
	Description string `json:"description" binding:"required"`
	RecordID    uint64 `json:"record_id"`
	Force       bool   `json:"force"`
}

// AnalyzeTongue handles POST /api/v1/ai/analyze-tongue
func (h *AIAnalysisHandler) AnalyzeTongue(c *gin.Context) {
	var req tongueAnalysisRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Error(c, http.StatusBadRequest, "请输入舌象描述")
		return
	}

	if !h.deepSeek.IsEnabled() {
		Error(c, http.StatusServiceUnavailable, "AI 服务未配置")
		return
	}

	tenantID := middleware.GetTenantID(c)

	// If record_id provided and not forcing, check cached tongue_analysis
	if req.RecordID > 0 && !req.Force {
		var record model.MedicalRecord
		if err := h.db.Where("id = ? AND tenant_id = ?", req.RecordID, tenantID).
			First(&record).Error; err == nil {
			if record.TongueAnalysis != "" {
				Success(c, gin.H{"analysis": record.TongueAnalysis, "cached": true})
				return
			}
		}
	}

	// Call DeepSeek API
	result, err := h.deepSeek.AnalyzeTongue(req.Description)
	if err != nil {
		Error(c, http.StatusInternalServerError, "舌象分析失败，请稍后重试")
		return
	}

	// Cache result in medical_records.tongue_analysis if record_id provided
	if req.RecordID > 0 {
		h.db.Model(&model.MedicalRecord{}).
			Where("id = ? AND tenant_id = ?", req.RecordID, tenantID).
			Update("tongue_analysis", result)
	}

	Success(c, gin.H{"analysis": result, "cached": false})
}
```

- [ ] **Step 2: 在 router.go 中注册新路由**

在 `authenticated.POST("/ai/analyze-diagnosis-stream", ...)` 之后添加：

```go
authenticated.POST("/ai/analyze-tongue", middleware.RequirePermission(db, "record:read"), aiAnalysisHandler.AnalyzeTongue)
```

- [ ] **Step 3: 验证编译通过**

Run: `cd server && go build ./...`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add server/handler/ai_analysis.go server/router/router.go
git commit -m "feat: add tongue analysis API endpoint (POST /ai/analyze-tongue)"
```

---

## Chunk 2: 前端实现

### Task 6: 前端 API 层更新

**Files:**
- Modify: `web/src/api/record.ts`

- [ ] **Step 1: 更新 RecordListItem 接口**

新增字段：
```typescript
chief_complaint: string;
pulse_name: string;
```

- [ ] **Step 2: 新增 analyzeTongue 方法**

```typescript
export function analyzeTongue(data: { description: string; record_id?: number; force?: boolean }) {
  return request.post('/ai/analyze-tongue', data, { timeout: 120000 });
}
```

- [ ] **Step 3: 提交**

```bash
git add web/src/api/record.ts
git commit -m "feat: add tongue analysis API and update RecordListItem type"
```

---

### Task 7: RecordForm 新增主诉/脉象/舌象 UI

**Files:**
- Modify: `web/src/pages/records/RecordForm.tsx`

这是最大的改动，分多步进行。

- [ ] **Step 1: 更新 imports 和类型定义**

新增 imports：
```typescript
import { SearchOutlined } from '@ant-design/icons';
import { listPulses } from '../../api/pulse';
import type { PulseItem } from '../../api/pulse';
import { analyzeTongue } from '../../api/record';
import { uploadFile, getFileUrl } from '../../api/upload';
```

更新 `PatientOption` 接口新增：
```typescript
birthday?: string;
```

更新 `RecordFormValues` 接口新增：
```typescript
chief_complaint: string;
pulse_id?: number;
pulse_name?: string;
tongue_image?: string;
tongue_description?: string;
tongue_analysis?: string;
```

- [ ] **Step 2: 新增脉象相关 state**

在 AI analysis state 之后添加：
```typescript
// Pulse search state
const [pulseOptions, setPulseOptions] = useState<PulseItem[]>([]);
const [pulseLoading, setPulseLoading] = useState(false);
const [selectedPulse, setSelectedPulse] = useState<PulseItem | null>(null);
const pulseSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const [pulseAiQuerying, setPulseAiQuerying] = useState(false);

// Tongue analysis state
const [tongueAnalyzing, setTongueAnalyzing] = useState(false);
const [tongueResult, setTongueResult] = useState<string>('');
const [tongueImageUrl, setTongueImageUrl] = useState<string>('');
const [tongueUploading, setTongueUploading] = useState(false);
```

- [ ] **Step 3: 新增脉象搜索函数**

```typescript
const searchPulses = useCallback(async (name: string) => {
  if (!name.trim()) {
    setPulseOptions([]);
    return;
  }
  setPulseLoading(true);
  try {
    const res = await listPulses({ name, page: 1, size: 10 });
    const body = res as unknown as { data: { list: PulseItem[]; total: number } };
    setPulseOptions(body.data.list || []);
  } catch {
    // handled
  } finally {
    setPulseLoading(false);
  }
}, []);

const handlePulseSearch = (value: string) => {
  if (pulseSearchTimerRef.current) {
    clearTimeout(pulseSearchTimerRef.current);
  }
  pulseSearchTimerRef.current = setTimeout(() => {
    searchPulses(value);
  }, 300);
};

const handlePulseAiQuery = async (searchName: string) => {
  setPulseAiQuerying(true);
  try {
    // Trigger search again — backend will auto-fallback to DeepSeek
    const res = await listPulses({ name: searchName, page: 1, size: 10 });
    const body = res as unknown as { data: { list: PulseItem[]; total: number } };
    const list = body.data.list || [];
    setPulseOptions(list);
    if (list.length > 0) {
      // Auto-select the first result
      const pulse = list[0];
      setSelectedPulse(pulse);
      form.setFieldsValue({ pulse_id: pulse.id, pulse_name: pulse.name });
      message.success(`已从 AI 获取脉象「${pulse.name}」并自动入库`);
    } else {
      message.warning('AI 未能识别该脉象');
    }
  } catch {
    message.error('AI 查询失败');
  } finally {
    setPulseAiQuerying(false);
  }
};

const handlePulseSelect = (value: number) => {
  const pulse = pulseOptions.find(p => p.id === value);
  if (pulse) {
    setSelectedPulse(pulse);
    form.setFieldsValue({ pulse_name: pulse.name });
  }
};
```

- [ ] **Step 4: 新增舌象分析函数**

```typescript
const handleTongueUpload = async (file: File) => {
  setTongueUploading(true);
  try {
    const res = await uploadFile(file);
    const body = res as unknown as { data: { file_path: string } };
    const filePath = body.data.file_path;
    form.setFieldValue('tongue_image', filePath);
    setTongueImageUrl(getFileUrl(filePath));
    message.success('舌象图片上传成功');
  } catch {
    message.error('上传失败');
  } finally {
    setTongueUploading(false);
  }
};

const handleTongueAnalysis = async (force = false) => {
  const description = form.getFieldValue('tongue_description');
  if (!description?.trim()) {
    message.warning('请先输入舌象描述');
    return;
  }
  setTongueAnalyzing(true);
  try {
    const recordId = id ? Number(id) : undefined;
    const res = await analyzeTongue({
      description: description.trim(),
      record_id: recordId,
      force,
    });
    const body = res as unknown as { data: { analysis: string; cached: boolean } };
    const analysis = body.data.analysis || '未获取到分析结果';
    setTongueResult(analysis);
    form.setFieldValue('tongue_analysis', analysis);
  } catch {
    message.error('舌象分析失败，请稍后重试');
  } finally {
    setTongueAnalyzing(false);
  }
};
```

- [ ] **Step 5: 修改编辑模式数据加载**

在 `loadRecord` 函数的 data 类型中新增：
```typescript
chief_complaint: string;
pulse_id: number;
pulse_name: string;
tongue_image: string;
tongue_description: string;
tongue_analysis: string;
patient: PatientOption & { birthday?: string };
```

在 `form.setFieldsValue` 中新增：
```typescript
chief_complaint: record.chief_complaint || '',
pulse_id: record.pulse_id || undefined,
pulse_name: record.pulse_name || '',
tongue_image: record.tongue_image || '',
tongue_description: record.tongue_description || '',
tongue_analysis: record.tongue_analysis || '',
```

在设置数据之后，加载关联的脉象详情和舌象图片：
```typescript
if (record.pulse_id) {
  const pulseRes = await listPulses({ name: record.pulse_name, page: 1, size: 10 });
  const pulseBody = pulseRes as unknown as { data: { list: PulseItem[] } };
  const list = pulseBody.data.list || [];
  setPulseOptions(list);
  const found = list.find(p => p.id === record.pulse_id);
  if (found) setSelectedPulse(found);
}
if (record.tongue_image) {
  setTongueImageUrl(getFileUrl(record.tongue_image));
}
if (record.tongue_analysis) {
  setTongueResult(record.tongue_analysis);
}
```

- [ ] **Step 6: 修改 handleSubmit 加入新字段**

在 payload 中新增：
```typescript
chief_complaint: values.chief_complaint || '',
pulse_id: values.pulse_id || null,
pulse_name: values.pulse_name || '',
tongue_image: values.tongue_image || '',
tongue_description: values.tongue_description || '',
tongue_analysis: values.tongue_analysis || '',
```

在 `updateRecord` 调用中也加入这些字段。

- [ ] **Step 7: 在表单中插入主诉/脉象/舌象 UI**

在就诊日期 `</div>` 之后、诊断 `<div>` 之前插入：

**主诉区域：**
```tsx
<Form.Item label="主诉" name="chief_complaint">
  <Input.TextArea rows={2} placeholder="请输入主诉（主要症状和持续时间）" />
</Form.Item>
```

**脉象区域：**
```tsx
<div style={{ display: 'flex', gap: 16, flexDirection: isMobile ? 'column' : 'row', alignItems: 'flex-start' }}>
  <Form.Item label="脉象" name="pulse_id" style={{ flex: 1 }}>
    <Select
      showSearch
      placeholder="搜索脉象名称"
      filterOption={false}
      onSearch={handlePulseSearch}
      onChange={handlePulseSelect}
      loading={pulseLoading}
      allowClear
      onClear={() => {
        setSelectedPulse(null);
        form.setFieldsValue({ pulse_name: '' });
      }}
      notFoundContent={
        pulseLoading ? (
          <Spin size="small" />
        ) : (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ color: '#999', marginBottom: 8 }}>未找到匹配脉象</div>
            <Button
              type="link"
              icon={<SearchOutlined />}
              loading={pulseAiQuerying}
              onClick={() => {
                const name = (document.querySelector('.ant-select-selection-search-input') as HTMLInputElement)?.value;
                if (name) handlePulseAiQuery(name);
              }}
            >
              从 AI 查询
            </Button>
          </div>
        )
      }
      options={pulseOptions.map(p => ({
        value: p.id,
        label: `${p.name}${p.category ? ` (${p.category})` : ''}`,
      }))}
    />
  </Form.Item>
  <Form.Item name="pulse_name" hidden>
    <Input />
  </Form.Item>
  {selectedPulse && (
    <Card size="small" style={{ flex: 1, maxWidth: isMobile ? '100%' : 400 }}
      title={<span>{selectedPulse.name} <Tag color="blue">{selectedPulse.category}</Tag></span>}
    >
      {selectedPulse.description && <div style={{ marginBottom: 4 }}><strong>特征：</strong>{selectedPulse.description}</div>}
      {selectedPulse.clinical_meaning && <div style={{ marginBottom: 4 }}><strong>临床意义：</strong>{selectedPulse.clinical_meaning}</div>}
      {selectedPulse.common_conditions && <div><strong>常见病症：</strong>{selectedPulse.common_conditions}</div>}
    </Card>
  )}
</div>
```

**舌象区域：**
```tsx
<div style={{ display: 'flex', gap: 16, flexDirection: isMobile ? 'column' : 'row', alignItems: 'flex-start' }}>
  <div style={{ flex: 1 }}>
    <Form.Item label="舌象图片" name="tongue_image">
      <div>
        {tongueImageUrl ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img src={tongueImageUrl} alt="舌象" style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, border: '1px solid #d9d9d9' }} />
            <Button
              size="small"
              danger
              style={{ position: 'absolute', top: 4, right: 4 }}
              onClick={() => {
                form.setFieldValue('tongue_image', '');
                setTongueImageUrl('');
              }}
            >
              删除
            </Button>
          </div>
        ) : (
          <Button
            loading={tongueUploading}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) handleTongueUpload(file);
              };
              input.click();
            }}
          >
            上传舌象图片
          </Button>
        )}
      </div>
    </Form.Item>
  </div>
  <div style={{ flex: 2 }}>
    <Form.Item label={
      <Space>
        <span>舌象描述</span>
        <Button
          type="primary"
          ghost
          size="small"
          icon={<RobotOutlined />}
          loading={tongueAnalyzing}
          onClick={() => handleTongueAnalysis()}
          disabled={!form.getFieldValue('tongue_description')?.trim()}
        >
          分析舌象
        </Button>
        {tongueResult && !tongueAnalyzing && (
          <Button size="small" icon={<ReloadOutlined />} onClick={() => handleTongueAnalysis(true)}>
            重新分析
          </Button>
        )}
      </Space>
    } name="tongue_description">
      <Input.TextArea rows={3} placeholder="描述舌象（如：舌质淡红，舌苔薄白，舌体胖大有齿痕）" />
    </Form.Item>
    <Form.Item name="tongue_analysis" hidden>
      <Input />
    </Form.Item>
  </div>
</div>
{tongueResult && (
  <Card size="small" style={{ marginBottom: 16 }} title={
    <Space>
      <RobotOutlined style={{ color: '#1677ff' }} />
      <span>舌象 AI 分析结果</span>
    </Space>
  }>
    <div className="ai-analysis-content" style={{ fontSize: 14, lineHeight: 1.8 }}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {tongueResult}
      </Markdown>
    </div>
    <div style={{ fontSize: 12, color: '#999', textAlign: 'center', marginTop: 8 }}>
      以上分析由 AI 生成，仅供参考
    </div>
  </Card>
)}
```

- [ ] **Step 8: 验证前端编译通过**

Run: `cd web && npm run build`
Expected: 编译成功

- [ ] **Step 9: 提交**

```bash
git add web/src/pages/records/RecordForm.tsx web/src/api/record.ts
git commit -m "feat: add chief complaint, pulse search, tongue analysis UI to RecordForm"
```

---

### Task 8: 诊疗内容模版动态填充患者信息

**Files:**
- Modify: `web/src/pages/records/RecordForm.tsx`

- [ ] **Step 1: 更新 initialValues 模版**

将 `diagnosis` 初始值前面加上患者信息占位行：

```typescript
diagnosis: isEdit ? undefined : `性别：
年龄：
出生年月：
主诉：
脉象：
---
1. 大便：
2. 小便：
... (保持原有20项不变)`,
```

- [ ] **Step 2: 新增模版同步 useEffect**

在 `handlePatientSearch` 之前添加：

```typescript
// Sync patient info + chief complaint + pulse to diagnosis template
useEffect(() => {
  if (isEdit) return; // Only for new records
  const diagnosis = form.getFieldValue('diagnosis') as string;
  if (!diagnosis) return;

  const patientId = form.getFieldValue('patient_id');
  const patient = patients.find(p => p.id === patientId);
  const chiefComplaint = form.getFieldValue('chief_complaint') || '';
  const pulseName = form.getFieldValue('pulse_name') || '';

  const genderText = patient ? (patient.gender === 1 ? '男' : patient.gender === 2 ? '女' : '') : '';
  const ageText = patient?.age ? `${patient.age}岁` : '';
  const birthdayText = patient?.birthday ? dayjs(patient.birthday).format('YYYY年MM月') : '';

  let updated = diagnosis;
  updated = updated.replace(/^性别：.*$/m, `性别：${genderText}`);
  updated = updated.replace(/^年龄：.*$/m, `年龄：${ageText}`);
  updated = updated.replace(/^出生年月：.*$/m, `出生年月：${birthdayText}`);
  updated = updated.replace(/^主诉：.*$/m, `主诉：${chiefComplaint}`);
  updated = updated.replace(/^脉象：.*$/m, `脉象：${pulseName}`);

  if (updated !== diagnosis) {
    form.setFieldValue('diagnosis', updated);
  }
}, [
  isEdit, form, patients,
  form.getFieldValue?.('patient_id'),
  form.getFieldValue?.('chief_complaint'),
  form.getFieldValue?.('pulse_name'),
]);
```

注意：由于 Ant Design Form 的值变化不能直接作为 useEffect 依赖，需改用 `Form.useWatch`：

```typescript
const watchedPatientId = Form.useWatch('patient_id', form);
const watchedChiefComplaint = Form.useWatch('chief_complaint', form);
const watchedPulseName = Form.useWatch('pulse_name', form);
```

然后把 `useEffect` 的依赖改为：
```typescript
[isEdit, form, patients, watchedPatientId, watchedChiefComplaint, watchedPulseName]
```

- [ ] **Step 3: 验证前端编译通过**

Run: `cd web && npm run build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add web/src/pages/records/RecordForm.tsx
git commit -m "feat: add dynamic patient info sync to diagnosis template"
```

---

## Chunk 3: 构建验证 + 部署

### Task 9: 全量构建验证

**Files:** 无新文件

- [ ] **Step 1: 后端编译**

Run: `cd server && go build ./...`
Expected: 编译成功

- [ ] **Step 2: 前端编译**

Run: `cd web && npm run build`
Expected: 编译成功，无 TypeScript 错误

- [ ] **Step 3: 部署到 Docker 容器**

```bash
cd web && npm run build
docker cp dist/. menzhen-web-1:/usr/share/nginx/html/
docker exec menzhen-nginx-1 nginx -s reload
```

- [ ] **Step 4: 后端重新部署（需要数据库迁移）**

```bash
cd /Users/xiayanji/qbox/menzhen
docker-compose up -d --build server
```

注意：GORM AutoMigrate 在启动时自动执行，会为 medical_records 表添加新字段。

---

### Task 10: 更新文档

**Files:**
- Modify: `docs/codebase.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 codebase.md**

在 MedicalRecord 模型描述中新增 6 个字段。
在 API 路由表中新增 `POST /ai/analyze-tongue`。
更新 PulseService 描述（新增 DeepSeek fallback）。

- [ ] **Step 2: 更新 CLAUDE.md**

在详细文档列表中添加本次设计文档链接。
更新权限码说明（如有变化）。

- [ ] **Step 3: 提交**

```bash
git add docs/codebase.md CLAUDE.md
git commit -m "docs: update codebase and CLAUDE.md for record enhancement feature"
```
