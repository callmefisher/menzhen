#!/bin/bash
# ============================================================
#  门诊系统安装向导 — 一键启动脚本 (Mac / Ubuntu / Linux)
#  Mac 用户：双击 start-wizard.command
#  Linux 用户：终端运行 bash start-wizard.command
# ============================================================

# 切换到脚本所在目录（无论从哪里双击打开）
cd "$(dirname "$0")"

echo ""
echo "====================================="
echo "  门诊系统安装向导 - 环境检测中..."
echo "====================================="
echo ""

# ------------------------------------------------------------------
# 1. 检测操作系统
# ------------------------------------------------------------------
OS="unknown"
if [[ "$(uname)" == "Darwin" ]]; then
    OS="mac"
    echo "[*] 检测到系统: 苹果 macOS"
elif [[ "$(uname)" == "Linux" ]]; then
    OS="linux"
    # 尝试获取具体发行版名称
    if [[ -f /etc/os-release ]]; then
        DISTRO=$(. /etc/os-release && echo "$NAME")
        echo "[*] 检测到系统: $DISTRO"
    else
        echo "[*] 检测到系统: Linux"
    fi
else
    echo "[!] 不支持的系统: $(uname)"
    echo "    请在 Mac / Ubuntu / CentOS 等系统上运行此脚本"
    echo "    Windows 用户请双击 start-wizard.bat"
    read -p "按回车退出..."
    exit 1
fi

# ------------------------------------------------------------------
# 2. 检测 Python3 是否可用（不只是检测命令是否存在）
#    Mac 上 /usr/bin/python3 可能是个空壳，需要真正运行测试
# ------------------------------------------------------------------
check_python3_works() {
    if ! command -v python3 &>/dev/null; then
        return 1
    fi
    # 真正运行一下，确认不是 macOS 的 CLT 空壳
    python3 -c "import sys; sys.exit(0)" 2>/dev/null
    return $?
}

# ------------------------------------------------------------------
# 3. Mac 上安装 Python3
# ------------------------------------------------------------------
install_python_mac() {
    echo ""
    echo "[*] 苹果电脑上安装 Python3..."
    echo ""

    # 方法1: 尝试 Homebrew（如果已安装了 brew）
    if command -v brew &>/dev/null; then
        echo "    检测到软件管理工具，正在自动安装..."
        if brew install python3; then
            # Refresh PATH for current shell (Apple Silicon / Intel)
            eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)" 2>/dev/null
            echo "    Python3 安装成功!"
            return 0
        fi
        echo "    Homebrew 安装失败，尝试其他方式..."
    fi

    # 方法2: 安装 Xcode 命令行工具（会自带 Python3）
    echo "    正在安装必需的运行工具（会弹出安装窗口）..."
    echo ""
    echo "    ================================================"
    echo "    请在弹出的窗口中点击「安装」按钮"
    echo "    （窗口可能是英文的，点击 Install 即可）"
    echo "    安装大约需要 5-10 分钟，请耐心等待"
    echo "    ================================================"
    echo ""

    xcode-select --install 2>/dev/null

    # 等待用户完成安装
    echo "    安装完成后，请按回车键继续..."
    read -p "    >>> "

    # 再次检测
    if check_python3_works; then
        echo ""
        echo "    Python3 安装成功!"
        return 0
    fi

    # 方法3: 引导手动安装
    echo ""
    echo "    ================================================"
    echo "    自动安装未成功，请手动安装 Python3："
    echo ""
    echo "    请联系技术支持人员协助安装。"
    echo ""
    echo "    或自行从官网下载安装包："
    echo "    https://www.python.org/downloads/"
    echo "    下载后双击安装包，一路点「继续」即可。"
    echo "    安装完成后，重新双击本文件。"
    echo "    ================================================"
    echo ""
    read -p "按回车退出..."
    exit 1
}

# ------------------------------------------------------------------
# 4. Linux 上安装 Python3
# ------------------------------------------------------------------
install_python_linux() {
    echo ""
    echo "[*] Linux 上安装 Python3..."

    if command -v apt-get &>/dev/null; then
        echo "    使用 apt-get 安装..."
        if sudo apt-get update -qq && sudo apt-get install -y python3; then
            echo "    Python3 安装成功!"
            return 0
        fi
    elif command -v yum &>/dev/null; then
        echo "    使用 yum 安装..."
        if sudo yum install -y python3; then
            echo "    Python3 安装成功!"
            return 0
        fi
    elif command -v dnf &>/dev/null; then
        echo "    使用 dnf 安装..."
        if sudo dnf install -y python3; then
            echo "    Python3 安装成功!"
            return 0
        fi
    fi

    echo ""
    echo "    ================================================"
    echo "    自动安装失败，请联系技术支持人员协助。"
    echo "    安装完成后，重新运行本脚本。"
    echo "    ================================================"
    echo ""
    read -p "按回车退出..."
    exit 1
}

# ------------------------------------------------------------------
# 5. 主流程：检测 → 安装 → 启动
# ------------------------------------------------------------------
if check_python3_works; then
    PY_VER=$(python3 --version 2>&1)
    echo "[*] 运行环境已就绪: $PY_VER"
else
    echo "[!] 未检测到运行环境，需要安装"

    if [[ "$OS" == "mac" ]]; then
        install_python_mac
    else
        install_python_linux
    fi

    # 安装后再次确认
    if ! check_python3_works; then
        echo ""
        echo "[!] 运行环境仍不可用，请联系技术支持人员协助"
        read -p "按回车退出..."
        exit 1
    fi

    echo "[*] 运行环境安装成功: $(python3 --version 2>&1)"
fi

# ------------------------------------------------------------------
# 6. 检查向导脚本，自动下载或更新到最新版本
# ------------------------------------------------------------------
WIZARD_URLS=(
    "https://raw.githubusercontent.com/callmefisher/menzhen/main/deploy-wizard.py"
    "https://cdn.jsdelivr.net/gh/callmefisher/menzhen@main/deploy-wizard.py"
    "https://ghfast.top/https://raw.githubusercontent.com/callmefisher/menzhen/main/deploy-wizard.py"
)

# Helper: download with multi-source fallback, validate shebang
# Usage: download_wizard <target_file>
download_wizard() {
    local target="$1"
    local i=1
    local total=${#WIZARD_URLS[@]}
    for url in "${WIZARD_URLS[@]}"; do
        echo "    尝试下载源 $i/$total ..."
        rm -f "$target" 2>/dev/null
        if command -v curl &>/dev/null; then
            curl --connect-timeout 15 --max-time 60 -fSL "$url" -o "$target" 2>/dev/null
        elif command -v wget &>/dev/null; then
            wget --timeout=60 --tries=1 -q "$url" -O "$target" 2>/dev/null
        fi
        # Validate: must start with python shebang and end with EOF marker
        if [[ -f "$target" ]] && head -1 "$target" | grep -qE "^#!.*python" && tail -1 "$target" | grep -q "WIZARD_EOF_MARKER"; then
            return 0
        fi
        rm -f "$target" 2>/dev/null
        i=$((i + 1))
    done
    return 1
}

# Helper: extract WIZARD_VERSION value from a Python file
get_wizard_version() {
    grep -o 'WIZARD_VERSION *= *"[^"]*"' "$1" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)".*/\1/'
}

if [[ -f "deploy-wizard.py" ]]; then
    echo ""
    echo "[*] 检测到已有向导程序，正在检查更新..."
    TEMP_FILE="deploy-wizard.py.download"
    if download_wizard "$TEMP_FILE"; then
        REMOTE_VER=$(get_wizard_version "$TEMP_FILE")
        LOCAL_VER=$(get_wizard_version "deploy-wizard.py")
        if [[ -z "$REMOTE_VER" ]]; then
            echo "[!] 下载的文件缺少版本号，继续使用当前版本"
            rm -f "$TEMP_FILE"
        elif [[ "$REMOTE_VER" > "$LOCAL_VER" ]]; then
            cp deploy-wizard.py deploy-wizard.py.bak
            mv "$TEMP_FILE" deploy-wizard.py
            echo "[*] 向导程序已更新: $LOCAL_VER → $REMOTE_VER（旧版本备份为 deploy-wizard.py.bak）"
        else
            echo "[*] 向导程序已是最新版本 ($LOCAL_VER)"
            rm -f "$TEMP_FILE"
        fi
    else
        echo "[!] 无法检查更新（网络不可用），继续使用当前版本"
        rm -f "$TEMP_FILE" 2>/dev/null
    fi
else
    echo ""
    echo "[*] 未找到向导程序，正在自动下载..."
    echo ""
    if download_wizard "deploy-wizard.py"; then
        echo "[*] 向导程序下载完成!"
    elif [[ -f "deploy-wizard.py" ]]; then
        echo "[!] 下载的文件无效（可能是网络错误页面）"
        rm -f deploy-wizard.py
        echo "    请检查网络连接后重试"
        read -p "按回车退出..."
        exit 1
    else
        echo "[!] 所有下载源均失败"
        read -p "按回车退出..."
        exit 1
    fi
fi

# ------------------------------------------------------------------
# 7. 启动向导
# ------------------------------------------------------------------
echo ""
echo "====================================="
echo "  正在启动安装向导..."
echo "  浏览器会自动打开"
echo "  如果没有自动打开，请查看终端输出的地址"
echo "====================================="
echo ""
echo "提示：按 Ctrl+C 可随时停止向导"
echo ""

# 由启动脚本已完成更新检查，跳过 Python 内置的自更新
WIZARD_SKIP_UPDATE=1 python3 deploy-wizard.py

# Python 退出后自动关闭终端窗口（无需按回车）
echo ""
echo "向导已停止。"
if [[ "$(uname)" == "Darwin" ]]; then
    sleep 1
    osascript -e 'tell application "Terminal" to close first window' 2>/dev/null || true
fi
exit 0
