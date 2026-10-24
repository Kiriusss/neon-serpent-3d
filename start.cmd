@echo off
setlocal
cd /d "%~dp0"
set "PORT=4173"
set "NEON_OPEN=1"
echo Starting NEON SERPENT on http://127.0.0.1:%PORT% ...
node serve.mjs
if errorlevel 1 (
  echo.
  echo The local server could not start. Make sure Node.js is installed.
  echo Alternatively run: python -m http.server %PORT% --bind 127.0.0.1
  echo.
  pause
)
