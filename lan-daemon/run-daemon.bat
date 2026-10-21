@echo off
REM ============================================================
REM  JJ Paper - Demonio LAN de Sincronizacion MixNet ERP
REM  - Sincroniza DBF <-> Supabase 24/7 sin tocar WhatsApp
REM  - Relanza automaticamente ante caidas
REM  - Candado en puerto 8790
REM ============================================================
cd /d "%~dp0"

set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;C:\Windows\System32;C:\Windows;%PATH%"

set "NODE_BIN=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE_BIN=C:\Program Files\nodejs\node.exe"
if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_BIN=C:\Program Files (x86)\nodejs\node.exe"

if not exist "%~dp0logs" mkdir "%~dp0logs"
set "LOGFILE=%~dp0logs\daemon.log"

:loop
REM Rotacion simple si el log supera los 5 MB
if exist "%LOGFILE%" (
  for %%F in ("%LOGFILE%") do (
    if %%~zF GTR 5242880 (
      del "%~dp0logs\daemon.log.old" 2>nul
      ren "%LOGFILE%" daemon.log.old 2>nul
    )
  )
)

REM Candado: si el puerto 8790 ya esta escuchando, salir sin duplicar
netstat -ano | findstr /R ":8790 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [%date% %time%] [PUENTE] Otra instancia activa confirmada (puerto 8790). Saliendo. >> "%LOGFILE%"
  exit /b 0
)

echo [%date% %time%] [PUENTE] Iniciando demonio de sincronizacion MixNet... >> "%LOGFILE%"
"%NODE_BIN%" "%~dp0daemon.js" >> "%LOGFILE%" 2>&1
set CODE=%errorlevel%

echo [%date% %time%] [PUENTE] Demonio finalizo con codigo %CODE% >> "%LOGFILE%"

REM Si se pidio detener limpiamente (codigo 2), salir
if "%CODE%"=="2" exit /b 0

REM Relanzar en 5 segundos
echo [%date% %time%] [PUENTE] Relanzando en 5 segundos... >> "%LOGFILE%"
ping -n 6 127.0.0.1 >nul
goto loop
