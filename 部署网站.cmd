@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1"
set "PUUKA_EXIT=%ERRORLEVEL%"
pause
exit /b %PUUKA_EXIT%
