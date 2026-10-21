@echo off
title JJ PAPER -- PUENTE COBRANZA MIXNET
color 0A
cls
echo ========================================================
echo    JJ PAPER - AGENTE PUENTE LOCAL (PC COBRANZA)
echo    Compatible con Windows 7 y Node.js 13.14.0
echo ========================================================
echo.

cd /d "%~dp0"

echo Verificando Node.js...
node -v
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js no esta instalado o no esta en el PATH.
    echo Instala Node 13.14.0 en esta PC.
    pause
    exit /b 1
)

echo.
echo Iniciando agente puente autonomo...
node cobranza-bridge.cjs

pause
