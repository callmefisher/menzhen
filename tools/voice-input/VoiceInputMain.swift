import Foundation
import AVFoundation
import Cocoa

// ─── 全局状态（C 回调可访问）────────────────────────────
var gPythonPID: pid_t = 0
var gEventTap: CFMachPort?

// Cmd+Shift+V
let kVKeycode: Int64 = 9
let kCmdFlag: UInt64 = 1 << 20
let kShiftFlag: UInt64 = 1 << 17
let kAllModFlags: UInt64 = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20)
let kRequiredMods: UInt64 = kCmdFlag | kShiftFlag

// ─── CGEvent 热键回调 ─────────────────────────────────
func hotkeyCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout {
        if let tap = gEventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passRetained(event)
    }
    guard type == .keyDown else {
        return Unmanaged.passRetained(event)
    }
    let kc = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags.rawValue & kAllModFlags
    if kc == kVKeycode && flags == kRequiredMods {
        kill(gPythonPID, SIGUSR1)
        return nil  // 吞掉热键事件
    }
    return Unmanaged.passRetained(event)
}

// ─── 请求麦克风权限 ──────────────────────────────────
let sem = DispatchSemaphore(value: 0)
var micGranted = false
let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
if micStatus == .authorized {
    micGranted = true
} else if micStatus == .notDetermined {
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        micGranted = granted
        sem.signal()
    }
    sem.wait()
} else {
    fputs("[错误] 麦克风权限被拒绝，请到系统设置中开启\n", stderr)
}
if micGranted {
    fputs("[✅] 麦克风权限已授权\n", stderr)
}

// ─── 日志文件 ────────────────────────────────────────
let logFile = FileHandle(forWritingAtPath: "/tmp/voice-input.log") ?? {
    FileManager.default.createFile(atPath: "/tmp/voice-input.log", contents: nil)
    return FileHandle(forWritingAtPath: "/tmp/voice-input.log")!
}()
let errFile = FileHandle(forWritingAtPath: "/tmp/voice-input.err") ?? {
    FileManager.default.createFile(atPath: "/tmp/voice-input.err", contents: nil)
    return FileHandle(forWritingAtPath: "/tmp/voice-input.err")!
}()
logFile.seekToEndOfFile()
errFile.seekToEndOfFile()

// ─── 启动 Python（信号模式）──────────────────────────
let env = [
    "PYTHONPATH": "/Users/xiayanji/qbox/menzhen/tools/voice-input/.venv/lib/python3.14/site-packages",
    "PATH": "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    "HOME": NSHomeDirectory(),
]

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/arch")
task.arguments = [
    "-arm64",
    "/Library/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python",
    "-u",
    "/Users/xiayanji/qbox/menzhen/tools/voice-input/voice_input.py",
    "--signal-mode",
]
task.environment = env
task.standardOutput = logFile
task.standardError = errFile
task.terminationHandler = { process in
    let code = process.terminationStatus
    fputs("[⚠️] Python 进程退出，code=\(code)\n", stderr)
    exit(code)
}

do {
    try task.run()
    gPythonPID = task.processIdentifier
    fputs("[✅] Python 进程已启动, PID=\(gPythonPID)\n", stderr)
} catch {
    fputs("[错误] 启动 Python 失败: \(error)\n", stderr)
    exit(1)
}

// ─── 创建 CGEventTap 监听热键 ─────────────────────────
let eventMask = CGEventMask(1 << CGEventType.keyDown.rawValue)
gEventTap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: eventMask,
    callback: hotkeyCallback,
    userInfo: nil
)

guard let tap = gEventTap else {
    fputs("[错误] 无法创建事件监听器！请检查辅助功能权限\n", stderr)
    fputs("  请到 系统设置 → 隐私与安全性 → 辅助功能 中添加 VoiceInput.app\n", stderr)
    task.terminate()
    exit(1)
}

let runLoopSource = CFMachPortCreateRunLoopSource(nil, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
fputs("[✅] 热键监听已启动 (CMD+SHIFT+V)\n", stderr)

// 阻塞主线程，等待事件
CFRunLoopRun()
