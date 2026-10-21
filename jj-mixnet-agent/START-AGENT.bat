@echo off
title JJ-MIXNET-AGENT — Demonio Autonomo de Sincronizacion MixNet ERP
color 0A

cd /d "%~dp0"

echo ======================================================================
echo    JJ Paper — Demonio Autonomo y Guardian de Red MixNet ERP
echo ======================================================================
echo Directorio: %CD%
echo Iniciando agente de sincronizacion y tareas...

:LOOP
if exist "%~dp0node.exe" (
  "%~dp0node.exe" agent.js
) else (
  node agent.js
)
echo.
echo [ALERTA] El proceso del agente finalizo a las %TIME%.
echo Reiniciando automaticamente en 3 segundos...
timeout /t 3 /nobreak >nul
goto LOOP
