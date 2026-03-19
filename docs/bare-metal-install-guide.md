# 裸机一键安装指南

> 适用于全新电脑，无需任何技术基础。脚本会自动安装所有依赖（Python、Docker、Git）。

## 第一步：下载启动脚本

根据你的操作系统，下载**一个文件**即可：

| 操作系统 | 下载文件 | 下载地址 |
|----------|---------|----------|
| **Windows 10/11** | `start-wizard.bat` | https://raw.githubusercontent.com/callmefisher/menzhen/main/start-wizard.bat |
| **macOS** | `start-wizard.command` | https://raw.githubusercontent.com/callmefisher/menzhen/main/start-wizard.command |
| **Linux (桌面/Server)** | `start-wizard.command` | https://raw.githubusercontent.com/callmefisher/menzhen/main/start-wizard.command |

将下载的文件放到一个**空文件夹**中（例如 `D:\门诊系统\` 或 `~/menzhen/`）。

---

## 第二步：运行脚本

### Windows

1. 双击 `start-wizard.bat`
2. 如果弹出"Windows 保护了你的电脑"提示，点击「更多信息」→「仍要运行」
3. 如果提示安装 Python，等待自动安装完成后**关闭窗口，再次双击**
4. 浏览器会自动打开安装向导页面

### macOS

**方法一（推荐）：打开终端粘贴一行命令**

1. 打开「终端」应用（在 启动台 → 其他 中，或按 `⌘+空格` 搜索"终端"）
2. 粘贴以下命令并按回车：
   ```bash
   mkdir -p ~/menzhen && cd ~/menzhen && { [ -f start-wizard.command ] || curl -fLO https://raw.githubusercontent.com/callmefisher/menzhen/main/start-wizard.command; } && bash start-wizard.command
   ```
3. 如果提示安装开发者工具，点击「安装」等待完成后按回车
4. 浏览器会自动打开安装向导页面

**方法二：下载后双击**

1. 下载 `start-wizard.command` 到一个空文件夹
2. 打开「终端」，运行以下命令修复权限（将路径替换为实际下载位置）：
   ```bash
   chmod +x ~/Downloads/start-wizard.command
   ```
3. 双击 `start-wizard.command`
4. 如果提示"无法打开，因为无法验证开发者"：
   - 右键点击文件 → 选择「打开」→ 点击「打开」
5. 如果提示安装开发者工具，点击「安装」等待完成后按回车
6. 浏览器会自动打开安装向导页面

### Ubuntu / CentOS 桌面版

1. 打开「终端」应用
2. 进入文件所在目录：
   ```bash
   cd ~/menzhen    # 替换为你的实际路径
   ```
3. 运行脚本：
   ```bash
   bash start-wizard.command
   ```
4. 如果提示输入密码，输入你的登录密码（用于安装软件）
5. 浏览器会自动打开安装向导页面

### Ubuntu Server（无桌面环境）

1. SSH 登录服务器
2. 创建目录并下载脚本：
   ```bash
   mkdir -p ~/menzhen && cd ~/menzhen
   { [ -f start-wizard.command ] || curl -fLO https://raw.githubusercontent.com/callmefisher/menzhen/main/start-wizard.command; }
   bash start-wizard.command
   ```
3. 脚本启动后，在**本地电脑浏览器**中访问：
   ```
   http://服务器IP:9527
   ```
   （脚本会显示服务器的 IP 地址）

---

## 第三步：按向导完成安装

启动脚本会自动打开浏览器，进入 Web 安装向导。向导会引导你完成：

1. **检测系统** — 自动识别操作系统
2. **检测已有部署** — 检查是否已安装过
3. **设置站点编号** — 生成唯一标识（务必记下来）
4. **安装依赖** — 一键安装 Docker、Git（如果缺失）
5. **下载代码** — 从 GitHub 下载系统代码
6. **配置参数** — 自动生成安全密钥，可选配置云备份/AI
7. **启动系统** — 一键启动所有服务

全程点击按钮即可，无需输入命令。

---

## 安装完成后

- 访问地址：`http://localhost`（本机）或 `http://服务器IP`（远程）
- 默认账号：`admin`
- 默认密码：`admin123`
- **请立即修改默认密码！**

---

## 常见问题

### Windows 提示"winget 不可用"
Windows 10 较旧版本可能没有 winget。请手动从 https://www.python.org/downloads/ 下载安装 Python 3，安装时**勾选"Add Python to PATH"**。

### macOS 提示"没有正确的访问权限"
从网上下载的 `.command` 文件默认没有执行权限。打开终端运行：
```bash
chmod +x start-wizard.command
```
如果还提示"无法验证开发者"，右键点击文件 → 选择「打开」。

**推荐**：直接使用上方"方法一"的终端命令，可完全避免权限问题。

### macOS 提示"command not found: python3"
双击 `start-wizard.command` 后脚本会自动引导安装。如果失败，从 https://www.python.org/downloads/ 下载 macOS 安装包。

### Linux 无法连接 Docker 安装源
脚本使用 Docker 官方安装脚本（get.docker.com）。如果在国内网络环境下安装较慢或失败，可手动配置 Docker 镜像源后重试。

### 浏览器没有自动打开（Server 版）
Ubuntu Server 没有桌面环境，需要在**另一台电脑的浏览器**中访问 `http://服务器IP:9527`。

### 站点编号丢了怎么办
站点编号是数据恢复的唯一标识。如果丢失，查看服务器上的 `.env` 文件中 `SITE_ID=` 行。
