@echo off
rem Fetches Garmin data without starting the server. Windows Task Scheduler runs this once a day.
rem Then backs up races.json and activities.json, and shows a Windows notification if the fetch failed.
rem Output is logged to data\fetch_data.log (not in version control).

chcp 65001 >nul
cd /d "%~dp0"
if not exist data mkdir data

echo ===== %date% %time% ===== >> data\fetch_data.log
uv run fetch_garmin.py >> data\fetch_data.log 2>&1
set FETCH_RESULT=%errorlevel%
echo Exit code: %FETCH_RESULT% >> data\fetch_data.log

rem Back up even when the fetch failed: the previous data is still worth keeping
uv run --no-project python backup.py >> data\fetch_data.log 2>&1

if not "%FETCH_RESULT%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -File notify.ps1 -Title "Running Log: Garmin fetch failed" -StatusFile data\fetch_status.json >> data\fetch_data.log 2>&1
)
