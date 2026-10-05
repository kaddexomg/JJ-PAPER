@echo off
rem ====================================================================
rem JJ PAPER -- COPIAR PUENTE AUTONOMO WIN7 A UN PENDRIVE USB
rem ====================================================================
title JJ PAPER -- Exportar Puente Windows 7 a Pendrive
color 0b
cls

echo ====================================================================
echo    JJ PAPER -- EXPORTAR PUENTE AUTONOMO A PENDRIVE USB
echo ====================================================================
echo.
echo  Conecta tu memoria USB (Pendrive) en esta laptop.
echo.

set /p DRIVE_LETTER="Ingresa la letra de tu pendrive (por ejemplo E, F, G, D): "

if "%DRIVE_LETTER%"=="" (
    echo [ERROR] No ingresaste ninguna letra.
    pause
    exit /b 1
)

:: Limpiar espacios o dos puntos
set "DRIVE_LETTER=%DRIVE_LETTER:~0,1%"
set "DEST_DIR=%DRIVE_LETTER%:\JJ-PAPER-PUENTE"

echo.
echo  Destino: %DEST_DIR%
echo  Copiando puente autónomo ultra-ligero...
echo.

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

xcopy "%~dp0puente-win7\*" "%DEST_DIR%\" /E /I /Y /Q

if %errorlevel%==0 (
    echo.
    echo ====================================================================
    echo  [EXITO] PUENTE AUTONOMO COPIADO AL PENDRIVE CON EXITO
    echo ====================================================================
    echo.
    echo  Ahora en la PC con Windows 7:
    echo  1. Desconecta el pendrive y conectalo a la PC Windows 7 (COBRANZA).
    echo  2. Abre la carpeta JJ-PAPER-PUENTE (o copiala al Escritorio).
    echo  3. Haz doble clic en: INICIAR-PUENTE.bat
    echo.
    echo  El puente detectara M:\comp01 y comenzara a sincronizar
    echo  cotizaciones, pedidos y correlativos en ambos sentidos.
    echo ====================================================================
) else (
    echo.
    echo [ERROR] Hubo un problema al copiar. Verifica que la letra sea correcta.
)

pause
