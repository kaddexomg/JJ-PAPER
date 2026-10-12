@echo off
title ESTADO - PUENTE COBRANZA
color 0E
cls
echo ========================================================
echo    ESTADO DEL PUENTE AUTONOMO (PC COBRANZA)
echo ========================================================
echo.

cd /d "%~dp0"

echo Proceso activo en memoria:
tasklist /FI "IMAGENAME eq node.exe" /FO TABLE
echo.

if exist "logs\cobranza-bridge.log" (
    echo Ultimas 15 lineas del registro de actividad:
    echo ----------------------------------------------------
    powershell -NoProfile -Command "Get-Content 'logs\cobranza-bridge.log' -Tail 15"
    echo ----------------------------------------------------
) else (
    echo No se encontro archivo de registro logs\cobranza-bridge.log aun.
)

echo.
pause
