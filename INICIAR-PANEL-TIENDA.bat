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
    goto EJECUTAR
)

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE=C:\Program Files\nodejs\node.exe"
    goto EJECUTAR
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE=C:\Program Files (x86)\nodejs\node.exe"
    goto EJECUTAR
)
if exist "C:\nodejs\node.exe" (
    set "NODE=C:\nodejs\node.exe"
    goto EJECUTAR
)
if exist "C:\node\node.exe" (
    set "NODE=C:\node\node.exe"
    goto EJECUTAR
)

echo [ERROR] No se encontro Node.js en este equipo.
echo Por favor instala Node.js v13 para ejecutar el panel.
echo.
pause
exit /b 1

:EJECUTAR
echo [OK] Node.js detectado: %NODE%
echo.
echo  Abriendo panel de control en tu navegador (http://localhost:3300)...
echo  Los pedidos de la nube caeran automaticamente en C:\pedidos
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3300"

:loop
"%NODE%" "%~dp0mixnet-ai-panel\server.js"
echo.
echo [ALERTA] El panel se cerro inesperadamente. Reiniciando en 3 segundos...
timeout /t 3 >nul
goto loop
