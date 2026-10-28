@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "PUUKA_NODE=node.exe"
if exist ".runtime\node-path.txt" set /p PUUKA_NODE=<".runtime\node-path.txt"
"%PUUKA_NODE%" --version >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Run the deployment script first.
  pause
  exit /b 1
)
if not defined JLPT_PORT set "JLPT_PORT=3300"
set "JLPT_URL=http://127.0.0.1:%JLPT_PORT%"
powershell.exe -NoProfile -Command "try { $r=Invoke-RestMethod -Uri ($env:JLPT_URL + '/api/health') -TimeoutSec 2; if($r.app -eq 'puuka-jlpt-dojo'){exit 0} } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo Puuka JLPT Dojo is already running at %JLPT_URL%
  if not defined JLPT_NO_BROWSER start "" "%JLPT_URL%"
  exit /b 0
)
echo Starting Puuka JLPT Dojo at %JLPT_URL%
if not defined JLPT_NO_BROWSER start "" "%JLPT_URL%"
"%PUUKA_NODE%" server.js
if errorlevel 1 pause
