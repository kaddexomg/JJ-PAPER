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
echo  Este script configurara el Antigravity Micro-Node para que se
echo  inicie silenciosamente en segundo plano cada vez que se encienda
echo  o reinicie esta computadora con Windows 7.
echo.

set "TARGET_DIR=%~dp0mixnet-ai-panel"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if not exist "%STARTUP_DIR%" (
    echo [ERROR] No se pudo localizar la carpeta de Inicio de Windows.
    echo Ruta esperada: %STARTUP_DIR%
    pause
    exit /b 1
)

echo [1/3] Creando script de inicio silencioso en la carpeta de arranque...
set "VBS_FILE=%STARTUP_DIR%\JJ-Paper-Node-Win7.vbs"

(
    echo ' JJ Paper - Arranque silencioso en segundo plano
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo WshShell.CurrentDirectory = "%TARGET_DIR%"
    echo WshShell.Run "node server.js", 0, False
    echo Set WshShell = Nothing
) > "%VBS_FILE%"

if exist "%VBS_FILE%" (
    echo  [OK] Creado: %VBS_FILE%
) else (
    echo  [ERROR] Fallo al crear el archivo VBS en Inicio.
    pause
    exit /b 1
)

echo.
echo [2/3] Creando acceso directo en el Escritorio para abrir la consola...
set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "BAT_DESKTOP=%DESKTOP_DIR%\ABRIR-COCKPIT-TIENDA.bat"

(
    echo @echo off
    echo start http://localhost:3300
) > "%BAT_DESKTOP%"

echo  [OK] Creado acceso directo: ABRIR-COCKPIT-TIENDA.bat en el Escritorio.

echo.
echo [3/3] Iniciando el servicio en segundo plano ahora mismo...
cscript //nologo "%VBS_FILE%"

echo.
echo ====================================================================
echo  [EXITO] ANTIGRAVITY MICRO-NODE CONFIGURADO CON EXITO
echo ====================================================================
echo.
echo  - El agente ya esta corriendo en segundo plano (puerto 3300).
echo  - Se iniciara solo cada vez que prendas o reinicies la PC.
echo  - No mostrara ventanas negras molestas.
echo  - Puedes ver la consola en cualquier momento abriendo:
echo    http://localhost:3300  (o con el icono en el Escritorio)
echo.
pause
