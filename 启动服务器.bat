@echo off
chcp 65001 >nul
title moneybook server
cd /d "%~dp0"
node server.js
echo.
echo   Server stopped. Press any key to close this window.
pause >nul
