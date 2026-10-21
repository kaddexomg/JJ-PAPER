@echo off
title JJ Paper - Instalar Inicio Automatico y Tarea 8:00 AM
cd /d "%~dp0"

echo ============================================================
echo   JJ PAPER -- INSTALADOR DE AUTO-ARRANQUE PUENTE MIXNET
echo   - Ejecucion diaria automatica a las 8:00 AM
echo   - Ejecucion automatica al encender la PC / Iniciar Sesion
echo   - Arranque inmediato del servicio
echo ============================================================
echo.

set SCRIPT_PATH=%~dp0start-hidden.vbs

echo [1/3] Registrando Tarea Programada en Windows (Diaria 8:00 AM)...
schtasks /create /tn "JJPaper_MixNet_Bridge_8AM" /tr "wscript.exe \"%SCRIPT_PATH%\"" /sc daily /st 08:00 /f /rl highest >nul 2>&1
if not errorlevel 1 (
  echo       [OK] Tarea diaria de las 8:00 AM registrada exitosamente.
) else (
  echo       [i] Se registro con permisos de usuario estandar.
  schtasks /create /tn "JJPaper_MixNet_Bridge_8AM" /tr "wscript.exe \"%SCRIPT_PATH%\"" /sc daily /st 08:00 /f >nul 2>&1
)

echo [2/3] Registrando Tarea Programada al Iniciar Sesion (On Logon)...
schtasks /create /tn "JJPaper_MixNet_Bridge_Logon" /tr "wscript.exe \"%SCRIPT_PATH%\"" /sc onlogon /f /rl highest >nul 2>&1
if not errorlevel 1 (
  echo       [OK] Tarea de inicio de sesion registrada exitosamente.
) else (
  schtasks /create /tn "JJPaper_MixNet_Bridge_Logon" /tr "wscript.exe \"%SCRIPT_PATH%\"" /sc onlogon /f >nul 2>&1
)

echo [3/3] Registrando enlace en carpeta de Inicio de Windows (shell:startup)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Startup', 'Puente-MixNet.lnk')); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%SCRIPT_PATH%\"'; $s.WorkingDirectory = '%~dp0'; $s.Save()" >nul 2>&1

echo.
echo ============================================================
echo   LANZANDO EL PUENTE DE INMEDIATO EN SEGUNDO PLANO...
echo ============================================================
wscript "%SCRIPT_PATH%"
ping -n 3 127.0.0.1 >nul

netstat -ano | findstr ":8790" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo  [OK] EL PUENTE YA QUEDO CORRIENDO EN SEGUNDO PLANO (PUERTO 8790).
  echo  Y quedo programado para ejecutarse TODOS LOS DIAS A LAS 8:00 AM
  echo  y cada vez que se encienda la computadora.
) else (
  echo.
  echo  [OK] Instalacion completada. El puente se esta iniciando.
)

echo.
echo Presiona cualquier tecla para finalizar...
pause >nul
exit /b 0
