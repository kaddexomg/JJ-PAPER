@echo off
rem ====================================================================
rem JJ PAPER - Activar Puente Autonomo MixNet ERP (Windows 7)
rem ====================================================================
title JJ PAPER -- Puente Autonomo MixNet
color 0b
cls

echo ====================================================================
echo      JJ PAPER -- PUENTE AUTONOMO MIXNET ERP (WINDOWS 7)
echo ====================================================================
echo.
echo  Buscando Node.js en esta PC con Windows 7...
echo.

set "NODE="

where node >nul 2>nul
if %errorlevel%==0 (
    set "NODE=node"
    goto EJECUTAR
)

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE=C:\Program Files\nodejs\node.exe"
    goto EJECUTAR
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE=C:\Program Files (x86)\nodejs\node.exe"
    goto EJECUTAR
)
if exist "C:\nodejs\node.exe" (
    set "NODE=C:\nodejs\node.exe"
    goto EJECUTAR
)
if exist "C:\node\node.exe" (
    set "NODE=C:\node\node.exe"
    goto EJECUTAR
)

echo [ERROR] No se encontro Node.js en este equipo.
echo Por favor instala Node.js v13 para ejecutar el puente.
echo.
pause
exit /b 1

:EJECUTAR
echo [OK] Node.js detectado: %NODE%
echo.
echo Iniciando sincronizacion en tiempo real con la nube de JJ Paper...
echo Cada venta o cotizacion caera automaticamente en C:\pedidos
echo.

if not exist logs mkdir logs

"%NODE%" "%~dp0puente-mixnet-autonomo.cjs"

echo.
pause
