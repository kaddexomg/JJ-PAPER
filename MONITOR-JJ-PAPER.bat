@echo off
title JJ Paper - Monitor de Cuotas & Optimizador
cd /d "%~dp0"

echo ============================================================
echo   JJ Paper - Monitor de Cuotas, Trafico y Optimizador
echo ============================================================
echo.

REM 1. Verificar si el puerto 8786 (wa-server) esta respondiendo
netstat -ano | findstr ":8786" >nul
if %errorlevel% neq 0 (
    echo [INFO] El servidor local wa-server no esta activo.
    echo [INFO] Iniciando wa-server en segundo plano para acceso PostgreSQL...
    if exist "wa-server\start-wa.vbs" (
        wscript "wa-server\start-wa.vbs"
    ) else if exist "start-wa.vbs" (
        wscript "start-wa.vbs"
    ) else (
        start "" /b cmd /c "cd wa-server && node src/index.js"
    )
    timeout /t 2 /nobreak >nul
) else (
    echo [OK] Servidor wa-server detectado en ejecucion.
)

echo.
echo [INFO] Abriendo Dashboard de Monitoreo...

set URL=http://localhost:8787/admin/monitor.html

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
