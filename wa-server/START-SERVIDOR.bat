@echo off
REM ============================================================
REM  JJ Paper - Lanzador del Servidor en Segundo Plano
REM  Inicia el servidor de forma independiente y silenciosa.
REM  - Si cierras esta ventana, la terminal o Antigravity:
REM    EL SERVIDOR SEGUIRA CORRIENDO EN SEGUNDO PLANO.
REM ============================================================
title JJ Paper - Servidor
cd /d "%~dp0"

REM 1. Desactivar QuickEdit para evitar bloqueos por clic
reg add "HKCU\Console" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\Console\JJ Paper - Servidor" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1

REM 2. Verificar si ya esta activo (puerto candado 8786)
set IS_RUNNING=0
set SERVER_PID=
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8786" ^| findstr "LISTENING"') do (
  set IS_RUNNING=1
  set SERVER_PID=%%P
)

if "%IS_RUNNING%"=="1" goto already_running

REM 3. No esta corriendo -> Iniciar en segundo plano
echo ============================================================
echo   JJ PAPER -- INICIANDO SERVIDOR EN SEGUNDO PLANO
echo ============================================================
echo.
echo  Lanzando supervisor independiente silencioso...
wscript start-hidden.vbs

echo  Esperando confirmacion de enlace...
ping -n 4 127.0.0.1 >nul

REM Verificar nuevamente
set IS_RUNNING=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8786" ^| findstr "LISTENING"') do (
  set IS_RUNNING=1
  set SERVER_PID=%%P
)

echo.
if "%IS_RUNNING%"=="1" (
  goto started_ok
) else (
  echo  [i] El servidor esta terminando de inicializar en segundo plano.
  echo  Puedes verificar su progreso en cualquier momento con:
  echo  ESTADO-SERVIDOR.bat
  echo.
  ping -n 5 127.0.0.1 >nul
  exit /b 0
)

:already_running
echo ============================================================
echo      JJ PAPER -- SERVIDOR ACTIVO EN SEGUNDO PLANO
echo ============================================================
echo.
echo  [ESTADO]  🟢 SERVIDOR EN LINEA (Activo en segundo plano)
echo  [PID]     Proceso Node.js: %SERVER_PID%
goto show_menu

:started_ok
echo ============================================================
echo   🟢 SERVIDOR INICIADO EN SEGUNDO PLANO CON EXITO!
echo ============================================================
echo.
echo  [PID] Proceso Node.js: %SERVER_PID%
echo.
echo  ============================================================
echo   IMPORTANTE:
echo   El servidor corre como un proceso independiente en Windows.
echo   Puedes CERRAR esta ventana, cerrar la terminal o Antigravity:
echo   EL SERVIDOR SEGUIRA OPERANDO EN SEGUNDO PLANO SIN INTERRUPCION.
echo  ============================================================
echo.

:show_menu
echo ------------------------------------------------------------
echo  Opciones:
echo   [L] Ver registros en vivo (Live Log)
echo   [R] Reiniciar servidor
echo   [D] Detener servidor
echo   [S] Salir (Cerrar ventana - el servidor sigue corriendo)
echo ------------------------------------------------------------
echo  Esta ventana se cerrara automaticamente en 8 segundos
echo  dejando el servidor funcionando en segundo plano.
echo.
choice /C LRDS /N /T 8 /D S /M "Selecciona una tecla [L / R / D / S]: "
set CODE=%errorlevel%

if "%CODE%"=="1" goto view_log
if "%CODE%"=="2" goto restart_server
if "%CODE%"=="3" goto stop_server
if "%CODE%"=="4" exit /b 0
exit /b 0

:view_log
cls
echo ============================================================
echo   VISOR DE REGISTROS EN VIVO (logs\wa-server.log)
echo   Puedes cerrar esta ventana cuando quieras con la X:
echo   EL SERVIDOR SEGUIRA FUNCIONANDO EN SEGUNDO PLANO.
echo ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path 'logs\wa-server.log' -Tail 50 -Wait"
exit /b 0

:restart_server
call REINICIAR-SERVIDOR.bat
exit /b 0

:stop_server
call DETENER-SERVIDOR.bat
exit /b 0
