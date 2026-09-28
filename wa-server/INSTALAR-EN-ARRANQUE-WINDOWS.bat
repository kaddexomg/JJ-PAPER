@echo off
REM ============================================================
REM  JJ Paper - Instalador de Arranque Silencioso en Windows
REM  Crea un acceso directo a start-hidden.vbs en shell:startup
REM ============================================================
chcp 65001 >nul
title JJ Paper - Configurador de Arranque Automático

echo ============================================================
echo   JJ Paper — Servicio Desatendido en Segundo Plano
echo ============================================================
echo.
echo Configurando el arranque automático para que el servidor
echo se actualice e inicie solo cada vez que se encienda esta PC...
echo.

set SCRIPT_DIR=%~dp0
set TARGET_VBS=%SCRIPT_DIR%start-hidden.vbs
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_PATH=%STARTUP_FOLDER%\JJ-Paper-Server.lnk

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 0; $s.Description = 'JJ Paper Background Server'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo.
    echo [OK] ¡Acceso directo creado exitosamente en la carpeta de Inicio!
    echo Ruta: %SHORTCUT_PATH%
    echo.
    echo A partir de ahora, al encender la PC:
    echo 1. Se descargan automáticamente las últimas mejoras de Git (git pull).
    echo 2. El servidor arranca en segundo plano sin mostrar ventanas negras.
    echo 3. WhatsApp, MixNet y las llamadas telefónicas quedan 100%% activas.
    echo.
) else (
    echo.
    echo [AVISO] No se pudo crear el acceso directo automáticamente.
    echo Puedes copiar manualmente el archivo "start-hidden.vbs" a:
    echo %STARTUP_FOLDER%
    echo.
)

pause
