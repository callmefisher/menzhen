#!/usr/bin/env python3
"""
语音输入工具 - 按快捷键录音，Whisper 识别后自动键入终端

用法：
    python voice_input.py [--hotkey HOTKEY] [--model MODEL] [--language LANG]

默认热键：Cmd+Shift+V
默认模型：small
默认语言：zh（中文）
"""

import argparse
import os
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import wave
from typing import Optional

import numpy as np
import sounddevice as sd

# 延迟导入 whisper（加载较慢）
whisper = None

# ─── 配置 ───────────────────────────────────────────────

SAMPLE_RATE = 16000  # Whisper 要求 16kHz
CHANNELS = 1

# ─── 状态 ───────────────────────────────────────────────

recording = False
audio_frames: list[np.ndarray] = []
stream: Optional[sd.InputStream] = None
lock = threading.Lock()
transcribing = False  # 防止识别期间重复触发


def _escape_applescript(s: str) -> str:
    """转义 AppleScript 字符串"""
    return s.replace("\\", "\\\\").replace('"', '\\"')


def notify(title: str, message: str) -> None:
    """macOS 通知（参数已转义）"""
    try:
        safe_title = _escape_applescript(title)
        safe_msg = _escape_applescript(message)
        subprocess.run(
            [
                "osascript",
                "-e",
                f'display notification "{safe_msg}" with title "{safe_title}"',
            ],
            timeout=2,
            capture_output=True,
        )
    except Exception:
        pass


def beep() -> None:
    """播放系统提示音"""
    try:
        subprocess.run(
            ["afplay", "/System/Library/Sounds/Tink.aiff"],
            timeout=2,
            capture_output=True,
        )
    except Exception:
        pass


def type_text(text: str) -> None:
    """通过剪贴板粘贴文字到前台应用（避免 AppleScript 注入）"""
    if not text.strip():
        return

    # 保存原剪贴板内容
    try:
        old_clipboard = subprocess.run(
            ["pbpaste"], capture_output=True, timeout=2
        ).stdout
    except Exception:
        old_clipboard = None

    # 写入剪贴板
    try:
        subprocess.run(
            ["pbcopy"],
            input=text.encode("utf-8"),
            timeout=5,
            check=True,
        )
    except Exception as e:
        print(f"[错误] 写入剪贴板失败: {e}")
        return

    # 模拟 Cmd+V 粘贴
    try:
        subprocess.run(
            [
                "osascript",
                "-e",
                'tell application "System Events" to keystroke "v" using command down',
            ],
            timeout=5,
            capture_output=True,
        )
    except Exception as e:
        print(f"[错误] 粘贴失败: {e}")

    # 恢复原剪贴板内容
    if old_clipboard is not None:
        time.sleep(0.2)
        try:
            subprocess.run(
                ["pbcopy"], input=old_clipboard, timeout=2, capture_output=True
            )
        except Exception:
            pass


def save_audio_to_wav(frames: list[np.ndarray]) -> str:
    """将录音数据保存为临时 WAV 文件"""
    audio_data = np.concatenate(frames, axis=0)
    audio_int16 = (audio_data * 32767).astype(np.int16)

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    with wave.open(tmp.name, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_int16.tobytes())

    return tmp.name


def transcribe(audio_path: str, model, language: str) -> str:
    """用 Whisper 识别音频"""
    result = model.transcribe(audio_path, language=language, fp16=False)
    return result["text"].strip()


def audio_callback(indata, frames, time_info, status):
    """录音回调"""
    if status:
        print(f"[警告] 录音状态: {status}", file=sys.stderr)
    audio_frames.append(indata.copy())


def start_recording() -> None:
    """开始录音（必须在 lock 内调用）"""
    global recording, stream, audio_frames

    audio_frames = []
    stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="float32",
        callback=audio_callback,
    )
    stream.start()
    recording = True

    print("[🎙️ 录音中...] 再按热键停止")
    threading.Thread(target=beep, daemon=True).start()
    threading.Thread(
        target=notify, args=("语音输入", "录音中... 再按热键停止"), daemon=True
    ).start()


def _do_transcribe(frames_snapshot: list[np.ndarray], model, language: str) -> None:
    """在后台线程中执行识别和输入（避免阻塞热键监听）"""
    global transcribing

    total_samples = sum(f.shape[0] for f in frames_snapshot)
    duration = total_samples / SAMPLE_RATE
    if duration < 0.5:
        print(f"[⚠️] 录音太短（{duration:.1f}秒），已忽略")
        transcribing = False
        return

    print(f"[⏳ 识别中...] 录音时长: {duration:.1f}秒")
    threading.Thread(
        target=notify, args=("语音输入", f"识别中... ({duration:.1f}秒)"), daemon=True
    ).start()

    wav_path = None
    try:
        wav_path = save_audio_to_wav(frames_snapshot)
        text = transcribe(wav_path, model, language)
        if text:
            print(f"[✅ 识别结果] {text}")
            time.sleep(0.3)
            type_text(text)
            threading.Thread(
                target=notify,
                args=("语音输入", f"已输入: {text[:50]}"),
                daemon=True,
            ).start()
        else:
            print("[⚠️] 未识别到文字")
    except Exception as e:
        print(f"[错误] 识别失败: {e}")
    finally:
        if wav_path:
            try:
                os.unlink(wav_path)
            except OSError:
                pass
        transcribing = False


def stop_and_dispatch(model, language: str) -> None:
    """停止录音并分发识别任务到后台线程（必须在 lock 内调用）"""
    global recording, stream, transcribing

    if stream is not None:
        stream.stop()
        stream.close()
        stream = None
    recording = False
    transcribing = True

    if not audio_frames:
        print("[⚠️] 没有录到音频")
        transcribing = False
        return

    # 快照帧数据，交给后台线程处理
    frames_snapshot = audio_frames[:]
    threading.Thread(
        target=_do_transcribe,
        args=(frames_snapshot, model, language),
        daemon=True,
    ).start()


def hotkey_to_pynput(hotkey_str: str) -> str:
    """将用户热键格式转换为 pynput GlobalHotKeys 格式

    例: 'cmd+shift+v' -> '<cmd>+<shift>+v'
    """
    modifier_map = {
        "ctrl": "<ctrl>",
        "shift": "<shift>",
        "alt": "<alt>",
        "cmd": "<cmd>",
    }

    parts = hotkey_str.lower().split("+")
    result = []
    has_key = False

    for part in parts:
        part = part.strip()
        if part in modifier_map:
            result.append(modifier_map[part])
        else:
            if len(part) != 1:
                raise ValueError(f"热键格式错误: {part!r}（触发键必须是单个字符）")
            result.append(part)
            has_key = True

    if not has_key:
        raise ValueError(f"热键格式错误，缺少触发键: {hotkey_str!r}（需要类似 cmd+shift+v）")

    return "+".join(result)


def main():
    global whisper

    parser = argparse.ArgumentParser(description="语音输入工具")
    parser.add_argument(
        "--hotkey",
        default="cmd+shift+v",
        help="热键组合（默认: cmd+shift+v）",
    )
    parser.add_argument(
        "--model",
        default="small",
        choices=["tiny", "base", "small", "medium", "large"],
        help="Whisper 模型大小（默认: small）",
    )
    parser.add_argument(
        "--language",
        default="zh",
        help="识别语言（默认: zh）",
    )
    args = parser.parse_args()

    # 绕过 SSL 证书验证（代理环境需要）
    ssl._create_default_https_context = ssl._create_unverified_context

    # 加载 Whisper 模型
    print(f"[⏳] 加载 Whisper {args.model} 模型...")
    import whisper as whisper_module

    whisper = whisper_module
    model = whisper.load_model(args.model)
    print("[✅] 模型加载完成")

    # 设置热键
    from pynput import keyboard

    pynput_hotkey = hotkey_to_pynput(args.hotkey)

    def on_hotkey():
        with lock:
            if transcribing:
                print("[⏳] 识别中，请稍候...")
                return
            if not recording:
                start_recording()
            else:
                stop_and_dispatch(model, args.language)

    print("")
    print("=" * 50)
    print("  语音输入工具已启动")
    print(f"  热键: {args.hotkey.upper()}")
    print(f"  模型: {args.model} | 语言: {args.language}")
    print("  按热键开始/停止录音")
    print("  Ctrl+C 退出")
    print("=" * 50)
    print("")

    with keyboard.GlobalHotKeys({pynput_hotkey: on_hotkey}) as hotkeys:
        try:
            hotkeys.join()
        except KeyboardInterrupt:
            print("\n[👋] 已退出")


if __name__ == "__main__":
    main()
