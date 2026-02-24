#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== 患者病历系统 - 一键部署 ==="

# 1. Check Docker and Docker Compose
echo ">> 检查 Docker 环境..."
if ! command -v docker &> /dev/null; then
    echo "错误: Docker 未安装，请先安装 Docker"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo "错误: Docker Compose 未安装，请先安装 Docker Compose"
    exit 1
fi

echo "Docker 版本: $(docker --version)"
echo "Docker Compose 版本: $(docker compose version --short)"

# 2. Generate .env if not exists
if [ ! -f .env ]; then
    echo ">> 生成 .env 配置文件..."
    cp .env.example .env

    # Generate random passwords/secrets
    DB_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)
    JWT_SECRET=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    MINIO_SECRET=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)

    # Replace defaults with random values (use sed -i.bak for macOS compatibility)
    sed -i.bak "s/DB_PASSWORD=menzhen123/DB_PASSWORD=${DB_PASSWORD}/" .env
    sed -i.bak "s/JWT_SECRET=change-me-in-production/JWT_SECRET=${JWT_SECRET}/" .env
    sed -i.bak "s/MINIO_SECRET_KEY=minioadmin/MINIO_SECRET_KEY=${MINIO_SECRET}/" .env
    rm -f .env.bak

    echo "已生成 .env，数据库密码和JWT密钥已随机生成"
else
    echo ">> 使用已有 .env 配置"
fi

# 3. Handle --restore flag
RESTORE_DIR=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --restore)
            RESTORE_DIR="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# 4. Build and start services
echo ">> 构建服务..."
docker compose build

echo ">> 启动服务..."
docker compose up -d

# 5. Wait for MySQL to be healthy
echo ">> 等待 MySQL 就绪..."
for i in $(seq 1 30); do
    if docker compose exec -T mysql mysqladmin ping -h localhost --silent 2>/dev/null; then
        echo "MySQL 已就绪"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "错误: MySQL 启动超时"
        exit 1
    fi
    echo "等待中... ($i/30)"
    sleep 2
done

# 6. Restore from backup if specified
if [ -n "$RESTORE_DIR" ]; then
    echo ">> 从备份恢复数据: $RESTORE_DIR"
    if [ -f "$SCRIPT_DIR/scripts/restore.sh" ]; then
        bash "$SCRIPT_DIR/scripts/restore.sh" "$RESTORE_DIR"
    else
        echo "警告: restore.sh 不存在，跳过数据恢复"
    fi
fi

# 7. Print access info
echo ""
echo "=== 部署完成 ==="
echo "访问地址: http://localhost"
echo "默认账号: admin / admin123"
echo "请登录后立即修改默认密码"
echo ""
