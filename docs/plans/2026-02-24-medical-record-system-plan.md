# 患者病历系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一套支持多租户的患者病历管理系统，包含完整的前后端、RBAC 权限、文件存储、操作日志、一键部署和自动备份。

**Architecture:** Go (Gin + GORM) 后端提供 RESTful API，React (Ant Design) 前端通过 Nginx 反代对接。MySQL 存储结构化数据，MinIO 存储文件附件。Docker Compose 编排所有服务，备份容器独立运行定时任务。

**Tech Stack:** Go 1.22+, Gin, GORM, MySQL 8.0, MinIO, React 18, TypeScript, Ant Design 5, Docker Compose, Nginx

**Design doc:** `docs/plans/2026-02-24-medical-record-system-design.md`

---

## Phase 1: 项目脚手架与基础设施

### Task 1: 初始化 Go 后端项目

**Files:**
- Create: `server/go.mod`
- Create: `server/main.go`
- Create: `server/config/config.go`

**Step 1: 初始化 Go module**

```bash
cd server && go mod init github.com/callmefisher/menzhen/server
```

**Step 2: 创建配置加载**

Create `server/config/config.go`:
```go
package config

import "os"

type Config struct {
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
	JWTSecret  string
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOBucket    string
	ServerPort string
}

func Load() *Config {
	return &Config{
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "3306"),
		DBUser:     getEnv("DB_USER", "menzhen"),
		DBPassword: getEnv("DB_PASSWORD", "menzhen123"),
		DBName:     getEnv("DB_NAME", "menzhen"),
		JWTSecret:  getEnv("JWT_SECRET", "change-me-in-production"),
		MinIOEndpoint:  getEnv("MINIO_ENDPOINT", "localhost:9000"),
		MinIOAccessKey: getEnv("MINIO_ACCESS_KEY", "minioadmin"),
		MinIOSecretKey: getEnv("MINIO_SECRET_KEY", "minioadmin"),
		MinIOBucket:    getEnv("MINIO_BUCKET", "menzhen"),
		ServerPort: getEnv("SERVER_PORT", "8080"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

**Step 3: 创建 main.go 入口**

Create `server/main.go`:
```go
package main

import (
	"log"
	"github.com/callmefisher/menzhen/server/config"
)

func main() {
	cfg := config.Load()
	log.Printf("Starting server on port %s", cfg.ServerPort)
}
```

**Step 4: 安装核心依赖**

```bash
cd server
go get github.com/gin-gonic/gin
go get gorm.io/gorm
go get gorm.io/driver/mysql
go get github.com/golang-jwt/jwt/v5
go get github.com/minio/minio-go/v7
go get golang.org/x/crypto/bcrypt
```

**Step 5: 验证编译通过**

```bash
cd server && go build ./...
```

**Step 6: Commit**

```bash
git add server/
git commit -m "feat: init Go backend with config loader"
```

---

### Task 2: 初始化 React 前端项目

**Files:**
- Create: `web/` (Vite scaffold)

**Step 1: 创建 Vite + React + TypeScript 项目**

```bash
cd /path/to/menzhen
npm create vite@latest web -- --template react-ts
```

**Step 2: 安装依赖**

```bash
cd web
npm install
npm install antd @ant-design/icons
npm install react-router-dom
npm install axios
npm install dayjs
```

**Step 3: 验证开发服务器启动**

```bash
cd web && npm run dev
# 验证 http://localhost:5173 可访问
```

**Step 4: Commit**

```bash
git add web/
git commit -m "feat: init React frontend with Vite + Ant Design"
```

---

### Task 3: 创建 Docker Compose 基础编排

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `server/Dockerfile`
- Create: `web/Dockerfile`
- Create: `nginx/nginx.conf`

**Step 1: 创建 .env.example**

```env
# MySQL
DB_HOST=mysql
DB_PORT=3306
DB_USER=menzhen
DB_PASSWORD=menzhen123
DB_NAME=menzhen

# JWT
JWT_SECRET=change-me-in-production

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=menzhen

# Server
SERVER_PORT=8080

# Backup
BACKUP_DIR=/backups
BACKUP_HOUR=2
```

**Step 2: 创建 server/Dockerfile**

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /menzhen-api .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai
COPY --from=builder /menzhen-api /usr/local/bin/menzhen-api
EXPOSE 8080
CMD ["menzhen-api"]
```

**Step 3: 创建 web/Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
```

**Step 4: 创建 nginx/nginx.conf**

```nginx
server {
    listen 80;
    server_name _;

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 100m;
    }
}
```

**Step 5: 创建 docker-compose.yml**

```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf
      - web-dist:/usr/share/nginx/html
    depends_on:
      - api
      - web

  web:
    build: ./web
    volumes:
      - web-dist:/usr/share/nginx/html

  api:
    build: ./server
    env_file: .env
    depends_on:
      mysql:
        condition: service_healthy
      minio:
        condition: service_started

  mysql:
    image: mysql:8.0
    env_file: .env
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - minio-data:/data

volumes:
  mysql-data:
  minio-data:
  web-dist:
```

**Step 6: Commit**

```bash
git add docker-compose.yml .env.example server/Dockerfile web/Dockerfile nginx/
git commit -m "feat: add Docker Compose with MySQL, MinIO, Nginx"
```

---

## Phase 2: 后端核心 — 数据库与认证

### Task 4: 定义 GORM 数据模型

**Files:**
- Create: `server/model/tenant.go`
- Create: `server/model/user.go`
- Create: `server/model/role.go`
- Create: `server/model/permission.go`
- Create: `server/model/patient.go`
- Create: `server/model/medical_record.go`
- Create: `server/model/record_attachment.go`
- Create: `server/model/oplog.go`
- Create: `server/model/base.go`

**Step 1: 创建 base model**

Create `server/model/base.go`:
```go
package model

import (
	"time"
	"gorm.io/gorm"
)

type BaseModel struct {
	ID        uint64         `gorm:"primaryKey;autoIncrement" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
```

**Step 2: 创建所有模型文件**

按照设计文档中的数据模型逐一创建，字段需与设计完全一致。每个模型一个文件。关键点：
- Tenant: id, name, code, status, created_at
- User: id, tenant_id, username, password_hash, real_name, phone, status, created_at
- Role: id, tenant_id, name, description
- Permission: id, code, name, description
- RolePermission: role_id, permission_id (联合主键)
- UserRole: user_id, role_id (联合主键)
- Patient: id, tenant_id, name, gender, age, weight, phone, id_card, created_at, updated_at, created_by
- MedicalRecord: id, patient_id, tenant_id, diagnosis, treatment, notes, visit_date, created_at, updated_at, created_by
- RecordAttachment: id, record_id, file_type, file_name, file_path, file_size, created_at
- OpLog: id, tenant_id, user_id, user_name, action, resource_type, resource_id, old_data(JSON), new_data(JSON), created_at

**Step 3: 验证编译**

```bash
cd server && go build ./...
```

**Step 4: Commit**

```bash
git add server/model/
git commit -m "feat: add GORM data models for all tables"
```

---

### Task 5: 数据库连接与自动迁移

**Files:**
- Create: `server/database/database.go`
- Create: `server/database/seed.go`
- Modify: `server/main.go`

**Step 1: 创建数据库初始化**

Create `server/database/database.go`:
- 使用 GORM 连接 MySQL
- AutoMigrate 所有模型
- 返回 *gorm.DB 实例

**Step 2: 创建种子数据**

Create `server/database/seed.go`:
- 初始化预置权限（patient:create 等 11 个）
- 创建默认租户
- 创建默认管理员角色（拥有所有权限）
- 创建默认管理员用户（admin/admin123，首次登录强制改密）

**Step 3: 在 main.go 中集成**

修改 `server/main.go`，启动时：
1. 加载配置
2. 连接数据库并迁移
3. 执行种子数据

**Step 4: 验证编译**

```bash
cd server && go build ./...
```

**Step 5: Commit**

```bash
git add server/database/ server/main.go
git commit -m "feat: add database connection, migration, and seed data"
```

---

### Task 6: JWT 认证与中间件

**Files:**
- Create: `server/middleware/auth.go`
- Create: `server/middleware/tenant.go`
- Create: `server/handler/auth.go`
- Create: `server/service/auth.go`

**Step 1: 创建 JWT 工具**

Create `server/middleware/auth.go`:
- GenerateToken(userID, tenantID, username): 生成 JWT，有效期 24h
- AuthMiddleware(): Gin 中间件，解析 JWT，将 userID/tenantID 注入 context

**Step 2: 创建租户隔离中间件**

Create `server/middleware/tenant.go`:
- TenantMiddleware(): 从 context 获取 tenantID，注入到 GORM scope 中
- 所有查询自动加 WHERE tenant_id = ?

**Step 3: 创建认证 service 和 handler**

Create `server/service/auth.go`:
- Login(username, password) → token
- Register(tenantCode, username, password, realName, phone)
- GetCurrentUser(userID) → user info + permissions

Create `server/handler/auth.go`:
- POST /api/v1/auth/login
- POST /api/v1/auth/register
- POST /api/v1/auth/logout
- GET /api/v1/auth/me

**Step 4: 验证编译**

```bash
cd server && go build ./...
```

**Step 5: Commit**

```bash
git add server/middleware/ server/handler/auth.go server/service/auth.go
git commit -m "feat: add JWT auth, tenant isolation middleware"
```

---

### Task 7: RBAC 权限中间件

**Files:**
- Create: `server/middleware/rbac.go`
- Create: `server/service/permission.go`

**Step 1: 创建权限检查 service**

Create `server/service/permission.go`:
- GetUserPermissions(userID) → []string (权限 code 列表)
- HasPermission(userID, permCode) → bool

**Step 2: 创建 RBAC 中间件**

Create `server/middleware/rbac.go`:
- RequirePermission(permCode string) gin.HandlerFunc
- 从 context 获取 userID，查询权限，无权限返回 403

**Step 3: 验证编译**

```bash
cd server && go build ./...
```

**Step 4: Commit**

```bash
git add server/middleware/rbac.go server/service/permission.go
git commit -m "feat: add RBAC permission middleware"
```

---

### Task 8: OpLog 中间件

**Files:**
- Create: `server/middleware/oplog.go`
- Create: `server/service/oplog.go`
- Create: `server/handler/oplog.go`

**Step 1: 创建 oplog service**

Create `server/service/oplog.go`:
- CreateOpLog(tenantID, userID, userName, action, resourceType, resourceID, oldData, newData)
- QueryOpLogs(tenantID, name, startDate, endDate, page, size) → ([]OpLog, total)

**Step 2: 创建 oplog 记录辅助函数**

Create `server/middleware/oplog.go`:
- LogOperation(): 在 handler 中调用的辅助函数，记录操作前后数据变化
- 不是传统 middleware，而是 service 层调用的记录函数

**Step 3: 创建 oplog 查询 handler**

Create `server/handler/oplog.go`:
- GET /api/v1/oplogs — 按时间和姓名查询

**Step 4: Commit**

```bash
git add server/middleware/oplog.go server/service/oplog.go server/handler/oplog.go
git commit -m "feat: add operation log recording and query"
```

---

## Phase 3: 后端业务 — CRUD 接口

### Task 9: 患者管理接口

**Files:**
- Create: `server/handler/patient.go`
- Create: `server/service/patient.go`

**Step 1: 创建 patient service**

Create `server/service/patient.go`:
- CreatePatient(tenantID, req) → Patient
- GetPatient(tenantID, id) → Patient (含 MedicalRecords 预加载)
- ListPatients(tenantID, name, page, size) → ([]Patient, total)
- UpdatePatient(tenantID, id, req) → Patient
- DeletePatient(tenantID, id) → soft delete

每个写操作调用 oplog service 记录变更。

**Step 2: 创建 patient handler**

Create `server/handler/patient.go`:
- GET /api/v1/patients — 列表查询（姓名搜索+分页）
- POST /api/v1/patients — 新增
- GET /api/v1/patients/:id — 详情（含诊疗记录时间线）
- PUT /api/v1/patients/:id — 修改
- DELETE /api/v1/patients/:id — 删除

**Step 3: 验证编译**

```bash
cd server && go build ./...
```

**Step 4: Commit**

```bash
git add server/handler/patient.go server/service/patient.go
git commit -m "feat: add patient CRUD endpoints"
```

---

### Task 10: 诊疗记录接口

**Files:**
- Create: `server/handler/record.go`
- Create: `server/service/record.go`

**Step 1: 创建 record service**

Create `server/service/record.go`:
- CreateRecord(tenantID, req) → MedicalRecord
- GetRecord(tenantID, id) → MedicalRecord (含 Attachments 预加载)
- ListRecords(tenantID, name, date, page, size, sort) → ([]RecordWithPatient, total)
  - JOIN patients 表，支持按患者姓名搜索
  - 支持按 visit_date 排序
- UpdateRecord(tenantID, id, req) → MedicalRecord
- DeleteRecord(tenantID, id)

每个写操作调用 oplog service。

**Step 2: 创建 record handler**

Create `server/handler/record.go`:
- GET /api/v1/records — 列表（姓名+日期搜索+分页+排序）
- POST /api/v1/records — 新增
- GET /api/v1/records/:id — 详情（含附件列表）
- PUT /api/v1/records/:id — 修改
- DELETE /api/v1/records/:id — 删除

**Step 3: 验证编译**

```bash
cd server && go build ./...
```

**Step 4: Commit**

```bash
git add server/handler/record.go server/service/record.go
git commit -m "feat: add medical record CRUD endpoints"
```

---

### Task 11: 文件上传接口 (MinIO)

**Files:**
- Create: `server/storage/minio.go`
- Create: `server/handler/upload.go`

**Step 1: 创建 MinIO 客户端封装**

Create `server/storage/minio.go`:
- InitMinIO(cfg) → *minio.Client
- UploadFile(bucketName, objectName, reader, size, contentType) → objectKey
- GetFileURL(bucketName, objectName) → presigned URL (有效期 1h)
- 启动时自动创建 bucket（如不存在）

**Step 2: 创建上传 handler**

Create `server/handler/upload.go`:
- POST /api/v1/upload — multipart form 上传
  - 接收文件，校验类型（image/audio/video）
  - 上传到 MinIO，生成唯一 objectKey
  - 返回 {file_path, file_name, file_size, file_type}
- GET /api/v1/files/:key — 返回预签名 URL 或代理下载

**Step 3: 验证编译**

```bash
cd server && go build ./...
```

**Step 4: Commit**

```bash
git add server/storage/ server/handler/upload.go
git commit -m "feat: add MinIO file upload and download"
```

---

### Task 12: 用户与角色管理接口

**Files:**
- Create: `server/handler/user.go`
- Create: `server/handler/role.go`
- Create: `server/service/user.go`
- Create: `server/service/role.go`

**Step 1: 创建 user service + handler**

- GET /api/v1/users — 用户列表
- PUT /api/v1/users/:id — 修改用户
- DELETE /api/v1/users/:id — 禁用用户
- POST /api/v1/users/:id/roles — 分配角色

**Step 2: 创建 role service + handler**

- GET /api/v1/roles — 角色列表（含权限）
- POST /api/v1/roles — 创建角色
- PUT /api/v1/roles/:id — 修改角色（更新权限列表）
- GET /api/v1/permissions — 所有可用权限列表

**Step 3: 验证编译**

```bash
cd server && go build ./...
```

**Step 4: Commit**

```bash
git add server/handler/user.go server/handler/role.go server/service/user.go server/service/role.go
git commit -m "feat: add user and role management endpoints"
```

---

### Task 13: 路由注册与统一响应

**Files:**
- Create: `server/router/router.go`
- Create: `server/handler/response.go`
- Modify: `server/main.go`

**Step 1: 创建统一响应工具**

Create `server/handler/response.go`:
```go
func Success(c *gin.Context, data interface{})
func SuccessWithPagination(c *gin.Context, data interface{}, page, size int, total int64)
func Error(c *gin.Context, httpCode int, code int, message string)
```

**Step 2: 创建路由注册**

Create `server/router/router.go`:
- 注册所有路由，应用中间件
- 公开路由：login
- 认证路由：me, logout, register
- 业务路由：patients, records, upload, files, oplogs（认证 + RBAC）
- 管理路由：users, roles（认证 + user:manage/role:manage）

**Step 3: 更新 main.go**

完整启动流程：
1. 加载配置
2. 连接数据库 + 迁移 + 种子数据
3. 初始化 MinIO
4. 注册路由
5. 启动 HTTP 服务器

**Step 4: 验证编译并手动测试 login**

```bash
cd server && go build ./...
# 启动 MySQL + MinIO (docker compose up mysql minio -d)
# 运行 server，测试 POST /api/v1/auth/login
```

**Step 5: Commit**

```bash
git add server/router/ server/handler/response.go server/main.go
git commit -m "feat: add router registration and unified response"
```

---

## Phase 4: 前端页面

### Task 14: 前端基础架构

**Files:**
- Modify: `web/src/App.tsx`
- Create: `web/src/api/client.ts`
- Create: `web/src/api/auth.ts`
- Create: `web/src/store/auth.ts`
- Create: `web/src/components/Layout.tsx`
- Create: `web/src/utils/request.ts`

**Step 1: 创建 axios 请求封装**

Create `web/src/utils/request.ts`:
- 基础 URL: `/api/v1`
- 请求拦截器：自动附加 JWT token
- 响应拦截器：统一错误处理，401 跳转登录

**Step 2: 创建 auth API 和状态管理**

Create `web/src/api/auth.ts`:
- login(username, password)
- register(...)
- getMe()
- logout()

Create `web/src/store/auth.ts`:
- 使用 React Context 或 zustand
- 存储 user info, token, permissions
- 提供 hasPermission(code) 检查函数

**Step 3: 创建主布局**

Create `web/src/components/Layout.tsx`:
- Ant Design Layout: Sider + Header + Content
- 侧边栏菜单：病历列表、患者管理、操作日志、系统设置
- 顶栏：用户名 + 登出按钮
- 菜单项根据权限动态显示/隐藏

**Step 4: 配置路由**

Modify `web/src/App.tsx`:
- React Router 配置所有路由
- 登录页不需要布局
- 其他页面使用主布局包裹
- 路由守卫：未登录跳转 /login

**Step 5: 验证开发服务器**

```bash
cd web && npm run dev
```

**Step 6: Commit**

```bash
git add web/src/
git commit -m "feat: add frontend base architecture, routing, auth state"
```

---

### Task 15: 登录与注册页面

**Files:**
- Create: `web/src/pages/Login.tsx`
- Create: `web/src/pages/Register.tsx`

**Step 1: 创建登录页**

- Ant Design Form: 用户名 + 密码 + 登录按钮
- 居中卡片布局，带系统 logo/标题
- 登录成功后跳转 /records
- 错误提示

**Step 2: 创建注册页**

- 表单：诊所编码 + 用户名 + 密码 + 确认密码 + 真实姓名 + 手机号
- 注册成功后跳转登录页

**Step 3: 验证页面渲染**

```bash
cd web && npm run dev
# 访问 /login 和 /register 页面
```

**Step 4: Commit**

```bash
git add web/src/pages/Login.tsx web/src/pages/Register.tsx
git commit -m "feat: add login and register pages"
```

---

### Task 16: 病历列表页（默认首页）

**Files:**
- Create: `web/src/pages/records/RecordList.tsx`
- Create: `web/src/api/record.ts`

**Step 1: 创建 record API**

Create `web/src/api/record.ts`:
- listRecords(params: {name?, date?, page, size, sort})
- getRecord(id)
- createRecord(data)
- updateRecord(id, data)
- deleteRecord(id)

**Step 2: 创建病历列表页**

Create `web/src/pages/records/RecordList.tsx`:
- 搜索栏：姓名 Input + 日期 RangePicker + 搜索 Button + 重置 Button
- Ant Design Table:
  - 列：患者姓名、年龄、就诊日期、诊断摘要、操作（查看/编辑/删除）
  - 默认按 visit_date 降序
- Pagination 组件，每页 20 条
- 删除确认 Modal
- 新增按钮 → 跳转 /records/new

**Step 3: 验证页面渲染**

**Step 4: Commit**

```bash
git add web/src/pages/records/RecordList.tsx web/src/api/record.ts
git commit -m "feat: add medical record list page with search and pagination"
```

---

### Task 17: 诊疗记录录入/编辑页

**Files:**
- Create: `web/src/pages/records/RecordForm.tsx`
- Create: `web/src/api/upload.ts`
- Create: `web/src/components/FileUpload.tsx`

**Step 1: 创建文件上传组件**

Create `web/src/components/FileUpload.tsx`:
- Ant Design Upload (Dragger)
- 支持图片/音频/视频
- 显示上传进度
- 上传到 /api/v1/upload
- 返回已上传文件列表

**Step 2: 创建录入/编辑页**

Create `web/src/pages/records/RecordForm.tsx`:
- 患者选择：Select + 搜索 (调用 patients API)，或 "新建患者" 按钮
- 就诊日期 DatePicker
- 诊断 TextArea
- 治疗方案 TextArea
- 备注 TextArea
- 文件上传区域（使用 FileUpload 组件）
- 保存按钮
- 编辑模式：根据 URL params 加载已有数据

**Step 3: Commit**

```bash
git add web/src/pages/records/RecordForm.tsx web/src/api/upload.ts web/src/components/FileUpload.tsx
git commit -m "feat: add record create/edit page with file upload"
```

---

### Task 18: 患者管理页面

**Files:**
- Create: `web/src/pages/patients/PatientList.tsx`
- Create: `web/src/pages/patients/PatientDetail.tsx`
- Create: `web/src/pages/patients/PatientForm.tsx`
- Create: `web/src/api/patient.ts`

**Step 1: 创建 patient API**

Create `web/src/api/patient.ts`:
- listPatients(params)
- getPatient(id)
- createPatient(data)
- updatePatient(id, data)
- deletePatient(id)

**Step 2: 创建患者列表页**

- 搜索栏：姓名搜索 + 分页
- Table: 姓名、性别、年龄、体重、联系电话、操作

**Step 3: 创建患者详情页**

- 顶部 Card：基本信息（姓名、年龄、体重、性别、联系方式）
- 下方 Timeline：历次就诊记录按时间倒序排列
  - 每条：日期 + 诊断 + 治疗方案
  - 展开：详细文字 + 图片 Image.PreviewGroup + Audio 播放器 + Video 播放器
- "新增就诊记录" 按钮

**Step 4: 创建患者新增/编辑表单**

- Modal 或独立页面
- 字段：姓名、性别、年龄、体重、联系电话、身份证号

**Step 5: Commit**

```bash
git add web/src/pages/patients/ web/src/api/patient.ts
git commit -m "feat: add patient list, detail with timeline, create/edit"
```

---

### Task 19: 操作日志页面

**Files:**
- Create: `web/src/pages/OpLogList.tsx`
- Create: `web/src/api/oplog.ts`

**Step 1: 创建 oplog API**

Create `web/src/api/oplog.ts`:
- listOpLogs(params: {name?, start_date?, end_date?, page, size})

**Step 2: 创建操作日志页**

- 搜索栏：操作人姓名 + 日期范围
- Table: 操作时间、操作人、操作类型(create/update/delete)、资源类型、资源ID
- 点击行展开：显示变更前后的 JSON diff

**Step 3: Commit**

```bash
git add web/src/pages/OpLogList.tsx web/src/api/oplog.ts
git commit -m "feat: add operation log query page"
```

---

### Task 20: 系统设置 — 用户与角色管理

**Files:**
- Create: `web/src/pages/settings/UserList.tsx`
- Create: `web/src/pages/settings/RoleList.tsx`
- Create: `web/src/api/user.ts`
- Create: `web/src/api/role.ts`

**Step 1: 创建 API 封装**

- user.ts: listUsers, updateUser, deleteUser, assignRoles
- role.ts: listRoles, createRole, updateRole, listPermissions

**Step 2: 创建用户管理页**

- Table: 用户名、真实姓名、手机号、角色、状态、操作
- 操作：编辑、分配角色（Modal + Transfer 组件）、禁用/启用

**Step 3: 创建角色管理页**

- Table: 角色名、描述、权限数量、操作
- 新增/编辑角色 Modal: 名称 + 描述 + 权限 Checkbox 勾选

**Step 4: Commit**

```bash
git add web/src/pages/settings/ web/src/api/user.ts web/src/api/role.ts
git commit -m "feat: add user and role management pages"
```

---

## Phase 5: 部署与运维脚本

### Task 21: 一键部署脚本

**Files:**
- Create: `deploy.sh`

**Step 1: 创建 deploy.sh**

```bash
#!/bin/bash
set -e

# 1. 检查 Docker 和 Docker Compose
# 2. 如果 .env 不存在，从 .env.example 复制并生成随机密码/密钥
# 3. docker compose build
# 4. docker compose up -d
# 5. 等待 MySQL healthy
# 6. 如果指定了备份目录 (--restore /path/to/backup)，执行 restore.sh
# 7. 输出访问地址
```

**Step 2: 测试脚本执行**

```bash
chmod +x deploy.sh
./deploy.sh
```

**Step 3: Commit**

```bash
git add deploy.sh
git commit -m "feat: add one-click deploy script"
```

---

### Task 22: 备份与恢复脚本

**Files:**
- Create: `scripts/backup-loop.sh`
- Create: `scripts/backup.sh`
- Create: `scripts/restore.sh`
- Create: `scripts/Dockerfile.backup`
- Modify: `docker-compose.yml` (添加 backup 服务)

**Step 1: 创建 backup.sh（单次备份）**

```bash
#!/bin/bash
# 1. 创建备份目录 backup-YYYY-MM-DD/
# 2. mysqldump 全量导出
# 3. mc mirror MinIO bucket 到备份目录
# 4. 清理 3 个月前的 oplog
# 5. 输出备份结果
```

**Step 2: 创建 backup-loop.sh（守护循环）**

```bash
#!/bin/bash
BACKUP_DONE_FILE="/tmp/backup-done-$(date +%Y%m%d)"

while true; do
    CURRENT_HOUR=$(date +%H)
    TODAY_FILE="/tmp/backup-done-$(date +%Y%m%d)"

    if [ "$CURRENT_HOUR" -eq "${BACKUP_HOUR:-2}" ] && [ ! -f "$TODAY_FILE" ]; then
        echo "[$(date)] Starting daily backup..."
        /scripts/backup.sh
        touch "$TODAY_FILE"
        # 清理旧标记文件
        find /tmp -name "backup-done-*" -mtime +1 -delete
        echo "[$(date)] Backup completed."
    fi

    sleep 3600
done
```

**Step 3: 创建 restore.sh**

```bash
#!/bin/bash
# 参数: 备份目录路径
# 1. 验证备份目录存在
# 2. mysql < backup.sql
# 3. mc mirror 恢复 MinIO 文件
# 4. 验证数据完整性（表行数检查）
```

**Step 4: 创建 Dockerfile.backup**

```dockerfile
FROM alpine:3.19
RUN apk add --no-cache mysql-client bash curl
# 安装 mc (MinIO Client)
RUN curl -o /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc && chmod +x /usr/local/bin/mc
COPY backup-loop.sh backup.sh restore.sh /scripts/
RUN chmod +x /scripts/*.sh
CMD ["/scripts/backup-loop.sh"]
```

**Step 5: 在 docker-compose.yml 添加 backup 服务**

```yaml
  backup:
    build:
      context: ./scripts
      dockerfile: Dockerfile.backup
    env_file: .env
    volumes:
      - ./backups:/backups
    depends_on:
      mysql:
        condition: service_healthy
```

**Step 6: Commit**

```bash
git add scripts/ docker-compose.yml
git commit -m "feat: add backup loop, manual backup, restore scripts"
```

---

## Phase 6: 集成测试与收尾

### Task 23: 端到端验证

**Step 1: 完整构建并启动**

```bash
cp .env.example .env
docker compose build
docker compose up -d
```

**Step 2: 验证核心流程**

1. 访问 http://localhost，看到登录页
2. 使用 admin/admin123 登录
3. 查看病历列表（空）
4. 新增患者
5. 新增诊疗记录（含图片/音频/视频上传）
6. 在病历列表按姓名搜索
7. 在病历列表按日期搜索
8. 查看患者详情，验证时间线展示
9. 修改诊疗记录
10. 删除诊疗记录
11. 查看操作日志
12. 创建新角色，分配权限
13. 创建新用户，分配角色
14. 用新用户登录，验证权限限制

**Step 3: 验证备份恢复**

```bash
# 手动触发备份
docker compose exec backup /scripts/backup.sh
# 检查备份文件
ls -la backups/
# 销毁数据
docker compose down -v
# 重新部署并恢复
./deploy.sh --restore ./backups/backup-2026-02-24
```

**Step 4: 修复发现的问题**

**Step 5: 最终 Commit**

```bash
git add -A
git commit -m "fix: integration test fixes"
```

---

### Task 24: 更新项目文档

**Files:**
- Modify: `CLAUDE.md`

**Step 1: 更新 CLAUDE.md**

添加以下内容：
- 项目结构说明
- 开发环境启动方式
- 部署说明（引用 deploy.sh）
- API 文档引用（指向设计文档）

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with project structure and dev guide"
```
