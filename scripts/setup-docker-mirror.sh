#!/bin/bash
# 配置 Docker Hub 国内镜像加速
# 用法: sudo bash scripts/setup-docker-mirror.sh
set -e

DAEMON_JSON="/etc/docker/daemon.json"

# 国内可用的 Docker Hub 镜像
# - docker.m.daocloud.io: 公网可用
# - mirror.ccs.tencentyun.com: 仅腾讯云 CVM 内网可用，公网会超时
MIRRORS_JSON='["https://docker.m.daocloud.io","https://mirror.ccs.tencentyun.com"]'

echo "=== 配置 Docker Hub 国内镜像加速 ==="

if [ "$(id -u)" -ne 0 ]; then
    echo "错误: 请使用 sudo 运行此脚本"
    exit 1
fi

# Backup existing config
if [ -f "$DAEMON_JSON" ]; then
    cp "$DAEMON_JSON" "${DAEMON_JSON}.bak.$(date +%Y%m%d%H%M%S)"
    echo "已备份现有配置到 ${DAEMON_JSON}.bak.*"

    # Check if mirrors already configured
    if grep -q "registry-mirrors" "$DAEMON_JSON" 2>/dev/null; then
        echo "检测到已有 registry-mirrors 配置:"
        grep -A5 "registry-mirrors" "$DAEMON_JSON"
        echo ""
        if [ -t 0 ]; then
            read -p "是否覆盖? (y/N) " -n 1 -r
            echo
        else
            echo "非交互环境，默认不覆盖（传入 --force 覆盖）"
            REPLY="n"
            for arg in "$@"; do [ "$arg" = "--force" ] && REPLY="y"; done
        fi
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "跳过配置"
            exit 0
        fi
    fi

    # Merge mirrors into existing config using python3
    if ! DAEMON_JSON="$DAEMON_JSON" MIRRORS_JSON="$MIRRORS_JSON" python3 - <<'PYEOF'
import json, os
path = os.environ['DAEMON_JSON']
mirrors = json.loads(os.environ['MIRRORS_JSON'])
with open(path) as f:
    cfg = json.load(f)
cfg['registry-mirrors'] = mirrors
with open(path, 'w') as f:
    json.dump(cfg, f, indent=2)
print(f'已更新 {path}')
PYEOF
    then
        echo "错误: 无法更新 $DAEMON_JSON，请检查文件 JSON 格式是否正确"
        exit 1
    fi
else
    mkdir -p /etc/docker
    printf '{\n  "registry-mirrors": %s\n}\n' "$MIRRORS_JSON" > "$DAEMON_JSON"
    echo "已创建 $DAEMON_JSON"
fi

echo ""
echo "当前配置:"
cat "$DAEMON_JSON"
echo ""

# Restart Docker
echo "重启 Docker 服务..."
if command -v systemctl &>/dev/null; then
    systemctl daemon-reload
    systemctl restart docker
    echo "Docker 已重启"
elif command -v service &>/dev/null; then
    service docker restart
    echo "Docker 已重启"
else
    echo "警告: 无法自动重启 Docker，请手动重启"
fi

# Verify
echo ""
echo "验证镜像配置:"
docker info 2>/dev/null | grep -A5 "Registry Mirrors" || echo "  (请手动运行 docker info 确认)"
echo ""
echo "=== 配置完成 ==="
