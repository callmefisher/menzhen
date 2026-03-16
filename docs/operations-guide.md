# 运维操作手册

## 日常操作

### 启动服务

```bash
# 启动所有服务（后台运行）
docker compose up -d

# 启动并重新构建（代码有改动时）
docker compose up -d --build

# 只启动指定服务
docker compose up -d api mysql
```

### 停止服务

```bash
# 停止所有服务（保留数据卷）
docker compose down

# 停止所有服务并删除数据卷（慎用，数据会丢失）
docker compose down -v
```

### 重启服务

```bash
# 重启所有服务
docker compose restart

# 重启单个服务（如后端代码更新后）
docker compose restart api
```

### 查看状态和日志

```bash
# 查看所有服务状态
docker compose ps

# 实时查看所有日志
docker compose logs -f

# 查看指定服务日志（如只看后端）
docker compose logs -f api

# 查看最近 100 行日志
docker compose logs --tail 100 api
```

---

## 部署

### 前置条件

- Docker 和 Docker Compose
- Git
- Go 1.21+（本地构建需要）
- Node.js 18+（本地构建需要）

> **Windows 用户**：安装 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) 后，通过 Git Bash 或 WSL 执行相同命令即可。WSL（Windows Subsystem for Linux）是微软提供的 Windows 内置 Linux 子系统，可在 PowerShell 中运行 `wsl --install` 安装，装好后打开 WSL 终端即可像 Linux 一样操作。

### 全新部署

```bash
# 1. 克隆代码
git clone <repo-url> menzhen && cd menzhen

# 2. 一键部署（自动生成 .env，随机密码）
./deploy.sh --full

# 3. 访问 http://localhost，用 admin / admin123 登录，立即修改密码

# 4.（可选）进入「系统设置 → 软件配置」，在页面上配置：
#    - DeepSeek API 密钥（AI 功能）
#    - 七牛云 AK/SK/Bucket（云备份）
#    - 备份间隔等参数

# 5. 配置修改后重启生效
docker compose restart api backup
```

### 迁移部署（从旧服务器恢复数据）

```bash
# 1. 克隆 + 部署
git clone <repo-url> menzhen && cd menzhen
./deploy.sh --full

# 2. 在「系统设置 → 软件配置」或 .env 中填入七牛云配置
# 3. 重启使配置生效
docker compose restart api backup

# 4. 一键从云端恢复数据
docker compose exec backup bash /scripts/restore.sh --auto
```

### 从本地备份恢复

```bash
./deploy.sh --restore ./backups/backup-2026-02-24
```

在首次部署的基础上，额外将备份数据导入系统。

---

## 备份与恢复

### 自动备份

`backup` 服务自动执行双重备份：

- **MySQL 备份**：默认每 2 小时，文件名 `{SITE_ID}_YYYYMMDD_HHMMSS.sql`，存放于 `./backups/`
- **MinIO 备份**：默认每 12 小时，文件名 `{SITE_ID}_minio_YYYYMMDD_HHMMSS.tar.gz`，存放于 `./backups/minio/`
- **多服务器隔离**：`SITE_ID` 注入到文件名和七牛云路径中，不同服务器的备份互不干扰

可通过 `.env` 配置：

```bash
SITE_ID=clinic-bj              # 站点标识，默认 default
BACKUP_INTERVAL_MYSQL=7200     # MySQL 备份间隔，默认 2 小时
BACKUP_INTERVAL_MINIO=43200    # MinIO 备份间隔，默认 12 小时
```

备份文件结构（以 `SITE_ID=clinic-bj` 为例）：

```
backups/
├── clinic-bj_20260312_120000.sql              # MySQL 备份
├── clinic-bj_20260312_140000.sql
├── minio/
│   ├── clinic-bj_minio_20260312_060000.tar.gz # MinIO 备份
│   └── clinic-bj_minio_20260312_180000.tar.gz
```

七牛云路径：`menzhen-backup/clinic-bj/` 和 `menzhen-backup/clinic-bj/minio/`

### 手动触发备份

```bash
# 手动触发 MySQL 备份
docker compose exec backup bash /scripts/backup.sh

# 手动触发 MinIO 备份
docker compose exec backup bash /scripts/backup-minio.sh
```

### 恢复数据

#### 本机恢复（有本地备份文件）

```bash
# 自动恢复最新备份（推荐）
docker compose exec backup bash /scripts/restore.sh --auto

# 指定文件恢复
docker compose exec backup bash /scripts/restore.sh --sql /backups/20260312_120000.sql --minio-tar /backups/minio/minio_20260312_060000.tar.gz
```

#### 跨机器恢复（从七牛云下载）

适用于新服务器部署、服务器迁移等场景。参见上方「迁移部署」章节。

`restore.sh --auto` 在本地无备份文件时会自动从七牛云下载。

#### 仅手动下载备份（不恢复）

```bash
# 下载全部（MySQL + MinIO）
docker compose exec backup python3 /scripts/download_from_qiniu.py

# 只下载 MySQL
docker compose exec backup python3 /scripts/download_from_qiniu.py --type mysql

# 只下载 MinIO
docker compose exec backup python3 /scripts/download_from_qiniu.py --type minio
```

#### 恢复过程说明

1. 若本地无备份文件，自动从七牛云下载最新备份
2. 导入 `.sql` 到 MySQL
3. 解压 `tar.gz` 并同步到 MinIO（如有）
4. 验证数据完整性（打印表数量、患者数、记录数）

---

## 环境变量

在 `.env` 文件中配置，首次部署时由 `deploy.sh` 自动生成。部署后可通过「系统设置 → 软件配置」页面在线修改（需超级管理员权限），修改后重启容器生效。

### 数据库

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_HOST` | MySQL 地址 | `mysql` |
| `DB_PORT` | MySQL 端口 | `3306` |
| `DB_USER` | 数据库用户 | `menzhen` |
| `DB_PASSWORD` | 数据库密码 | 首次部署随机生成 |
| `DB_NAME` | 数据库名 | `menzhen` |

### MinIO 文件存储

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MINIO_ENDPOINT` | MinIO 地址 | `minio:9000` |
| `MINIO_ACCESS_KEY` | 访问密钥 | `minioadmin` |
| `MINIO_SECRET_KEY` | 秘密密钥 | 首次部署随机生成 |
| `MINIO_BUCKET` | 存储桶名 | `menzhen` |

### 认证

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | JWT 签名密钥 | 首次部署随机生成 |

### DeepSeek AI（可选）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEEPSEEK_API_KEY` | API 密钥 | 无 |
| `DEEPSEEK_BASE_URL` | API 地址 | `https://api.qnaigc.com/v1/messages` |
| `DEEPSEEK_MODEL` | 模型名 | `deepseek/deepseek-v3.2-251201` |

### 七牛云（可选）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `QINIU_ACCESS_KEY` | 七牛 Access Key | 无 |
| `QINIU_SECRET_KEY` | 七牛 Secret Key | 无 |
| `QINIU_BUCKET` | 存储空间名 | 无 |
| `QINIU_KEY_PREFIX` | 上传路径前缀 | `menzhen-backup/` |
| `QINIU_DOMAIN` | 下载域名 | `public.qnlinking.com` |

### 备份

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SITE_ID` | 站点标识（多服务器隔离备份） | `default` |
| `BACKUP_INTERVAL_MYSQL` | MySQL 备份间隔（秒） | `7200`（2小时） |
| `BACKUP_INTERVAL_MINIO` | MinIO 备份间隔（秒） | `43200`（12小时） |

---

## 常见问题

### MySQL 启动超时

```bash
# 查看 MySQL 日志定位原因
docker compose logs mysql

# 手动检查 MySQL 是否就绪
docker compose exec mysql mysqladmin ping -h localhost
```

### 需要进入容器调试

```bash
# 进入后端容器
docker compose exec api sh

# 进入 MySQL 命令行
docker compose exec mysql mysql -u menzhen -p menzhen
```

### 重置所有数据重新开始

```bash
docker compose down -v
./deploy.sh
```
