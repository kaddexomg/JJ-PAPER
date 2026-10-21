@echo off
title Instalar Demonio Maestro JJ-MIXNET-AGENT en Servidor Central
color 0A

echo ======================================================================
echo    JJ Paper — Instalador de Demonio de Red en Servidor MixNet
echo ======================================================================
echo.
echo Este instalador configura el Puente MixNet para ejecutarse de forma
echo permanente en el SERVIDOR CENTRAL (192.168.0.185).
echo.
echo  - Se ejecuta como Servicio/Tarea Programada al encender el equipo (ONSTART)
echo  - Corre en segundo plano (invisible) sin depender de que un usuario inicie sesion
echo  - Si el proceso finaliza o el servidor reinicia, se recupera automaticamente
echo  - Las PCs de la tienda pueden apagarse sin afectar la sincronizacion
echo ======================================================================
echo.

set "AGENT_DIR=%~dp0"
set "NODE_PATH=%AGENT_DIR%node.exe"

if not exist "%NODE_PATH%" (
  set "NODE_PATH=node"
)

echo [1/3] Registrando Tarea Programada de Arranque (ONSTART / SYSTEM)...
schtasks /create /tn "JJ-MIXNET-DAEMON" /tr "\"%NODE_PATH%\" \"%AGENT_DIR%agent.js\"" /sc onstart /ru "SYSTEM" /f >nul 2>&1
if %errorlevel% equ 0 (
  echo  [OK] Tarea programada 'JJ-MIXNET-DAEMON' registrada al encendido del sistema.
) else (
  echo  [i] Registrando como tarea de usuario interactivo...
  schtasks /create /tn "JJ-MIXNET-DAEMON" /tr "\"%NODE_PATH%\" \"%AGENT_DIR%agent.js\"" /sc onlogon /f >nul 2>&1
)

echo.
echo [2/3] Registrando acceso directo en Inicio de Windows (Startup Fallback)...
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\JJ-MIXNET-AGENT.lnk"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%AGENT_DIR%start-hidden.vbs'; $s.WorkingDirectory = '%AGENT_DIR%'; $s.Save()" >nul 2>&1
if exist "%SHORTCUT_PATH%" (
  echo  [OK] Acceso directo en Startup creado correctamente.
)

echo.
echo [3/3] Iniciando agente inmediatamente en segundo plano...
wscript.exe "%AGENT_DIR%start-hidden.vbs"
timeout /t 2 /nobreak >nul

echo.
echo ======================================================================
echo   [EXITO] Demonio MixNet instalado y en ejecucion permanente.
echo   La sincronizacion con el VPS (166.0.112.247) ahora es autonoma.
echo ======================================================================
echo.
pause
