@echo off
title JJ Paper - Monitor de Cuotas & Optimizador
cd /d "%~dp0"

echo ============================================================
echo   JJ Paper - Monitor de Cuotas, Trafico y Optimizador
echo ============================================================
echo.

set SERVER_IP=192.168.0.172
set URL=http://%SERVER_IP%:8787/admin/monitor.html

REM 1. Verificar si esta PC es el servidor dedicado (puerto 8786 activo localmente)
netstat -ano | findstr ":8786" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Servidor wa-server detectado en ejecucion local.
    set URL=http://localhost:8787/admin/monitor.html
) else (
    echo [INFO] Conectando al servidor JJ Paper en la red local (%SERVER_IP%:8787)...
)

REM Intentar abrir en modo aplicacion nativa de escritorio (sin marco de navegador)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=%URL%
    goto done
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app=%URL%
    goto done
)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%URL%
    goto done
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=%URL%
    goto done
)

REM Fallback al navegador predeterminado
start %URL%

:done
echo [OK] Monitor iniciado exitosamente.
timeout /t 2 >nul
exit
