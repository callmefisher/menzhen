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

### 首次部署

```bash
./deploy.sh
```

自动执行：
1. 检查 Docker 环境
2. 生成 `.env`（随机密码和 JWT 密钥）
3. 构建并启动所有服务
4. 等待 MySQL 就绪

部署完成后：
- 访问地址：`http://localhost`
- 默认账号：`admin / admin123`（请立即修改密码）

### 从备份恢复部署

```bash
./deploy.sh --restore ./backups/backup-2026-02-24
```

在首次部署的基础上，额外将备份数据导入系统。适用于服务器迁移场景。

---

## 备份与恢复

### 自动备份

`backup` 服务会在每天凌晨自动执行备份（默认 2:00），备份文件保存在 `./backups/` 目录。

可通过环境变量 `BACKUP_HOUR` 修改备份时间：

```bash
# .env 中设置备份时间为凌晨 4 点
BACKUP_HOUR=4
```

### 手动触发备份

```bash
docker compose exec backup bash /scripts/backup.sh
```

备份产出的目录结构：

```
backups/backup-2026-02-24/
├── database.sql     # MySQL 完整导出
├── files/           # MinIO 附件文件
└── metadata.json    # 备份时间等元信息
```

### 恢复数据

**方式一：随部署一起恢复（新环境）**

```bash
./deploy.sh --restore ./backups/backup-2026-02-24
```

**方式二：服务已在运行，只恢复数据**

```bash
docker compose exec backup bash /scripts/restore.sh /backups/backup-2026-02-24
```

恢复过程：
1. 导入 `database.sql` 到 MySQL
2. 同步 `files/` 目录到 MinIO（如有）
3. 验证数据完整性（打印表数量、患者数、记录数）

---

## 环境变量

在 `.env` 文件中配置，首次部署时由 `deploy.sh` 自动生成。

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

### 备份

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `BACKUP_HOUR` | 每日自动备份时间（24h） | `2` |

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
