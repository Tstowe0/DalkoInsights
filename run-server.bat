@echo off
cd /d "%~dp0"

echo ============================================
echo  Dalko Insights — local server
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

echo Starting server at http://localhost:8080
echo Press Ctrl+C to stop.
echo.

start "" "http://localhost:8080"
python -m http.server 8080

pause
