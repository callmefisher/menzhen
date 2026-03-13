# 测试覆盖率提升至 90% 设计文档

## 目标

将前后端测试覆盖率从当前水平提升至 90% 以上，过程中发现的 bug 立即修复。

### 当前状态
- **后端**: 3 个测试文件 / 63 个源文件，整体覆盖率 < 10%
- **前端**: 4 个测试文件 / 49 个可测试源文件 (12%)

### 目标状态
- **后端**: 各 package 行覆盖率 ≥ 90%
- **前端**: 可测试代码行覆盖率 ≥ 90%（排除 3D 组件和纯数据文件）

## 约束与决策

| 决策项 | 选择 | 原因 |
|--------|------|------|
| 3D 组件 | 排除 | Three.js mock 投入产出比低 |
| 后端 DB | 真实 MySQL（Docker 容器） | 覆盖真实 SQL 行为 |
| 测试隔离 | 事务回滚 | 快速、干净、无残留 |
| 前端 API mock | vi.mock() | 沿用现有模式 |

### 排除范围
- **前端 3D 渲染组件**: MeridianView, MeridianScene, MeridianPath, AcupointMarker, HumanBodyModel, surfaceProjection.ts（依赖 Three.js/R3F）
- **前端数据文件**: meridians.ts, acupoints.ts, meridian-paths-*.ts, acupoint-positions-*.ts, types.ts
- **前端入口**: main.tsx, App.tsx (路由配置)
- **后端**: database/seed.go (种子数据), router/router.go (路由注册), config/config.go (env 加载), main.go (入口)

### 需要测试的经络 UI 组件（非 3D）
以下组件位于 meridians 目录但是纯 Ant Design UI，不依赖 Three.js，需要测试：
- MeridianDetailDrawer.tsx — 详情抽屉（Ant Design Drawer）
- MeridianPanel.tsx — 选择面板（Ant Design 列表）
- AcupointInfoCard.tsx — 穴位信息卡片
- AcupointDetailPanel.tsx — 穴位详情面板

### 已有测试的文件（需扩展覆盖率）
- **后端**: model/formula_test.go, service/deepseek_test.go, handler/handler_test.go
- **前端**: PrescriptionModal.test.tsx, PrescriptionPrint.test.tsx, HerbSearch.test.tsx, FormulaSearch.test.tsx

---

## 后端测试设计

### Phase 1: 测试基础设施 + Middleware

#### 1.1 testutil 包

创建 `server/testutil/testutil.go`:

```go
// SetupTestDB 连接 Docker MySQL，创建临时测试库，返回 *gorm.DB
// 每次调用创建唯一库名 test_menzhen_<timestamp>_<random>
// t.Cleanup 自动 DROP DATABASE

// WithTx 在事务中执行测试，自动回滚
// func WithTx(db *gorm.DB, fn func(tx *gorm.DB))

// SeedTestTenant 创建测试租户，返回 tenant
// SeedTestUser 创建测试用户（含角色+权限），返回 user + JWT token
// SeedTestPatient 创建测试患者，返回 patient
```

环境变量 `TEST_DB_DSN` 指定测试数据库连接，默认 `root:password@tcp(127.0.0.1:3306)/`。

#### 1.2 Middleware 测试 (4 个文件)

**middleware/auth_test.go**:
- JWT token 解析成功 → context 包含 UserID/TenantID/Username
- 无 token → 401
- 过期 token → 401
- 无效 token → 401
- Helper 函数 GetUserID/GetTenantID/GetUsername

**middleware/tenant_test.go**:
- TenantScope 过滤：租户 A 查不到租户 B 的数据
- 无 TenantID → 返回空
- 多租户并行查询隔离

**middleware/rbac_test.go**:
- 有权限 → 200 放行
- 无权限 → 403 + required_permissions
- 多权限 OR 逻辑（任一满足即可）
- 用户不存在 → 403

**middleware/oplog_test.go**:
- LogOperation 成功记录
- 包含正确的 tenantID/userID/action/resourceType
- 失败不影响主请求

### Phase 2: Model + Service

#### 2.1 Model 测试

对每个有自定义方法（Value/Scan/BeforeCreate 等）的 model 写测试。
对于纯结构体 model，通过 service 层间接覆盖。

**需要独立测试的 model**:
- formula.go — Value/Scan（已有，扩展覆盖率）
- prescription.go — PrescriptionItem 序列化
- 其他有自定义类型的 model

**通过 CRUD 操作间接测试的 model**:
- patient, medical_record, user, tenant, role, permission, herb, oplog 等
- 验证：创建/读取/更新/软删除、关联关系、租户字段

#### 2.2 Service 测试 (16 个文件)

每个 service 测试模板：

```
- 正常流程 (happy path)
- 空数据 / 无结果
- 参数无效 / 边界值
- 租户隔离 (跨租户不可访问)
- 分页 (首页/末页/超范围)
- 中文字符处理
```

**关键 service 测试重点**:

| Service | 重点测试 |
|---------|---------|
| auth | Login 成功/失败、Token 生成/验证、密码错误 |
| patient | CRUD + 租户隔离 + 搜索（姓名/手机） |
| record | CRUD + 租户隔离 + 关联患者 + 附件 |
| prescription | CRUD + 药品组成序列化 + 关联记录 |
| permission | HasPermission + 角色权限继承 |
| tenant | CRUD + 唯一性校验 |
| user | CRUD + 密码加密 + 角色分配 |
| herb | 列表 + 搜索 + 分页 |
| formula | 列表 + 搜索 + 分页 |
| inventory_drug | CRUD + 库存数量 + 预警 |
| deepseek | 已有，扩展错误场景 |
| oplog | 记录查询 + 租户过滤 |
| clinical_experience | CRUD + 租户隔离 |
| pulse | 列表 + 创建 |
| meridian_resource | 列表查询 |
| wuyun_liuqi | 查询 + AI 分析 mock |

### Phase 3: Handler 测试 (18 个文件)

使用 httptest + gin.Engine，真实 DB，测试完整请求链路。

**特殊处理**:
- **ai_analysis handler**: 含 SSE 流式端点，使用 httptest.ResponseRecorder 读取 SSE 事件流，mock DeepSeek API
- **upload handler**: mock MinIO client（storage.MinioClient 接口），测试文件类型校验、key 生成逻辑，不测真实上传

```go
// 每个 handler 测试的标准结构
func TestXxxHandler(t *testing.T) {
    db := testutil.SetupTestDB(t)
    router := setupTestRouter(db) // gin.Engine with middleware

    // 创建测试数据
    token := testutil.SeedTestUser(db, ...)

    // 发送请求
    req := httptest.NewRequest("GET", "/api/v1/xxx", nil)
    req.Header.Set("Authorization", "Bearer "+token)
    w := httptest.NewRecorder()
    router.ServeHTTP(w, req)

    // 断言
    assert.Equal(t, 200, w.Code)
}
```

**每个 handler 测试覆盖**:
- 正常请求 → 正确响应
- 无 token → 401
- 无权限 → 403
- 无效参数 → 400
- 资源不存在 → 404
- 跨租户访问 → 404（看不到别人的数据）

---

## 前端测试设计

### Phase 4: 基础设施

**utils/request.test.ts**:
- mock axios，测试请求拦截器（token 注入）
- 测试响应拦截器（401 跳转登录、403 权限提示、通用错误）
- 测试 baseURL 和 timeout 配置

**store/auth.test.tsx**:
- 渲染 AuthProvider → 自动调用 getMe 恢复 session
- login 成功 → token 存储、用户信息更新
- login 记住我 → localStorage，不记住 → sessionStorage
- logout → 清除 token、重置状态
- hasPermission 权限检查

**utils/sse.test.ts**:
- mock EventSource
- 正常流式数据接收
- 连接错误处理
- 手动关闭连接

### Phase 5: API Services + 核心页面

**API Services (16 个文件)**:
- mock request.ts 的 get/post/put/delete
- 验证请求 URL、参数、返回值类型
- 每个 API 函数一个测试

**核心页面测试**:

| 页面 | 行数 | 测试重点 |
|------|------|---------|
| PatientList | 428 | 列表渲染、搜索、分页、新增/编辑跳转 |
| PatientDetail | 507 | 详情渲染、关联记录/处方展示、编辑跳转 |
| PatientForm | 248 | 表单渲染、校验、提交、编辑回填 |
| RecordList | 380 | 列表、筛选、分页 |
| RecordForm | 1440 | 分段测试：基本信息、主诉/脉象/舌象、AI 分析触发、处方关联 |
| DrugList | 948 | 列表、搜索、CRUD、库存预警、批量操作 |
| InventoryAlert | 374 | 预警列表、状态标记 |

### Phase 6: 剩余页面 + 组件

| 页面/组件 | 行数 | 测试重点 |
|-----------|------|---------|
| Login | 110 | 表单渲染、校验、登录提交、错误提示 |
| Register | 153 | 表单渲染、校验、密码确认、提交 |
| UserList | 463 | CRUD、角色分配 |
| RoleList | 393 | CRUD、权限编辑 |
| TenantList | 336 | CRUD |
| OpLogList | 645 | 列表、筛选、分页 |
| PulseList | 425 | 列表、新增 |
| ClinicalExperienceList | 400 | CRUD |
| WuyunLiuqi | 333 | AI 分析触发、流式显示 |
| NotesPanel | 271 | 笔记 CRUD、localStorage 持久化 |
| Layout | 463 | 导航渲染、菜单权限控制、移动端适配 |
| FileUpload | 188 | 上传触发、进度、预览 |
| HerbDetailModal | 74 | 渲染、关闭 |
| MeridianDetailDrawer | 343 | 详情渲染、穴位列表、关闭 |
| MeridianPanel | 260 | 经络选择列表、搜索、选中状态 |
| AcupointInfoCard | 50 | 穴位信息渲染 |
| AcupointDetailPanel | 121 | 穴位详情渲染 |

---

## 覆盖率验证

每个 Phase 完成后运行：

```bash
# 后端
cd server && go test ./... -cover -coverprofile=coverage.out
go tool cover -func=coverage.out | grep total

# 前端
cd web && npx vitest run --coverage
```

### 覆盖率配置

前端 vitest.config.ts 添加 coverage 配置，排除 3D 渲染组件和数据文件（保留经络 UI 组件）：

```ts
coverage: {
  provider: 'v8',
  exclude: [
    'src/pages/meridians/MeridianView.tsx',
    'src/pages/meridians/MeridianScene.tsx',
    'src/pages/meridians/MeridianPath.tsx',
    'src/pages/meridians/AcupointMarker.tsx',
    'src/pages/meridians/HumanBodyModel.tsx',
    'src/pages/meridians/surfaceProjection.ts',
    'src/pages/meridians/data/**',
    'src/test/**',
    '**/*.d.ts',
  ]
}
```

---

## Bug 修复策略

测试过程中发现的 bug：
1. 先写能重现 bug 的测试（RED）
2. 确认测试失败
3. 修复代码（GREEN）
4. 确认不破坏其他测试
5. 记录到 CLAUDE.md 经验教训
