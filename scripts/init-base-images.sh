#!/bin/bash
# Creates clean, flat base images from existing application images.
# Removes application code, keeping only OS + system packages.
# Run once after first `docker compose build`, or with `deploy.sh --full`.
set -e

echo ">> 创建干净的 API 基础镜像..."
CID=$(docker create menzhen-api:latest sh)
# Remove application binary, keep OS + ca-certs + tzdata
docker export "$CID" | docker import \
    --change 'ENV TZ=Asia/Shanghai' \
    --change 'EXPOSE 8080' \
    --change 'CMD ["menzhen-api"]' \
    - menzhen-api-base:latest
docker rm "$CID" > /dev/null
echo "  menzhen-api-base: $(docker images menzhen-api-base --format '{{.Size}}')"

echo ">> 创建干净的 Backup 基础镜像..."
CID=$(docker create menzhen-backup:latest sh)
docker export "$CID" | docker import \
    --change 'ENV TZ=Asia/Shanghai' \
    --change 'CMD ["/scripts/backup-loop.sh"]' \
    - menzhen-backup-base:latest
docker rm "$CID" > /dev/null
echo "  menzhen-backup-base: $(docker images menzhen-backup-base --format '{{.Size}}')"

echo ">> 基础镜像创建完成"
