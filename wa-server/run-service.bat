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

set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;C:\Windows\System32;C:\Windows;%PATH%"

set "NODE_BIN=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE_BIN=C:\Program Files\nodejs\node.exe"
if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_BIN=C:\Program Files (x86)\nodejs\node.exe"

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

REM Asegurar que la carpeta de pedidos exista y el entorno de MixNet este configurado
echo [%date% %time%] [SUPERVISOR] Verificando entorno de MixNet... >> "%LOGFILE%"
"%NODE_BIN%" auto-detect-mixnet.js >> "%LOGFILE%" 2>&1

echo [%date% %time%] [SUPERVISOR] Iniciando servidor JJ Paper con "%NODE_BIN%"... >> "%LOGFILE%"
"%NODE_BIN%" src/index.js >> "%LOGFILE%" 2>&1
set CODE=%errorlevel%

echo [%date% %time%] [SUPERVISOR] Servidor finalizo con codigo %CODE% >> "%LOGFILE%"

REM Codigo 2 = DETENER solicitado limpiamente desde el panel o usuario
if "%CODE%"=="2" (
  echo [%date% %time%] [SUPERVISOR] Parada intencional recibida. Finalizando servicio. >> "%LOGFILE%"
  exit /b 0
)

REM Codigo 3 = Candado activo (ya hay otra instancia de wa-server corriendo)
if "%CODE%"=="3" (
  echo [%date% %time%] [SUPERVISOR] Candado activo detectado (puerto 8786 ocupado). >> "%LOGFILE%"
  REM Verificar si realmente hay otro proceso escuchando en el puerto mutex 8786
  netstat -ano | findstr /R ":8786 .*LISTENING" >nul 2>&1
  if not errorlevel 1 (
    echo [%date% %time%] [SUPERVISOR] Otra instancia activa confirmada (puerto 8786 en escucha). Saliendo sin duplicar. >> "%LOGFILE%"
    exit /b 0
  )
  REM Si no hay otra instancia activa, el puerto esta liberandose (TIME_WAIT). Reintentar en 4s
  echo [%date% %time%] [SUPERVISOR] No hay otro proceso activo. Puerto en liberacion, reintentando en 4 segundos... >> "%LOGFILE%"
  ping -n 5 127.0.0.1 >nul
  goto loop
)

REM Mantener oculta la carpeta .JJ-PAPER
attrib +h "%~dp0.." >nul 2>&1

REM Si el servidor se cayo o se pidio reiniciar (codigo 0 o 1), auto-relanzar de inmediato
echo [%date% %time%] [SUPERVISOR] Relanzando servidor automaticamente en 2 segundos... >> "%LOGFILE%"
ping -n 3 127.0.0.1 >nul
goto loop
