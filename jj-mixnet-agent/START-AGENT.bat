@echo off
title JJ-MIXNET-AGENT — Demonio Autonomo de Sincronizacion MixNet ERP
color 0A

cd /d "%~dp0"
if not exist "%~dp0logs" mkdir "%~dp0logs"
set "LOGFILE=%~dp0logs\agent.log"

:LOOP
echo [%date% %time%] [INICIO] Arrancando agente MixNet... >> "%LOGFILE%"
if exist "%~dp0node.exe" (
  "%~dp0node.exe" agent.js >> "%LOGFILE%" 2>&1
) else (
  node agent.js >> "%LOGFILE%" 2>&1
)

echo [%date% %time%] [ALERTA] El proceso del agente finalizo. Reiniciando en 3 segundos... >> "%LOGFILE%"
ping -n 4 127.0.0.1 >nul
goto LOOP
