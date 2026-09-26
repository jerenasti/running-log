@echo off
rem Runs all tests: JavaScript (Node's built-in test runner) and Python (pytest).
rem The tests never contact Garmin.

cd /d "%~dp0"

echo.
echo === JavaScript tests (js/) ===
node --test "tests/*.test.js"
set JS_RESULT=%errorlevel%

echo.
echo === Python tests (fetch_garmin.py) ===
uv run --with pytest --with garminconnect==0.3.2 pytest tests -q
set PY_RESULT=%errorlevel%

echo.
if %JS_RESULT%==0 if %PY_RESULT%==0 (
    echo All tests passed.
    goto :end
)
echo Some tests FAILED. See the output above.

:end
echo.
pause
