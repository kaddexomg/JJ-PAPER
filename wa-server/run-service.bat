@echo off
REM ============================================================
REM  JJ Paper - Supervisor de Servicio en Segundo Plano
REM  Ejecutado de forma invisible por start-hidden.vbs o al iniciar PC.
REM  - Redirige toda la salida a logs\wa-server.log
REM  - Relanza automaticamente ante caidas o reinicios
REM  - Respeta senales de parada limpia (exit code 2 o 3)
REM ============================================================
cd /d "%~dp0"

if not exist logs mkdir logs

set LOGFILE=logs\wa-server.log

:loop
REM Rotacion simple si el log supera los 10 MB (10485760 bytes)
if exist %LOGFILE% (
  for %%F in (%LOGFILE%) do (
    if %%~zF GTR 10485760 (
      del "%LOGFILE%.old" 2>nul
      ren "%LOGFILE%" wa-server.log.old 2>nul
    )
  )
)

REM Verificando entorno de MixNet...
echo [%date% %time%] [SUPERVISOR] Verificando entorno de MixNet... >> "%LOGFILE%"
node auto-detect-mixnet.js >> "%LOGFILE%" 2>&1

echo [%date% %time%] [SUPERVISOR] Iniciando servidor JJ Paper... >> "%LOGFILE%"
node src/index.js >> "%LOGFILE%" 2>&1
set CODE=%errorlevel%

echo [%date% %time%] [SUPERVISOR] Servidor finalizo con codigo %CODE% >> "%LOGFILE%"

REM Codigo 2 = DETENER solicitado limpiamente desde el panel o usuario
if "%CODE%"=="2" (
  echo [%date% %time%] [SUPERVISOR] Parada intencional recibida. Finalizando servicio. >> "%LOGFILE%"
  exit /b 0
)

REM Codigo 3 = Candado activo o socket en liberacion
if "%CODE%"=="3" (
  echo [%date% %time%] [SUPERVISOR] Candado activo o socket en liberacion (puerto 8786). Reintentando en 6 segundos... >> "%LOGFILE%"
  ping -n 7 127.0.0.1 >nul
  goto loop
)

REM Si el servidor se cayo o se pidio reiniciar (codigo 0 o 1), auto-relanzar de inmediato
echo [%date% %time%] [SUPERVISOR] Relanzando servidor automaticamente en 2 segundos... >> "%LOGFILE%"
ping -n 3 127.0.0.1 >nul
goto loop
