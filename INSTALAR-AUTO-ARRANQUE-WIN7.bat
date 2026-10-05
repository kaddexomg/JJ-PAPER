@echo off
rem ====================================================================
rem JJ PAPER -- INSTALADOR DE AUTO-ARRANQUE EN WINDOWS 7
rem ====================================================================
title JJ PAPER -- Configurar Auto-Arranque Silencioso
color 0a
cls

echo ====================================================================
echo    JJ PAPER -- INSTALADOR DE ARRANQUE AUTOMATICO (WINDOWS 7)
echo ====================================================================
echo.
echo  Buscando ruta exacta de Node.js en esta PC...
echo.

set "NODE_EXE="

where node >nul 2>nul
if %errorlevel%==0 (
    for /f "delims=" %%i in ('where node') do if not defined NODE_EXE set "NODE_EXE=%%i"
)

if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
if not defined NODE_EXE if exist "C:\nodejs\node.exe" set "NODE_EXE=C:\nodejs\node.exe"
if not defined NODE_EXE if exist "C:\node\node.exe" set "NODE_EXE=C:\node\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe" set "NODE_EXE=%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe"

if not defined NODE_EXE (
    echo [ERROR] No se pudo encontrar Node.js en este equipo.
    echo Asegurese de tener instalado Node.js en Windows 7.
    pause
    exit /b 1
)

echo  [OK] Ejecutable de Node encontrado: "%NODE_EXE%"
echo.

set "TARGET_DIR="
if exist "%~dp0mixnet-ai-panel\server.js" (
    set "TARGET_DIR=%~dp0mixnet-ai-panel"
) else if exist "%~dp0server.js" (
    set "TARGET_DIR=%~dp0"
) else (
    echo [ERROR] No se encontro server.js.
    pause
    exit /b 1
)

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if not exist "%STARTUP_DIR%" (
    echo [ERROR] No se pudo localizar la carpeta de Inicio de Windows.
    echo Ruta: %STARTUP_DIR%
    pause
    exit /b 1
)

echo [1/3] Creando script lanzador en el directorio del agente...
set "RUN_BAT=%TARGET_DIR%\run-service-win7.bat"
(
    echo @echo off
    echo cd /d "%TARGET_DIR%"
    echo for /f "tokens=5" %%%%p in ^('netstat -aon ^^^| findstr ":3300"'^) do taskkill /F /PID %%%%p ^>nul 2^>nul
    echo for /f "tokens=5" %%%%p in ^('netstat -aon ^^^| findstr ":3301"'^) do taskkill /F /PID %%%%p ^>nul 2^>nul
    echo "%NODE_EXE%" "%TARGET_DIR%\server.js" ^>^> "%TARGET_DIR%\win7-agent.log" 2^>^&1
) > "%RUN_BAT%"
echo  [OK] Generado: %RUN_BAT%

echo.
echo [2/3] Creando script silencioso VBS en la carpeta de Inicio de Windows...
set "VBS_FILE=%STARTUP_DIR%\JJ-Paper-Node-Win7.vbs"
(
    echo ' JJ Paper - Arranque silencioso permanente
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo WshShell.CurrentDirectory = "%TARGET_DIR%"
    echo WshShell.Run """%RUN_BAT%""", 0, False
    echo Set WshShell = Nothing
) > "%VBS_FILE%"
echo  [OK] Generado en Inicio: %VBS_FILE%

echo.
echo [3/3] Creando acceso directo en el Escritorio...
set "DESKTOP_BAT=%USERPROFILE%\Desktop\ABRIR-COCKPIT-TIENDA.bat"
(
    echo @echo off
    echo title Abriendo Cockpit JJ Paper Tienda...
    echo if exist "%TARGET_DIR%\active_url.txt" ^(
    echo     for /f "delims=" %%%%u in ^(%TARGET_DIR%\active_url.txt^) do start %%%%u ^& exit /b 0
    echo ^)
    echo start http://localhost:3300
) > "%DESKTOP_BAT%"
echo  [OK] Creado: %DESKTOP_BAT%

echo.
echo  Iniciando servicio en segundo plano ahora mismo...
cscript //nologo "%VBS_FILE%"

echo  Esperando enlace en puerto 3300...
timeout /t 3 /nobreak >nul

netstat -aon | findstr ":3300" >nul
if %errorlevel%==0 (
    echo.
    echo ====================================================================
    echo  [EXITO] SERVICIO INICIADO Y CORRIENDO EN PUERTO 3300
    echo ====================================================================
    echo  - Se iniciara de forma 100%% automatica cada vez que prendas la PC.
    echo  - No mostrara ventanas molestas.
    echo  - Abriendo interfaz web de control ahora...
    echo.
    start http://localhost:3300
) else (
    echo.
    echo [AVISO] Comprobando registro de ejecucion:
    if exist "%TARGET_DIR%\win7-agent.log" (
        type "%TARGET_DIR%\win7-agent.log"
    )
    start http://localhost:3300
)

pause
