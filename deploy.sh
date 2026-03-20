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

# Check Docker Hub mirror configuration (important for China mainland)
if ! docker info 2>/dev/null | grep -q "Registry Mirrors"; then
    echo ""
    echo "提示: 未检测到 Docker Hub 镜像加速配置"
    echo "  国内网络建议先运行: sudo bash scripts/setup-docker-mirror.sh"
    echo ""
fi

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

# 3. Handle flags
RESTORE_DIR=""
FULL_BUILD=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --restore)
            RESTORE_DIR="$2"
            shift 2
            ;;
        --full)
            FULL_BUILD=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# 4. Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
    arm64|aarch64) GOARCH=arm64 ;;
    x86_64)        GOARCH=amd64 ;;
    *)             GOARCH=amd64 ;;
esac

# 5. Check if base images exist locally (first deploy needs --full)
check_base_images() {
    local missing=false
    for img in "menzhen-api-base:latest" "menzhen-backup-base:latest" "menzhen-nginx:latest" "menzhen-mysql:latest" "minio/minio:latest"; do
        if ! docker image inspect "$img" &>/dev/null; then
            echo "  缺少本地镜像: $img"
            missing=true
        fi
    done
    if $missing; then
        return 1
    fi
    return 0
}

if ! check_base_images; then
    echo ">> 检测到缺少基础镜像，使用完整构建模式（需要网络）"
    FULL_BUILD=true
fi

# 6. Build
if $FULL_BUILD; then
    echo ">> [完整构建] 拉取基础镜像 + 构建所有服务..."
    docker compose build

    # Create flat, clean runtime base images for future local builds.
    # Export/import flattens layers and removes application code,
    # so local builds stay small and constant-size.
    echo ">> 创建干净的运行时基础镜像..."
    bash "$SCRIPT_DIR/scripts/init-base-images.sh"
else
    echo ">> [本地构建] 使用本地镜像，仅更新应用代码..."

    # 6a. Build Go binary locally
    echo "  构建后端二进制 (linux/$GOARCH)..."
    (cd server && CGO_ENABLED=0 GOOS=linux GOARCH=$GOARCH go build -o menzhen-api .)

    # 6b. Build API image (copy binary into clean base)
    echo "  构建 API 镜像..."
    docker build --no-cache -f server/Dockerfile.local -t menzhen-api:latest server/

    # 6c. Build frontend locally
    echo "  构建前端..."
    (cd web && npm run build)

    # 6d. Build Web image (copy dist into clean nginx base)
    echo "  构建 Web 镜像..."
    docker build --no-cache -f web/Dockerfile.local -t menzhen-web:latest web/

    # 6e. Build backup image (copy scripts into clean base)
    echo "  构建备份镜像..."
    docker build --no-cache -f scripts/Dockerfile.local -t menzhen-backup:latest scripts/
fi

# 7. Update services (only recreates containers with changed images/config)
echo ">> 更新服务..."
docker compose up -d --force-recreate

# Restart nginx to refresh upstream DNS (api/web container IPs may have changed)
echo ">> 刷新 nginx 上游连接..."
docker compose restart nginx

# 8. Wait for MySQL to be healthy
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

# 9. Post-deploy verification
echo ">> 验证部署..."
DEPLOY_OK=true

# Check all containers are running
for svc in api web nginx mysql minio backup; do
    STATUS=$(docker compose ps --format '{{.State}}' "$svc" 2>/dev/null)
    if [ "$STATUS" = "running" ]; then
        echo "  $svc: running"
    else
        echo "  $svc: $STATUS [异常]"
        DEPLOY_OK=false
    fi
done

# Check API health
sleep 2
API_CODE=$(docker compose exec -T api wget -qO- --spider http://localhost:8080/api/v1/solar-terms 2>&1 | grep -o "200" || echo "fail")
if [ "$API_CODE" = "fail" ]; then
    # Try with curl as fallback
    API_CODE=$(docker compose exec -T api sh -c 'wget -qS -O /dev/null http://localhost:8080/api/v1/solar-terms 2>&1 | head -1' || echo "fail")
    echo "  API 健康检查: $API_CODE"
else
    echo "  API 健康检查: OK"
fi

# Verify web container serves latest index.html
CONTAINER_HASH=$(docker exec menzhen-web-1 md5sum /usr/share/nginx/html/index.html 2>/dev/null | awk '{print $1}')
LOCAL_HASH=$(md5 -q web/dist/index.html 2>/dev/null || md5sum web/dist/index.html 2>/dev/null | awk '{print $1}')
if [ "$CONTAINER_HASH" = "$LOCAL_HASH" ]; then
    echo "  前端文件: 已同步"
else
    echo "  前端文件: 不一致 [异常]"
    echo "    容器: $CONTAINER_HASH"
    echo "    本地: $LOCAL_HASH"
    DEPLOY_OK=false
fi

if ! $DEPLOY_OK; then
    echo ""
    echo "警告: 部署验证发现异常，请检查日志: docker compose logs"
fi

# 10. Restore from backup if specified
if [ -n "$RESTORE_DIR" ]; then
    echo ">> 从备份恢复数据: $RESTORE_DIR"
    if [ -f "$SCRIPT_DIR/scripts/restore.sh" ]; then
        bash "$SCRIPT_DIR/scripts/restore.sh" "$RESTORE_DIR"
    else
        echo "警告: restore.sh 不存在，跳过数据恢复"
    fi
fi

# 11. Clean up old Docker images and build cache
echo ">> 清理旧镜像和构建缓存..."
docker image prune -f
docker builder prune -f --filter "until=24h"

# 12. Print access info
echo ""
echo "=== 部署完成 ==="
echo "访问地址: http://localhost"
echo "默认账号: admin / admin123"
echo "请登录后立即修改默认密码"
echo ""
echo "提示: 首次部署或需更新基础镜像时，使用 ./deploy.sh --full"
echo ""
