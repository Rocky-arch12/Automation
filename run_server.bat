@echo off
title AlphaSignal Engine
echo ===============================================================
echo   AlphaSignal AI 24x7 Uvicorn Backend Engine
echo ===============================================================

cd /d "%~dp0"

REM Detect Python interpreter (prefer project venv, then uvicorn-capable python)
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
    if "%~1"=="--check" exit /b 1
    echo Retrying in 5 seconds...
    timeout /t 5 /nobreak >nul 2>&1 || python -c "import time; time.sleep(5)" >nul 2>&1
    goto svr_loop
)

if not "%~1"=="--check" goto skip_check
echo [CHECK] Validating Python and Uvicorn installation...
%PY_CMD% -m uvicorn --version
if errorlevel 1 (
    echo [CHECK] FAILED: Uvicorn is not functional under %PY_CMD%.
    exit /b 1
)
echo [CHECK] OK: Engine interpreter and Uvicorn backend are functional.
exit /b 0

:skip_check

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
