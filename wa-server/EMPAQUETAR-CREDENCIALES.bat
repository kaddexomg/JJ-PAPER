@echo off
REM ============================================================
REM  JJ Paper — EMPAQUETAR CREDENCIALES Y SESIONES
REM  Comprime .env y la carpeta sessions/ en un único archivo ZIP
REM  para pasarlo a la otra PC por WhatsApp, Gmail, Drive, etc.
REM ============================================================
title JJ Paper — Empaquetar Credenciales
cd /d "%~dp0"
color 0B

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║   JJ PAPER — EMPAQUETADOR DE CREDENCIALES Y SESIONES    ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

set "ZIP_OUT=%USERPROFILE%\Desktop\wa-server-credenciales.zip"
set "TEMP_PACK=%TEMP%\jjp_pack_%RANDOM%"

if not exist ".env" (
    echo  [!] ERROR: No se encontro el archivo .env en esta carpeta.
    pause
    exit /b 1
)

echo  [1/3] Preparando archivos para empaquetar...
if exist "%TEMP_PACK%" rmdir /s /q "%TEMP_PACK%" >nul 2>&1
mkdir "%TEMP_PACK%" >nul 2>&1

copy /y ".env" "%TEMP_PACK%\.env" >nul 2>&1
if exist "sessions" (
    xcopy "sessions" "%TEMP_PACK%\sessions\" /e /i /y /q >nul 2>&1
    echo        ✓ Copiado .env y sesiones de WhatsApp
) else (
    echo        ✓ Copiado .env (no habia carpeta sessions)
)

echo.
echo  [2/3] Comprimiendo en archivo ZIP...
if exist "%ZIP_OUT%" del /f /q "%ZIP_OUT%" >nul 2>&1

powershell -Command "Compress-Archive -Path '%TEMP_PACK%\*' -DestinationPath '%ZIP_OUT%' -Force"

if exist "%ZIP_OUT%" (
    echo        ✓ ZIP creado exitosamente en tu Escritorio:
    echo          %ZIP_OUT%
) else (
    echo  [!] Error al crear el archivo ZIP.
    pause
    exit /b 1
)

rmdir /s /q "%TEMP_PACK%" >nul 2>&1

echo.
echo  [3/3] Abriendo el archivo en el Escritorio...
explorer /select,"%ZIP_OUT%"

echo.
echo  ══════════════════════════════════════════════════════════
echo   LISTO. El archivo "wa-server-credenciales.zip" mide menos de 1 MB.
echo  ══════════════════════════════════════════════════════════
echo.
echo   COMO PASARLO A LA OTRA PC (Sin pendrive y sin red local):
echo.
echo   1. WhatsApp Web / Telegram:
echo      Enviate el ZIP a tu propio chat ("Tú" o "Mensajes guardados").
echo      En la otra PC abres WhatsApp Web y lo descargas.
echo.
echo   2. Correo Gmail / Google Drive:
echo      Enviate un correo a ti mismo adjuntando el ZIP.
echo.
echo   3. Wormhole (Enlace directo seguro en 5 segundos):
echo      Entra en https://wormhole.app sueltas el ZIP, copias el link
echo      y lo abres en el navegador de la otra PC.
echo.
echo  ══════════════════════════════════════════════════════════
echo.
pause
