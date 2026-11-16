@echo off
title AlphaSignal AI 24x7 Engine & Cloudflare Tunnel
echo ===================================================
echo   AlphaSignal AI 24x7 Continuous Execution Engine
echo ===================================================

cd /d "%~dp0"

REM 1. Prevent Windows from sleeping or suspending network adapter while plugged in
echo [CONFIG] Configuring Windows power state to stay awake 24/7...
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1

REM 2. Start Uvicorn Server in self-healing background watchdog window
echo [STARTUP] Launching AlphaSignal Uvicorn backend with auto-recovery...
start "AlphaSignal Server Engine" cmd /k "title AlphaSignal Engine && cd /d "%~dp0" && :svr_loop && python -m uvicorn main:app --host 127.0.0.1 --port 8000 --timeout-keep-alive 75 && echo [ALERT] Uvicorn stopped. Restarting in 3s... && timeout /t 3 >nul && goto svr_loop"

REM Wait 3 seconds for server to initialize
timeout /t 3 /nobreak >nul

REM 3. Permanent Cloudflare Tunnel with Watchdog Auto-Reconnection Loop
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

.\cloudflared.exe tunnel --url http://127.0.0.1:8000

echo.
echo ===============================================================
echo [%date% %time%] [ALERT] Cloudflare tunnel connection dropped!
echo [%date% %time%] [WATCHDOG] Reconnecting Cloudflare tunnel in 3 seconds...
echo ===============================================================
timeout /t 3 /nobreak >nul
goto cf_loop
