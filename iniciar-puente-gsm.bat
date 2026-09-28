@echo off
chcp 65001 >nul
title JJ Paper — Puente GSM Móvil USB (Windows 7 / Headset)
color 0A

echo ======================================================================
echo           JJ PAPER — PUENTE GSM MOVIL POR CABLE USB ($0)
echo ======================================================================
echo.
echo [1/3] Verificando entorno Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] No se encontro Node.js en el sistema.
    echo Por favor instala Node.js para continuar.
    pause
    exit /b 1
)

echo [2/3] Verificando directorio de herramientas...
if not exist "tools\adb" (
    mkdir "tools\adb"
)

echo [3/3] Iniciando Puente GSM en puerto 8789...
echo.
echo ----------------------------------------------------------------------
echo  INSTRUCCIONES PARA LLAMAR CON TU CELULAR DESDE LA PC:
echo  1. Conecta tu celular Android a la PC con un cable USB.
echo  2. En el celular activa: Ajustes -> Opciones de desarrollador ->
echo     "Depuracion por USB".
echo  3. En JJ Paper abre el "Marcador Telefonico" (Boton verde o Alt+P).
echo  4. Haz clic en "Llamar con Celular USB" y habla desde tu Headset!
echo ----------------------------------------------------------------------
echo.

if exist "scripts\gsm-bridge.cjs" (
    node scripts\gsm-bridge.cjs
) else (
    node wa-server\gsm-bridge.cjs
)

pause
