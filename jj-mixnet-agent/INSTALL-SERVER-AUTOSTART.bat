@echo off
title Instalar JJ-MIXNET-AGENT en Inicio Automatico de Windows
color 0B

echo ======================================================================
echo    JJ Paper — Instalador de Inicio Automatico en Servidor MixNet
echo ======================================================================
echo.

set "TARGET_DIR=%~dp0"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\JJ-MIXNET-AGENT.lnk"

echo Registrando acceso directo en:
echo %STARTUP_DIR%
echo.

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_DIR%start-hidden.vbs'; $s.WorkingDirectory = '%TARGET_DIR%'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
  echo [EXITO] Acceso directo creado correctamente.
  echo El Agente de MixNet iniciara automaticamente cada vez que encienda este servidor.
) else (
  echo [ERROR] No se pudo crear el acceso directo en Startup.
)

echo.
pause
