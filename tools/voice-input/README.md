# 语音输入工具

按快捷键录音，Whisper 本地识别后自动将文字键入终端。适用于 Claude Code 等终端工具的语音输入场景。

## 安装

```bash
cd tools/voice-input
./install.sh
```

安装内容：
- portaudio、ffmpeg（brew）
- Python 虚拟环境 + 依赖
- Whisper small 模型（约 1GB，首次下载）

## 使用

```bash
# 启动（使用虚拟环境）
tools/voice-input/.venv/bin/python tools/voice-input/voice_input.py

# 或激活虚拟环境后
source tools/voice-input/.venv/bin/activate
python tools/voice-input/voice_input.py
```

### 操作流程

1. `Ctrl+Shift+V` → 开始录音（听到提示音）
2. 说话...
3. `Ctrl+Shift+V` → 停止录音，自动识别
4. 识别结果自动键入当前前台应用

### 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--hotkey` | `ctrl+shift+v` | 热键组合 |
| `--model` | `small` | Whisper 模型：tiny/base/small/medium/large |
| `--language` | `zh` | 识别语言 |

```bash
# 示例：用 medium 模型 + 自定义热键
python voice_input.py --model medium --hotkey "cmd+shift+r"
```

## macOS 权限

首次使用需在 **系统设置 → 隐私与安全性** 中授权：

1. **辅助功能** — 添加终端应用（模拟键盘输入需要）
2. **麦克风** — 允许终端应用录音

## 模型选择

| 模型 | 大小 | 速度 | 中文效果 |
|------|------|------|----------|
| tiny | 75MB | 最快 | 一般 |
| base | 140MB | 快 | 较好 |
| small | 460MB | 中 | 好 |
| medium | 1.5GB | 慢 | 很好 |
| large | 3GB | 最慢 | 最好 |

推荐 `small`，平衡速度和准确率。
