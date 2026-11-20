@echo off
if "%~1"=="--server-worker" goto server_worker

title AlphaSignal AI 24x7 Engine ^& Permanent Ngrok Tunnel
echo ===================================================
echo   AlphaSignal AI 24x7 Continuous Execution Engine
echo ===================================================

cd /d "%~dp0"

REM 1. Prevent Windows from sleeping or suspending network adapter while plugged in
echo [CONFIG] Configuring Windows power state to stay awake 24/7...
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1

REM 2. Check mode: test runner components without blocking
if not "%~1"=="--check" goto skip_check
echo [CHECK] Verifying server backend...
if exist "%~dp0run_server.bat" (
    call "%~dp0run_server.bat" --check
) else (
    call "%~f0" --server-worker --check
)
if errorlevel 1 exit /b 1

echo [CHECK] Verifying ngrok tunnel binary...
set NGROK_BIN=
if exist "%~dp0ngrok.exe" set NGROK_BIN="%~dp0ngrok.exe"
if not defined NGROK_BIN (
    where ngrok >nul 2>&1
    if not errorlevel 1 set NGROK_BIN=ngrok
)
if not defined NGROK_BIN (
    echo [CHECK] FAILED: ngrok binary not found in '%~dp0' or PATH.
    exit /b 1
)
%NGROK_BIN% --version
echo [CHECK] OK: All 24x7 ngrok tunnel components verified successfully.
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

REM 4. Permanent Ngrok Tunnel with Watchdog Auto-Reconnection Loop
:tunnel_loop
cls
echo ===============================================================
echo   AlphaSignal AI Permanent 24x7 Ngrok Tunnel
echo   Tunnel URL: https://plod-exonerate-october.ngrok-free.dev
echo ===============================================================
echo [STATUS] Tunnel forwarding: https://plod-exonerate-october.ngrok-free.dev -^> http://127.0.0.1:8000
echo [STATUS] Telegram Listener: Auto-managed in background (No browser needed)
echo [STATUS] Watchdog Active: Any network drop will auto-reconnect in 3s
echo ===============================================================
echo.

REM Resolve ngrok binary (local directory first, then system PATH)
set NGROK_BIN=
if exist "%~dp0ngrok.exe" set NGROK_BIN="%~dp0ngrok.exe"
if not defined NGROK_BIN (
    where ngrok >nul 2>&1
    if not errorlevel 1 set NGROK_BIN=ngrok
)

if not defined NGROK_BIN (
    echo.
    echo ===============================================================
    echo [%date% %time%] [ERROR] ngrok was not found in this folder or in system PATH!
    echo Please place ngrok.exe in '%~dp0' or add ngrok to your PATH.
    echo ===============================================================
    echo Retrying in 5 seconds...
    timeout /t 5 /nobreak >nul 2>&1 || python -c "import time; time.sleep(5)" >nul 2>&1
    goto tunnel_loop
)

%NGROK_BIN% http --url=https://plod-exonerate-october.ngrok-free.dev 8000

echo.
echo ===============================================================
echo [%date% %time%] [ALERT] Ngrok tunnel connection dropped!
echo [%date% %time%] [WATCHDOG] Reconnecting ngrok in 3 seconds...
echo ===============================================================
timeout /t 3 /nobreak >nul 2>&1 || python -c "import time; time.sleep(3)" >nul 2>&1
goto tunnel_loop

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
