@echo off
REM ============================================================
REM  JJ Paper — DESEMPAQUETAR CREDENCIALES Y SESIONES
REM  Busca wa-server-credenciales.zip en Descargas o Escritorio
REM  y extrae .env y sessions/ en esta carpeta automáticamente.
REM ============================================================
title JJ Paper — Desempaquetar Credenciales
cd /d "%~dp0"
color 0A

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║  JJ PAPER — DESEMPAQUETADOR DE CREDENCIALES Y SESIONES   ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

set "ZIP_FOUND="

REM 1. Buscar wa-server-completo.zip (incluye node_modules)
if exist "wa-server-completo.zip" set "ZIP_FOUND=%~dp0wa-server-completo.zip"
if not defined ZIP_FOUND if exist "%USERPROFILE%\Downloads\wa-server-completo.zip" set "ZIP_FOUND=%USERPROFILE%\Downloads\wa-server-completo.zip"
if not defined ZIP_FOUND if exist "%USERPROFILE%\Desktop\wa-server-completo.zip" set "ZIP_FOUND=%USERPROFILE%\Desktop\wa-server-completo.zip"

REM 2. Buscar wa-server-credenciales.zip (solo .env y sessions)
if not defined ZIP_FOUND if exist "wa-server-credenciales.zip" set "ZIP_FOUND=%~dp0wa-server-credenciales.zip"
if not defined ZIP_FOUND if exist "%USERPROFILE%\Downloads\wa-server-credenciales.zip" set "ZIP_FOUND=%USERPROFILE%\Downloads\wa-server-credenciales.zip"
if not defined ZIP_FOUND if exist "%USERPROFILE%\Desktop\wa-server-credenciales.zip" set "ZIP_FOUND=%USERPROFILE%\Desktop\wa-server-credenciales.zip"

if not defined ZIP_FOUND (
    echo  [!] No se encontro "wa-server-completo.zip" ni "wa-server-credenciales.zip".
    echo.
    echo      Asegurate de haber descargado el archivo en tu carpeta
    echo      de Descargas, Escritorio o en esta misma carpeta.
    echo.
    echo      O arrastra el archivo ZIP directamente a esta ventana:
    set /p "ZIP_FOUND=     Ruta del archivo ZIP: "
    set "ZIP_FOUND=%ZIP_FOUND:"=%"
)

if not exist "%ZIP_FOUND%" (
    echo.
    echo  [!] El archivo "%ZIP_FOUND%" no existe.
    pause
    exit /b 1
)

echo.
echo  [1/2] Extrayendo archivos desde:
echo        %ZIP_FOUND%
echo.

powershell -Command "Expand-Archive -Path '%ZIP_FOUND%' -DestinationPath '%~dp0' -Force"

echo  [2/2] Verificando instalacion...
if exist ".env" (
    echo        ✓ Archivo .env instalado correctamente
) else (
    echo        ✗ No se encontro .env tras descomprimir
)

if exist "sessions" (
    echo        ✓ Carpeta sessions instalada correctamente
) else (
    echo        ! No se encontro carpeta sessions
)

echo.
echo  ══════════════════════════════════════════════════════════
echo   TODO LISTO. Ya tienes las credenciales en esta PC.
echo  ══════════════════════════════════════════════════════════
echo.
echo   Paso siguiente:
echo   Haz clic derecho en "SETUP-SERVIDOR-JJ.bat"
echo   y selecciona "Ejecutar como administrador".
echo.
pause
