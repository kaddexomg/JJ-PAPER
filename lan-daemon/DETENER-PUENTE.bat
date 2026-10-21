@echo off
title JJ Paper - Detener Puente MixNet
cd /d "%~dp0"

echo ============================================================
echo   JJ PAPER -- DETENIENDO PUENTE MIXNET
echo ============================================================
echo.

REM 1. Buscar PID escuchando en el puerto 8790
set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8790" ^| findstr "LISTENING"') do (
  set FOUND=1
  echo Finalizando proceso con PID %%P...
  taskkill /F /PID %%P >nul 2>&1
)

REM 2. Detener supervisor
wmic process where "name='cmd.exe' and commandline like '%%run-daemon.bat%%'" call terminate >nul 2>&1

REM 3. Detener node daemon.js
wmic process where "name='node.exe' and commandline like '%%daemon.js%%'" call terminate >nul 2>&1

echo.
if "%FOUND%"=="1" (
  echo  [OK] El puente MixNet ha sido detenido correctamente.
) else (
  echo  [i] No habia ninguna instancia activa en el puerto 8790.
)
ping -n 3 127.0.0.1 >nul
exit /b 0
