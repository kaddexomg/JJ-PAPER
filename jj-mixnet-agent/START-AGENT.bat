@echo off
title JJ-MIXNET-AGENT — Demonio Autonomo de Sincronizacion MixNet ERP
cd /d "%~dp0"
set "PATH=C:\Users\Supervisor\AppData\Local\Python\bin;C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;C:\Program Files\Git\cmd;C:\Windows\System32;C:\Windows;%PATH%"
set "GIT_TERMINAL_PROMPT=0"
set "SUPABASE_URL_CORE=http://100.89.82.36"

set "NODE_BIN=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE_BIN=C:\Program Files\nodejs\node.exe"

if not exist "%~dp0logs" mkdir "%~dp0logs"
set "LOGFILE=%~dp0logs\agent.log"

:LOOP
echo [%date% %time%] [GIT] Sincronizando con repositorio oficial... >> "%LOGFILE%" 2>&1
git -c core.askPass= fetch origin main --quiet >> "%LOGFILE%" 2>&1
git -c core.askPass= reset --hard origin/main --quiet >> "%LOGFILE%" 2>&1

echo [%date% %time%] [INICIO] Arrancando agente MixNet Silencioso con "%NODE_BIN%"... >> "%LOGFILE%" 2>&1
"%NODE_BIN%" agent.js >> "%LOGFILE%" 2>&1
set CODE=%errorlevel%

echo [%date% %time%] [ALERTA] El proceso del agente finalizo con codigo %CODE%. Reiniciando en 5s... >> "%LOGFILE%" 2>&1

ping -n 6 127.0.0.1 >nul
goto LOOP
