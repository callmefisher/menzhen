#!/usr/bin/env python3
"""
语音输入工具 - 按快捷键录音，Whisper 识别后自动键入前台应用

录音使用 macOS AVFoundation 原生 API，确保在任何 session 下都能访问麦克风。
热键使用 Quartz CGEvent tap。
"""

import argparse
import os
import signal
import ssl
import subprocess
import sys
import tempfile
import threading
import time

# ─── 配置 ───────────────────────────────────────────────

SAMPLE_RATE = 16000
CHANNELS = 1

# 静音检测配置（由命令行参数覆盖）
SILENCE_TIMEOUT = 2.0  # 秒
SILENCE_THRESHOLD = -30.0  # dB（说话通常 -30~-10，环境噪音通常 -50~-35）

# ─── 状态 ───────────────────────────────────────────────

recording = False
lock = threading.Lock()
transcribing = False
audio_recorder = None  # AVFoundation recorder


# ─── AVFoundation 录音 ────────────────────────────────

class AVFRecorder:
    """用 AVFoundation AVAudioRecorder 录音"""

    def __init__(self):
        import AVFoundation
        import Foundation
        self.AVFoundation = AVFoundation
        self.Foundation = Foundation
        self._recorder = None
        self._file_url = None
        self._path = None

    def start(self, output_path: str):
        AVF = self.AVFoundation
        NS = self.Foundation

        self._path = output_path
        self._file_url = NS.NSURL.fileURLWithPath_(output_path)

        settings = NS.NSDictionary.dictionaryWithDictionary_({
            AVF.AVFormatIDKey: int(AVF.kAudioFormatLinearPCM),
            AVF.AVSampleRateKey: float(SAMPLE_RATE),
            AVF.AVNumberOfChannelsKey: int(CHANNELS),
            AVF.AVLinearPCMBitDepthKey: int(16),
            AVF.AVLinearPCMIsFloatKey: False,
            AVF.AVLinearPCMIsBigEndianKey: False,
        })

        recorder, error = AVF.AVAudioRecorder.alloc().initWithURL_settings_error_(
            self._file_url, settings, None
        )

        if error:
            raise RuntimeError(f"AVAudioRecorder init failed: {error}")
        if not recorder:
            raise RuntimeError("AVAudioRecorder init returned None")

        self._recorder = recorder
        self._recorder.setMeteringEnabled_(True)
        self._recorder.prepareToRecord()

        if not self._recorder.record():
            raise RuntimeError("AVAudioRecorder.record() failed")

    def get_power(self) -> float:
        """获取当前平均音频电平 (dB)，范围 -160 ~ 0"""
        if self._recorder and self._recorder.isRecording():
            self._recorder.updateMeters()
            return self._recorder.averagePowerForChannel_(0)
        return -160.0

    def stop(self) -> str:
        if self._recorder:
            self._recorder.stop()
            self._recorder = None
        return self._path


# ─── 工具函数 ──────────────────────────────────────────

def _escape_applescript(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def notify(title: str, message: str) -> None:
    try:
        safe_title = _escape_applescript(title)
        safe_msg = _escape_applescript(message)
        subprocess.run(
            ["osascript", "-e",
             f'display notification "{safe_msg}" with title "{safe_title}"'],
            timeout=2, capture_output=True,
        )
    except Exception:
        pass


def beep() -> None:
    try:
        subprocess.run(
            ["afplay", "/System/Library/Sounds/Tink.aiff"],
            timeout=2, capture_output=True,
        )
    except Exception:
        pass


def type_text(text: str) -> None:
    if not text.strip():
        return

    try:
        old_clipboard = subprocess.run(
            ["pbpaste"], capture_output=True, timeout=2
        ).stdout
    except Exception:
        old_clipboard = None

    try:
        subprocess.run(
            ["pbcopy"], input=text.encode("utf-8"), timeout=5, check=True,
        )
    except Exception as e:
        print(f"[错误] 写入剪贴板失败: {e}", flush=True)
        return

    try:
        subprocess.run(
            ["osascript", "-e",
             'tell application "System Events" to keystroke "v" using command down'],
            timeout=5, capture_output=True,
        )
    except Exception as e:
        print(f"[错误] 粘贴失败: {e}", flush=True)

    if old_clipboard is not None:
        time.sleep(0.2)
        try:
            subprocess.run(
                ["pbcopy"], input=old_clipboard, timeout=2, capture_output=True
            )
        except Exception:
            pass


# ─── 录音控制 ──────────────────────────────────────────

_current_wav_path = None
_whisper_model = None
_language = "zh"


def _silence_monitor() -> None:
    """后台线程：轮询音频电平，检测到语音后静音超时则自动停止录音"""
    global recording
    speech_detected = False
    silence_start = None
    poll_count = 0

    while True:
        time.sleep(0.2)
        with lock:
            if not recording or audio_recorder is None:
                return

            power = audio_recorder.get_power()

        poll_count += 1

        if power > SILENCE_THRESHOLD:
            # 有声音
            if not speech_detected:
                speech_detected = True
                print(f"[🎤 检测到语音] power={power:.1f}dB", flush=True)
            silence_start = None
        elif speech_detected:
            # 有过语音但现在静音了
            if silence_start is None:
                silence_start = time.monotonic()
            elapsed = time.monotonic() - silence_start
            if elapsed >= SILENCE_TIMEOUT:
                print(f"[🔇 静音 {SILENCE_TIMEOUT}s，自动停止]", flush=True)
                with lock:
                    if recording and not transcribing:
                        stop_and_dispatch(_whisper_model, _language)
                return


def start_recording() -> None:
    global recording, audio_recorder, _current_wav_path

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    _current_wav_path = tmp.name

    try:
        audio_recorder = AVFRecorder()
        audio_recorder.start(_current_wav_path)
    except Exception as e:
        print(f"[错误] 启动录音失败: {e}", flush=True)
        return

    recording = True
    print("[🎙️ 录音中...] 说完自动停止（或按热键手动停止）", flush=True)
    threading.Thread(target=beep, daemon=True).start()
    threading.Thread(
        target=notify, args=("语音输入", "录音中... 说完自动停止"), daemon=True
    ).start()
    # 启动静音监测线程
    threading.Thread(target=_silence_monitor, daemon=True).start()


def _do_transcribe(audio_path: str, model, language: str) -> None:
    global transcribing

    try:
        import wave as wave_mod
        import numpy as np

        wf = wave_mod.open(audio_path, "rb")
        raw = wf.readframes(wf.getnframes())
        nframes = wf.getnframes()
        wf.close()

        if nframes == 0:
            print("[⚠️] 没有录到音频", flush=True)
            transcribing = False
            return

        samples = np.frombuffer(raw, dtype=np.int16)
        peak = int(np.abs(samples).max())
        duration = nframes / SAMPLE_RATE

        print(f"[调试] peak={peak}, duration={duration:.1f}s", flush=True)

        if duration < 0.5:
            print("[⚠️] 录音太短", flush=True)
            transcribing = False
            return

        if peak < 10:
            print("[⚠️] 录音静音！麦克风可能无法访问", flush=True)
            transcribing = False
            return

        print(f"[⏳ 识别中...] {duration:.1f}秒", flush=True)
        threading.Thread(
            target=notify, args=("语音输入", f"识别中... ({duration:.1f}秒)"),
            daemon=True,
        ).start()

        result = model.transcribe(audio_path, language=language, fp16=False,
                                  initial_prompt="以下是普通话的句子，使用简体中文，包含标点符号。")
        text = result["text"].strip()

        if text:
            print(f"[✅ 识别结果] {text}", flush=True)
            time.sleep(0.3)
            type_text(text)
            threading.Thread(
                target=notify, args=("语音输入", f"已输入: {text[:50]}"),
                daemon=True,
            ).start()
        else:
            print("[⚠️] 未识别到文字", flush=True)
    except Exception as e:
        print(f"[错误] 识别失败: {e}", flush=True)
    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            pass
        transcribing = False


def stop_and_dispatch(model, language: str) -> None:
    global recording, transcribing, audio_recorder

    transcribing = True
    audio_path = None

    if audio_recorder:
        audio_path = audio_recorder.stop()
        audio_recorder = None
    recording = False

    if not audio_path or not os.path.exists(audio_path):
        print("[⚠️] 没有录音文件", flush=True)
        transcribing = False
        return

    threading.Thread(
        target=_do_transcribe,
        args=(audio_path, model, language),
        daemon=True,
    ).start()


# ─── macOS 原生热键（Quartz CGEvent）───────────────────

MODIFIER_MAP = {
    "cmd": 1 << 20,
    "shift": 1 << 17,
    "ctrl": 1 << 18,
    "alt": 1 << 19,
}

KEYCODE_MAP = {
    "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4,
    "i": 34, "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31, "p": 35,
    "q": 12, "r": 15, "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7,
    "y": 16, "z": 6,
    "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26,
    "8": 28, "9": 25,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
}


def parse_hotkey(hotkey_str: str):
    parts = hotkey_str.lower().split("+")
    modifier_mask = 0
    key = None
    for part in parts:
        part = part.strip()
        if part in MODIFIER_MAP:
            modifier_mask |= MODIFIER_MAP[part]
        elif part in KEYCODE_MAP:
            key = KEYCODE_MAP[part]
        else:
            raise ValueError(f"未知的键: {part!r}")
    if key is None:
        raise ValueError(f"热键格式错误，缺少触发键: {hotkey_str!r}")
    return modifier_mask, key


def run_event_loop(modifier_mask: int, keycode: int, callback):
    import Quartz

    def cg_event_callback(proxy, event_type, event, refcon):
        if event_type == Quartz.kCGEventTapDisabledByTimeout:
            print("[⚠️] 事件监听器超时，重新启用...", flush=True)
            Quartz.CGEventTapEnable(tap, True)
            return event
        if event_type == Quartz.kCGEventKeyDown:
            kc = Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode)
            flags = Quartz.CGEventGetFlags(event)
            masked = flags & (MODIFIER_MAP["cmd"] | MODIFIER_MAP["shift"]
                              | MODIFIER_MAP["ctrl"] | MODIFIER_MAP["alt"])
            if kc == keycode and masked == modifier_mask:
                threading.Thread(target=callback, daemon=True).start()
                return None
        return event

    event_mask = Quartz.CGEventMaskBit(Quartz.kCGEventKeyDown)
    tap = Quartz.CGEventTapCreate(
        Quartz.kCGSessionEventTap,
        Quartz.kCGHeadInsertEventTap,
        Quartz.kCGEventTapOptionDefault,
        event_mask,
        cg_event_callback,
        None,
    )

    if tap is None:
        print("[错误] 无法创建事件监听器！请检查辅助功能权限", flush=True)
        sys.exit(1)

    run_loop_source = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
    Quartz.CFRunLoopAddSource(
        Quartz.CFRunLoopGetCurrent(),
        run_loop_source,
        Quartz.kCFRunLoopCommonModes,
    )
    Quartz.CGEventTapEnable(tap, True)
    print("[✅] Quartz 事件监听器已启动", flush=True)
    Quartz.CFRunLoopRun()


# ─── 启动时麦克风自检 ──────────────────────────────────

def mic_self_test():
    """启动时请求麦克风权限并自动录 2 秒测试"""
    import AVFoundation

    # 先请求权限（首次会弹窗）
    status = AVFoundation.AVCaptureDevice.authorizationStatusForMediaType_(
        AVFoundation.AVMediaTypeAudio
    )
    print(f"[🔍] 麦克风权限状态: {status} (0=未决定 1=受限 2=拒绝 3=已授权)", flush=True)

    if status == 0:  # NotDetermined
        print("[🔍] 首次请求麦克风权限...", flush=True)
        granted = [None]
        def handler(g):
            granted[0] = g
        AVFoundation.AVCaptureDevice.requestAccessForMediaType_completionHandler_(
            AVFoundation.AVMediaTypeAudio, handler
        )
        for _ in range(60):
            if granted[0] is not None:
                break
            time.sleep(1)
        if not granted[0]:
            print("[错误] 麦克风权限被拒绝", flush=True)
            return False
        print("[✅] 麦克风权限已授权", flush=True)
    elif status == 2:  # Denied
        print("[错误] 麦克风权限被拒绝，请到系统设置中手动开启", flush=True)
        return False

    # 录 2 秒测试
    print("[🔍] 麦克风自检中...", flush=True)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        rec = AVFRecorder()
        rec.start(tmp.name)
        time.sleep(2)
        rec.stop()

        import wave as wave_mod
        import numpy as np
        wf = wave_mod.open(tmp.name, "rb")
        raw = wf.readframes(wf.getnframes())
        nframes = wf.getnframes()
        wf.close()
        if nframes > 0:
            samples = np.frombuffer(raw, dtype=np.int16)
            peak = int(np.abs(samples).max())
            print(f"[🔍] 自检: peak={peak}, samples={len(samples)}", flush=True)
            if peak < 10:
                print("[⚠️] 麦克风自检失败：静音", flush=True)
                return False
            else:
                print("[✅] 麦克风正常", flush=True)
                return True
        else:
            print("[⚠️] 麦克风自检失败：无数据", flush=True)
            return False
    except Exception as e:
        print(f"[⚠️] 自检异常: {e}", flush=True)
        return False
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser(description="语音输入工具")
    parser.add_argument("--hotkey", default="cmd+shift+v")
    parser.add_argument("--model", default="small",
                        choices=["tiny", "base", "small", "medium", "large"])
    parser.add_argument("--language", default="zh")
    parser.add_argument("--silence-timeout", type=float, default=2.0,
                        help="静音多少秒后自动停止录音（默认: 2.0）")
    parser.add_argument("--silence-threshold", type=float, default=-30.0,
                        help="静音判定阈值 dB（默认: -30.0）")
    parser.add_argument("--signal-mode", action="store_true",
                        help="信号模式：由 Swift 父进程通过 SIGUSR1 触发录音（无需 CGEventTap）")
    args = parser.parse_args()

    # 设置全局静音检测配置
    global SILENCE_TIMEOUT, SILENCE_THRESHOLD, _whisper_model, _language
    SILENCE_TIMEOUT = args.silence_timeout
    SILENCE_THRESHOLD = args.silence_threshold
    _language = args.language

    modifier_mask, keycode = parse_hotkey(args.hotkey)

    # 麦克风自检
    mic_self_test()

    ssl._create_default_https_context = ssl._create_unverified_context

    print(f"[⏳] 加载 Whisper {args.model} 模型...", flush=True)
    import whisper as whisper_module
    model = whisper_module.load_model(args.model)
    _whisper_model = model
    print("[✅] 模型加载完成", flush=True)

    def on_hotkey():
        with lock:
            if transcribing:
                print("[⏳] 识别中，请稍候...", flush=True)
                return
            if not recording:
                start_recording()
            else:
                stop_and_dispatch(model, args.language)

    mode_label = "信号模式 (SIGUSR1)" if args.signal_mode else "CGEventTap"
    print("", flush=True)
    print("=" * 50, flush=True)
    print("  语音输入工具已启动", flush=True)
    print(f"  热键: {args.hotkey.upper()}", flush=True)
    print(f"  模型: {args.model} | 语言: {args.language}", flush=True)
    print("  录音: AVFoundation (原生)", flush=True)
    print(f"  热键监听: {mode_label}", flush=True)
    print(f"  静音自动停止: {SILENCE_TIMEOUT}s / {SILENCE_THRESHOLD}dB", flush=True)
    print("  按热键开始录音，说完自动停止", flush=True)
    print("  Ctrl+C 退出", flush=True)
    print("=" * 50, flush=True)
    print("", flush=True)

    if args.signal_mode:
        # 信号模式：由 Swift 父进程通过 SIGUSR1 触发
        def _sigusr1_handler(signum, frame):
            threading.Thread(target=on_hotkey, daemon=True).start()
        signal.signal(signal.SIGUSR1, _sigusr1_handler)
        print("[✅] 信号模式就绪，等待 SIGUSR1...", flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            print("\n[👋] 已退出", flush=True)
    else:
        # 传统模式：Python 自建 CGEventTap（需要辅助功能权限）
        try:
            run_event_loop(modifier_mask, keycode, on_hotkey)
        except KeyboardInterrupt:
            print("\n[👋] 已退出", flush=True)


if __name__ == "__main__":
    main()
