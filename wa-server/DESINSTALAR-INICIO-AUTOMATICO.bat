@echo off
title JJ Paper - Desinstalar Inicio Automatico
cd /d "%~dp0"

echo ============================================================
echo   JJ PAPER -- QUITAR INICIO AUTOMATICO DEL SERVIDOR
echo ============================================================
echo.

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_TARGET=%STARTUP_DIR%\JJPaperServidor.vbs
set TAREA=JJPaperServidor

if exist "%VBS_TARGET%" (
  del /f /q "%VBS_TARGET%" >nul 2>&1
  echo  [OK] Acceso de inicio retirado de carpeta Startup.
)

schtasks /Delete /TN "%TAREA%" /F >nul 2>&1
if "%errorlevel%"=="0" (
  echo  [OK] Tarea programada de Windows retirada.
)

echo.
echo  [OK] El inicio automatico ha sido completamente removido.
echo  Para prender el servidor manualmente cuando lo desees:
echo    - En segundo plano: wscript start-hidden.vbs
echo    - En ventana visible: START-SERVIDOR.bat
echo.
pause
