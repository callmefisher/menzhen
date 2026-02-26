# Codebase 全局上下文

> 本文件供每次任务执行前快速扫描，保持与代码同步。
> 最后更新：2026-02-26（中药编辑+道地产区 + 患者生日自动算年龄）

---

## 项目总览

患者病历管理系统，支持中小诊所局域网部署和多诊所云端共享（多租户架构）。包含中医药查询（对接 DeepSeek AI 回退）、AI 辅助辩证论治分析和开方功能。

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Ant Design 6 + React Router 7 |
| 后端 | Go + Gin + GORM |
| 数据库 | MySQL 8.0 |
| 文件存储 | MinIO |
| 认证 | JWT（HS256，24h 过期）+ RBAC |
| AI | DeepSeek API（Anthropic Messages 格式） |
| 测试 | Go test（后端）+ Vitest + Testing Library（前端） |
| 部署 | Docker Compose（6 个服务）+ Nginx 反向代理 |

---

## 目录结构详解

```
menzhen/
├── server/                          # Go 后端
│   ├── main.go                      # 入口：加载配置 -> InitDB -> Seed -> InitMinIO -> SetupRouter -> Run
│   ├── config/
│   │   └── config.go                # Config 结构体 + Load()，全部读取环境变量
│   ├── database/
│   │   ├── database.go              # InitDB：连接 MySQL + AutoMigrate 全部 15 个模型
│   │   └── seed.go                  # Seed：幂等写入 permissions/tenant/admin role/admin user
│   ├── handler/
│   │   ├── response.go              # 统一 Success/Error 响应
│   │   ├── auth.go                  # Login/Register/Logout/Me/ChangePassword
│   │   ├── patient.go               # List/Create/Detail/Update/Delete
│   │   ├── record.go                # List/Create/Detail/Update/Delete
│   │   ├── upload.go                # Upload/GetFile（MinIO）
│   │   ├── herb.go                  # List/Detail/Delete/Categories/Update
│   │   ├── formula.go               # List/Detail/Delete/UpdateComposition
│   │   ├── prescription.go          # Create/Detail/Update/Delete/ListByRecord
│   │   ├── ai_analysis.go           # Analyze（AI 辩证论治，含缓存）+ GetCached
│   │   ├── oplog.go                 # ListOpLogs/DeleteOpLog/BatchDeleteOpLogs
│   │   ├── user.go                  # List/Update/Delete/AssignRoles
│   │   ├── role.go                  # List/Create/Update/ListPermissions
│   │   ├── tenant.go                # List/Create/Update/Delete
│   │   └── handler_test.go          # handler 测试
│   ├── middleware/
│   │   ├── auth.go                  # JWT 解析，设置 user_id/tenant_id/username 到上下文
│   │   ├── rbac.go                  # RequirePermission：检查用户是否拥有指定权限码
│   │   ├── tenant.go                # TenantScope：GORM scope，按 tenant_id 过滤
│   │   └── oplog.go                 # LogOperation：记录操作审计日志（best-effort）
│   ├── model/                       # GORM 数据模型（见下方数据模型章节）
│   ├── router/
│   │   └── router.go                # SetupRouter：注册所有路由和中间件
│   ├── service/
│   │   ├── auth.go                  # 登录/注册逻辑
│   │   ├── patient.go               # 患者 CRUD
│   │   ├── record.go                # 诊疗记录 CRUD
│   │   ├── herb.go                  # 中药查询（DB + AI 回退 + 自动入库 + 分类列表）
│   │   ├── formula.go               # 方剂查询（DB + AI 回退 + 自动入库）
│   │   ├── prescription.go          # 处方 CRUD
│   │   ├── deepseek.go              # DeepSeek API 客户端（chat/chatLong/QueryHerb/QueryFormula/AnalyzeDiagnosis）
│   │   ├── deepseek_test.go         # DeepSeek 测试
│   │   ├── oplog.go                 # 操作日志 CRUD
│   │   ├── permission.go            # HasPermission 检查
│   │   ├── user.go                  # 用户管理
│   │   ├── role.go                  # 角色管理
│   │   └── tenant.go                # 租户管理
│   └── storage/
│       └── minio.go                 # InitMinIO 客户端初始化
├── web/                             # React 前端
│   └── src/
│       ├── main.tsx                 # React 入口
│       ├── App.tsx                  # 路由配置 + Layout（默认跳转 /patients）
│       ├── index.css                # 全局样式
│       ├── api/                     # API 调用封装
│       │   ├── auth.ts              # 登录/注册/登出/获取当前用户/修改密码
│       │   ├── patient.ts           # 患者 CRUD
│       │   ├── record.ts            # 诊疗记录 CRUD + AI分析调用/缓存获取
│       │   ├── herb.ts              # 中药搜索/详情/删除/分类列表/更新
│       │   ├── formula.ts           # 方剂搜索/详情/删除/更新组成
│       │   ├── prescription.ts      # 处方 CRUD + 按记录查询
│       │   ├── upload.ts            # 文件上传
│       │   ├── oplog.ts             # 操作日志查询/删除
│       │   ├── user.ts              # 用户管理
│       │   ├── role.ts              # 角色管理
│       │   └── tenant.ts            # 租户管理
│       ├── components/
│       │   ├── Layout.tsx           # 侧边栏 + 顶部导航布局（菜单顺序：患者→病历→中医药→系统设置→操作日志）
│       │   ├── FileUpload.tsx       # 文件上传组件
│       │   ├── PrescriptionModal.tsx  # 处方弹窗（开方/编辑，含药物详情查看，医嘱预填分行）
│       │   ├── HerbDetailModal.tsx   # 通用中药详情弹窗（方剂/处方复用）
│       │   ├── PrescriptionPrint.tsx  # 处方打印（药物每10味一列多列并排，医嘱分行）
│       │   └── __tests__/           # 组件测试
│       ├── pages/
│       │   ├── Login.tsx            # 登录页（登录后跳转患者管理）
│       │   ├── Register.tsx         # 注册页
│       │   ├── OpLogList.tsx        # 操作日志列表
│       │   ├── patients/            # 患者管理
│       │   │   ├── PatientList.tsx
│       │   │   ├── PatientDetail.tsx
│       │   │   └── PatientForm.tsx
│       │   ├── records/             # 诊疗记录
│       │   │   ├── RecordList.tsx
│       │   │   └── RecordForm.tsx   # 含 AI 辩证论治 Drawer + 处方区域全宽浅灰底色 + 医嘱分行展示
│       │   ├── herbs/               # 中药查询
│       │   │   ├── HerbSearch.tsx   # 含分类筛选下拉框 + 管理员行内编辑
│       │   │   └── __tests__/
│       │   ├── formulas/            # 方剂查询
│       │   │   ├── FormulaSearch.tsx
│       │   │   └── __tests__/
│       │   └── settings/            # 系统设置
│       │       ├── UserList.tsx
│       │       ├── RoleList.tsx
│       │       └── TenantList.tsx
│       ├── store/
│       │   └── auth.tsx             # 认证状态管理
│       ├── test/
│       │   └── setup.ts             # 测试配置（polyfill ResizeObserver、matchMedia）
│       └── utils/
│           └── request.ts           # axios 封装（自动附加 JWT、401 跳转登录）
├── nginx/
│   └── nginx.conf                   # Nginx 反向代理配置
├── scripts/
│   ├── backup.sh                    # 备份脚本（MySQL dump + 清理 3 天前备份 + 上传七牛云）
│   ├── backup-loop.sh               # 定时备份守护进程（每小时备份，启动时检查）
│   ├── restore.sh                   # 恢复脚本（MySQL + MinIO + 数据验证）
│   ├── upload_to_qiniu.py           # 七牛云上传脚本（AK/SK 从环境变量读取）
│   ├── seed-herbs-formulas.sh       # 中药/方剂数据播种（通过 API 触发 DeepSeek 回退自动入库）
│   └── Dockerfile.backup            # 备份容器镜像（alpine + mysql-client + mc + python3 + qiniu SDK）
├── docker-compose.yml               # 6 个服务：nginx、web、api、mysql、minio、backup
├── deploy.sh                        # 一键部署脚本（生成 .env + build + 启动 + 可选恢复）
└── CLAUDE.md                        # Claude Code 指导文件
```

---

## 数据模型

### BaseModel（公共基类，含软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键，自增 |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |
| `deleted_at` | `gorm.DeletedAt` | 软删除时间 |

### 全局表（无租户隔离）

#### `permissions` — 权限

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `code` | `varchar(50)` | 权限码（唯一索引），如 `patient:create` |
| `name` | `varchar(50)` | 权限名称 |
| `description` | `varchar(200)` | 描述 |

**全部权限码：** `patient:create`, `patient:read`, `patient:update`, `patient:delete`, `record:create`, `record:read`, `record:update`, `record:delete`, `oplog:read`, `user:manage`, `role:manage`, `herb:read`, `formula:read`, `prescription:create`, `prescription:read`, `tenant:manage`

#### `herbs` — 中药

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `name` | `varchar(100)` | 药名（唯一索引） |
| `alias` | `varchar(500)` | 别名 |
| `category` | `varchar(50)` | 归类（索引），如理气、活血 |
| `properties` | `varchar(200)` | 性味归经 |
| `effects` | `text` | 功效 |
| `indications` | `text` | 主治 |
| `origin` | `varchar(200)` | 道地产区 |
| `source` | `varchar(20)` | 数据来源，`manual`（默认）或 `deepseek` |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |

#### `formulas` — 方剂

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `name` | `varchar(100)` | 方剂名（唯一索引） |
| `effects` | `text` | 功效 |
| `indications` | `text` | 主治 |
| `composition` | `json` | 组成，`[{herb_name, default_dosage}]` |
| `source` | `varchar(20)` | 数据来源，`manual` 或 `deepseek` |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |

#### `role_permissions` — 角色-权限关联表

| 字段 | 类型 | 说明 |
|------|------|------|
| `role_id` | `uint64` | 联合主键 |
| `permission_id` | `uint64` | 联合主键 |

#### `user_roles` — 用户-角色关联表

| 字段 | 类型 | 说明 |
|------|------|------|
| `user_id` | `uint64` | 联合主键 |
| `role_id` | `uint64` | 联合主键 |

### 租户隔离表（含 `tenant_id`）

#### `tenants` — 租户/诊所

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `name` | `varchar(100)` | 诊所名称 |
| `code` | `varchar(50)` | 诊所编码（唯一索引） |
| `status` | `tinyint` | 状态：1=启用, 0=禁用 |
| `created_at` | `time.Time` | 创建时间 |

#### `users` — 用户

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `username` | `varchar(50)` | 用户名 |
| `password_hash` | `varchar(255)` | bcrypt 密码哈希 |
| `real_name` | `varchar(50)` | 真实姓名 |
| `phone` | `varchar(20)` | 手机号 |
| `notes` | `text` | 备注 |
| `status` | `tinyint` | 状态：1=启用, 0=禁用 |
| `created_at` | `time.Time` | 创建时间 |

#### `roles` — 角色

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `name` | `varchar(50)` | 角色名 |
| `description` | `varchar(200)` | 描述 |

#### `patients` — 患者（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `name` | `varchar(50)` | 姓名 |
| `gender` | `tinyint` | 性别：1=男, 2=女 |
| `age` | `int` | 年龄（可由生日自动计算） |
| `birthday` | `date` | 出生日期（nullable，填写后自动计算年龄） |
| `weight` | `decimal(5,1)` | 体重(kg) |
| `phone` | `varchar(20)` | 手机号 |
| `id_card` | `varchar(20)` | 身份证号 |
| `address` | `varchar(200)` | 地址 |
| `native_place` | `varchar(100)` | 籍贯 |
| `notes` | `text` | 备注 |
| `created_by` | `uint64` | 创建者用户 ID |

#### `medical_records` — 诊疗记录（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `patient_id` | `uint64` | 患者 ID（索引） |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `diagnosis` | `text` | 诊断 |
| `treatment` | `text` | 治疗方案 |
| `notes` | `text` | 备注 |
| `visit_date` | `date` | 就诊日期 |
| `created_by` | `uint64` | 创建者用户 ID |

#### `record_attachments` — 诊疗记录附件（无软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `record_id` | `uint64` | 诊疗记录 ID（索引） |
| `file_type` | `varchar(20)` | 类型：image/audio/video |
| `file_name` | `varchar(255)` | 原始文件名 |
| `file_path` | `varchar(500)` | MinIO object key |
| `file_size` | `bigint` | 文件大小(bytes) |
| `created_at` | `time.Time` | 创建时间 |

#### `prescriptions` — 处方（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `record_id` | `uint64` | 诊疗记录 ID（索引） |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `formula_name` | `varchar(100)` | 方剂名称 |
| `total_doses` | `int` | 剂数（默认 7） |
| `notes` | `text` | 备注 |
| `created_by` | `uint64` | 创建者用户 ID |

#### `prescription_items` — 处方药物明细（无软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `prescription_id` | `uint64` | 处方 ID（索引） |
| `herb_name` | `varchar(100)` | 药物名称 |
| `dosage` | `varchar(50)` | 用量 |
| `sort_order` | `int` | 排序号（默认 0） |
| `notes` | `varchar(200)` | 备注 |
| `created_at` | `time.Time` | 创建时间 |

#### `op_logs` — 操作日志（无软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `user_id` | `uint64` | 操作用户 ID（索引） |
| `user_name` | `varchar(50)` | 冗余用户名（用于展示） |
| `action` | `varchar(20)` | 操作类型：create/update/delete |
| `resource_type` | `varchar(50)` | 资源类型：patient/record/attachment |
| `resource_id` | `bigint` | 资源 ID |
| `old_data` | `json` | 变更前数据 |
| `new_data` | `json` | 变更后数据 |
| `created_at` | `time.Time` | 操作时间 |

#### `ai_analyses` — AI 分析缓存（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `record_id` | `uint64` | 诊疗记录 ID（唯一索引） |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `diagnosis` | `text` | 输入的诊断文本（用于判断内容是否变化） |
| `analysis` | `longtext` | AI 返回的 Markdown 分析结果 |

---

## API 路由清单

### 公开路由（无需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 登录 |
| POST | `/api/v1/auth/register` | 注册 |
| GET | `/api/v1/files/*key` | 文件下载（浏览器 img 标签无法带 Authorization） |

### 认证路由（需 JWT）

#### 用户认证

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/auth/logout` | - | 登出 |
| GET | `/api/v1/auth/me` | - | 获取当前用户信息 |
| POST | `/api/v1/auth/change-password` | - | 修改密码 |

#### 患者管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/patients` | `patient:read` | 患者列表（分页） |
| POST | `/api/v1/patients` | `patient:create` | 创建患者 |
| GET | `/api/v1/patients/:id` | `patient:read` | 患者详情 |
| PUT | `/api/v1/patients/:id` | `patient:update` | 更新患者 |
| DELETE | `/api/v1/patients/:id` | `patient:delete` | 删除患者 |

#### 诊疗记录

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/records` | `record:read` | 记录列表（分页） |
| POST | `/api/v1/records` | `record:create` | 创建记录 |
| GET | `/api/v1/records/:id` | `record:read` | 记录详情 |
| PUT | `/api/v1/records/:id` | `record:update` | 更新记录 |
| DELETE | `/api/v1/records/:id` | `record:delete` | 删除记录 |

#### 文件上传

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/upload` | - | 文件上传到 MinIO |

#### AI 分析

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/ai/analyze-diagnosis` | `record:read` | AI 辅助辩证论治分析（支持缓存，超时 120s） |
| GET | `/api/v1/records/:id/ai-analysis` | `record:read` | 获取已缓存的 AI 分析结果 |

#### 中药查询（全局数据）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/herbs` | - | 搜索中药（DB + AI 回退），参数：`name`, `category`, `page`, `size` |
| GET | `/api/v1/herbs/categories` | - | 获取中药分类列表（从已有数据中聚合） |
| GET | `/api/v1/herbs/:id` | - | 中药详情 |
| PUT | `/api/v1/herbs/:id` | `role:manage` | 更新中药（药名/别名/分类/性味/功效/主治/道地产区） |
| DELETE | `/api/v1/herbs/:id` | `role:manage` | 删除中药 |

#### 方剂查询（全局数据）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/formulas` | - | 搜索方剂（DB + AI 回退），参数：`name`, `page`, `size` |
| GET | `/api/v1/formulas/:id` | - | 方剂详情 |
| PUT | `/api/v1/formulas/:id/composition` | `role:manage` | 更新方剂药物组成 |
| DELETE | `/api/v1/formulas/:id` | `role:manage` | 删除方剂 |

#### 处方管理（租户隔离）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/prescriptions` | `prescription:create` | 创建处方 |
| GET | `/api/v1/prescriptions/:id` | `prescription:read` | 处方详情 |
| PUT | `/api/v1/prescriptions/:id` | `prescription:create` | 更新处方 |
| DELETE | `/api/v1/prescriptions/:id` | `prescription:create` | 删除处方 |
| GET | `/api/v1/records/:id/prescriptions` | `prescription:read` | 某次就诊的处方列表 |

#### 操作日志

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/oplogs` | `oplog:read` | 操作日志列表 |
| DELETE | `/api/v1/oplogs/:id` | `role:manage` | 删除单条日志 |
| POST | `/api/v1/oplogs/batch-delete` | `role:manage` | 批量删除日志 |

#### 用户管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/users` | `user:manage` | 用户列表 |
| PUT | `/api/v1/users/:id` | `user:manage` | 更新用户 |
| DELETE | `/api/v1/users/:id` | `user:manage` | 删除用户 |
| POST | `/api/v1/users/:id/roles` | `user:manage` | 为用户分配角色 |

#### 角色管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/roles` | `role:manage` | 角色列表 |
| POST | `/api/v1/roles` | `role:manage` | 创建角色 |
| PUT | `/api/v1/roles/:id` | `role:manage` | 更新角色 |
| GET | `/api/v1/permissions` | `role:manage` | 全部权限列表 |

#### 租户/诊所管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/tenants` | `tenant:manage` | 租户列表 |
| POST | `/api/v1/tenants` | `tenant:manage` | 创建租户 |
| PUT | `/api/v1/tenants/:id` | `tenant:manage` | 更新租户 |
| DELETE | `/api/v1/tenants/:id` | `tenant:manage` | 删除租户 |

---

## 核心业务流程

### 中药查询（DB + AI 回退）

```
用户搜索 name
  -> DB: herbs 表 WHERE name LIKE %name% OR alias LIKE %name%
  -> 有结果 -> 返回分页数据
  -> 无结果 且 DeepSeek 已启用
     -> 调用 DeepSeek AI QueryHerb(name)
     -> AI 返回 JSON（name/alias/category/properties/effects/indications/origin）
     -> 验证结果有效性（effects 或 indications 非空）
     -> 有效则写入 herbs 表（source=deepseek），处理唯一键冲突
     -> 返回结果给前端
```

### 方剂查询（DB + AI 回退）

流程与中药查询一致，区别在于方剂额外包含 `composition` JSON 字段（药物组成及剂量）。

### AI 辩证论治分析（含缓存）

```
前端提交诊断文本 + record_id (POST /api/v1/ai/analyze-diagnosis)
  -> 检查 DeepSeek 是否启用
  -> 若 record_id > 0 且 force=false
     -> 查 ai_analyses 表是否有该 record_id 的缓存
     -> 有缓存且 diagnosis 内容一致 -> 返回缓存结果（cached: true）
  -> 缓存未命中或 force=true
     -> 调用 AnalyzeDiagnosis（120s 超时，max_tokens=4096）
     -> upsert 到 ai_analyses 表
     -> 返回分析结果（cached: false）

前端编辑记录时自动加载缓存 (GET /api/v1/records/:id/ai-analysis)
  -> 若有缓存 -> 在诊断旁显示「已有分析」标签
  -> 点击标签可直接查看缓存结果
  -> Drawer 中提供「重新分析」按钮强制刷新
```

### 租户隔离

- JWT 中嵌入 `tenant_id`，`AuthMiddleware` 解析后存入 Gin Context
- 查询租户隔离表时，使用 `middleware.TenantScope(c)` GORM scope 自动注入 `WHERE tenant_id = ?`
- 中药（herbs）和方剂（formulas）为全局数据，不做租户隔离，路由仅需认证无需特定权限

### RBAC 权限控制

- 用户 -> user_roles -> 角色 -> role_permissions -> 权限
- `RequirePermission` 中间件检查用户是否拥有指定权限码（支持 OR 匹配）
- 管理员角色在 seed 时自动关联全部权限

### 操作审计

- `LogOperation` helper 在 handler 中调用，记录 action/resource_type/resource_id/old_data/new_data
- best-effort：记录失败不影响业务请求
- 备份脚本自动清理 3 个月前的日志

---

## 配置与环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_HOST` | `localhost` | MySQL 主机 |
| `DB_PORT` | `3306` | MySQL 端口 |
| `DB_USER` | `menzhen` | MySQL 用户名 |
| `DB_PASSWORD` | `menzhen123` | MySQL 密码 |
| `DB_NAME` | `menzhen` | MySQL 数据库名 |
| `JWT_SECRET` | `change-me-in-production` | JWT 签名密钥 |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO 地址 |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO 访问密钥 |
| `MINIO_SECRET_KEY` | `minioadmin` | MinIO 秘密密钥 |
| `MINIO_BUCKET` | `menzhen` | MinIO 桶名 |
| `SERVER_PORT` | `8080` | 后端服务端口 |
| `DEEPSEEK_API_KEY` | （内置） | DeepSeek API 密钥 |
| `DEEPSEEK_BASE_URL` | `https://api.qnaigc.com/v1/messages` | DeepSeek API 地址 |
| `DEEPSEEK_MODEL` | `deepseek/deepseek-v3.2-251201` | AI 模型名称 |
| `QINIU_ACCESS_KEY` | （无默认） | 七牛云 Access Key |
| `QINIU_SECRET_KEY` | （无默认） | 七牛云 Secret Key |
| `QINIU_BUCKET` | （无默认） | 七牛云存储空间名 |
| `QINIU_KEY_PREFIX` | `menzhen-backup/` | 七牛云上传路径前缀 |

---

## 脚本与部署

### 部署脚本

| 脚本 | 用途 |
|------|------|
| `deploy.sh` | 一键部署：检查 Docker -> 生成 `.env`（随机密码）-> 构建镜像 -> 启动服务 -> 等待 MySQL -> 可选恢复 |

```bash
./deploy.sh                            # 首次部署
./deploy.sh --restore /path/to/backup  # 从备份恢复部署
```

### 备份恢复脚本

| 脚本 | 用途 |
|------|------|
| `scripts/backup.sh` | 全量备份：MySQL dump + 清理 3 月前 oplog + 清理 3 天前备份 + 上传七牛云 |
| `scripts/backup-loop.sh` | 定时备份守护：每小时触发备份，启动时检测最近备份是否超过 1 小时 |
| `scripts/restore.sh` | 恢复：导入 MySQL dump + 同步 MinIO 文件 + 验证数据完整性 |
| `scripts/upload_to_qiniu.py` | 七牛云上传：备份完成后自动上传 SQL 文件，AK/SK 从环境变量读取 |
| `scripts/seed-herbs-formulas.sh` | 中药/方剂数据播种：通过 API 逐条搜索触发 DeepSeek 回退自动入库，支持进度恢复、dry-run |
| `scripts/Dockerfile.backup` | 备份容器镜像：alpine + mysql-client + MinIO Client (mc) + python3 + qiniu SDK |

### Docker Compose 服务

| 服务 | 镜像/构建 | 端口 | 说明 |
|------|-----------|------|------|
| `nginx` | `nginx:alpine` | `80:80` | 反向代理前后端 |
| `web` | `./web` 构建 | - | React 前端 |
| `api` | `./server` 构建 | - | Go 后端（依赖 mysql + minio） |
| `mysql` | `mysql:8.0` | - | 数据库（health check） |
| `minio` | `minio/minio` | - | 对象存储（console 端口 9001） |
| `backup` | `./scripts` 构建 | - | 定时备份（unless-stopped） |

### 种子数据

启动时 `Seed()` 幂等写入：
1. **16 个权限** — upsert 模式（逐条检查 code，不存在则创建）
2. **默认租户** — code=`default`, name=`默认诊所`
3. **管理员角色** — 关联全部权限（已存在则同步权限集）
4. **管理员用户** — username=`admin`, password=`admin123`
