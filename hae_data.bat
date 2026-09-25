@echo off
rem Fetches Garmin data without starting the server. Windows Task Scheduler runs this once a day.
rem Output is logged to data\hae_data.log (not in version control).

chcp 65001 >nul
cd /d "%~dp0"
if not exist data mkdir data

echo ===== %date% %time% ===== >> data\hae_data.log
uv run fetch_garmin.py >> data\hae_data.log 2>&1
echo Exit code: %errorlevel% >> data\hae_data.log
