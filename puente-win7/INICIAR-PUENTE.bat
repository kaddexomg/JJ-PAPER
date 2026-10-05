@echo off
title JJ PAPER -- PUENTE AUTONOMO MIXNET ERP (WINDOWS 7)
color 0b
cls

echo ====================================================================
echo    JJ PAPER -- PUENTE AUTONOMO BIDIRECCIONAL MIXNET ERP (WIN 7)
echo ====================================================================
echo.
echo  Buscando Node.js en esta PC con Windows 7...
echo.

set "NODE_CMD="

where node >nul 2>nul
if %errorlevel%==0 (
    set "NODE_CMD=node"
    goto DETECTADO
)

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files\nodejs\node.exe"
    goto DETECTADO
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files (x86)\nodejs\node.exe"
    goto DETECTADO
)
if exist "C:\nodejs\node.exe" (
    set "NODE_CMD=C:\nodejs\node.exe"
    goto DETECTADO
)
if exist "C:\node\node.exe" (
    set "NODE_CMD=C:\node\node.exe"
    goto DETECTADO
)
if exist "%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe" (
    set "NODE_CMD=%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe"
    goto DETECTADO
)

color 0c
echo ====================================================================
echo [ERROR] No se encontro Node.js en esta PC con Windows 7.
echo ====================================================================
echo Por favor asegurese de tener Node.js instalado en el equipo.
echo.
pause
exit /b 1

:DETECTADO
echo [OK] Node.js detectado: %NODE_CMD%
"%NODE_CMD%" -v
echo.

cd /d "%~dp0"
set "SCRIPT_FILE=%~dp0puente-mixnet.cjs"

if not exist "%SCRIPT_FILE%" (
    color 0c
    echo [ERROR] No se encontro puente-mixnet.cjs en esta carpeta.
    echo Ruta buscada: %SCRIPT_FILE%
    pause
    exit /b 1
)

echo ====================================================================
echo  INICIANDO PUENTE BIDIRECCIONAL MIXNET ERP ⇄ NUBE...
echo  Para cerrar el puente simplemente cierra esta ventana.
echo ====================================================================
echo.

:BUCLE
"%NODE_CMD%" "%SCRIPT_FILE%"
set "ERR=%errorlevel%"

echo.
echo ====================================================================
echo  [AVISO] El puente se detuvo (Codigo de salida: %ERR%).
echo  Reiniciando conexion en 5 segundos...
echo ====================================================================
timeout /t 5 /nobreak >nul
goto BUCLE
