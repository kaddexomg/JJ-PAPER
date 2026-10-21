@echo off
rem ====================================================================
rem JJ PAPER -- PUENTE AUTONOMO MIXNET ERP (WINDOWS 7)
rem ====================================================================
title JJ PAPER -- Puente MixNet ERP (Win 7)
color 0b
cls

echo ====================================================================
echo    JJ PAPER -- PUENTE AUTONOMO BIDIRECCIONAL MIXNET ERP (WIN 7)
echo ====================================================================
echo.
echo [1/3] Localizando ejecutable de Node.js en esta PC con Windows 7...
echo.

cd /d "%~dp0"
set "NODE_CMD="

rem 1. Probar comando en PATH
where node >nul 2>nul
if %errorlevel%==0 (
    set "NODE_CMD=node"
    goto :NODE_OK
)

rem 2. Rutas estandar de instalacion de Node.js en Windows 7
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
if exist "%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe" (
    set "NODE_CMD=%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe"
    goto :NODE_OK
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE_CMD=%LOCALAPPDATA%\Programs\nodejs\node.exe"
    goto :NODE_OK
)
if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
    goto :NODE_OK
)
if exist "%~dp0bin\node.exe" (
    set "NODE_CMD=%~dp0bin\node.exe"
    goto :NODE_OK
)

:NODE_FAIL
color 0c
echo ====================================================================
echo [ERROR] No se encontro Node.js en esta PC con Windows 7.
echo ====================================================================
echo.
echo  Rutas verificadas sin exito:
echo   - Comando "node" en la variable PATH
echo   - C:\Program Files\nodejs\node.exe
echo   - C:\Program Files (x86)\nodejs\node.exe
echo   - C:\nodejs\node.exe
echo   - %~dp0node.exe
echo.
echo  SOLUCION RAPIDA PARA WINDOWS 7:
echo   1. Descarga e instala Node.js v13.14.0 (ultima version oficial para Win 7):
echo      https://nodejs.org/dist/v13.14.0/node-v13.14.0-x64.msi (o x86)
echo   2. O copia el archivo "node.exe" directamente dentro de esta carpeta:
echo      %~dp0
echo.
echo Presiona cualquier tecla para salir...
pause >nul
exit /b 1

:NODE_OK
echo [OK] Node.js detectado exitosamente:
echo      %NODE_CMD%
"%NODE_CMD%" -v
echo.

echo [2/3] Verificando actualizaciones y archivos del puente...
rem Auto-actualizacion transparente desde la nube si hay conexion a internet
"%NODE_CMD%" -e "const https = require('https'); const fs = require('fs'); const path = require('path'); const target = path.join('%~dp0', 'server.cjs'); https.get('https://jjpaper.pages.dev/puente-win7/server.cjs', res => { if (res.statusCode === 200) { let data = ''; res.on('data', c => data += c); res.on('end', () => { if (data.length > 50000 && data.includes('injectQuoteToMixnet')) { fs.writeFileSync(target, data, 'utf8'); console.log('  [OK] Puente actualizado exitosamente con la ultima version oficial.'); } }); } }).on('error', () => { console.log('  [INFO] Sin conexion para auto-update, iniciando con version local.'); });" 2>nul

if not exist "%~dp0server.cjs" (
    color 0c
    echo [ERROR] No se encontro el archivo server.cjs en esta carpeta.
    echo Ruta: %~dp0server.cjs
    pause
    exit /b 1
)

rem Verificacion previa de puerto 3300 sin piping anidado
netstat -ano | findstr ":3300" | findstr "LISTENING" >nul 2>nul
if %errorlevel%==0 (
    echo   - Puerto 3300 en uso. Se reusara o server.cjs reportara estado.
)

echo.
echo [3/3] Iniciando Micro-Puente JJ Paper <-> MixNet...
echo       La interfaz web se abrira en: http://localhost:3300
echo.
echo ====================================================================
echo  PUENTE EN LINEA -- Deje esta ventana abierta mientras use el sistema.
echo ====================================================================
echo.

rem Abrir la interfaz web tras breve pausa para garantizar que el servidor este escuchando
start "" cmd /c "ping 127.0.0.1 -n 3 >nul & start http://localhost:3300"
"%NODE_CMD%" "%~dp0server.cjs"

set "EXIT_CODE=%errorlevel%"
echo.
echo ====================================================================
echo  [AVISO] El puente se detuvo con codigo de salida: %EXIT_CODE%
echo ====================================================================
echo.
pause
