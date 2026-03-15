# 软件配置页面设计

## 概述

在系统设置下新增「软件配置」入口，允许超级管理员通过 Web UI 维护 `.env` 文件中的所有环境变量。支持初始化部署前配置和部署后修改。

## 需求

- 管理 .env 中全部变量（数据库、JWT、MinIO、DeepSeek、七牛云、备份间隔）
- 直接读写 .env 文件，不使用数据库
- 修改后写入文件，提示需重启容器生效
- 仅 `user:manage` 权限可访问
- 密码/密钥类字段掩码显示

## 前端设计

### 路由与菜单

- **路由**: `/settings/config`
- **菜单位置**: 系统设置 → 软件配置（ToolOutlined 图标）
- **权限**: `user:manage`
- **组件**: `web/src/pages/settings/SystemConfig.tsx`

### 页面结构

6 个分组 Card，每组独立展示：

#### 1. 数据库配置

| 变量 | Label | 控件 | 默认值 |
|------|-------|------|--------|
| DB_HOST | 数据库地址 | Input | localhost |
| DB_PORT | 数据库端口 | InputNumber | 3306 |
| DB_USER | 数据库用户名 | Input | root |
| DB_PASSWORD | 数据库密码 | Input.Password | - |
| DB_NAME | 数据库名 | Input | menzhen |

#### 2. JWT 配置

| 变量 | Label | 控件 | 默认值 |
|------|-------|------|--------|
| JWT_SECRET | JWT 密钥 | Input.Password | - |

#### 3. MinIO 文件存储

| 变量 | Label | 控件 | 默认值 |
|------|-------|------|--------|
| MINIO_ENDPOINT | MinIO 地址 | Input | localhost:9000 |
| MINIO_ACCESS_KEY | Access Key | Input.Password | - |
| MINIO_SECRET_KEY | Secret Key | Input.Password | - |
| MINIO_BUCKET | 存储桶名 | Input | menzhen |

#### 4. DeepSeek AI

| 变量 | Label | 控件 | 默认值 |
|------|-------|------|--------|
| DEEPSEEK_API_KEY | API 密钥 | Input.Password | - |
| DEEPSEEK_BASE_URL | API 地址 | Input | https://api.qnaigc.com/v1/messages |
| DEEPSEEK_MODEL | 模型名称 | Input | deepseek/deepseek-v3.2-251201 |

#### 5. 七牛云备份

| 变量 | Label | 控件 | 默认值 |
|------|-------|------|--------|
| QINIU_ACCESS_KEY | Access Key | Input.Password | - |
| QINIU_SECRET_KEY | Secret Key | Input.Password | - |
| QINIU_BUCKET | 存储空间名 | Input | - |
| QINIU_KEY_PREFIX | 上传路径前缀 | Input | menzhen-backup/ |
| QINIU_DOMAIN | 下载域名 | Input | public.qnlinking.com |
| QINIU_RETAIN_MYSQL | MySQL 备份保留数 | InputNumber | 5 |
| QINIU_RETAIN_MINIO | MinIO 备份保留数 | InputNumber | 5 |

#### 6. 备份间隔

| 变量 | Label | 控件 | 默认值 |
|------|-------|------|--------|
| BACKUP_INTERVAL_MYSQL | MySQL 备份间隔(秒) | InputNumber | 7200 |
| BACKUP_INTERVAL_MINIO | MinIO 备份间隔(秒) | InputNumber | 43200 |

### 交互流程

1. 页面加载 → `GET /api/v1/config` 获取当前配置
2. 密码/密钥字段显示为掩码（`****xxxx`）
3. 用户修改字段值
4. 点击「保存配置」→ `PUT /api/v1/config` 提交
5. 成功后 `message.success("配置已保存，需重启 Docker 容器后生效")`

### 移动端适配

Card 纵向堆叠，自然响应式，与其他设置页面一致。

## 后端设计

### API 端点

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/config | user:manage | 读取 .env，密码字段掩码返回 |
| PUT | /api/v1/config | user:manage | 写入 .env，写入前备份为 .env.bak |

### 文件结构

- `server/handler/config.go` — HTTP handler
- `server/service/config.go` — .env 读写逻辑

### GET /api/v1/config 响应

```json
{
  "DB_HOST": "localhost",
  "DB_PORT": "3306",
  "DB_USER": "root",
  "DB_PASSWORD": "****word",
  "DB_NAME": "menzhen",
  "JWT_SECRET": "****cret",
  "MINIO_ENDPOINT": "localhost:9000",
  "MINIO_ACCESS_KEY": "****key1",
  "MINIO_SECRET_KEY": "****key2",
  "MINIO_BUCKET": "menzhen",
  "DEEPSEEK_API_KEY": "****pkey",
  "DEEPSEEK_BASE_URL": "https://api.qnaigc.com/v1/messages",
  "DEEPSEEK_MODEL": "deepseek/deepseek-v3.2-251201",
  "QINIU_ACCESS_KEY": "",
  "QINIU_SECRET_KEY": "",
  "QINIU_BUCKET": "",
  "QINIU_KEY_PREFIX": "menzhen-backup/",
  "QINIU_DOMAIN": "public.qnlinking.com",
  "QINIU_RETAIN_MYSQL": "5",
  "QINIU_RETAIN_MINIO": "5",
  "BACKUP_INTERVAL_MYSQL": "7200",
  "BACKUP_INTERVAL_MINIO": "43200"
}
```

### PUT /api/v1/config 请求体

```json
{
  "DB_HOST": "localhost",
  "DB_PASSWORD": "****word",
  "DEEPSEEK_API_KEY": "sk-new-key-12345"
}
```

### 掩码逻辑

**敏感字段列表**（硬编码）：
- DB_PASSWORD, JWT_SECRET, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
- DEEPSEEK_API_KEY, QINIU_ACCESS_KEY, QINIU_SECRET_KEY

**GET 返回**：敏感字段值长度 > 4 时返回 `****` + 后 4 位，否则返回 `****`

**PUT 处理**：如果值以 `****` 开头，视为未修改，保留 .env 文件中的原值

### .env 读写逻辑

1. **读取**: 逐行解析 `KEY=VALUE`，忽略注释行（`#`）和空行
2. **写入**:
   - 先复制 .env 为 .env.bak
   - 逐行处理：已有的 key 更新 value，保留注释和空行
   - 新增的 key 追加到文件末尾
3. **路径**: 优先读取环境变量 `ENV_FILE_PATH`，默认 `.env`（相对工作目录）

## 安全考虑

- 仅 `user:manage` 权限可访问（超级管理员）
- 密码/密钥掩码返回，防止前端泄露
- 写入前备份 .env.bak，防止误操作
- OpLog 记录配置修改操作

## 测试计划

### 后端测试
- service: .env 解析/写入/掩码逻辑
- handler: API 权限检查、请求参数验证

### 前端测试
- 页面渲染、表单提交、掩码显示、错误处理
