@echo off
if "%~1"=="--server-worker" goto server_worker

title AlphaSignal AI 24x7 Engine ^& Cloudflare Tunnel
echo ===================================================
echo   AlphaSignal AI 24x7 Continuous Execution Engine
echo ===================================================

cd /d "%~dp0"

REM 1. Prevent Windows from sleeping or suspending network adapter while plugged in, and keep running when lid is closed
echo [CONFIG] Configuring Windows power state to stay awake 24/7...
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 >nul 2>&1
powercfg /setdcvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1

REM 2. Check mode: test runner components without blocking
if not "%~1"=="--check" goto skip_check
echo [CHECK] Verifying server backend...
if exist "%~dp0run_server.bat" (
    call "%~dp0run_server.bat" --check
) else (
    call "%~f0" --server-worker --check
)
if errorlevel 1 exit /b 1

echo [CHECK] Verifying cloudflared tunnel binary...
set CF_BIN=
if exist "%~dp0cloudflared.exe" set CF_BIN="%~dp0cloudflared.exe"
if not defined CF_BIN (
    where cloudflared >nul 2>&1
    if not errorlevel 1 set CF_BIN=cloudflared
)
if not defined CF_BIN (
    echo [CHECK] FAILED: cloudflared binary not found in '%~dp0' or PATH.
    exit /b 1
)
%CF_BIN% --version
echo [CHECK] OK: All 24x7 Cloudflare tunnel components verified successfully.
exit /b 0

:skip_check

REM 3. Start Uvicorn Server in self-healing background watchdog window
echo [STARTUP] Launching AlphaSignal Uvicorn backend with auto-recovery...
if exist "%~dp0run_server.bat" (
    start "AlphaSignal Engine" /d "%~dp0" cmd /k call "%~dp0run_server.bat"
) else (
    start "AlphaSignal Engine" /d "%~dp0" cmd /k call "%~f0" --server-worker
)

REM Wait 3 seconds for server to initialize
timeout /t 3 /nobreak >nul 2>&1 || python -c "import time; time.sleep(3)" >nul 2>&1

REM 4. Permanent Cloudflare Tunnel with Watchdog Auto-Reconnection Loop
:cf_loop
cls
echo ===============================================================
echo   AlphaSignal AI 24x7 Cloudflare Tunnel (Zero-Drop)
echo ===============================================================
echo [STATUS] Forwarding traffic to local engine: http://127.0.0.1:8000
echo [STATUS] Telegram Listener: Auto-managed in background (No browser needed)
echo [STATUS] Watchdog Active: Continuous auto-healing
echo ===============================================================
echo.

REM Resolve cloudflared binary (local directory first, then system PATH)
set CF_BIN=
if exist "%~dp0cloudflared.exe" set CF_BIN="%~dp0cloudflared.exe"
if not defined CF_BIN (
    where cloudflared >nul 2>&1
    if not errorlevel 1 set CF_BIN=cloudflared
)

if not defined CF_BIN (
    echo.
    echo ===============================================================
    echo [%date% %time%] [ERROR] cloudflared was not found in this folder or in system PATH!
    echo Please place cloudflared.exe in '%~dp0' or add cloudflared to your PATH.
    echo ===============================================================
    echo Retrying in 5 seconds...
    timeout /t 5 /nobreak >nul 2>&1 || python -c "import time; time.sleep(5)" >nul 2>&1
    goto cf_loop
)

%CF_BIN% tunnel --url http://127.0.0.1:8000

echo.
echo ===============================================================
echo [%date% %time%] [ALERT] Cloudflare tunnel connection dropped!
echo [%date% %time%] [WATCHDOG] Reconnecting Cloudflare tunnel in 3 seconds...
echo ===============================================================
timeout /t 3 /nobreak >nul 2>&1 || python -c "import time; time.sleep(3)" >nul 2>&1
goto cf_loop

exit /b 0

:server_worker
title AlphaSignal Engine
cd /d "%~dp0"

set PY_CMD=
if exist "%~dp0venv\Scripts\python.exe" set PY_CMD="%~dp0venv\Scripts\python.exe"
if not defined PY_CMD if exist "%~dp0.venv\Scripts\python.exe" set PY_CMD="%~dp0.venv\Scripts\python.exe"
if not defined PY_CMD (
    python -c "import uvicorn" >nul 2>&1
    if not errorlevel 1 set PY_CMD=python
)
if not defined PY_CMD (
    py -3 -c "import uvicorn" >nul 2>&1
    if not errorlevel 1 set PY_CMD=py -3
)
if not defined PY_CMD (
    where python >nul 2>&1
    if not errorlevel 1 set PY_CMD=python
)
if not defined PY_CMD (
    where py >nul 2>&1
    if not errorlevel 1 set PY_CMD=py
)

if not defined PY_CMD (
    echo.
    echo ===============================================================
    echo [%date% %time%] [ERROR] Python was not found in PATH or venv!
    echo Please install Python 3.10+ and run: pip install -r requirements.txt
    echo ===============================================================
    if "%~2"=="--check" exit /b 1
    echo Retrying in 5 seconds...
    timeout /t 5 /nobreak >nul 2>&1 || python -c "import time; time.sleep(5)" >nul 2>&1
    goto svr_loop
)

if not "%~2"=="--check" goto skip_worker_check
echo [CHECK] Validating Python and Uvicorn installation (worker mode)...
%PY_CMD% -m uvicorn --version
if errorlevel 1 (
    echo [CHECK] FAILED: Uvicorn is not functional under %PY_CMD%.
    exit /b 1
)
echo [CHECK] OK: Engine interpreter and Uvicorn backend are functional.
exit /b 0

:skip_worker_check

:svr_loop
echo.
echo [%date% %time%] [ENGINE] Launching AlphaSignal Uvicorn backend...

%PY_CMD% -m uvicorn main:app --host 127.0.0.1 --port 8000 --timeout-keep-alive 75

echo.
echo ===============================================================
echo [%date% %time%] [ALERT] AlphaSignal Uvicorn backend stopped!
echo [%date% %time%] [WATCHDOG] Restarting Uvicorn in 3 seconds...
echo ===============================================================
timeout /t 3 /nobreak >nul 2>&1 || %PY_CMD% -c "import time; time.sleep(3)" >nul 2>&1
goto svr_loop
