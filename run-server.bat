@echo off
cd /d "%~dp0"

echo ============================================
echo  DALKO Insights — local server
echo ============================================
echo.

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo Python was not found on PATH.
    echo Install Python, then run this file again.
    echo.
    pause
    exit /b 1
)

echo Starting http://localhost:8080
echo This one process serves the site, DAT RateView, and FMCSA QCMobile.
echo Press Ctrl+C to stop.
echo.

start "" "http://localhost:8080"
python tools\dat-proxy.py

pause
