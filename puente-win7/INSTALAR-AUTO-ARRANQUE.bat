@echo off
title JJ PAPER -- Configurar Auto-Arranque del Puente (Windows 7)
color 0a
cls

echo ====================================================================
echo    JJ PAPER -- INSTALADOR DE ARRANQUE AUTOMATICO (WINDOWS 7)
echo ====================================================================
echo.
echo  Configurando inicio automatico al encender la PC...
echo.

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if not exist "%STARTUP_DIR%" (
    color 0c
    echo [ERROR] No se pudo localizar la carpeta de Inicio de Windows.
    pause
    exit /b 1
)

set "SHORTCUT_VBS=%STARTUP_DIR%\IniciarPuenteMixNet.vbs"
set "TARGET_BAT=%~dp0INICIAR-PUENTE.bat"

(
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo WshShell.Run chr^(34^) ^& "%TARGET_BAT%" ^& chr^(34^), 1, False
) > "%SHORTCUT_VBS%"

if exist "%SHORTCUT_VBS%" (
    echo ====================================================================
    echo  [EXITO] AUTO-ARRANQUE CONFIGURADO CORRECTAMENTE
    echo ====================================================================
    echo  Cada vez que inicies sesion en esta PC con Windows 7,
    echo  el puente se encendera automaticamente para sincronizar
    echo  cotizaciones y pedidos con JJ Paper.
    echo ====================================================================
) else (
    echo [ERROR] No se pudo crear el acceso directo de arranque.
)

echo.
pause
