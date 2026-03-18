#!/usr/bin/env python3
"""
Deploy Wizard - Web UI guided deployment for menzhen system.
Cross-platform: Mac / Windows / Linux (Ubuntu, CentOS, etc.)
Usage: python3 deploy-wizard.py
"""

import http.server
import json
import os
import platform
import re
import secrets
import shutil
import socket
import socketserver
import string
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path

WIZARD_PORT = 9527
SCRIPT_DIR = Path(__file__).resolve().parent
IMAGE_REGISTRY = "https://your-registry.example.com"
REPO_URL = "https://github.com/callmefisher/menzhen.git"

# .env 变量定义：(key, 中文名, 分组, 是否自动生成, 默认值提示)
ENV_SCHEMA = [
    # 基础配置（自动生成，一般不用改）
    ("DB_PASSWORD",   "数据库密码",        "basic", True,  "自动生成随机密码"),
    ("JWT_SECRET",    "安全密钥",          "basic", True,  "自动生成随机密钥"),
    ("MINIO_SECRET_KEY", "文件存储密码",   "basic", True,  "自动生成随机密码"),
    # 云备份配置（可选）
    ("QINIU_ACCESS_KEY", "七牛云 AccessKey", "qiniu", False, "留空则不启用云备份"),
    ("QINIU_SECRET_KEY", "七牛云 SecretKey", "qiniu", False, "留空则不启用云备份"),
    ("QINIU_BUCKET",     "七牛云存储桶名称",  "qiniu", False, "public"),
    ("QINIU_DOMAIN",     "七牛云域名",       "qiniu", False, "public.qnlinking.com"),
    # AI 接口配置（可选）
    ("DEEPSEEK_API_KEY",  "AI 接口密钥",    "ai", False, "留空则不启用 AI 功能"),
    ("DEEPSEEK_BASE_URL", "AI 接口地址",    "ai", False, "留空则不启用 AI 功能"),
]

# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def get_local_ip():
    """Get the primary local IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def detect_os():
    """Return os key and display name."""
    sys_name = platform.system()
    if sys_name == "Darwin":
        return "mac", "macOS"
    elif sys_name == "Windows":
        return "windows", "Windows"
    else:
        return "linux", "Linux"


def check_service(ip, port=80, timeout=3):
    """Check if http://<ip>:<port> is reachable."""
    try:
        url = f"http://{ip}:{port}"
        req = urllib.request.Request(url, method="HEAD")
        urllib.request.urlopen(req, timeout=timeout)
        return True
    except urllib.error.HTTPError as e:
        # 405, 403, etc. still means the server is running
        return e.code < 500
    except Exception:
        return False


def generate_site_id():
    """Generate a SITE_ID: 6 random alphanumeric + datetime."""
    chars = []
    chars.append(secrets.choice(string.ascii_lowercase))
    chars.append(secrets.choice(string.ascii_uppercase))
    chars.append(secrets.choice(string.digits))
    alphabet = string.ascii_letters + string.digits
    for _ in range(3):
        chars.append(secrets.choice(alphabet))
    # Shuffle using secrets for unpredictability
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    prefix = "".join(chars)
    suffix = datetime.now().strftime("%Y%m%d%H%M%S")
    return prefix + suffix


def check_command(cmd):
    """Check if a command is available."""
    try:
        if platform.system() == "Windows":
            result = subprocess.run(
                ["where", cmd], capture_output=True, timeout=10
            )
        else:
            result = subprocess.run(
                ["which", cmd], capture_output=True, timeout=10
            )
        return result.returncode == 0
    except Exception:
        return False


def check_docker_compose():
    """Check if docker compose (v2) is available."""
    try:
        result = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True, timeout=10
        )
        return result.returncode == 0
    except Exception:
        return False


def _popen_kwargs():
    """Extra kwargs for subprocess on Windows to suppress console windows."""
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {}


def run_command(cmd, cwd=None):
    """Run a command and return (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            cwd=cwd or str(SCRIPT_DIR), timeout=600,
            **_popen_kwargs()
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "命令执行超时"
    except Exception as e:
        return -1, "", str(e)


# ---------------------------------------------------------------------------
# SSE streaming helper
# ---------------------------------------------------------------------------

def stream_command(handler, cmd, cwd=None):
    """Run a command and stream output via SSE. Only accepts hardcoded commands."""
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "keep-alive")
    handler.end_headers()

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            cwd=cwd or str(SCRIPT_DIR), text=True, bufsize=1,
            **_popen_kwargs()
        )
        for line in proc.stdout:
            data = json.dumps({"type": "log", "data": line.rstrip()})
            handler.wfile.write(f"data: {data}\n\n".encode())
            handler.wfile.flush()
        proc.wait()
        result = "success" if proc.returncode == 0 else "error"
        data = json.dumps({
            "type": "done", "result": result,
            "code": proc.returncode
        })
        handler.wfile.write(f"data: {data}\n\n".encode())
        handler.wfile.flush()
    except Exception as e:
        data = json.dumps({"type": "done", "result": "error", "data": str(e)})
        handler.wfile.write(f"data: {data}\n\n".encode())
        handler.wfile.flush()


# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------

class WizardHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        # Suppress default logging
        pass

    MAX_BODY_SIZE = 64 * 1024  # 64 KB

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > self.MAX_BODY_SIZE:
            return {}
        if length:
            try:
                return json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, ValueError):
                return {}
        return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode())
            return

        if self.path == "/api/detect-os":
            os_key, os_name = detect_os()
            self._send_json({"os": os_key, "name": os_name})
            return

        if self.path == "/api/detect-ip":
            ip = get_local_ip()
            self._send_json({"ip": ip})
            return

        if self.path == "/api/check-service":
            ip = get_local_ip()
            port_ok = check_service(ip)
            real_os, real_os_name = detect_os()

            # Check Docker daemon status
            docker_installed = check_command("docker")
            docker_daemon_ok = False
            if docker_installed:
                rc, _, _ = run_command(["docker", "info"], cwd=str(SCRIPT_DIR))
                docker_daemon_ok = (rc == 0)

            # Check docker compose services
            docker_running = False
            docker_partial = False
            if docker_daemon_ok:
                rc, out, _ = run_command(["docker", "compose", "ps", "--format", "json"])
                if rc == 0 and out.strip():
                    services = []
                    for line in out.strip().split("\n"):
                        try:
                            services.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
                    if services:
                        docker_running = True
                        states = [s.get("State", "") for s in services]
                        if any(s != "running" for s in states):
                            docker_partial = True

            # status: "running" | "partial" | "docker_stopped" | "not_installed"
            if port_ok:
                status = "running"
            elif docker_running:
                status = "partial"
            elif docker_installed and not docker_daemon_ok:
                status = "docker_stopped"
            else:
                status = "not_installed"
            self._send_json({
                "available": port_ok, "ip": ip, "url": f"http://{ip}",
                "real_os": real_os, "real_os_name": real_os_name,
                "status": status, "docker_installed": docker_installed,
                "docker_daemon_ok": docker_daemon_ok,
                "docker_running": docker_running,
                "docker_partial": docker_partial,
            })
            return

        if self.path == "/api/generate-site-id":
            sid = generate_site_id()
            self._send_json({"site_id": sid})
            return

        if self.path == "/api/check-deps":
            docker_ok = check_command("docker")
            compose_ok = check_docker_compose()
            git_ok = check_command("git")
            docker_ver = ""
            compose_ver = ""
            git_ver = ""
            if docker_ok:
                rc, out, _ = run_command(["docker", "--version"])
                if rc == 0:
                    docker_ver = out.strip()
            if compose_ok:
                rc, out, _ = run_command(["docker", "compose", "version"])
                if rc == 0:
                    compose_ver = out.strip()
            if git_ok:
                rc, out, _ = run_command(["git", "--version"])
                if rc == 0:
                    git_ver = out.strip()
            # Pre-checks: architecture, disk space, network
            arch = platform.machine()  # e.g. x86_64, arm64, AMD64
            disk_gb = 0
            try:
                usage = shutil.disk_usage(str(SCRIPT_DIR))
                disk_gb = round(usage.free / (1024 ** 3), 1)
            except Exception:
                pass
            network_ok = False
            try:
                urllib.request.urlopen("https://www.baidu.com", timeout=5)
                network_ok = True
            except Exception:
                try:
                    urllib.request.urlopen("https://get.docker.com", timeout=5)
                    network_ok = True
                except Exception:
                    pass
            self._send_json({
                "docker": docker_ok,
                "docker_version": docker_ver,
                "compose": compose_ok,
                "compose_version": compose_ver,
                "git": git_ok,
                "git_version": git_ver,
                "arch": arch,
                "disk_free_gb": disk_gb,
                "disk_enough": disk_gb >= 5,
                "network": network_ok,
            })
            return

        if self.path == "/api/check-images":
            images = [
                "menzhen-api:latest",
                "menzhen-web:latest",
                "menzhen-backup:latest",
                "nginx:alpine",
                "mysql:8.0",
                "minio/minio:latest",
            ]
            results = []
            for img in images:
                rc, _, _ = run_command(["docker", "image", "inspect", img])
                results.append({"image": img, "exists": rc == 0})
            self._send_json({"images": results})
            return

        if self.path == "/api/check-configs":
            configs = ["docker-compose.yml", ".env", "nginx/nginx.conf"]
            results = []
            for cfg in configs:
                p = SCRIPT_DIR / cfg
                results.append({"file": cfg, "exists": p.exists()})
            self._send_json({"configs": results})
            return

        if self.path == "/api/service-status":
            rc, out, _ = run_command(["docker", "compose", "ps", "--format", "json"])
            services = []
            if rc == 0 and out.strip():
                for line in out.strip().split("\n"):
                    try:
                        svc = json.loads(line)
                        services.append({
                            "name": svc.get("Service", svc.get("Name", "")),
                            "state": svc.get("State", "unknown"),
                            "status": svc.get("Status", ""),
                        })
                    except json.JSONDecodeError:
                        pass
            self._send_json({"services": services})
            return

        # SSE endpoints
        if self.path == "/api/install-docker":
            os_key, _ = detect_os()
            if os_key == "mac":
                if check_command("brew"):
                    stream_command(self, ["brew", "install", "--cask", "docker"])
                else:
                    # Install Homebrew first, then Docker Desktop
                    stream_command(self, [
                        "bash", "-c",
                        'echo "正在安装 Homebrew（软件管理工具）..." && '
                        '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" && '
                        'if [ -f /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi && '
                        'brew install --cask docker && '
                        'echo "Docker Desktop 安装完成！请在启动台中打开 Docker 应用。"'
                    ])
            elif os_key == "linux":
                # Use Docker official install script — handles all distros
                if check_command("curl"):
                    stream_command(self, [
                        "bash", "-c",
                        "curl -fsSL https://get.docker.com | sh && "
                        "sudo systemctl enable docker && "
                        "sudo systemctl start docker && "
                        "echo 'Docker 安装完成!'"
                    ])
                elif check_command("wget"):
                    stream_command(self, [
                        "bash", "-c",
                        "wget -qO- https://get.docker.com | sh && "
                        "sudo systemctl enable docker && "
                        "sudo systemctl start docker && "
                        "echo 'Docker 安装完成!'"
                    ])
                else:
                    # Try installing curl first, then Docker
                    stream_command(self, [
                        "bash", "-c",
                        "("
                        "  command -v apt-get >/dev/null && sudo apt-get update -qq && sudo apt-get install -y curl || "
                        "  command -v yum >/dev/null && sudo yum install -y curl || "
                        "  command -v dnf >/dev/null && sudo dnf install -y curl"
                        ") && "
                        "curl -fsSL https://get.docker.com | sh && "
                        "sudo systemctl enable docker && "
                        "sudo systemctl start docker && "
                        "echo 'Docker 安装完成!'"
                    ])
            elif os_key == "windows":
                if check_command("winget"):
                    # Check/install WSL 2 first, then Docker Desktop
                    stream_command(self, [
                        "powershell", "-Command",
                        "# Check WSL status\n"
                        "$wslOk = $false;\n"
                        "try { $out = wsl --status 2>&1; if ($LASTEXITCODE -eq 0) { $wslOk = $true } } catch {}\n"
                        "if (-not $wslOk) {\n"
                        "  Write-Output '正在安装 WSL 2（Docker 运行所需）...';\n"
                        "  wsl --install --no-distribution;\n"
                        "  Write-Output 'WSL 2 安装完成';\n"
                        "}\n"
                        "# Install Docker Desktop\n"
                        "Write-Output '正在安装 Docker Desktop...';\n"
                        "winget install Docker.DockerDesktop --accept-package-agreements --accept-source-agreements;\n"
                        "# Refresh PATH\n"
                        "$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + "
                        "[System.Environment]::GetEnvironmentVariable('Path','User');\n"
                        "Write-Output '安装完成！可能需要重启电脑后才能使用 Docker。';"
                    ])
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    msg = json.dumps({"type": "done", "result": "error",
                        "data": "自动安装工具不可用，请手动下载安装 Docker Desktop: https://docs.docker.com/desktop/install/windows-install/"})
                    self.wfile.write(f"data: {msg}\n\n".encode())
                    self.wfile.flush()
            return

        if self.path == "/api/install-git":
            os_key, _ = detect_os()
            if os_key == "mac":
                if check_command("brew"):
                    stream_command(self, ["bash", "-c",
                        "brew install git && git --version && echo 'Git 安装完成!'"])
                else:
                    # xcode-select --install opens a GUI dialog; guide user
                    stream_command(self, ["bash", "-c",
                        'echo "正在安装 Git（会弹出安装窗口，请点击安装）..." && '
                        "xcode-select --install 2>/dev/null; "
                        'echo "请在弹出的窗口中点击「安装」，安装完成后重新检测即可。"'])
            elif os_key == "linux":
                if check_command("apt-get"):
                    stream_command(self, ["sudo", "apt-get", "install", "-y", "git"])
                elif check_command("yum"):
                    stream_command(self, ["sudo", "yum", "install", "-y", "git"])
                elif check_command("dnf"):
                    stream_command(self, ["sudo", "dnf", "install", "-y", "git"])
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    msg = json.dumps({"type": "done", "result": "error",
                        "data": "未检测到 apt/yum/dnf 包管理器，请手动安装 Git: https://git-scm.com/downloads"})
                    self.wfile.write(f"data: {msg}\n\n".encode())
                    self.wfile.flush()
            elif os_key == "windows":
                if check_command("winget"):
                    stream_command(self, [
                        "powershell", "-Command",
                        "winget install Git.Git --accept-package-agreements --accept-source-agreements;\n"
                        "# Refresh PATH so git is immediately available\n"
                        "$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + "
                        "[System.Environment]::GetEnvironmentVariable('Path','User');\n"
                        "git --version;\n"
                        "Write-Output 'Git 安装完成!';"
                    ])
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    msg = json.dumps({"type": "done", "result": "error",
                        "data": "请手动下载安装 Git: https://git-scm.com/downloads"})
                    self.wfile.write(f"data: {msg}\n\n".encode())
                    self.wfile.flush()
            return

        if self.path == "/api/start-docker":
            os_key, _ = detect_os()
            if os_key == "mac":
                # Open Docker Desktop app, then wait for daemon
                stream_command(self, [
                    "bash", "-c",
                    "open -a Docker && echo '正在启动 Docker Desktop...' && "
                    "for i in $(seq 1 60); do "
                    "  docker info >/dev/null 2>&1 && echo 'Docker 已启动!' && exit 0; "
                    "  echo \"等待中... ($i/60)\"; sleep 2; "
                    "done; echo 'Docker 启动超时'; exit 1"
                ])
            elif os_key == "windows":
                stream_command(self, [
                    "powershell", "-Command",
                    "Write-Output '正在查找 Docker Desktop...'; "
                    "$p = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Docker Inc.\\Docker\\Install' -EA SilentlyContinue).AppPath; "
                    "if (-not $p) { $p = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe' }; "
                    "if (Test-Path $p) { "
                    "  Write-Output \"找到: $p\"; Start-Process $p; "
                    "} else { "
                    "  Write-Output '尝试直接启动...'; Start-Process 'Docker Desktop' -EA SilentlyContinue; "
                    "}; "
                    "Write-Output '等待 Docker 启动...'; "
                    "for ($i=1; $i -le 60; $i++) { "
                    "  $null = & docker info 2>&1; "
                    "  if ($LASTEXITCODE -eq 0) { Write-Output 'Docker 已启动!'; exit 0 }; "
                    "  Write-Output \"等待中... ($i/60)\"; "
                    "  Start-Sleep -Seconds 2; "
                    "}; "
                    "Write-Output 'Docker 启动超时，请手动打开 Docker Desktop'; exit 1"
                ])
            else:
                stream_command(self, [
                    "bash", "-c",
                    "sudo systemctl start docker && echo 'Docker 已启动!' || echo 'Docker 启动失败'"
                ])
            return

        if self.path == "/api/deploy":
            stream_command(self, ["docker", "compose", "up", "-d"])
            return

        if self.path == "/api/build-full":
            stream_command(self, ["docker", "compose", "build"])
            return

        if self.path == "/api/check-repo":
            # Check if essential project files exist
            checks = {
                "docker_compose": (SCRIPT_DIR / "docker-compose.yml").exists(),
                "server": (SCRIPT_DIR / "server").is_dir(),
                "web": (SCRIPT_DIR / "web").is_dir(),
                "deploy_sh": (SCRIPT_DIR / "deploy.sh").exists(),
                "env_example": (SCRIPT_DIR / ".env.example").exists(),
            }
            checks["ready"] = all(checks.values())
            checks["git_available"] = check_command("git")
            self._send_json(checks)
            return

        if self.path == "/api/clone-repo":
            # git clone fails on non-empty dir, so use init+pull instead
            os_key, _ = detect_os()
            script_dir = str(SCRIPT_DIR)
            if os_key == "windows":
                stream_command(self, [
                    "cmd", "/c",
                    f'cd /d "{script_dir}" && '
                    "git init && "
                    f'git remote add origin "{REPO_URL}" 2>nul || git remote set-url origin "{REPO_URL}" && '
                    "git fetch origin && "
                    "git checkout -f origin/main -- . && "
                    'echo 代码下载完成!'
                ])
            else:
                stream_command(self, [
                    "bash", "-c",
                    f"cd '{script_dir}' && "
                    "git init && "
                    f"git remote add origin '{REPO_URL}' 2>/dev/null || git remote set-url origin '{REPO_URL}' && "
                    "git fetch origin && "
                    "git checkout -f origin/main -- . && "
                    "echo '代码下载完成!'"
                ])
            return

        if self.path == "/api/get-env-config":
            # Return env schema + current values from .env or .env.example
            env_path = SCRIPT_DIR / ".env"
            example_path = SCRIPT_DIR / ".env.example"
            current = {}
            src = env_path if env_path.exists() else example_path
            if src and src.exists():
                for line in src.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        current[k.strip()] = v.strip()
            first_install = not env_path.exists()
            # Placeholder values in .env.example that should show as empty
            placeholders = {"xxx", "xxxx", "sk-xxx", "change-me-in-production"}
            items = []
            for key, label, group, auto_gen, hint in ENV_SCHEMA:
                val = current.get(key, "")
                # On first install, clear placeholder/default values for optional fields
                if first_install and not auto_gen and val.lower() in placeholders:
                    val = ""
                items.append({
                    "key": key, "label": label, "group": group,
                    "auto_gen": auto_gen, "hint": hint,
                    "value": val,
                })
            self._send_json({"items": items, "has_env": not first_install})
            return

        self.send_error(404)

    def do_POST(self):
        if self.path == "/api/save-site-id":
            body = self._read_body()
            site_id = body.get("site_id", "")
            if not site_id or not re.fullmatch(r"[A-Za-z0-9]{1,64}", site_id):
                self._send_json({"error": "站点编号格式不正确，只能包含英文字母和数字"}, 400)
                return
            # Write SITE_ID to .env
            env_path = SCRIPT_DIR / ".env"
            if env_path.exists():
                content = env_path.read_text(encoding="utf-8")
                if re.search(r"^SITE_ID=", content, re.MULTILINE):
                    content = re.sub(
                        r"^SITE_ID=.*$", f"SITE_ID={site_id}",
                        content, flags=re.MULTILINE
                    )
                else:
                    content += f"\nSITE_ID={site_id}\n"
                env_path.write_text(content, encoding="utf-8", newline="\n")
            else:
                env_path.write_text(f"SITE_ID={site_id}\n", encoding="utf-8", newline="\n")
            self._send_json({"ok": True, "site_id": site_id})
            return

        if self.path == "/api/generate-env":
            # Generate .env from .env.example if it doesn't exist
            env_path = SCRIPT_DIR / ".env"
            example_path = SCRIPT_DIR / ".env.example"
            if env_path.exists():
                self._send_json({"ok": True, "message": "配置文件已存在，无需重新生成"})
                return
            if not example_path.exists():
                self._send_json({"error": "缺少配置模板文件 .env.example，请联系技术人员"}, 400)
                return
            content = example_path.read_text(encoding="utf-8")
            db_pass = secrets.token_urlsafe(16)[:16]
            jwt_secret = secrets.token_urlsafe(32)[:32]
            minio_secret = secrets.token_urlsafe(16)[:16]
            content = re.sub(r"^DB_PASSWORD=.*$", f"DB_PASSWORD={db_pass}", content, flags=re.MULTILINE)
            content = re.sub(r"^JWT_SECRET=.*$", f"JWT_SECRET={jwt_secret}", content, flags=re.MULTILINE)
            content = re.sub(r"^MINIO_SECRET_KEY=.*$", f"MINIO_SECRET_KEY={minio_secret}", content, flags=re.MULTILINE)
            env_path.write_text(content, encoding="utf-8", newline="\n")
            self._send_json({"ok": True, "message": "配置文件已自动生成"})
            return

        if self.path == "/api/save-env-config":
            body = self._read_body()
            values = body.get("values", {})
            if not values:
                self._send_json({"error": "未提供配置内容"}, 400)
                return
            env_path = SCRIPT_DIR / ".env"
            example_path = SCRIPT_DIR / ".env.example"
            first_install = not env_path.exists()

            if first_install:
                # First install: use .env.example as base
                if example_path.exists():
                    content = example_path.read_text(encoding="utf-8")
                else:
                    content = ""
            else:
                # Already exists: read current .env, only patch changed fields
                content = env_path.read_text(encoding="utf-8")

            # Auto-generate secrets for auto_gen fields if empty (first install only)
            if first_install:
                for key, _, _, auto_gen, _ in ENV_SCHEMA:
                    val = values.get(key, "")
                    if auto_gen and not val:
                        val = secrets.token_urlsafe(16)[:16]
                        values[key] = val

            # Only update fields the user actually changed
            for key, val in values.items():
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                    continue
                val = val.replace("\n", "").replace("\r", "")
                if re.search(rf"^{re.escape(key)}=", content, re.MULTILINE):
                    content = re.sub(
                        rf"^{re.escape(key)}=.*$", f"{key}={val}",
                        content, flags=re.MULTILINE
                    )
                elif first_install:
                    content += f"\n{key}={val}\n"
            env_path.write_text(content, encoding="utf-8", newline="\n")
            self._send_json({"ok": True, "first_install": first_install})
            return

        self.send_error(404)


# ---------------------------------------------------------------------------
# Embedded HTML / CSS / JS
# ---------------------------------------------------------------------------

HTML_PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>门诊系统 - 安装向导</title>
<style>
:root {
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --success: #16a34a;
  --danger: #dc2626;
  --warning: #d97706;
  --bg: #f8fafc;
  --card: #ffffff;
  --border: #e2e8f0;
  --text: #1e293b;
  --text-secondary: #64748b;
  --radius: 12px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "WenQuanYi Micro Hei", sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  font-size: 16px;
}
.container {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px;
}
header {
  text-align: center;
  margin-bottom: 32px;
}
header h1 {
  font-size: 30px;
  font-weight: 700;
  margin-bottom: 8px;
}
header p {
  color: var(--text-secondary);
  font-size: 16px;
}

/* Progress bar */
.progress-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 32px;
}
.progress-step {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--border);
  transition: background 0.3s;
}
.progress-step.active { background: var(--primary); }
.progress-step.done { background: var(--success); }

/* Step labels */
.step-labels {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  font-size: 15px;
  color: var(--text-secondary);
}
.step-labels span {
  flex: 1;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.step-labels span.active { color: var(--primary); font-weight: 600; }
.step-labels span.done { color: var(--success); }

/* Card */
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.card h2 {
  font-size: 22px;
  margin-bottom: 10px;
}
.card .subtitle {
  color: var(--text-secondary);
  font-size: 15px;
  margin-bottom: 24px;
  line-height: 1.6;
}

/* OS selector */
.os-options {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}
.os-option {
  flex: 1;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 12px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}
.os-option:hover { border-color: var(--primary); }
.os-option.selected {
  border-color: var(--primary);
  background: #eff6ff;
}
.os-option .icon { font-size: 36px; margin-bottom: 8px; }
.os-option .name { font-weight: 600; font-size: 15px; }

/* Status badges */
.status-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  font-size: 15px;
}
.status-item:last-child { border-bottom: none; }
.badge {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
}
.badge.ok { background: #dcfce7; color: var(--success); }
.badge.fail { background: #fef2f2; color: var(--danger); }
.badge.warn { background: #fef9c3; color: var(--warning); }
.badge.info { background: #eff6ff; color: var(--primary); }

/* Input */
.input-group {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.input-group input {
  flex: 1;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 16px;
  outline: none;
  transition: border-color 0.2s;
}
.input-group input:focus { border-color: var(--primary); }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 28px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  text-decoration: none;
}
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-hover); }
.btn-secondary { background: var(--border); color: var(--text); }
.btn-secondary:hover { background: #d1d5db; }
.btn-success { background: var(--success); color: #fff; }
.btn-success:hover { background: #15803d; }
.btn-danger { background: var(--danger); color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.actions {
  display: flex;
  justify-content: space-between;
  margin-top: 28px;
}

/* Log console */
.log-console {
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  font-family: "SF Mono", Menlo, Monaco, monospace;
  font-size: 14px;
  line-height: 1.6;
  max-height: 300px;
  overflow-y: auto;
  margin: 16px 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-console .log-line { margin: 0; }
.log-console .log-success { color: #4ade80; }
.log-console .log-error { color: #f87171; }

/* Spinner */
.spinner {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  vertical-align: middle;
  margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Final success */
.success-box {
  text-align: center;
  padding: 24px;
}
.success-box .big-icon { font-size: 64px; margin-bottom: 16px; }
.success-box h2 { color: var(--success); margin-bottom: 8px; font-size: 24px; }
.success-box .url {
  font-size: 22px;
  font-weight: 700;
  color: var(--primary);
  margin: 16px 0;
}
.success-box .url a { color: inherit; text-decoration: underline; }

/* Hint box */
.hint-box {
  margin-top: 16px;
  padding: 16px;
  border-radius: 8px;
  font-size: 15px;
  line-height: 1.6;
}
.hint-box.green { background: #dcfce7; }
.hint-box.yellow { background: #fef9c3; }
.hint-box.red { background: #fef2f2; }

/* Responsive */
@media (max-width: 600px) {
  .os-options { flex-direction: column; }
  .container { padding: 24px 16px; }
  .step-labels { display: none; }
}

/* Help modal */
.modal-overlay {
  display: none;
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1000;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.modal-overlay.show { display: block; }
.modal-content {
  background: var(--card);
  max-width: 720px;
  margin: 40px auto;
  border-radius: var(--radius);
  padding: 32px;
  position: relative;
  box-shadow: 0 8px 30px rgba(0,0,0,0.15);
}
.modal-close {
  position: absolute;
  top: 16px; right: 16px;
  background: var(--border);
  border: none;
  border-radius: 50%;
  width: 44px; height: 44px;
  font-size: 22px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-close:hover { background: #d1d5db; }
.guide-section { margin-bottom: 28px; }
.guide-section h3 { font-size: 17px; margin-bottom: 10px; color: var(--primary); }
.guide-section p, .guide-section li { font-size: 15px; line-height: 1.8; }
.guide-section ul { padding-left: 20px; }
.guide-section code {
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 14px;
  font-family: "SF Mono", Menlo, Monaco, monospace;
}
.guide-section pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 14px;
  border-radius: 8px;
  font-size: 14px;
  overflow-x: auto;
  margin: 10px 0;
  font-family: "SF Mono", Menlo, Monaco, monospace;
}
.guide-section .tip-box {
  background: #eff6ff;
  border-left: 4px solid var(--primary);
  padding: 12px 16px;
  border-radius: 0 8px 8px 0;
  margin: 10px 0;
  font-size: 14px;
}
.help-btn {
  position: absolute;
  top: 0; right: 0;
  background: var(--border);
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text);
}
.help-btn:hover { background: #d1d5db; }
</style>
</head>
<body>
<div class="container">
  <header style="position:relative;">
    <h1>门诊系统安装向导</h1>
    <p>跟着步骤一步一步操作，轻松完成系统安装</p>
    <button class="help-btn" onclick="document.getElementById('helpModal').classList.add('show')">需要帮助？</button>
  </header>

  <div class="step-labels" id="stepLabels">
    <span>确认电脑</span>
    <span>检查状态</span>
    <span>设置编号</span>
    <span>检查软件</span>
    <span>准备程序</span>
    <span>安装系统</span>
  </div>
  <div class="progress-bar" id="progressBar">
    <div class="progress-step"></div>
    <div class="progress-step"></div>
    <div class="progress-step"></div>
    <div class="progress-step"></div>
    <div class="progress-step"></div>
    <div class="progress-step"></div>
  </div>

  <div class="card" id="wizard"></div>
</div>

<script>
const $ = s => document.querySelector(s);
const API = '';

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

let state = {
  step: 1,
  os: '',
  osName: '',
  ip: '',
  siteId: '',
  serviceAvailable: false,
};

function updateProgress() {
  const steps = document.querySelectorAll('.progress-step');
  const labels = document.querySelectorAll('#stepLabels span');
  steps.forEach((el, i) => {
    el.className = 'progress-step';
    if (i < state.step - 1) el.classList.add('done');
    else if (i === state.step - 1) el.classList.add('active');
  });
  labels.forEach((el, i) => {
    el.className = '';
    if (i < state.step - 1) el.classList.add('done');
    else if (i === state.step - 1) el.classList.add('active');
  });
}

async function api(path, opts) {
  try {
    const res = await fetch(API + path, opts);
    if (!res.ok) throw new Error('服务响应异常');
    return res.json();
  } catch(e) {
    throw e;
  }
}

// 通用错误展示
function showError(el, msg) {
  el.innerHTML = `
    <div style="text-align:center; padding:32px;">
      <div style="font-size:48px; margin-bottom:16px;">&#x26A0;&#xFE0F;</div>
      <h2 style="margin-bottom:12px;">出现问题</h2>
      <p style="font-size:16px; color:var(--text-secondary); margin-bottom:20px;">${msg || '无法连接到安装服务，请检查后刷新页面重试。'}</p>
      <button class="btn btn-primary" onclick="location.reload()">刷新页面重试</button>
    </div>
  `;
}

// 服务状态翻译
function stateText(s) {
  const map = { running: '运行中', exited: '已停止', restarting: '重启中', dead: '异常', paused: '已暂停', created: '已创建' };
  return map[s] || '异常';
}

// 自定义中文确认弹窗
function showConfirm(message, onYes) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:420px; text-align:center; padding:32px;">
      <p style="font-size:17px; line-height:1.8; margin-bottom:24px;">${message}</p>
      <div style="display:flex; gap:12px; justify-content:center;">
        <button class="btn btn-secondary" id="cfmNo">取消</button>
        <button class="btn btn-danger" id="cfmYes">确定继续</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cfmNo').onclick = () => overlay.remove();
  overlay.querySelector('#cfmYes').onclick = () => { overlay.remove(); onYes(); };
}

function render() {
  updateProgress();
  const w = $('#wizard');
  const step = state.step;
  const fn = [null, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6][step];
  if (fn) fn(w).catch(() => showError(w));
}

// ---- 第一步：选择操作系统 ----
async function renderStep1(el) {
  const data = await api('/api/detect-os');
  state.os = data.os;
  state.osName = data.name;

  const osNames = { mac: '苹果 macOS', windows: 'Windows 电脑', linux: 'Linux 服务器' };

  el.innerHTML = `
    <h2>第一步：确认您的电脑系统</h2>
    <p class="subtitle">系统已自动识别您的电脑类型，请确认是否正确。如果不对，请点击正确的选项。</p>
    <div class="os-options">
      <div class="os-option ${state.os === 'mac' ? 'selected' : ''}" data-os="mac">
        <div class="icon">&#x1F34E;</div>
        <div class="name">苹果电脑</div>
      </div>
      <div class="os-option ${state.os === 'windows' ? 'selected' : ''}" data-os="windows">
        <div class="icon">&#x1FA9F;</div>
        <div class="name">Windows 电脑</div>
      </div>
      <div class="os-option ${state.os === 'linux' ? 'selected' : ''}" data-os="linux">
        <div class="icon">&#x1F427;</div>
        <div class="name">Linux 服务器</div>
        <div style="font-size:14px;color:var(--text-secondary);margin-top:4px;">Ubuntu / CentOS 等</div>
      </div>
    </div>
    <div id="linuxHint" style="display:none; margin-bottom:16px; padding:14px 16px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; font-size:14px; line-height:1.7; color:#1e40af;">
      <strong>Linux 服务器用户提示：</strong><br>
      如果您是通过远程连接（SSH）操作服务器，且不太熟悉操作流程，<br>
      请点击右上角的「<a href="javascript:openHelp('guide-ssh')" style="color:#1d4ed8;font-weight:600;">帮助</a>」按钮，查看详细的图文教程。
    </div>
    <div class="actions">
      <span></span>
      <button class="btn btn-primary" id="nextBtn">确认，下一步 &rarr;</button>
    </div>
  `;

  const linuxHint = el.querySelector('#linuxHint');
  function updateLinuxHint() {
    if (linuxHint) linuxHint.style.display = state.os === 'linux' ? 'block' : 'none';
  }
  updateLinuxHint();

  el.querySelectorAll('.os-option').forEach(opt => {
    opt.onclick = () => {
      el.querySelectorAll('.os-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      state.os = opt.dataset.os;
      state.osName = osNames[state.os];
      updateLinuxHint();
    };
  });

  el.querySelector('#nextBtn').onclick = () => { state.step = 2; render(); };
}

// ---- 第二步：检查服务是否已运行 ----
async function renderStep2(el) {
  el.innerHTML = `
    <h2>第二步：检查系统是否已安装</h2>
    <p class="subtitle"><span class="spinner"></span> 正在检查，请稍候...</p>
  `;

  const data = await api('/api/check-service');
  state.ip = data.ip;
  state.serviceAvailable = data.available;

  // 检查用户选的 OS 和服务端检测到的真实 OS 是否一致
  const osDisplayNames = { mac: '苹果电脑 (macOS)', windows: 'Windows 电脑', linux: 'Linux 服务器' };
  let osMismatchHtml = '';
  if (data.real_os && data.real_os !== state.os) {
    osMismatchHtml = `
      <div style="margin-bottom:20px; padding:16px; background:#fef2f2; border:2px solid #dc2626; border-radius:8px;">
        <div style="font-size:16px; font-weight:700; color:#991b1b; margin-bottom:8px;">
          &#9888;&#65039; 系统选择有误
        </div>
        <div style="font-size:15px; color:#991b1b; line-height:1.8;">
          您在上一步选择的是 <strong>${esc(osDisplayNames[state.os] || state.os)}</strong>，
          但检测到这台电脑实际是 <strong>${esc(osDisplayNames[data.real_os] || data.real_os_name)}</strong>。<br>
          系统选择错误会导致后续安装失败，请点击下方「返回修改」纠正。
        </div>
        <button class="btn btn-danger" onclick="state.os='${data.real_os}';state.osName='${esc(osDisplayNames[data.real_os] || data.real_os_name)}';state.step=1;render();" style="margin-top:12px;">
          返回修改
        </button>
      </div>
    `;
  }

  if (data.status === 'running') {
    el.innerHTML = `
      ${osMismatchHtml}
      <h2>第二步：系统已在运行！</h2>
      <p class="subtitle">检测到系统已经安装好了，可以直接使用。</p>
      <div class="status-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
        <span>访问地址</span>
        <a href="${esc(data.url)}" target="_blank" style="font-size:24px; font-weight:700; color:var(--primary); text-decoration:underline;">${esc(data.url)}</a>
      </div>
      <div class="hint-box green" style="text-align:center;">
        系统运行正常！您可以直接点击下方按钮打开系统。<br>
        如果需要重新安装，请点击「重新安装」。
      </div>
      <div class="actions">
        <button class="btn btn-secondary" onclick="state.step=1;render();">&larr; 上一步</button>
        <div>
          <a href="${esc(data.url)}" target="_blank" class="btn btn-success">打开系统</a>
          <button class="btn btn-primary" id="redeployBtn" style="margin-left:8px;">重新安装 &rarr;</button>
        </div>
      </div>
    `;
    el.querySelector('#redeployBtn').onclick = () => {
      showConfirm('重新安装会覆盖当前系统配置，确定要继续吗？', () => { state.step = 3; render(); });
    };
  } else if (data.status === 'partial') {
    el.innerHTML = `
      ${osMismatchHtml}
      <h2>第二步：系统已安装，但部分服务异常</h2>
      <p class="subtitle">检测到系统已安装过，但部分服务未正常运行，可能需要修复。</p>
      <div class="status-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
        <span>访问地址（当前不可用）</span>
        <span style="font-size:22px; font-weight:700; color:var(--warning);">http://${esc(data.ip)}</span>
      </div>
      <div class="hint-box yellow">
        <strong>系统已安装但服务异常。</strong><br>
        您可以点击「重启服务」尝试恢复，或点击「全新安装」重新安装。
      </div>
      <div id="repairLog"></div>
      <div class="actions">
        <button class="btn btn-secondary" onclick="state.step=1;render();">&larr; 上一步</button>
        <div>
          <button class="btn btn-success" id="repairBtn">重启服务</button>
          <button class="btn btn-primary" id="reinstallBtn" style="margin-left:8px;">全新安装 &rarr;</button>
        </div>
      </div>
    `;
    el.querySelector('#repairBtn').onclick = () => {
      const btn = el.querySelector('#repairBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 正在重启服务...';
      const logDiv = el.querySelector('#repairLog');
      logDiv.innerHTML = '<details open><summary style="cursor:pointer;font-size:14px;color:var(--text-secondary);">运行日志</summary><div class="log-console" id="repairConsole"></div></details>';
      const cons = logDiv.querySelector('#repairConsole');
      const es = new EventSource('/api/deploy');
      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'log') { cons.textContent += msg.data + '\n'; cons.scrollTop = cons.scrollHeight; }
        else if (msg.type === 'done') {
          es.close();
          if (msg.result === 'success') {
            logDiv.innerHTML = '<div class="hint-box green" style="text-align:center;">重启完成！正在重新检查...</div>';
            setTimeout(() => renderStep2(el), 3000);
          } else {
            logDiv.innerHTML = '<div class="hint-box red" style="text-align:center;">重启失败，请截图并联系技术支持。</div>';
            btn.disabled = false; btn.textContent = '重试';
          }
        }
      };
      es.onerror = () => { es.close(); btn.disabled = false; btn.textContent = '重试'; };
    };
    el.querySelector('#reinstallBtn').onclick = () => {
      showConfirm('全新安装会覆盖当前所有配置和数据，确定要继续吗？', () => { state.step = 3; render(); });
    };
  } else if (data.status === 'docker_stopped') {
    el.innerHTML = `
      ${osMismatchHtml}
      <h2>第二步：需要先启动 Docker</h2>
      <p class="subtitle">检测到 Docker 已安装，但尚未启动。系统需要 Docker 才能运行。</p>
      <div class="hint-box yellow">
        <strong>Docker 未启动。</strong><br>
        请点击下方按钮启动 Docker，启动后会自动重新检查。
      </div>
      <div id="dockerStartLog"></div>
      <div class="actions">
        <button class="btn btn-secondary" onclick="state.step=1;render();">&larr; 上一步</button>
        <button class="btn btn-success" id="startDockerBtn">启动 Docker</button>
      </div>
    `;
    el.querySelector('#startDockerBtn').onclick = () => {
      const btn = el.querySelector('#startDockerBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 正在启动 Docker...';
      const logDiv = el.querySelector('#dockerStartLog');
      logDiv.innerHTML = '<details open><summary style="cursor:pointer;font-size:14px;color:var(--text-secondary);">启动日志</summary><div class="log-console" id="dockerStartConsole"></div></details>';
      const cons = logDiv.querySelector('#dockerStartConsole');
      const es = new EventSource('/api/start-docker');
      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'log') { cons.textContent += msg.data + '\n'; cons.scrollTop = cons.scrollHeight; }
        else if (msg.type === 'done') {
          es.close();
          if (msg.result === 'success') {
            logDiv.innerHTML = '<div class="hint-box green" style="text-align:center;">Docker 已启动！正在重新检查...</div>';
            setTimeout(() => renderStep2(el), 3000);
          } else {
            logDiv.innerHTML = '<div class="hint-box red" style="text-align:center;">启动失败。请手动打开 Docker Desktop 应用，然后刷新页面。</div>';
            btn.disabled = false; btn.textContent = '重试';
          }
        }
      };
      es.onerror = () => { es.close(); btn.disabled = false; btn.textContent = '重试'; };
    };
  } else {
    el.innerHTML = `
      ${osMismatchHtml}
      <h2>第二步：系统尚未安装</h2>
      <p class="subtitle">在这台电脑上还没有安装系统，请继续下一步进行安装。</p>
      <div class="status-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
        <span>安装后的访问地址</span>
        <span style="font-size:22px; font-weight:700; color:var(--primary);">http://${esc(data.ip)}</span>
      </div>
      <div class="hint-box yellow">
        系统还没有安装，点击下方按钮继续安装。
      </div>
      <div class="actions">
        <button class="btn btn-secondary" onclick="state.step=1;render();">&larr; 上一步</button>
        <button class="btn btn-primary" id="nextBtn">继续安装 &rarr;</button>
      </div>
    `;
    el.querySelector('#nextBtn').onclick = () => { state.step = 3; render(); };
  }
}

// ---- 第三步：站点编号 ----
async function renderStep3(el) {
  el.innerHTML = `
    <h2>第三步：设置站点编号</h2>
    <p class="subtitle">
      每个诊所需要一个唯一的站点编号，用来区分不同诊所的数据。<br>
      如果您已有编号，请在下方输入；如果是新安装，请点击「自动生成」。
    </p>
    <div class="input-group">
      <input type="text" id="siteIdInput" placeholder="请输入或点击右侧按钮自动生成" value="${state.siteId}" />
      <button class="btn btn-secondary" id="genBtn">自动生成</button>
    </div>
    <div id="siteIdGenerated" style="display:none; background:#dcfce7; padding:14px; border-radius:8px; font-size:16px; margin-bottom:12px;">
      已为您生成编号，请现在<strong>拍照或抄写保存</strong>！
    </div>
    <div id="siteIdError" style="display:none; color:var(--danger); font-size:15px; margin-bottom:8px;">
      请先输入编号，或点击「自动生成」按钮
    </div>
    <div style="margin-top:16px; padding:16px; background:#fef9c3; border:2px solid #f59e0b; border-radius:8px;">
      <div style="font-size:16px; font-weight:700; color:#92400e; margin-bottom:8px;">
        &#9888;&#65039; 重要提醒
      </div>
      <div style="font-size:15px; color:#78350f; line-height:1.8;">
        站点编号是您诊所的<strong>唯一身份标识</strong>，非常重要！<br>
        请<strong>立即将编号抄写或截图保存</strong>，以后重装或迁移系统时需要用到。<br>
        <strong>丢失编号可能导致无法恢复数据！</strong>
      </div>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="state.step=2;render();">&larr; 上一步</button>
      <button class="btn btn-primary" id="nextBtn">已保存编号，下一步 &rarr;</button>
    </div>
  `;

  el.querySelector('#genBtn').onclick = async () => {
    const data = await api('/api/generate-site-id');
    el.querySelector('#siteIdInput').value = data.site_id;
    state.siteId = data.site_id;
    el.querySelector('#siteIdGenerated').style.display = 'block';
    el.querySelector('#siteIdError').style.display = 'none';
  };

  el.querySelector('#nextBtn').onclick = async () => {
    const val = el.querySelector('#siteIdInput').value.trim();
    if (!val) {
      el.querySelector('#siteIdError').style.display = 'block';
      return;
    }
    state.siteId = val;
    try {
      const resp = await api('/api/save-site-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: val })
      });
      if (resp.error) {
        el.querySelector('#siteIdError').textContent = resp.error;
        el.querySelector('#siteIdError').style.display = 'block';
        return;
      }
    } catch(e) {
      el.querySelector('#siteIdError').textContent = '保存失败，请重试';
      el.querySelector('#siteIdError').style.display = 'block';
      return;
    }
    state.step = 4;
    render();
  };
}

// ---- 第四步：环境检查 ----
async function renderStep4(el) {
  el.innerHTML = `
    <h2>第四步：检查运行环境</h2>
    <p class="subtitle"><span class="spinner"></span> 正在检查电脑上是否已安装必需的软件...</p>
  `;

  const data = await api('/api/check-deps');

  let items = '';
  items += `<div class="status-item">
    <div><strong>运行环境</strong><br><small>${esc(data.docker_version || '未安装')}</small></div>
    <span class="badge ${data.docker ? 'ok' : 'fail'}">${data.docker ? '已安装' : '未安装'}</span>
  </div>`;
  items += `<div class="status-item">
    <div><strong>服务管理工具</strong><br><small>${esc(data.compose_version || '未安装')}</small></div>
    <span class="badge ${data.compose ? 'ok' : 'fail'}">${data.compose ? '已安装' : '未安装'}</span>
  </div>`;
  items += `<div class="status-item">
    <div><strong>代码管理工具</strong><br><small>${esc(data.git_version || '未安装')}</small></div>
    <span class="badge ${data.git ? 'ok' : 'fail'}">${data.git ? '已安装' : '未安装'}</span>
  </div>`;

  const allOk = data.docker && data.compose && data.git;

  // 分别检查缺了什么
  const missingDocker = !data.docker || !data.compose;
  const missingGit = !data.git;

  let installSection = '';
  if (!allOk) {
    let hint = '缺少必需软件，请点击下方按钮自动安装。';
    installSection = `
      <div class="hint-box red">
        <strong>${hint}</strong><br>
        如果安装失败，请联系技术支持人员协助。
      </div>
      <div style="display:flex; gap:12px; margin-top:12px;">
        ${missingDocker ? '<button class="btn btn-primary" id="installDockerBtn">安装运行环境</button>' : ''}
        ${missingGit ? '<button class="btn btn-primary" id="installGitBtn">安装代码管理工具</button>' : ''}
      </div>
      <div id="installLog"></div>
    `;
  }

  el.innerHTML = `
    <h2>第四步：检查运行环境</h2>
    <p class="subtitle">以下是您电脑（${esc(state.osName)}）上的软件情况：</p>
    ${items}
    ${installSection}
    <div class="actions">
      <button class="btn btn-secondary" onclick="state.step=3;render();">&larr; 上一步</button>
      <button class="btn btn-primary" id="nextBtn" ${allOk ? '' : 'disabled'}>下一步 &rarr;</button>
    </div>
  `;

  if (!allOk && el.querySelector('#installDockerBtn')) {
    el.querySelector('#installDockerBtn').onclick = () => {
      const btn = el.querySelector('#installDockerBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 正在安装...';
      const logDiv = el.querySelector('#installLog');
      logDiv.innerHTML = '<div class="log-console" id="installConsole"></div>';
      const console_ = logDiv.querySelector('#installConsole');
      const es = new EventSource('/api/install-docker');
      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'log') {
          console_.textContent += msg.data + '\n';
          console_.scrollTop = console_.scrollHeight;
        } else if (msg.type === 'done') {
          es.close();
          if (msg.result === 'success') {
            console_.innerHTML += '<span class="log-success">安装完成！正在重新检查...</span>\n';
            setTimeout(() => renderStep4(el), 2000);
          } else {
            console_.innerHTML += '<span class="log-error">安装失败，请联系技术支持人员。</span>\n';
            btn.disabled = false; btn.textContent = '重试';
          }
        }
      };
      es.onerror = () => { es.close(); btn.disabled = false; btn.textContent = '重试'; };
    };
  }

  if (!allOk && el.querySelector('#installGitBtn')) {
    el.querySelector('#installGitBtn').onclick = () => {
      const btn = el.querySelector('#installGitBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 正在安装...';
      const logDiv = el.querySelector('#installLog');
      logDiv.innerHTML = '<div class="log-console" id="installConsole"></div>';
      const console_ = logDiv.querySelector('#installConsole');
      const es = new EventSource('/api/install-git');
      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'log') {
          console_.textContent += msg.data + '\n';
          console_.scrollTop = console_.scrollHeight;
        } else if (msg.type === 'done') {
          es.close();
          if (msg.result === 'success') {
            console_.innerHTML += '<span class="log-success">安装完成！正在重新检查...</span>\n';
            setTimeout(() => renderStep4(el), 2000);
          } else {
            console_.innerHTML += '<span class="log-error">安装失败，请联系技术支持人员。</span>\n';
            btn.disabled = false; btn.textContent = '重试';
          }
        }
      };
      es.onerror = () => { es.close(); btn.disabled = false; btn.textContent = '重试'; };
    };
  }

  el.querySelector('#nextBtn').onclick = () => { state.step = 5; render(); };
}

// ---- 第五步：程序和配置 ----
async function renderStep5(el) {
  el.innerHTML = `
    <h2>第五步：准备程序和配置</h2>
    <p class="subtitle"><span class="spinner"></span> 正在检查...</p>
  `;

  // 并行获取状态
  const [repoData, imgData, envData] = await Promise.all([
    api('/api/check-repo'),
    api('/api/check-images'),
    api('/api/get-env-config'),
  ]);

  const repoReady = repoData.ready;
  const hasMissingImages = imgData.images.some(i => !i.exists);
  const envConfigured = envData.has_env;

  const imgNameMap = {
    'menzhen-api:latest': '门诊后台程序',
    'menzhen-web:latest': '门诊界面程序',
    'menzhen-backup:latest': '自动备份程序',
    'nginx:alpine': '网络服务程序',
    'mysql:8.0': '数据库程序',
    'minio/minio:latest': '文件存储程序',
  };

  // --- 阶段1: 代码库 ---
  let repoHtml = '';
  if (!repoReady) {
    repoHtml = `
      <div class="hint-box red" style="margin-bottom:20px;">
        <strong>系统代码尚未下载到本机。</strong><br>
        请点击下方按钮自动下载，下载完成后页面会自动刷新。
      </div>
      <button class="btn btn-success" id="cloneBtn" style="font-size:16px; padding:12px 28px;">下载系统程序</button>
      <div id="cloneLog" style="margin-top:12px;"></div>
    `;
  }

  // --- 阶段2: .env 配置表单 ---
  const groupLabels = { basic: '基础安全配置', qiniu: '云备份配置（可选）', ai: 'AI 功能配置（可选）' };
  let envFormHtml = '';
  if (repoReady) {
    let groups = {};
    envData.items.forEach(item => {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    });
    let formRows = '';
    for (const [gk, gLabel] of Object.entries(groupLabels)) {
      if (!groups[gk]) continue;
      formRows += '<h4 style="font-size:15px; margin:16px 0 8px; color:var(--text-secondary);">' + gLabel + '</h4>';
      for (const item of groups[gk]) {
        const placeholder = item.auto_gen ? '留空将自动生成随机值' : esc(item.hint);
        formRows += '<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">' +
          '<label style="min-width:140px; font-size:15px; text-align:right;">' + esc(item.label) + '</label>' +
          '<input type="text" class="env-input" data-key="' + esc(item.key) + '" value="' + esc(item.value || '') + '" placeholder="' + placeholder + '" style="flex:1; padding:10px 12px; border:1px solid var(--border); border-radius:6px; font-size:15px;" />' +
          '</div>';
      }
    }
    envFormHtml = `
      <div style="margin:20px 0; padding:20px; background:#f8fafc; border:1px solid var(--border); border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 style="font-size:16px;">系统参数配置</h3>
          <span style="font-size:14px; color:var(--text-secondary);">${envConfigured ? '已有配置，可修改' : '首次安装，请确认'}</span>
        </div>
        <p style="font-size:14px; color:var(--text-secondary); margin-bottom:12px;">
          基础安全配置留空会自动生成随机密码。云备份和 AI 功能为可选项，留空表示不启用。
        </p>
        ${formRows}
        <div style="text-align:right; margin-top:12px;">
          <button class="btn btn-primary" id="saveEnvBtn">保存配置</button>
        </div>
        <div id="envSaveMsg" style="margin-top:8px;"></div>
      </div>
    `;
  }

  // --- 阶段3: 镜像状态 + 构建 ---
  let imgHtml = '';
  if (repoReady) {
    let imgRows = imgData.images.map(i =>
      '<div class="status-item"><span>' + esc(imgNameMap[i.image] || i.image) + '</span>' +
      '<span class="badge ' + (i.exists ? 'ok' : 'warn') + '">' + (i.exists ? '已就绪' : '需要构建') + '</span></div>'
    ).join('');

    let buildSection = '';
    if (hasMissingImages) {
      buildSection = `
        <div class="hint-box yellow" style="margin-top:12px;">
          程序包尚未构建，请先保存上方配置，再点击下方按钮开始构建。<br>
          <strong>构建需要 5-15 分钟</strong>，请耐心等待。
        </div>
        <button class="btn btn-success" id="buildBtn" style="margin-top:12px; font-size:16px; padding:12px 28px;">开始构建程序</button>
      `;
    } else {
      buildSection = '<div class="hint-box green" style="margin-top:12px; text-align:center;">所有程序已就绪，可以继续下一步！</div>';
    }
    imgHtml = '<h3 style="font-size:16px; margin:20px 0 8px;">系统程序包</h3>' + imgRows + buildSection + '<div id="buildLog"></div>';
  }

  const allReady = repoReady && !hasMissingImages && envConfigured;

  el.innerHTML = `
    <h2>第五步：准备程序和配置</h2>
    <p class="subtitle">${repoReady ? '请确认配置后构建程序。' : '需要先下载系统程序代码。'}</p>
    ${repoHtml}${envFormHtml}${imgHtml}
    <div class="actions">
      <button class="btn btn-secondary" onclick="state.step=4;render();">&larr; 上一步</button>
      <button class="btn btn-primary" id="nextBtn" ${allReady ? '' : 'disabled'}>下一步 &rarr;</button>
    </div>
  `;

  // --- 事件绑定 ---
  if (!repoReady && el.querySelector('#cloneBtn')) {
    el.querySelector('#cloneBtn').onclick = () => {
      const btn = el.querySelector('#cloneBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 正在下载...';
      const logDiv = el.querySelector('#cloneLog');
      logDiv.innerHTML = '<details open><summary style="cursor:pointer;font-size:14px;color:var(--text-secondary);">下载进度</summary><div class="log-console" id="cloneConsole"></div></details>';
      const cons = logDiv.querySelector('#cloneConsole');
      const es = new EventSource('/api/clone-repo');
      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'log') { cons.textContent += msg.data + '\n'; cons.scrollTop = cons.scrollHeight; }
        else if (msg.type === 'done') {
          es.close();
          if (msg.result === 'success') {
            logDiv.innerHTML = '<div class="hint-box green" style="text-align:center;">下载完成！正在刷新...</div>';
            setTimeout(() => renderStep5(el), 1500);
          } else {
            logDiv.innerHTML = '<div class="hint-box red">下载失败，请检查网络后重试。</div>';
            btn.disabled = false; btn.textContent = '重试下载';
          }
        }
      };
      es.onerror = () => { es.close(); btn.disabled = false; btn.textContent = '重试下载'; };
    };
  }

  if (el.querySelector('#saveEnvBtn')) {
    el.querySelector('#saveEnvBtn').onclick = async () => {
      const values = {};
      el.querySelectorAll('.env-input').forEach(inp => { values[inp.dataset.key] = inp.value.trim(); });
      const msgDiv = el.querySelector('#envSaveMsg');
      try {
        const resp = await api('/api/save-env-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values })
        });
        msgDiv.innerHTML = resp.ok
          ? '<span style="color:var(--success);font-size:15px;">配置已保存！</span>'
          : '<span style="color:var(--danger);font-size:15px;">保存失败，请重试。</span>';
      } catch(e) {
        msgDiv.innerHTML = '<span style="color:var(--danger);font-size:15px;">保存失败，请重试。</span>';
      }
    };
  }

  if (el.querySelector('#buildBtn')) {
    el.querySelector('#buildBtn').onclick = () => {
      const btn = el.querySelector('#buildBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 正在构建，请勿关闭...';
      const logDiv = el.querySelector('#buildLog');
      logDiv.innerHTML = '<div style="font-size:17px;text-align:center;padding:16px;color:var(--primary);"><span class="spinner"></span> 正在构建程序（约5-15分钟）...</div><details style="margin-top:8px;"><summary style="cursor:pointer;color:var(--text-secondary);font-size:14px;">查看详细日志</summary><div class="log-console" id="buildConsole"></div></details>';
      const cons = logDiv.querySelector('#buildConsole');
      const es = new EventSource('/api/build-full');
      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'log') { cons.textContent += msg.data + '\n'; cons.scrollTop = cons.scrollHeight; }
        else if (msg.type === 'done') {
          es.close();
          if (msg.result === 'success') {
            logDiv.innerHTML = '<div class="hint-box green" style="text-align:center;font-size:17px;">构建完成！正在刷新...</div>';
            setTimeout(() => renderStep5(el), 2000);
          } else {
            logDiv.innerHTML = '<div class="hint-box red" style="text-align:center;">构建失败，请截图并联系技术支持。</div>';
            btn.disabled = false; btn.textContent = '重试';
          }
        }
      };
      es.onerror = () => { es.close(); logDiv.innerHTML = '<div class="hint-box red" style="text-align:center;">连接中断，请刷新页面。</div>'; btn.disabled = false; btn.textContent = '重试'; };
    };
  }

  el.querySelector('#nextBtn').onclick = () => { state.step = 6; render(); };
}

// ---- 第六步：开始安装 ----
async function renderStep6(el) {
  el.innerHTML = `
    <h2>第六步：开始安装</h2>
    <p class="subtitle">一切准备就绪！点击下方按钮开始安装系统。安装过程大约需要1-3分钟，请耐心等待。</p>
    <div id="deployLog"></div>
    <div id="deployResult"></div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="state.step=5;render();">&larr; 上一步</button>
      <button class="btn btn-success" id="deployBtn">开始安装</button>
    </div>
  `;

  el.querySelector('#deployBtn').onclick = () => {
    const btn = el.querySelector('#deployBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 正在安装，请勿关闭页面...';

    const logDiv = el.querySelector('#deployLog');
    logDiv.innerHTML = `
      <div style="font-size:18px; text-align:center; padding:20px; color:var(--primary);">
        <span class="spinner"></span> 正在安装中，请耐心等待（约需1-3分钟）...
      </div>
      <details style="margin-top:8px;">
        <summary style="cursor:pointer; color:var(--text-secondary); font-size:14px; padding:4px;">查看详细日志</summary>
        <div class="log-console" id="deployConsole"></div>
      </details>
    `;
    const cons = logDiv.querySelector('#deployConsole');

    const es = new EventSource('/api/deploy');
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'log') {
        cons.textContent += msg.data + '\n';
        cons.scrollTop = cons.scrollHeight;
      } else if (msg.type === 'done') {
        es.close();
        if (msg.result === 'success') {
          cons.innerHTML += '<span class="log-success">所有服务已启动！</span>\n';
          showDeployResult(el);
        } else {
          logDiv.innerHTML = `
            <div class="hint-box red" style="font-size:16px; text-align:center;">
              安装遇到问题，请截图本页面并联系技术支持人员。
            </div>
          `;
          btn.disabled = false;
          btn.textContent = '重试';
        }
      }
    };
    es.onerror = () => { es.close(); btn.disabled = false; btn.innerHTML = '连接中断，点击重试'; };
  };
}

async function showDeployResult(el) {
  const result = el.querySelector('#deployResult');
  result.innerHTML = '<div style="text-align:center; padding:20px; font-size:17px; color:var(--primary);"><span class="spinner"></span> 正在确认各项服务状态...</div>';

  await new Promise(r => setTimeout(r, 3000));

  const svcData = await api('/api/service-status');
  const ipData = await api('/api/detect-ip');
  const url = `http://${ipData.ip}`;

  const svcNameMap = {
    api: '后台服务',
    web: '前端页面',
    nginx: '网关服务',
    mysql: '数据库',
    minio: '文件存储',
    backup: '自动备份',
  };

  let svcRows = '';
  if (svcData.services.length) {
    svcRows = svcData.services.map(s => `
      <div class="status-item">
        <span>${esc(svcNameMap[s.name] || s.name)}</span>
        <span class="badge ${s.state === 'running' ? 'ok' : 'fail'}">${stateText(s.state)}</span>
      </div>
    `).join('');
  } else {
    svcRows = '<p style="color:var(--text-secondary)">正在获取服务状态...</p>';
  }

  result.innerHTML = `
    <div style="margin-top:24px;">
      <h3 style="font-size:16px; margin-bottom:8px;">各项服务运行状态</h3>
      ${svcRows}
    </div>
    <div class="success-box" style="margin-top:24px;">
      <div class="big-icon">&#x2705;</div>
      <h2>安装成功！</h2>
      <p style="font-size:15px; margin:8px 0;">系统已安装完成，可以开始使用了。</p>
      <p style="color:var(--danger); font-size:14px;">首次登录后请及时修改默认密码。</p>
      <div class="url"><a href="${esc(url)}" target="_blank">${esc(url)}</a></div>
      <a href="${esc(url)}" target="_blank" class="btn btn-success" style="font-size:18px; padding:14px 40px;">
        点击打开系统
      </a>
    </div>
  `;

  el.querySelector('.actions').innerHTML = '';
}

// 帮助弹窗
function openHelp(section) {
  const m = document.getElementById('helpModal');
  m.classList.add('show');
  if (section) {
    setTimeout(() => {
      const t = document.getElementById(section);
      if (t) t.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }
}

// 启动
render();
</script>

<!-- 帮助教程弹窗 -->
<div class="modal-overlay" id="helpModal" onclick="if(event.target===this)this.classList.remove('show')">
<div class="modal-content">
  <button class="modal-close" onclick="document.getElementById('helpModal').classList.remove('show')">&times;</button>
  <h2 style="margin-bottom:8px;">安装帮助教程</h2>
  <p style="color:var(--text-secondary);margin-bottom:24px;">遇到问题？在这里查找答案。</p>

  <div class="guide-section" id="guide-ssh">
    <h3>一、如何连接 Linux 服务器（SSH）</h3>
    <p>如果您的系统安装在一台没有屏幕的服务器上，需要先从自己的电脑"远程连接"过去。</p>
    <div class="tip-box">您需要知道：服务器的 <strong>IP 地址</strong>、<strong>用户名</strong>（一般是 root）和 <strong>密码</strong></div>

    <p style="margin-top:12px;"><strong>苹果电脑：</strong></p>
    <ol>
      <li>打开「终端」（按 Command + 空格，搜索"终端"）</li>
      <li>输入命令（把 IP 和用户名换成实际的）：</li>
    </ol>
    <pre>ssh root@192.168.1.100</pre>
    <ul>
      <li>第一次会问 yes/no，输入 <code>yes</code> 回车</li>
      <li>然后输入密码（屏幕不显示字符是正常的），回车</li>
    </ul>

    <p style="margin-top:12px;"><strong>Windows 电脑：</strong></p>
    <ol>
      <li>按 Win 键，搜索「PowerShell」或「终端」，打开</li>
      <li>输入同样的命令：</li>
    </ol>
    <pre>ssh root@192.168.1.100</pre>
    <p>如果您的 Windows 较旧没有 ssh 命令，可以下载 <a href="https://www.putty.org/" target="_blank">PuTTY</a> 工具，打开后填入 IP 地址即可连接。</p>

    <p style="margin-top:12px;"><strong>手机：</strong></p>
    <ul>
      <li>苹果手机：App Store 搜索安装「Termius」</li>
      <li>安卓手机：应用商店搜索安装「JuiceSSH」</li>
    </ul>
  </div>

  <div class="guide-section" id="guide-upload">
    <h3>二、如何把安装文件传到服务器</h3>
    <p><strong>方法 A：服务器能上网时</strong>，直接在服务器上下载：</p>
    <pre>cd ~
wget 下载链接地址</pre>

    <p style="margin-top:12px;"><strong>方法 B：从自己电脑传到服务器</strong>（在自己电脑的终端执行）：</p>
    <pre>scp -r 本地文件夹路径 root@服务器IP:~/</pre>
    <p>Windows 用户也可以用 <a href="https://winscp.net/" target="_blank">WinSCP</a>，像文件管理器一样拖拽文件。</p>
  </div>

  <div class="guide-section" id="guide-run">
    <h3>三、如何启动安装向导</h3>
    <p>SSH 连上服务器后，执行以下命令：</p>
    <pre>cd ~/menzhen
bash start-wizard.sh</pre>
    <p>屏幕会显示一个访问地址（例如 <code>http://192.168.1.100:9527</code>），在您自己电脑的浏览器中打开它，就能看到这个安装向导页面。</p>
  </div>

  <div class="guide-section" id="guide-firewall">
    <h3>四、浏览器打不开？检查防火墙</h3>
    <p>服务器可能默认没有放行端口，需要手动放行：</p>
    <p><strong>Ubuntu / Debian：</strong></p>
    <pre>sudo ufw allow 9527
sudo ufw allow 80</pre>
    <p><strong>CentOS / RHEL：</strong></p>
    <pre>sudo firewall-cmd --add-port=9527/tcp --permanent
sudo firewall-cmd --add-port=80/tcp --permanent
sudo firewall-cmd --reload</pre>
    <div class="tip-box">如果是云服务器（阿里云、腾讯云等），还需要在云控制台的「安全组」中放行 9527 和 80 端口。</div>
  </div>

  <div class="guide-section" id="guide-faq">
    <h3>五、其他常见问题</h3>
    <ul>
      <li><strong>SSH 连不上？</strong> — 确认服务器已开机联网，IP 地址正确。在服务器上输入 <code>hostname -I</code> 查看 IP。</li>
      <li><strong>提示"Permission denied"？</strong> — 密码输错了。输密码时屏幕不会显示任何字符，这是正常的，输完直接按回车。</li>
      <li><strong>IP 地址是什么？</strong> — 在服务器上输入 <code>hostname -I</code>，显示的第一串数字就是（例如 192.168.1.100）。</li>
      <li><strong>安装完成后怎么用？</strong> — 向导最后一步会显示访问地址。局域网内任何电脑或手机，浏览器输入该地址即可使用。</li>
    </ul>
  </div>

  <div style="text-align:center; margin-top:24px;">
    <button class="btn btn-primary" onclick="document.getElementById('helpModal').classList.remove('show')">我知道了，关闭</button>
  </div>
</div>
</div>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

def has_desktop():
    """Detect if a desktop/GUI environment is available."""
    os_key, _ = detect_os()
    # Mac and Windows always have a desktop
    if os_key in ("mac", "windows"):
        return True
    # Linux: check DISPLAY or WAYLAND_DISPLAY environment variables
    if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
        return True
    return False


def main():
    ip = get_local_ip()
    desktop = has_desktop()

    print()
    print("=" * 48)
    print("  门诊系统安装向导")
    print("=" * 48)
    print(f"  项目目录: {SCRIPT_DIR}")
    print(f"  系统: {detect_os()[1]}")
    print(f"  本机网络地址: {ip}")
    print(f"  运行模式: {'桌面模式' if desktop else '服务器模式（无桌面）'}")
    print()

    class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True

    if desktop:
        # Desktop mode: bind to localhost only (safe)
        bind_addr = "127.0.0.1"
        server = ThreadedHTTPServer((bind_addr, WIZARD_PORT), WizardHandler)

        def open_browser():
            time.sleep(1)
            webbrowser.open(f"http://localhost:{WIZARD_PORT}")

        threading.Thread(target=open_browser, daemon=True).start()

        print(f"  向导已启动: http://localhost:{WIZARD_PORT}")
        print("  浏览器将自动打开，如未打开请手动复制上方地址到浏览器")
    else:
        # Server mode: bind to all interfaces so remote browser can access
        bind_addr = "0.0.0.0"
        server = ThreadedHTTPServer((bind_addr, WIZARD_PORT), WizardHandler)

        print(f"  向导已启动（服务器模式）")
        print()
        print(f"  请在您自己电脑的浏览器中打开:")
        print()
        print(f"    http://{ip}:{WIZARD_PORT}")
        print()
        print(f"  如果打不开，请检查防火墙是否放行了 {WIZARD_PORT} 端口")

        # Server mode: periodically print current IP in case it changes
        def print_ip_loop():
            last_ip = ip
            while True:
                time.sleep(60)
                cur_ip = get_local_ip()
                if cur_ip != last_ip:
                    print(f"\n  [提示] 检测到IP变化: {last_ip} -> {cur_ip}")
                    print(f"  新地址: http://{cur_ip}:{WIZARD_PORT}\n")
                    last_ip = cur_ip

        threading.Thread(target=print_ip_loop, daemon=True).start()

    print()
    print("  按 Ctrl+C 可随时停止向导")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n向导已停止。")
        server.server_close()


if __name__ == "__main__":
    main()
