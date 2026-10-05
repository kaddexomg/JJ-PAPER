@echo off
title JJ PAPER -- Antigravity Micro-Node (Win7)
color 0b
cls

echo ====================================================================
echo    JJ PAPER -- ANTIGRAVITY MICRO-NODE ^& COPILOTO IA (WINDOWS 7)
echo ====================================================================
echo.

echo [1/3] Verificando instalacion de Node.js...

set "NODE_CMD="

node -v >nul 2>nul
if not errorlevel 1 (
    set "NODE_CMD=node"
    goto :NODE_OK
)

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files\nodejs\node.exe"
    goto :NODE_OK
)

if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files (x86)\nodejs\node.exe"
    goto :NODE_OK
)

if exist "C:\nodejs\node.exe" (
    set "NODE_CMD=C:\nodejs\node.exe"
    goto :NODE_OK
)

if exist "C:\node\node.exe" (
    set "NODE_CMD=C:\node\node.exe"
    goto :NODE_OK
)

:NODE_FAIL
color 0c
echo ====================================================================
echo [ERROR] No se encontro Node.js en esta PC con Windows 7.
echo ====================================================================
echo Por favor asegurese de tener Node.js instalado en la PC.
echo.
pause
exit /b 1

:NODE_OK
echo [OK] Node.js detectado: %NODE_CMD%
"%NODE_CMD%" -v
echo.

echo [2/3] Localizando archivo del servidor...
set "TARGET_DIR="
set "SERVER_FILE="

if exist "%~dp0mixnet-ai-panel\server.js" (
    set "TARGET_DIR=%~dp0mixnet-ai-panel"
    set "SERVER_FILE=%~dp0mixnet-ai-panel\server.js"
    goto :SERVER_OK
)

if exist "%~dp0server.js" (
    set "TARGET_DIR=%~dp0"
    set "SERVER_FILE=%~dp0server.js"
    goto :SERVER_OK
)

:SERVER_FAIL
color 0c
echo ====================================================================
echo [ERROR] No se encontro el archivo server.js
echo ====================================================================
echo Carpeta actual: %~dp0
echo.
echo Asegurate de haber EXTRAIDO el archivo ZIP en tu Escritorio.
echo Si haces doble clic al archivo dentro del ZIP sin extraerlo,
echo Windows no puede cargar los demas archivos.
echo.
pause
exit /b 1

:SERVER_OK
echo [OK] Directorio de aplicacion: %TARGET_DIR%
echo.

echo [3/3] Liberando puerto 3300...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3300') do taskkill /F /PID %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3301') do taskkill /F /PID %%a >nul 2>nul

echo.
echo ====================================================================
echo  INICIANDO ANTIGRAVITY MICRO-NODE EN PUERTO 3300...
echo  Abriendo navegador en http://localhost:3300
echo ====================================================================
echo.

start http://localhost:3300

cd /d "%TARGET_DIR%"
"%NODE_CMD%" "%SERVER_FILE%"

echo.
echo ====================================================================
echo [ATENCION] El servidor se cerro con codigo: %errorlevel%
echo ====================================================================
pause
