@echo off
setlocal
title Math Analysis Tutor Server
cd /d "%~dp0server"

if not exist "node_modules\express\package.json" (
  echo [1/2] Installing backend dependencies...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Dependency installation failed. Check Node.js and network access.
    pause
    exit /b 1
  )
)

echo [2/2] Starting server...
echo Teacher dashboard: http://127.0.0.1:3000/admin
echo Press Ctrl+C to stop.
start "" "http://127.0.0.1:3000/admin"
node src\server.js

echo.
echo Server stopped.
pause
