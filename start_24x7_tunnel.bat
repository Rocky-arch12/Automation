@echo off
title AlphaSignal AI 24x7 Engine & Cloudflare Tunnel
echo ===================================================
echo   Starting AlphaSignal AI Engine & MT5 Execution
echo ===================================================

cd /d "%~dp0"

REM 1. Start Uvicorn Server in background window
start "AlphaSignal Server" cmd /k "python -m uvicorn main:app --host 127.0.0.1 --port 8000"

REM Wait 3 seconds for server to initialize
timeout /t 3 /nobreak >nul

REM 2. Start Cloudflare Tunnel
echo Starting Cloudflare 24x7 Free Tunnel...
.\cloudflared.exe tunnel --url http://127.0.0.1:8000

pause
