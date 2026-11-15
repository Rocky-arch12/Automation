@echo off
title AlphaSignal AI 24x7 Engine & Permanent Ngrok Tunnel
echo ===================================================
echo   Starting AlphaSignal AI Engine & MT5 Execution
echo ===================================================

cd /d "%~dp0"

REM 1. Start Uvicorn Server in background window
start "AlphaSignal Server" cmd /k "python -m uvicorn main:app --host 127.0.0.1 --port 8000"

REM Wait 3 seconds for server to initialize
timeout /t 3 /nobreak >nul

REM 2. Start Permanent Ngrok Tunnel with Edge Google OAuth Whitelist
echo ===================================================
echo   Starting Permanent 24x7 Ngrok Tunnel:
echo   https://plod-exonerate-october.ngrok-free.dev
echo   Protected by Google OAuth:
echo   riddhesh.firake@gmail.com, acc94926@gmail.com
echo ===================================================
.\ngrok.exe http --url=https://plod-exonerate-october.ngrok-free.dev 8000 --oauth=google --oauth-allow-email=riddhesh.firake@gmail.com,acc94926@gmail.com

pause
