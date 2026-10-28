@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "PUUKA_NODE=node.exe"
if exist ".runtime\node-path.txt" set /p PUUKA_NODE=<".runtime\node-path.txt"
echo Puuka JLPT Dojo - downloading updates from ZJU GitLab master...
echo Close the website server before running this script.
"%PUUKA_NODE%" updater.js
set "PUUKA_EXIT=%ERRORLEVEL%"
if not "%PUUKA_EXIT%"=="0" echo Update failed. Check the network and run deployment if Node.js is missing.
pause
exit /b %PUUKA_EXIT%
