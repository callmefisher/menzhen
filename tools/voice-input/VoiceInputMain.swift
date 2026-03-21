import Foundation
import AVFoundation

// 请求麦克风权限（首次会弹系统弹窗）
let semaphore = DispatchSemaphore(value: 0)
var micGranted = false

let status = AVCaptureDevice.authorizationStatus(for: .audio)
if status == .authorized {
    micGranted = true
} else if status == .notDetermined {
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        micGranted = granted
        semaphore.signal()
    }
    semaphore.wait()
} else {
    fputs("[错误] 麦克风权限被拒绝，请到系统设置中开启\n", stderr)
}

if micGranted {
    fputs("[✅] 麦克风权限已授权\n", stderr)
}

// 日志文件
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

// 启动 Python 语音输入脚本
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
]
task.environment = env
task.standardOutput = logFile
task.standardError = errFile

do {
    try task.run()
    task.waitUntilExit()
} catch {
    fputs("[错误] 启动失败: \(error)\n", stderr)
    exit(1)
}
