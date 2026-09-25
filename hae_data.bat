@echo off
rem Hakee Garmin-datan ilman palvelinta. Windowsin Tehtävien ajoitus ajaa tämän kerran päivässä.
rem Tulos kirjataan tiedostoon data\hae_data.log (ei versionhallinnassa).

chcp 65001 >nul
cd /d "%~dp0"
if not exist data mkdir data

echo ===== %date% %time% ===== >> data\hae_data.log
uv run fetch_garmin.py >> data\hae_data.log 2>&1
echo Exit code: %errorlevel% >> data\hae_data.log
