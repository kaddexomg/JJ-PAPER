@echo off
title JJ Paper C.A. — Aplicativo de Escritorio
color 0B
cd /d "%~dp0"

echo ========================================================================
echo        JJ PAPER C.A. — SISTEMA ADMINISTRATIVO Y PUNTO DE VENTA
echo           Compatible con Windows 7, Windows 10 y Windows 11
echo ========================================================================
echo.

:: 1. Verificar si Node.js está disponible para el panel local MixNet (puerto 3300)
where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [1/3] Iniciando servicio local MixNet ERP y Copiloto en segundo plano...
    if exist "mixnet-ai-panel\server.js" (
        start "" /b wscript.exe "mixnet-ai-panel\start-hidden.vbs" >nul 2>nul
        if %errorlevel% neq 0 (
            start "JJ-Paper-Server" /min node mixnet-ai-panel\server.js
        )
    )
) else (
    echo [1/3] Modo Cliente Liviano (Sin servidor Node local en esta PC).
)

:: 2. Determinar la URL de la aplicación
set APP_URL=http://localhost:3300
netstat -ano | findstr ":3300" >nul 2>nul
if %errorlevel% neq 0 (
    :: Si el puerto local 3300 no está arriba aún, usar el portal Cloudflare / Nube
    set APP_URL=https://jj-paper.pages.dev/admin/
)

:: 3. Localizar navegador Chromium para ejecutar en MODO APLICACIÓN (Sin barra de direcciones)
echo [2/3] Configurando ventana de aplicacion de escritorio nativa...
set BROWSER_EXE=

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Supermium\chrome.exe" (
    set "BROWSER_EXE=%ProgramFiles%\Supermium\chrome.exe"
) else if exist "%LocalAppData%\Supermium\chrome.exe" (
    set "BROWSER_EXE=%LocalAppData%\Supermium\chrome.exe"
) else if exist "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    set "BROWSER_EXE=%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
) else if exist "%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    set "BROWSER_EXE=%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe"
)

echo.
echo [3/3] Abriendo JJ Paper Desktop...
if defined BROWSER_EXE (
    start "" "%BROWSER_EXE%" --app="%APP_URL%" --window-size=1366,768 --disable-infobars
) else (
    start "" "%APP_URL%"
)

echo.
echo ========================================================================
echo   [LISTO] JJ Paper esta ejecutandose como aplicativo de escritorio.
echo   Puede cerrar esta ventana o se cerrara automaticamente en 3 segundos.
echo ========================================================================
timeout /t 3 >nul
exit
