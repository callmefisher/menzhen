#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "=== 语音输入工具安装 ==="
echo ""

# 检查 Homebrew
if ! command -v brew &>/dev/null; then
    echo "❌ 未找到 Homebrew，请先安装: https://brew.sh"
    exit 1
fi

# 检查 Python 版本
PYTHON=""
for cmd in python3.11 python3.10 python3.9 python3; do
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
echo "✅ 使用 Python: $($PYTHON --version)"

# 检查 portaudio（sounddevice 依赖）
if ! brew ls --versions portaudio &>/dev/null; then
    echo "📦 安装 portaudio（录音依赖）..."
    brew install portaudio
else
    echo "✅ portaudio 已安装"
fi

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

# 预下载 Whisper small 模型
echo "📦 预下载 Whisper small 模型（约 1GB，首次需要等待）..."
python -c "import whisper; whisper.load_model('small')"
echo "✅ Whisper 模型就绪"

echo ""
echo "=== 安装完成 ==="
echo ""
echo "⚠️  macOS 权限设置（首次使用需要）："
echo "   1. 系统设置 → 隐私与安全性 → 辅助功能 → 添加终端应用"
echo "   2. 系统设置 → 隐私与安全性 → 麦克风 → 允许终端应用"
echo ""
echo "启动命令："
echo "   source $VENV_DIR/bin/activate && python $SCRIPT_DIR/voice_input.py"
echo ""
echo "或直接运行："
echo "   $VENV_DIR/bin/python $SCRIPT_DIR/voice_input.py"
