# 语音输入工具

按快捷键录音，Whisper 本地识别后自动将文字键入前台应用。适用于 Claude Code 等终端工具的语音输入场景。

## 架构

```
VoiceInput.app (Swift 原生入口)
  ├── 请求麦克风权限（macOS TCC）
  └── 启动 voice_input.py
        ├── Quartz CGEvent tap 监听全局热键
        ├── AVFoundation AVAudioRecorder 录音
        └── Whisper 本地语音识别 → 剪贴板粘贴
```

## 安装

```bash
cd tools/voice-input
./install.sh
```

安装内容：
- ffmpeg（brew）
- Python 虚拟环境 + 依赖（whisper, pyobjc）
- Whisper small 模型（约 1GB，首次下载）
- VoiceInput.app（编译 Swift + 签名）
- LaunchAgent（开机自启）

## 首次使用

安装后需要两个权限：

1. **麦克风** — 首次启动 VoiceInput.app 会自动弹窗，点「允许」
2. **辅助功能** — 系统设置 → 隐私与安全性 → 辅助功能 → 添加 `Python.app`
   （路径：`/Library/Frameworks/Python.framework/Versions/3.x/Resources/Python.app`）

## 使用

热键: **Cmd+Shift+V**

1. `Cmd+Shift+V` → 开始录音（听到提示音）
2. 说话...
3. `Cmd+Shift+V` → 停止录音，自动识别并输入到前台应用

### 参数

编辑 `VoiceInputMain.swift` 中的 Python 启动参数，或直接运行脚本：

```bash
python voice_input.py --hotkey "cmd+shift+r" --model medium --language en
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--hotkey` | `cmd+shift+v` | 热键组合 |
| `--model` | `small` | Whisper 模型：tiny/base/small/medium/large |
| `--language` | `zh` | 识别语言 |

## 服务管理

```bash
# 启动
launchctl load ~/Library/LaunchAgents/com.menzhen.voice-input.plist

# 停止
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.menzhen.voice-input.plist

# 查看日志
tail -f /tmp/voice-input.log

# 手动运行（调试用）
~/Applications/VoiceInput.app/Contents/MacOS/VoiceInput
```

## 文件清单

| 文件 | 说明 |
|------|------|
| `voice_input.py` | 主脚本（热键、录音、识别、输入） |
| `VoiceInputMain.swift` | Swift 原生入口（请求权限、启动 Python） |
| `Info.plist` | macOS .app 配置 |
| `install.sh` | 一键安装脚本 |
| `requirements.txt` | Python 依赖 |

## 模型选择

| 模型 | 大小 | 速度 | 中文效果 |
|------|------|------|----------|
| tiny | 75MB | 最快 | 一般 |
| base | 140MB | 快 | 较好 |
| small | 460MB | 中 | 好 |
| medium | 1.5GB | 慢 | 很好 |
| large | 3GB | 最慢 | 最好 |

推荐 `small`，平衡速度和准确率。
