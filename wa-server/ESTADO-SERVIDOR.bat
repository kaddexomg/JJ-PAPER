@echo off
title JJ Paper - Estado del Servidor
cd /d "%~dp0"

:menu
cls
echo ============================================================
echo      JJ PAPER -- MONITOR Y ESTADO DEL SERVIDOR LOCAL
echo ============================================================
echo.

REM 1. Verificar si el puerto del candado (8786) o LAN (8787) esta en escucha
set IS_RUNNING=0
set SERVER_PID=
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8786" ^| findstr "LISTENING"') do (
  set IS_RUNNING=1
  set SERVER_PID=%%P
)

if "%IS_RUNNING%"=="1" (
  echo  [ESTADO]  [ACTIVO] SERVIDOR EN LINEA (Activo en segundo plano)
  echo  [PID]     Proceso Node.js: %SERVER_PID%
  REM Consultar consumo de memoria
  for /f "tokens=1,2,3,4,5" %%A in ('tasklist /FI "PID eq %SERVER_PID%" /NH 2^>nul') do (
    echo  [MEMORIA] Uso de RAM: %%E
  )
) else (
  echo  [ESTADO]  [DETENIDO] SERVIDOR DETENIDO / APAGADO
)

echo.
echo ------------------------------------------------------------
echo  CONEXION Y ACCESO EN RED LOCAL:
echo ------------------------------------------------------------
REM Obtener IP local recomendada
set LOCAL_IP=127.0.0.1
for /f "tokens=4" %%I in ('route print 0.0.0.0 ^| findstr " 0.0.0.0"') do (
  set LOCAL_IP=%%I
)
echo  * Monitor Web LAN:    http://%LOCAL_IP%:8787/lan/monitor
echo  * Pedidos MixNet LAN: http://%LOCAL_IP%:8787/lan/mixnet/pedidos
echo  * Cotizaciones LAN:   http://%LOCAL_IP%:8787/lan/mixnet/cotizaciones
echo  * Conteo Offline:     http://%LOCAL_IP%:8787/lan/start

echo.
echo ------------------------------------------------------------
echo  ESTADO DEL PUENTE MIXNET:
echo ------------------------------------------------------------
if exist "mixnet-config.json" (
  type mixnet-config.json
) else (
  echo  [!] Aun no se ha generado mixnet-config.json
)

echo.
echo ------------------------------------------------------------
echo  ULTIMAS LINEAS DEL REGISTRO (logs\wa-server.log):
echo ------------------------------------------------------------
if exist "logs\wa-server.log" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path 'logs\wa-server.log' -Tail 15 -ErrorAction SilentlyContinue"
) else (
  echo  (El archivo de log logs\wa-server.log todavia no existe)
)

echo.
echo ============================================================
echo   ACCIONES DISPONIBLES:
echo ============================================================
echo   [I] Iniciar Servidor en segundo plano (si esta detenido)
echo   [R] Reiniciar Servidor
echo   [D] Detener Servidor
echo   [M] Abrir Monitor Web en Navegador
echo   [L] Ver registros en tiempo real (Live Log)
echo   [Enter] Salir
echo.
set /p OPC="Selecciona una opcion: "

if /i "%OPC%"=="I" (
  echo.
  echo Iniciando servidor en segundo plano...
  wscript start-hidden.vbs
  timeout /t 3 /nobreak >nul
  goto menu
)

if /i "%OPC%"=="R" (
  echo.
  echo Reiniciando servidor...
  call REINICIAR-SERVIDOR.bat
  timeout /t 3 /nobreak >nul
  goto menu
)

if /i "%OPC%"=="D" (
  echo.
  echo Deteniendo servidor...
  call DETENER-SERVIDOR.bat
  timeout /t 2 /nobreak >nul
  goto menu
)

if /i "%OPC%"=="M" (
  start http://localhost:8787/lan/monitor
  goto menu
)

if /i "%OPC%"=="L" (
  cls
  echo Presiona Ctrl+C para salir del visor de log en vivo.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path 'logs\wa-server.log' -Tail 50 -Wait"
  goto menu
)

exit /b 0
