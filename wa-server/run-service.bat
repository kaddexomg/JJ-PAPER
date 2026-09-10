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
if exist "%LOGFILE%" (
  for %%F in ("%LOGFILE%") do (
    if %%~zF GTR 10485760 (
      del "%LOGFILE%.old" 2>nul
      ren "%LOGFILE%" wa-server.log.old 2>nul
    )
  )
)

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

REM Codigo 3 = Candado activo (ya hay otra instancia de wa-server corriendo)
if "%CODE%"=="3" (
  echo [%date% %time%] [SUPERVISOR] Otra instancia ya se encuentra activa. Saliendo sin duplicar. >> "%LOGFILE%"
  exit /b 0
)

REM Si el servidor se cayo o se pidio reiniciar (codigo 0 o 1), esperar 5s y relanzar
echo [%date% %time%] [SUPERVISOR] Relanzando servidor en 5 segundos... >> "%LOGFILE%"
timeout /t 5 /nobreak >nul
goto loop
