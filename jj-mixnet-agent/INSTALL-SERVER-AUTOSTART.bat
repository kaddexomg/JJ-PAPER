@echo off
title Instalar JJ-MIXNET-AGENT en Inicio Automatico de Windows
color 0B

echo ======================================================================
echo    JJ Paper — Instalador de Inicio Automatico en Servidor MixNet
echo ======================================================================
echo.

set "RAW_DIR=%~dp0"
if "%RAW_DIR:~-1%"=="\" set "RAW_DIR=%RAW_DIR:~0,-1%"

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\JJ-MIXNET-AGENT.lnk"

echo Registrando acceso directo en:
echo %STARTUP_DIR%
echo.

powershell -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut([System.Environment]::ExpandEnvironmentVariables('%%APPDATA%%\Microsoft\Windows\Start Menu\Programs\Startup\JJ-MIXNET-AGENT.lnk')); $s.TargetPath = '%RAW_DIR%\start-hidden.vbs'; $s.WorkingDirectory = '%RAW_DIR%'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
  echo [EXITO] Acceso directo creado correctamente.
  echo El Agente de MixNet iniciara automaticamente cada vez que encienda este servidor.
) else (
  echo [ERROR] No se pudo crear el acceso directo en Startup.
)

echo.
timeout /t 4 >nul
