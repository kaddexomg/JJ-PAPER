@echo off
rem ====================================================================
rem JJ PAPER - Instalador de Auto-Arranque del Puente (Windows 7)
rem Instala el puente en shell:startup para que inicie solo al encender la PC
rem ====================================================================
title JJ PAPER -- Configurar Auto-Arranque en Windows 7
color 0b
cls

echo ====================================================================
echo    JJ PAPER -- CONFIGURADOR DE AUTO-ARRANQUE EN WINDOWS 7
echo ====================================================================
echo.
echo Configurando el puente para que inicie automaticamente de forma invisible
echo cada vez que se encienda esta PC con Windows 7...
echo.

set SCRIPT_DIR=%~dp0
set TARGET_VBS=%SCRIPT_DIR%start-puente-win7.vbs
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_PATH=%STARTUP_FOLDER%\JJ-Paper-Puente-MixNet.lnk

if not exist logs mkdir logs

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 0; $s.Description = 'JJ Paper Puente MixNet ERP'; $s.Save()" 2>nul

if not exist "%SHORTCUT_PATH%" (
    rem Fallback nativo para Windows 7 si powershell da error
    copy /y "%TARGET_VBS%" "%STARTUP_FOLDER%\start-puente-win7.vbs" >nul 2>nul
)

echo.
echo ====================================================================
echo   [OK] ¡PUENTE CONFIGURADO CON AUTO-ARRANQUE EXITOSAMENTE!
echo ====================================================================
echo.
echo  A partir de ahora:
echo  1. Cada vez que se encienda esta PC, el puente arrancara solo en segundo plano.
echo  2. No abrira ventanas negras ni molestara al operador de caja.
echo  3. Todos los pedidos y cotizaciones de JJ Paper caeran solos en:
echo     C:\pedidos\
echo.
echo  Iniciando el servicio ahora mismo...
start wscript.exe "%TARGET_VBS%"

echo.
echo  ¡Listo! Puedes cerrar esta ventana.
echo.
pause
