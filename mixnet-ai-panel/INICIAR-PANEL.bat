@echo off
rem ====================================================================
rem JJ PAPER -- Suite Ejecutiva MixNet ERP con Copiloto IA (Windows 7)
rem ====================================================================
title JJ PAPER -- Panel Ejecutivo MixNet AI & Agente
color 0b
cls

echo ====================================================================
echo    JJ PAPER -- CONTROL TOTAL MIXNET ERP & ENTORNO AGENTICO IA
echo ====================================================================
echo.
echo  Buscando Node.js en esta PC con Windows 7...
echo.

set "NODE="

where node >nul 2>nul
if %errorlevel%==0 (
    set "NODE=node"
    goto DETECTADO
)

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE=C:\Program Files\nodejs\node.exe"
    goto DETECTADO
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE=C:\Program Files (x86)\nodejs\node.exe"
    goto DETECTADO
)
if exist "C:\nodejs\node.exe" (
    set "NODE=C:\nodejs\node.exe"
    goto DETECTADO
)
if exist "C:\node\node.exe" (
    set "NODE=C:\node\node.exe"
    goto DETECTADO
)
if exist "%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe" (
    set "NODE=%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe"
    goto DETECTADO
)

echo [ERROR] No se encontro Node.js en este equipo.
echo Por favor asegurese de tener Node.js instalado (v13 o superior).
echo.
pause
exit /b 1

:DETECTADO
echo [OK] Node.js detectado: %NODE%
echo.

cd /d "%~dp0"

echo  Liberando puertos 3300 y 3301 antes de arrancar...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3300"') do (
    echo   [AVISO] Cerrando proceso previo en puerto 3300 (PID %%p)...
    taskkill /F /PID %%p >nul 2>nul
)
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3301"') do (
    taskkill /F /PID %%p >nul 2>nul
)
timeout /t 1 /nobreak >nul

echo.
echo  Iniciando Antigravity Micro-Node...
echo  Abriendo navegador en http://localhost:3300...
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3300"

:loop
cd /d "%~dp0"
"%NODE%" "server.js"
set "ERR=%errorlevel%"

echo.
echo ====================================================================
echo  [ALERTA] El proceso del micro-nodo se detuvo (Codigo: %ERR%).
echo  Liberando puerto y reiniciando en 3 segundos...
echo ====================================================================
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3300"') do taskkill /F /PID %%p >nul 2>nul
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3301"') do taskkill /F /PID %%p >nul 2>nul
timeout /t 3 >nul
goto loop
