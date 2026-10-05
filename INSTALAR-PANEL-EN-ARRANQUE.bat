@echo off
rem ====================================================================
rem JJ PAPER - Instalador de Auto-Arranque del Panel MixNet AI (Windows 7)
rem ====================================================================
title JJ PAPER -- Configurar Auto-Arranque del Panel en Windows 7
color 0b
cls

echo ====================================================================
echo    JJ PAPER -- CONFIGURAR AUTO-ARRANQUE DEL PANEL EN WINDOWS 7
echo ====================================================================
echo.
echo Configurando para que el servidor del panel inicie automaticamente
echo cada vez que se encienda esta PC con Windows 7...
echo.

set SCRIPT_DIR=%~dp0mixnet-ai-panel\
set TARGET_VBS=%SCRIPT_DIR%start-hidden.vbs
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_PATH=%STARTUP_FOLDER%\JJ-Paper-Panel-MixNet.lnk

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 0; $s.Description = 'JJ Paper Panel MixNet AI'; $s.Save()" 2>nul

if not exist "%SHORTCUT_PATH%" (
    copy /y "%TARGET_VBS%" "%STARTUP_FOLDER%\start-hidden.vbs" >nul 2>nul
)

echo.
echo ====================================================================
echo   [OK] ¡PANEL CONFIGURADO CON AUTO-ARRANQUE EXITOSAMENTE!
echo ====================================================================
echo.
echo  A partir de ahora:
echo  1. Cada vez que se encienda esta PC, el panel arrancara en segundo plano.
echo  2. Siempre podras abrir http://localhost:3300 en tu navegador.
echo  3. Todos los pedidos y cotizaciones de JJ Paper caeran solos en:
echo     C:\pedidos\
echo.
echo  Iniciando el panel ahora mismo...
start wscript.exe "%TARGET_VBS%"
timeout /t 2 /nobreak >nul
start http://localhost:3300

echo.
echo  ¡Listo! Puedes cerrar esta ventana.
echo.
pause
