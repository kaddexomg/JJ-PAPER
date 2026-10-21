@echo off
REM ============================================================
REM   JJ PAPER — Lanzador Continuo del Demonio LAN MixNet
REM   Reinicia automaticamente si el proceso cae o falla la red.
REM ============================================================
cd /d "%~dp0"
title JJ Paper - LAN Daemon MixNet

if not exist logs mkdir logs
set LOGFILE=logs\daemon.log

echo [%date% %time%] [LAN-DAEMON] Iniciando demonio de sincronizacion MixNet... >> "%LOGFILE%"
echo [%date% %time%] [LAN-DAEMON] Iniciando demonio de sincronizacion MixNet...

:loop
REM Rotacion de log a los 10 MB
if exist "%LOGFILE%" (
  for %%F in ("%LOGFILE%") do (
    if %%~zF GTR 10485760 (
      del "%LOGFILE%.old" 2>nul
      ren "%LOGFILE%" daemon.log.old 2>nul
    )
  )
)

node daemon.js >> "%LOGFILE%" 2>&1
set CODE=%errorlevel%

echo [%date% %time%] [LAN-DAEMON] Proceso finalizo con codigo %CODE%. Reiniciando en 5 segundos... >> "%LOGFILE%"
echo [%date% %time%] [LAN-DAEMON] Proceso finalizo con codigo %CODE%. Reiniciando en 5 segundos...

ping -n 6 127.0.0.1 >nul
goto loop
