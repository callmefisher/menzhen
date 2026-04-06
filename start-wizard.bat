@echo off
setlocal enabledelayedexpansion
title 门诊系统安装向导

echo.
echo =====================================
echo   门诊系统安装向导 - 环境检测中...
echo =====================================
echo.

:: ------------------------------------------------------------------
:: 1. Detect Python3
:: ------------------------------------------------------------------
:: Win10 python3.exe may be MS Store alias (returns 9009)
:: Must test with real execution, not just --version

:: Try python3
python3 -c "import sys; print(sys.version)" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    for /f "tokens=*" %%i in ('python3 --version 2^>^&1') do echo [*] 已安装: %%i
    set "PYTHON_CMD=python3"
    goto :CHECK_FILE
)

:: Try python
python -c "import sys; print(sys.version)" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set "PY_FULL_VER=%%v"
    for /f "tokens=1 delims=." %%m in ("!PY_FULL_VER!") do set "PY_MAJOR=%%m"
    if "!PY_MAJOR!"=="3" (
        for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo [*] 已安装: %%i
        set "PYTHON_CMD=python"
        goto :CHECK_FILE
    )
    echo [x] 检测到 Python 2，需要 Python 3
)

:: Try py launcher (Windows-specific)
py -3 --version >nul 2>&1
if !ERRORLEVEL! equ 0 (
    for /f "tokens=*" %%i in ('py -3 --version 2^>^&1') do echo [*] 已安装: %%i
    set "PYTHON_CMD=py -3"
    goto :CHECK_FILE
)

echo [x] 未检测到 Python3，需要安装
goto :INSTALL_PYTHON

:: ------------------------------------------------------------------
:: 2. Install Python
:: ------------------------------------------------------------------
:INSTALL_PYTHON
echo.

:: Method 1: winget auto-install
winget --version >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo [*] 正在自动安装运行环境，请稍候...
    echo     安装过程可能需要几分钟，请耐心等待...
    echo.
    winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    if !ERRORLEVEL! equ 0 (
        echo.
        echo =============================================
        echo   必需的软件已安装好。
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

:: Method 2: manual install guide
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
:: 3. Check wizard script, auto-download or update
:: ------------------------------------------------------------------
:CHECK_FILE
set "URL1=https://raw.githubusercontent.com/callmefisher/menzhen/main/deploy-wizard.py"
set "URL2=https://cdn.jsdelivr.net/gh/callmefisher/menzhen@main/deploy-wizard.py"
set "URL3=https://ghfast.top/https://raw.githubusercontent.com/callmefisher/menzhen/main/deploy-wizard.py"

if exist "%~dp0deploy-wizard.py" (
    echo.
    echo [*] 检测到已有向导程序，正在检查更新...
    call :DOWNLOAD_FILE "%~dp0deploy-wizard.py.download"
    if exist "%~dp0deploy-wizard.py.download" (
        :: Validate downloaded file
        findstr /m "WIZARD_VERSION" "%~dp0deploy-wizard.py.download" >nul 2>&1
        if !ERRORLEVEL! equ 0 (
            :: Extract WIZARD_VERSION and only update if remote is newer
            set "LOCAL_VER="
            set "REMOTE_VER="
            for /f "tokens=3" %%V in ('findstr /r "^WIZARD_VERSION" "%~dp0deploy-wizard.py"') do set "LOCAL_VER=%%~V"
            for /f "tokens=3" %%V in ('findstr /r "^WIZARD_VERSION" "%~dp0deploy-wizard.py.download"') do set "REMOTE_VER=%%~V"
            if "!REMOTE_VER!" GTR "!LOCAL_VER!" (
                copy /y "%~dp0deploy-wizard.py" "%~dp0deploy-wizard.py.bak" >nul 2>&1
                move /y "%~dp0deploy-wizard.py.download" "%~dp0deploy-wizard.py" >nul 2>&1
                echo [*] 向导程序已更新到最新版本
            ) else (
                echo [*] 向导程序已是最新版本
                del /f "%~dp0deploy-wizard.py.download" >nul 2>&1
            )
        ) else (
            echo [x] 下载的文件无效，继续使用当前版本
            del /f "%~dp0deploy-wizard.py.download" >nul 2>&1
        )
    ) else (
        echo [x] 无法检查更新，继续使用当前版本
    )
) else (
    echo.
    echo [*] 未找到向导程序，正在自动下载...
    call :DOWNLOAD_FILE "%~dp0deploy-wizard.py"
    if not exist "%~dp0deploy-wizard.py" (
        echo.
        echo [x] 所有下载源均失败
        echo     请手动下载 deploy-wizard.py 放到本脚本同一文件夹
        echo     下载地址: %URL1%
        echo.
        pause
        exit /b 1
    )
    :: Validate
    findstr /m "WIZARD_VERSION" "%~dp0deploy-wizard.py" >nul 2>&1
    if not !ERRORLEVEL! equ 0 (
        echo.
        echo [x] 下载的文件无效（可能是网络错误页面）
        del /f "%~dp0deploy-wizard.py" >nul 2>&1
        echo     请检查网络连接后重试
        echo.
        pause
        exit /b 1
    )
    echo [*] 向导程序下载完成
)

:: ------------------------------------------------------------------
:: 4. Launch wizard
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
timeout /t 2 /nobreak >nul
exit

:: ------------------------------------------------------------------
:: Helper: try multiple URLs to download deploy-wizard.py
:: Usage: call :DOWNLOAD_FILE "target_path"
:: Tries curl.exe first (Win10+ built-in), then PowerShell fallback
:: ------------------------------------------------------------------
:DOWNLOAD_FILE
set "_TARGET=%~1"

:: Detect if curl.exe is available (built-in on Win10 1803+)
set "_HAS_CURL=0"
where curl.exe >nul 2>&1
if !ERRORLEVEL! equ 0 set "_HAS_CURL=1"

:: --- Source 1/3: raw.githubusercontent.com ---
echo     尝试下载源 1/3 ...
if "!_HAS_CURL!"=="1" (
    curl.exe -fsSL --connect-timeout 15 --max-time 60 -o "%_TARGET%" "%URL1%" >nul 2>&1
    if exist "%_TARGET%" (
        findstr /m "WIZARD_VERSION" "%_TARGET%" >nul 2>&1
        if !ERRORLEVEL! equ 0 goto :DOWNLOAD_DONE
        del /f "%_TARGET%" >nul 2>&1
    )
)
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%URL1%' -OutFile '%_TARGET%' -UseBasicParsing -TimeoutSec 30 } catch {}" 2>nul
if exist "%_TARGET%" (
    findstr /m "WIZARD_VERSION" "%_TARGET%" >nul 2>&1
    if !ERRORLEVEL! equ 0 goto :DOWNLOAD_DONE
    del /f "%_TARGET%" >nul 2>&1
)

:: --- Source 2/3: jsDelivr CDN (China-friendly) ---
echo     尝试下载源 2/3 ...
if "!_HAS_CURL!"=="1" (
    curl.exe -fsSL --connect-timeout 15 --max-time 60 -o "%_TARGET%" "%URL2%" >nul 2>&1
    if exist "%_TARGET%" (
        findstr /m "WIZARD_VERSION" "%_TARGET%" >nul 2>&1
        if !ERRORLEVEL! equ 0 goto :DOWNLOAD_DONE
        del /f "%_TARGET%" >nul 2>&1
    )
)
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%URL2%' -OutFile '%_TARGET%' -UseBasicParsing -TimeoutSec 30 } catch {}" 2>nul
if exist "%_TARGET%" (
    findstr /m "WIZARD_VERSION" "%_TARGET%" >nul 2>&1
    if !ERRORLEVEL! equ 0 goto :DOWNLOAD_DONE
    del /f "%_TARGET%" >nul 2>&1
)

:: --- Source 3/3: ghfast.top proxy ---
echo     尝试下载源 3/3 ...
if "!_HAS_CURL!"=="1" (
    curl.exe -fsSL --connect-timeout 15 --max-time 60 -o "%_TARGET%" "%URL3%" >nul 2>&1
    if exist "%_TARGET%" (
        findstr /m "WIZARD_VERSION" "%_TARGET%" >nul 2>&1
        if !ERRORLEVEL! equ 0 goto :DOWNLOAD_DONE
        del /f "%_TARGET%" >nul 2>&1
    )
)
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%URL3%' -OutFile '%_TARGET%' -UseBasicParsing -TimeoutSec 30 } catch {}" 2>nul
if exist "%_TARGET%" (
    findstr /m "WIZARD_VERSION" "%_TARGET%" >nul 2>&1
    if !ERRORLEVEL! equ 0 goto :DOWNLOAD_DONE
    del /f "%_TARGET%" >nul 2>&1
)

echo.
echo     [x] 所有下载源均失败
echo.
echo     诊断建议:
if "!_HAS_CURL!"=="1" (
    echo       - curl.exe 可用但下载失败，可能是代理/防火墙问题
    echo       - 请尝试: curl.exe -v %URL1%
) else (
    echo       - 未检测到 curl.exe，仅使用了 PowerShell 下载
)
echo       - 请在浏览器中访问以下地址测试:
echo         %URL1%
echo       - 如能访问，请手动下载 deploy-wizard.py 放到本脚本同目录
:DOWNLOAD_DONE
goto :eof
