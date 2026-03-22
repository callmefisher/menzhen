#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
APP_DIR="$HOME/Applications/VoiceInput.app"
PLIST_DIR="$HOME/Library/LaunchAgents"

echo "=== 语音输入工具安装 ==="
echo ""

# 检查 Homebrew
if ! command -v brew &>/dev/null; then
    echo "❌ 未找到 Homebrew，请先安装: https://brew.sh"
    exit 1
fi

# 检查 Xcode Command Line Tools（编译 Swift 需要）
if ! command -v swiftc &>/dev/null; then
    echo "❌ 未找到 swiftc，请先安装 Xcode Command Line Tools："
    echo "   xcode-select --install"
    exit 1
fi
echo "✅ swiftc 可用"

# 检查 Python 版本
PYTHON=""
for cmd in python3.14 python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
    if command -v "$cmd" &>/dev/null; then
        version=$("$cmd" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
        major=$(echo "$version" | cut -d. -f1)
        minor=$(echo "$version" | cut -d. -f2)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 9 ]; then
            PYTHON="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo "❌ 需要 Python 3.9+，请先安装："
    echo "   brew install python@3.11"
    exit 1
fi
PYTHON_REAL=$(readlink -f "$(which "$PYTHON")")
PYTHON_APP_DIR=$(echo "$PYTHON_REAL" | sed 's|/bin/python[0-9.]*$|/Resources/Python.app/Contents/MacOS/Python|')
echo "✅ 使用 Python: $($PYTHON --version) ($PYTHON_REAL)"

# 检查 ffmpeg（whisper 依赖）
if ! command -v ffmpeg &>/dev/null; then
    echo "📦 安装 ffmpeg（音频处理依赖）..."
    brew install ffmpeg
else
    echo "✅ ffmpeg 已安装"
fi

# 创建虚拟环境
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 创建虚拟环境..."
    "$PYTHON" -m venv "$VENV_DIR"
fi
echo "✅ 虚拟环境: $VENV_DIR"

# 激活虚拟环境并安装依赖
source "$VENV_DIR/bin/activate"
echo "📦 安装 Python 依赖..."
pip install --upgrade pip -q
pip install -r "$SCRIPT_DIR/requirements.txt" -q

# 安装 PyObjC（AVFoundation 录音 + Quartz 热键）
pip install pyobjc-framework-Quartz pyobjc-framework-Cocoa pyobjc-framework-AVFoundation -q
echo "✅ Python 依赖安装完成"

# 预下载 Whisper small 模型
echo "📦 预下载 Whisper small 模型（约 1GB，首次需要等待）..."
python -c "import whisper; whisper.load_model('small')"
echo "✅ Whisper 模型就绪"

# ─── 构建 VoiceInput.app ─────────────────────────────

echo ""
echo "📦 构建 VoiceInput.app..."

mkdir -p "$APP_DIR/Contents/MacOS"

# 编译 Swift 原生入口（请求麦克风权限 + 热键监听 + 启动 Python）
swiftc "$SCRIPT_DIR/VoiceInputMain.swift" \
    -o "$APP_DIR/Contents/MacOS/VoiceInput" \
    -framework AVFoundation \
    -framework Cocoa
echo "✅ Swift 入口编译完成"

# 复制 Info.plist
cp "$SCRIPT_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"

# Ad-hoc 签名
codesign -s - "$APP_DIR" --force --deep
echo "✅ VoiceInput.app 构建完成: $APP_DIR"

# ─── 安装 LaunchAgent ─────────────────────────────────

echo ""
echo "📦 安装 LaunchAgent（开机自启）..."

mkdir -p "$PLIST_DIR"
cat > "$PLIST_DIR/com.menzhen.voice-input.plist" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.menzhen.voice-input</string>
    <key>ProgramArguments</key>
    <array>
        <string>$APP_DIR/Contents/MacOS/VoiceInput</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
PLISTEOF

echo "✅ LaunchAgent 已安装"

# ─── 首次启动（触发权限弹窗）─────────────────────────

echo ""
echo "=== 安装完成 ==="
echo ""
echo "⚠️  首次使用需要授权（按提示操作）："
echo ""
echo "1. 运行以下命令首次启动（会弹出麦克风授权弹窗，点「允许」）："
echo "   $APP_DIR/Contents/MacOS/VoiceInput"
echo ""
echo "2. 如果热键无效，在 系统设置→隐私与安全性→辅助功能 中添加："
echo "   VoiceInput.app（位于 ~/Applications/VoiceInput.app）"
echo ""
echo "3. 授权完成后，重新启动服务："
echo "   launchctl kickstart -k gui/\$(id -u)/com.menzhen.voice-input"
echo ""
echo "热键: Cmd+Shift+V（按一次开始录音，再按一次停止并识别）"
echo "日志: /tmp/voice-input.log"
