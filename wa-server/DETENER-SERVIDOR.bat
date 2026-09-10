@echo off
title JJ Paper - Detener Servidor
cd /d "%~dp0"

echo ============================================================
echo   JJ PAPER -- DETENIENDO SERVIDOR LOCAL Y SERVICIOS
echo ============================================================
echo.

REM 1. Buscar PID escuchando en el candado (8786)
set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8786" ^| findstr "LISTENING"') do (
  set FOUND=1
  echo Finalizando proceso de servidor con PID %%P...
  taskkill /F /PID %%P >nul 2>&1
)

REM 2. Detener procesos node adicionales que ejecuten index.js
wmic process where "name='node.exe' and commandline like '%%src/index.js%%'" call terminate >nul 2>&1

echo.
if "%FOUND%"=="1" (
  echo  [OK] El servidor ha sido detenido correctamente.
) else (
  echo  [i] No habia ninguna instancia activa en el puerto 8786.
)
echo.
timeout /t 2 /nobreak >nul
