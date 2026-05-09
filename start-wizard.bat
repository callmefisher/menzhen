@echo off
setlocal enabledelayedexpansion
title ???????????

echo.
echo =====================================
echo   ??????????? - ?????????...
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
    for /f "tokens=*" %%i in ('python3 --version 2^>^&1') do echo [*] ????: %%i
    set "PYTHON_CMD=python3"
    goto :CHECK_FILE
)

:: Try python
python -c "import sys; print(sys.version)" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set "PY_FULL_VER=%%v"
    for /f "tokens=1 delims=." %%m in ("!PY_FULL_VER!") do set "PY_MAJOR=%%m"
    if "!PY_MAJOR!"=="3" (
        for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo [*] ????: %%i
        set "PYTHON_CMD=python"
        goto :CHECK_FILE
    )
    echo [x] ??? Python 2????? Python 3
)

:: Try py launcher (Windows-specific)
py -3 --version >nul 2>&1
if !ERRORLEVEL! equ 0 (
    for /f "tokens=*" %%i in ('py -3 --version 2^>^&1') do echo [*] ????: %%i
    set "PYTHON_CMD=py -3"
    goto :CHECK_FILE
)

echo [x] ¦Ä??? Python3????????
goto :INSTALL_PYTHON

:: ------------------------------------------------------------------
:: 2. Install Python
:: ------------------------------------------------------------------
:INSTALL_PYTHON
echo.

:: Method 1: winget auto-install
winget --version >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo [*] ?????????????§Ý??????????...
    echo     ????????????????????????????...
    echo.
    winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    if !ERRORLEVEL! equ 0 (
        echo.
        echo =============================================
        echo   ??????????????¨¢?
        echo.
        echo   ????????????????
        echo   ????????? start-wizard.bat ?????????
        echo =============================================
        echo.
        pause
        exit /b 0
    )
    echo [x] ?????????????????????????§¿??
)

:: Method 2: manual install guide
echo.
echo =============================================
echo   ???????????????§¿???????
echo.
echo   ?????§Õ????????????
echo   https://www.python.org/downloads/
echo.
echo   ???????????
echo   ?? Python ??????¡¤??
echo   ????????????§Ú?????????????
echo   ????????????????????????????
echo.
echo   ??????????????
echo   ??????? start-wizard.bat ???¨À?
echo =============================================
echo.
pause
exit /b 1

:: ------------------------------------------------------------------
:: 3. Check wizard script, auto-download or update
:: ------------------------------------------------------------------
:CHECK_FILE
set "URL1=https://gh-proxy.com/https://raw.githubusercontent.com/callmefisher/menzhen/main/deploy-wizard.py"
set "URL2=https://ghproxy.net/https://raw.githubusercontent.com/callmefisher/menzhen/main/deploy-wizard.py"
set "URL3=https://ghfast.top/https://raw.githubusercontent.com/callmefisher/menzhen/main/deploy-wizard.py"

if exist "%~dp0deploy-wizard.py" (
    echo.
    echo [*] ?????????????????????...
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
                echo [*] ??????????????¡ã·Ú
            ) else (
                echo [*] ????????????¡ã·Ú
                del /f "%~dp0deploy-wizard.py.download" >nul 2>&1
            )
        ) else (
            echo [x] ??????????§¹????????????·Ú
            del /f "%~dp0deploy-wizard.py.download" >nul 2>&1
        )
    ) else (
        echo [x] ????????????????????·Ú
    )
) else (
    echo.
    echo [*] ¦Ä???????????????????...
    call :DOWNLOAD_FILE "%~dp0deploy-wizard.py"
    if not exist "%~dp0deploy-wizard.py" (
        echo.
        echo [x] ??????????????
        echo     ????????? deploy-wizard.py ???????????????
        echo     ??????: %URL1%
        echo.
        pause
        exit /b 1
    )
    :: Validate
    findstr /m "WIZARD_VERSION" "%~dp0deploy-wizard.py" >nul 2>&1
    if not !ERRORLEVEL! equ 0 (
        echo.
        echo [x] ??????????§¹?????????????????—¥
        del /f "%~dp0deploy-wizard.py" >nul 2>&1
        echo     ?????????????????
        echo.
        pause
        exit /b 1
    )
    echo [*] ????????????
)

:: ------------------------------------------------------------------
:: 4. Launch wizard
:: ------------------------------------------------------------------
echo.
echo =====================================
echo   ?????????????...
echo   ????????????
echo   ?????????????????????????
echo =====================================
echo.
echo ??????? Ctrl+C ?????????
echo.

cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set WIZARD_SKIP_UPDATE=1
!PYTHON_CMD! deploy-wizard.py

echo.
echo ????????
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
echo     ????????? 1/3 ...
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
echo     ????????? 2/3 ...
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
echo     ????????? 3/3 ...
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
echo     [x] ??????????????
echo.
echo     ??????:
if "!_HAS_CURL!"=="1" (
    echo       - curl.exe ??????????????????????/?????????
    echo       - ????: curl.exe -v %URL1%
) else (
    echo       - ¦Ä??? curl.exe????????? PowerShell ????
)
echo       - ??????????§Ù?????????????:
echo         %URL1%
echo       - ????????????????? deploy-wizard.py ???????????
:DOWNLOAD_DONE
goto :eof
