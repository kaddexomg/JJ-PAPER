@echo off
REM ============================================================
REM  JJ Paper - Supervisor de Servicio PC Cobranza (Windows 7)
REM  Ejecutado de forma invisible por start-hidden-cobranza.vbs
REM  - Redirige logs a logs\cobranza-bridge.log
REM  - Auto-reinicia ante caidas o cortes de red
REM ============================================================
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%PATH%

if not exist logs mkdir logs

set LOGFILE=logs\cobranza-bridge.log

:loop
REM Rotacion simple si supera 5 MB
if exist "%LOGFILE%" (
  for %%F in ("%LOGFILE%") do (
    if %%~zF GTR 5242880 (
      del "%LOGFILE%.old" 2>nul
      ren "%LOGFILE%" cobranza-bridge.log.old 2>nul
    )
  )
)

echo [%date% %time%] [SUPERVISOR] Iniciando Agente Puente Cobranza... >> "%LOGFILE%"
node cobranza-bridge.cjs >> "%LOGFILE%" 2>&1
set CODE=%errorlevel%

echo [%date% %time%] [SUPERVISOR] Finalizo con codigo %CODE%. Reiniciando en 5s... >> "%LOGFILE%"
ping -n 6 127.0.0.1 >nul
goto loop
