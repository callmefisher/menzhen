# 患者病历系统设计方案

## 一、概述

构建一套患者病历管理系统，支持中小诊所局域网部署和多诊所云端共享部署。系统采用多租户架构，RBAC 权限体系，Docker Compose 一键部署。

### 技术选型

| 层 | 技术 |
|---|------|
| 前端 | React 18 + TypeScript + Ant Design 5 + React Router |
| 后端 | Go + Gin + GORM |
| 数据库 | MySQL 8.0 |
| 文件存储 | MinIO |
| 认证 | JWT |
| 部署 | Docker Compose |
| 反代 | Nginx |

### 架构图

```
┌──────────────┐     ┌──────────────┐     ┌──────────┐
│  React +     │────▶│  Golang API  │────▶│  MySQL   │
│  Ant Design  │     │  (Gin)       │────▶│  MinIO   │
└──────────────┘     └──────────────┘     └──────────┘
       │                    │
       └── Nginx ───────────┘
       (前端静态 + API反代)

Docker Compose 服务：
  - nginx (前端静态文件 + API 反向代理, 端口 80)
  - api   (Go 二进制, 端口 8080 内部)
  - mysql (MySQL 8.0, 端口 3306 内部)
  - minio (MinIO, 端口 9000/9001 内部)
  - backup (备份守护容器)
```

---

## 二、数据模型

### tenants（租户/诊所）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| name | VARCHAR(100) | 诊所名称 |
| code | VARCHAR(50) UNIQUE | 诊所编码 |
| status | TINYINT | 状态：1启用 0禁用 |
| created_at | DATETIME | 创建时间 |

### users（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| tenant_id | BIGINT FK | 所属租户 |
| username | VARCHAR(50) | 用户名 |
| password_hash | VARCHAR(255) | 密码哈希 |
| real_name | VARCHAR(50) | 真实姓名 |
| phone | VARCHAR(20) | 手机号 |
| status | TINYINT | 状态：1启用 0禁用 |
| created_at | DATETIME | 创建时间 |

### roles（角色）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| tenant_id | BIGINT FK | 所属租户 |
| name | VARCHAR(50) | 角色名称 |
| description | VARCHAR(200) | 角色描述 |

### permissions（权限）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| code | VARCHAR(50) UNIQUE | 权限编码 |
| name | VARCHAR(50) | 权限名称 |
| description | VARCHAR(200) | 权限描述 |

预置权限：
- `patient:create`, `patient:read`, `patient:update`, `patient:delete`
- `record:create`, `record:read`, `record:update`, `record:delete`
- `oplog:read`
- `user:manage`, `role:manage`

### role_permissions（角色-权限关联）

| 字段 | 类型 | 说明 |
|------|------|------|
| role_id | BIGINT FK | 角色ID |
| permission_id | BIGINT FK | 权限ID |

### user_roles（用户-角色关联）

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | BIGINT FK | 用户ID |
| role_id | BIGINT FK | 角色ID |

### patients（患者）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| tenant_id | BIGINT FK | 所属租户 |
| name | VARCHAR(50) | 姓名 |
| gender | TINYINT | 性别：1男 2女 |
| age | INT | 年龄 |
| weight | DECIMAL(5,1) | 体重(kg) |
| phone | VARCHAR(20) | 联系电话 |
| id_card | VARCHAR(20) | 身份证号 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |
| created_by | BIGINT FK | 创建人 |

### medical_records（诊疗记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| patient_id | BIGINT FK | 患者ID |
| tenant_id | BIGINT FK | 所属租户 |
| diagnosis | TEXT | 诊断 |
| treatment | TEXT | 治疗方案 |
| notes | TEXT | 备注 |
| visit_date | DATE | 就诊日期 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |
| created_by | BIGINT FK | 创建人 |

### record_attachments（附件）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| record_id | BIGINT FK | 诊疗记录ID |
| file_type | VARCHAR(20) | 类型：image/audio/video |
| file_name | VARCHAR(255) | 原始文件名 |
| file_path | VARCHAR(500) | MinIO object key |
| file_size | BIGINT | 文件大小(bytes) |
| created_at | DATETIME | 创建时间 |

### op_logs（操作日志）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| tenant_id | BIGINT FK | 所属租户 |
| user_id | BIGINT FK | 操作人 |
| user_name | VARCHAR(50) | 操作人姓名（冗余） |
| action | VARCHAR(20) | 操作：create/update/delete |
| resource_type | VARCHAR(50) | 资源类型：patient/record/attachment |
| resource_id | BIGINT | 资源ID |
| old_data | JSON | 变更前数据 |
| new_data | JSON | 变更后数据 |
| created_at | DATETIME | 操作时间 |

**设计要点**：
- 患者与诊疗记录分离，一个患者可有多次就诊记录
- 附件存 MinIO，数据库只存 object key 引用
- oplog 记录变更前后完整 JSON，支持审计
- 所有表通过 tenant_id 实现多租户数据隔离
- oplog 只保留 3 个月，患者病历永久保存

---

## 三、API 接口设计

### 通用规范

- **认证**：JWT Bearer Token，除 login/register 外所有接口需认证
- **多租户**：从 JWT 中解析 tenant_id，自动过滤数据
- **响应格式**：

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "pagination": { "page": 1, "size": 20, "total": 100 }
}
```

- **错误码**：0 成功，401 未认证，403 无权限，404 不存在，422 参数错误，500 内部错误

### 认证接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/v1/auth/register` | 注册 | 需管理员权限或邀请码 |
| POST | `/api/v1/auth/login` | 登录，返回 JWT | 公开 |
| POST | `/api/v1/auth/logout` | 登出 | 已认证 |
| GET | `/api/v1/auth/me` | 当前用户信息及权限 | 已认证 |

### 用户与权限管理

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/v1/users` | 用户列表 | user:manage |
| PUT | `/api/v1/users/:id` | 修改用户 | user:manage |
| DELETE | `/api/v1/users/:id` | 禁用用户 | user:manage |
| GET | `/api/v1/roles` | 角色列表 | role:manage |
| POST | `/api/v1/roles` | 创建角色 | role:manage |
| PUT | `/api/v1/roles/:id` | 修改角色权限 | role:manage |
| POST | `/api/v1/users/:id/roles` | 分配角色 | role:manage |

### 患者管理

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/v1/patients?name=&page=&size=` | 患者列表 | patient:read |
| POST | `/api/v1/patients` | 新增患者 | patient:create |
| GET | `/api/v1/patients/:id` | 患者详情（含诊疗记录） | patient:read |
| PUT | `/api/v1/patients/:id` | 修改患者信息 | patient:update |
| DELETE | `/api/v1/patients/:id` | 删除患者（软删除） | patient:delete |

### 诊疗记录

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/v1/records?name=&date=&page=&size=&sort=visit_date` | 病历列表 | record:read |
| POST | `/api/v1/records` | 新增诊疗记录 | record:create |
| GET | `/api/v1/records/:id` | 记录详情（含附件） | record:read |
| PUT | `/api/v1/records/:id` | 修改记录 | record:update |
| DELETE | `/api/v1/records/:id` | 删除记录 | record:delete |

### 文件上传

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/v1/upload` | 上传文件到 MinIO | 已认证 |
| GET | `/api/v1/files/:key` | 获取文件（代理或预签名URL） | 已认证 |

### 操作日志

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/v1/oplogs?name=&start_date=&end_date=&page=&size=` | 查询操作日志 | oplog:read |

---

## 四、前端页面设计

### 路由结构

```
/login          - 登录页
/register       - 注册页
/               - 主布局（侧边栏 + 顶栏 + 内容区）
  /records      - 病历列表（默认首页，按日期排序，分页）
  /records/new  - 新增诊疗记录
  /records/:id  - 诊疗记录详情/编辑
  /patients     - 患者列表
  /patients/:id - 患者详情（含历次就诊时间线）
  /patients/new - 新增患者
  /oplogs       - 操作日志查询
  /settings     - 系统设置
    /users      - 用户管理
    /roles      - 角色权限管理
```

### 关键页面交互

**病历列表页**（登录后默认页）：
- 顶部搜索栏：姓名输入框 + 日期范围选择器 + 搜索按钮
- 表格展示：患者姓名、年龄、就诊日期、诊断摘要、操作按钮
- 默认按就诊日期降序排列
- 分页组件：每页 20 条，可切换

**患者详情页**：
- 顶部：基本信息卡片（姓名、年龄、体重、联系方式）
- 下方：时间线展示历次就诊记录
  - 每条记录显示日期、诊断、治疗方案
  - 展开可查看文字详情、图片预览、音频播放器、视频播放器

**诊疗记录录入/编辑页**：
- 患者选择（搜索已有患者或新建）
- 诊断信息表单（文字输入）
- 文件上传区域：拖拽上传，支持图片/音频/视频，显示上传进度
- 保存/提交按钮

---

## 五、部署与运维

### Docker Compose 服务

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| nginx | nginx:alpine | 80 (外部) | 前端静态 + API 反代 |
| api | 自建 | 8080 (内部) | Go 后端 |
| mysql | mysql:8.0 | 3306 (内部) | 数据库 |
| minio | minio/minio | 9000/9001 (内部) | 文件存储 |
| backup | 自建 (alpine) | 无 | 备份守护 |

### 一键部署 (`deploy.sh`)

1. 检查 Docker & Docker Compose 是否安装
2. 生成/读取 `.env` 配置（MySQL密码、MinIO密钥、JWT密钥等）
3. `docker compose up -d` 启动所有服务
4. 等待 MySQL 就绪，执行数据库迁移
5. 如有备份数据，自动恢复

### 备份策略

备份容器运行 `backup-loop.sh`，每小时检查一次：

```
while true:
  if 当前小时 == 2 且今天尚未备份:
    1. mysqldump 导出全量数据
    2. mc mirror 同步 MinIO 文件到备份目录
    3. 按日期命名备份: backup-YYYY-MM-DD/
    4. 清理 3 个月前的 oplog 记录
    5. 标记今日已完成
  sleep 3600
```

- 服务重启后最多 1 小时恢复检查，不会错过当天备份
- 支持 `backup.sh --now` 手动立即触发

### 恢复/迁移 (`restore.sh`)

1. 输入备份目录路径
2. mysql 导入 SQL 数据
3. MinIO 文件恢复
4. 验证数据完整性

---

## 六、项目目录结构

```
menzhen/
├── docker-compose.yml
├── deploy.sh
├── .env.example
├── scripts/
│   ├── backup-loop.sh
│   ├── backup.sh
│   ├── restore.sh
│   └── Dockerfile.backup
├── server/
│   ├── main.go
│   ├── go.mod / go.sum
│   ├── config/
│   ├── middleware/
│   ├── model/
│   ├── handler/
│   ├── service/
│   ├── router/
│   ├── migration/
│   └── Dockerfile
├── web/
│   ├── package.json
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── api/
│   │   ├── store/
│   │   ├── utils/
│   │   └── App.tsx / main.tsx
│   └── Dockerfile
└── nginx/
    └── nginx.conf
```
