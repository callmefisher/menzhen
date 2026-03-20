@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title 门诊系统安装向导

echo.
echo =====================================
echo   门诊系统安装向导 - 环境检测中...
echo =====================================
echo.

:: ------------------------------------------------------------------
:: 1. 检测 Python3
:: ------------------------------------------------------------------
:: Windows 10 的 python3.exe 可能是 Microsoft Store 别名（返回 9009）
:: 必须用 "实际运行" 来测试，不能只靠 --version 返回码

:: 先试 python3
python3 -c "import sys; print(sys.version)" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    for /f "tokens=*" %%i in ('python3 --version 2^>^&1') do echo [*] 已安装: %%i
    set "PYTHON_CMD=python3"
    goto :CHECK_FILE
)

:: 再试 python
python -c "import sys; print(sys.version)" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    :: 确认是 Python 3 不是 2
    for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set "PY_FULL_VER=%%v"
    for /f "tokens=1 delims=." %%m in ("!PY_FULL_VER!") do set "PY_MAJOR=%%m"
    if "!PY_MAJOR!"=="3" (
        for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo [*] 已安装: %%i
        set "PYTHON_CMD=python"
        goto :CHECK_FILE
    )
    echo [x] 检测到 Python 2，需要 Python 3
)

:: 最后试 py 启动器（Windows 专有）
py -3 --version >nul 2>&1
if !ERRORLEVEL! equ 0 (
    for /f "tokens=*" %%i in ('py -3 --version 2^>^&1') do echo [*] 已安装: %%i
    set "PYTHON_CMD=py -3"
    goto :CHECK_FILE
)

echo [x] 未检测到 Python3，需要安装
goto :INSTALL_PYTHON

:: ------------------------------------------------------------------
:: 2. 安装 Python
:: ------------------------------------------------------------------
:INSTALL_PYTHON
echo.

:: 方法1: 尝试 winget 自动安装
winget --version >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo [*] 正在自动安装运行环境，请稍候...
    echo     安装过程可能需要几分钟，请耐心等待...
    echo.
    winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    if !ERRORLEVEL! equ 0 (
        echo.
        echo =============================================
        echo   恭喜！必需的软件已安装好。
        echo.
        echo   下一步：请关闭此窗口，
        echo   然后再次双击 start-wizard.bat 继续安装。
        echo =============================================
        echo.
        pause
        exit /b 0
    )
    echo [x] 自动安装失败，请联系技术支持人员协助
)

:: 方法2: 引导手动安装
echo.
echo =============================================
echo   请联系技术支持人员协助安装。
echo.
echo   或自行从官网下载安装：
echo   https://www.python.org/downloads/
echo.
echo   安装时请务必打勾：
echo   把 Python 加入系统路径
echo   （安装界面底部有个复选框，务必勾上）
echo   如果不确定，截图发给技术人员确认。
echo.
echo   安装完成后，关闭此窗口，
echo   重新双击 start-wizard.bat 即可。
echo =============================================
echo.
pause
exit /b 1

:: ------------------------------------------------------------------
:: 3. 检查向导脚本，自动下载或更新到最新版本
:: ------------------------------------------------------------------
:CHECK_FILE
set "WIZARD_URL=https://raw.githubusercontent.com/callmefisher/menzhen/main/deploy-wizard.py"

if exist "%~dp0deploy-wizard.py" (
    echo.
    echo [*] 检测到已有向导程序，正在检查更新...
    echo     下载地址: %WIZARD_URL%
    powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%WIZARD_URL%' -OutFile '%~dp0deploy-wizard.py.download' -UseBasicParsing } catch { Write-Output '[!] 检查更新失败'; if (Test-Path '%~dp0deploy-wizard.py.download') { Remove-Item '%~dp0deploy-wizard.py.download' -Force } }"
    if exist "%~dp0deploy-wizard.py.download" (
        :: 校验第一行是否包含 python shebang
        powershell -Command "if ((Get-Content '%~dp0deploy-wizard.py.download' -TotalCount 1) -match '^#!/.*python') { exit 0 } else { exit 1 }"
        if !ERRORLEVEL! equ 0 (
            :: 校验是否包含版本号
            findstr /m "WIZARD_VERSION" "%~dp0deploy-wizard.py.download" >nul 2>&1
            if !ERRORLEVEL! equ 0 (
                :: 比较文件是否相同
                fc /b "%~dp0deploy-wizard.py" "%~dp0deploy-wizard.py.download" >nul 2>&1
                if not !ERRORLEVEL! equ 0 (
                    copy /y "%~dp0deploy-wizard.py" "%~dp0deploy-wizard.py.bak" >nul 2>&1
                    move /y "%~dp0deploy-wizard.py.download" "%~dp0deploy-wizard.py" >nul 2>&1
                    echo [*] 向导程序已更新到最新版本！
                ) else (
                    echo [*] 向导程序已是最新版本
                    del /f "%~dp0deploy-wizard.py.download" >nul 2>&1
                )
            ) else (
                echo [!] 下载的文件缺少版本号，继续使用当前版本
                del /f "%~dp0deploy-wizard.py.download" >nul 2>&1
            )
        ) else (
            echo [!] 下载的文件无效，继续使用当前版本
            del /f "%~dp0deploy-wizard.py.download" >nul 2>&1
        )
    ) else (
        echo [!] 无法检查更新（网络不可用），继续使用当前版本
    )
) else (
    echo.
    echo [*] 未找到向导程序，正在自动下载...
    echo     下载地址: %WIZARD_URL%
    echo.
    powershell -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference='Continue'; Invoke-WebRequest -Uri '%WIZARD_URL%' -OutFile '%~dp0deploy-wizard.py' -UseBasicParsing } catch { Write-Output '[x] 下载失败'; exit 1 }"
    if not exist "%~dp0deploy-wizard.py" (
        echo.
        echo [x] 下载失败，请手动下载 deploy-wizard.py
        echo     放到本脚本同一个文件夹里
        echo     下载地址: %WIZARD_URL%
        echo.
        pause
        exit /b 1
    )
    :: 校验第一行是否包含 python shebang（排除 HTML 错误页）
    powershell -Command "if ((Get-Content '%~dp0deploy-wizard.py' -TotalCount 1) -match '^#!/.*python') { exit 0 } else { exit 1 }"
    if not !ERRORLEVEL! equ 0 (
        echo.
        echo [x] 下载的文件无效（可能是网络错误页面）
        del /f "%~dp0deploy-wizard.py" >nul 2>&1
        echo     请检查网络连接后重试
        echo.
        pause
        exit /b 1
    )
    echo [*] 向导程序下载完成!
)

:: ------------------------------------------------------------------
:: 4. 启动向导
:: ------------------------------------------------------------------
echo.
echo =====================================
echo   正在启动安装向导...
echo   浏览器会自动打开
echo   如果没有自动打开，请查看终端输出的地址
echo =====================================
echo.
echo 提示：按 Ctrl+C 可随时停止向导
echo.

cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set WIZARD_SKIP_UPDATE=1
!PYTHON_CMD! deploy-wizard.py

echo.
echo 向导已停止。
pause
