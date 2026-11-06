@echo off
title JJ-MIXNET-AGENT — Demonio Autonomo de Sincronizacion MixNet ERP
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;C:\Program Files\Git\cmd;C:\Windows\System32;C:\Windows;%PATH%"
set "GIT_TERMINAL_PROMPT=0"

set "NODE_BIN=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE_BIN=C:\Program Files\nodejs\node.exe"

if not exist "%~dp0logs" mkdir "%~dp0logs"
set "LOGFILE=%~dp0logs\agent.log"

:LOOP
echo [%date% %time%] [GIT] Verificando actualizaciones de repositorio...
git -c core.askPass= pull origin main --no-rebase >nul 2>&1

echo [%date% %time%] [INICIO] Arrancando agente MixNet con "%NODE_BIN%"...
"%NODE_BIN%" agent.js
set CODE=%errorlevel%

echo [%date% %time%] [ALERTA] El proceso del agente finalizo con codigo %CODE%. Reiniciando en 5s...

ping -n 6 127.0.0.1 >nul
goto LOOP
