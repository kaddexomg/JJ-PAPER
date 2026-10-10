@echo off
title JJ Paper — Puente MixNet ERP
color 0b

echo ====================================================
echo   INICIANDO PUENTE AUTONOMO JJ PAPER ⇄ MIXNET ERP
echo ====================================================
echo.

cd /d "%~dp0"

echo Verificando Node.js...
node -v >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: Node.js no esta instalado o no esta en el PATH.
  echo Por favor instala Node.js (v13 o superior) para Windows 7.
  pause
  exit /b 1
)

echo Iniciando servidor en puerto 3300...
start "" "http://localhost:3300"
node server.cjs

pause
