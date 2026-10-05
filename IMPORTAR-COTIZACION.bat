@echo off
rem ====================================================================
rem JJ PAPER - Importador de Cotizacion 00053355 a MixNet (Windows 7)
rem ====================================================================
title JJ PAPER - Inyectar Cotizacion 00053355 a MixNet
color 0b
cls

echo ====================================================================
echo    JJ PAPER -- INYECTOR DE COTIZACION 00053355 A MIXNET
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
echo Por favor instala Node.js v13 para ejecutar la inyeccion.
echo.
pause
exit /b 1

:EJECUTAR
echo [OK] Node.js detectado: %NODE%
echo.
echo Ejecutando inyeccion segura en MixNet...
echo.

"%NODE%" "%~dp0inyectar-cotizacion-mixnet.cjs"

echo.
pause
