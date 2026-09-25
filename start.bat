@echo off
rem Running Log: fetches fresh Garmin data, starts the server and opens the browser.
rem Start by double-clicking. Stop by closing the window or pressing Ctrl+C.

rem UTF-8 so that non-ASCII characters display correctly
chcp 65001 >nul

rem Go to the folder containing this file (works wherever it is started from)
cd /d "%~dp0"

echo.
echo === 1/3 Fetching activities from Garmin ===
uv run fetch_garmin.py
if errorlevel 1 (
    echo.
    echo Garmin fetch failed. The app will start with previously fetched data.
    echo.
)

echo.
echo === 2/3 Opening browser: http://localhost:8000 ===
rem Short delay so the server is up before the browser opens the page
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"

echo.
echo === 3/3 Server running. Keep this window open. To stop: Ctrl+C or close the window. ===
echo.
uv run --no-project python serve.py

pause
