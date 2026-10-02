@echo off
title JJ Paper - Panel Ejecutivo MixNet AI (Salaz Suite)
color 0B
cd /d "%~dp0"

echo ========================================================================
echo    JJ PAPER - MONITOR Y CONTROL EJECUTIVO MIXNET ERP CON IA (SALAZ)
echo ========================================================================
echo.
echo  Verificando entorno Node.js en Windows...

where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] No se encontro Node.js instalado o en el PATH del sistema.
    echo Por favor asegurese de tener Node.js instalado en esta PC.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo  [OK] Version de Node detectada: %NODE_VERSION%
echo  [OK] Iniciando servidor ligero de control en puerto 3300...
echo.

:: Abrir el navegador automaticamente tras 1.5 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3300"

:loop
node server.js
echo.
echo [ALERTA] El servidor se cerro inesperadamente. Reiniciando en 3 segundos...
timeout /t 3 >nul
goto loop
