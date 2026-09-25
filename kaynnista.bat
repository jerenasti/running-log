@echo off
rem Juoksupäiväkirja: hakee tuoreen Garmin-datan, käynnistää palvelimen ja avaa selaimen.
rem Käynnistä tuplaklikkaamalla. Sammuta sulkemalla ikkuna tai painamalla Ctrl+C.

rem UTF-8, jotta ääkköset näkyvät oikein
chcp 65001 >nul

rem Siirry kansioon, jossa tämä tiedosto on (toimii mistä tahansa käynnistettynä)
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
rem Pieni viive, jotta palvelin ehtii käynnistyä ennen kuin selain avaa sivun
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"

echo.
echo === 3/3 Server running. Keep this window open. To stop: Ctrl+C or close the window. ===
echo.
uv run --no-project python -m http.server 8000 --bind 127.0.0.1

pause
