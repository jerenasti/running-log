@echo off
rem Juoksupäiväkirja: hakee tuoreen Garmin-datan, käynnistää palvelimen ja avaa selaimen.
rem Käynnistä tuplaklikkaamalla. Sammuta sulkemalla ikkuna tai painamalla Ctrl+C.

rem UTF-8, jotta ääkköset näkyvät oikein
chcp 65001 >nul

rem Siirry kansioon, jossa tämä tiedosto on (toimii mistä tahansa käynnistettynä)
cd /d "%~dp0"

echo.
echo === 1/3 Haetaan harjoitukset Garminilta ===
uv run fetch_garmin.py
if errorlevel 1 (
    echo.
    echo Garmin-haku epaonnistui. Sovellus kaynnistyy aiemmin haetulla datalla.
    echo.
)

echo.
echo === 2/3 Avataan selain: http://localhost:8000 ===
rem Pieni viive, jotta palvelin ehtii käynnistyä ennen kuin selain avaa sivun
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"

echo.
echo === 3/3 Palvelin kaynnissa. Pida tama ikkuna auki. Sammuta: Ctrl+C tai sulje ikkuna. ===
echo.
uv run --no-project python -m http.server 8000 --bind 127.0.0.1

pause
