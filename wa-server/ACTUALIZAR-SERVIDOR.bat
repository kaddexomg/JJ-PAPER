@echo off
title Actualizar Servidor JJ Paper
cd /d "%~dp0"
color 0A

echo ========================================================
echo        ACTUALIZANDO SERVIDOR JJ PAPER (WA-SERVER)
echo ========================================================
echo.

echo 1. Deteniendo proceso en ejecucion...
call DETENER-SERVIDOR.bat >nul 2>&1
timeout /t 2 /nobreak >nul

echo 2. Descargando ultimas mejoras y correcciones desde GitHub...
git pull origin main
if errorlevel 1 (
    echo.
    echo [ERROR] No se pudo descargar la actualizacion de GitHub.
    echo Verifica la conexion a Internet o permisos de Git.
    pause
    exit /b 1
)

echo.
echo 3. Verificando dependencias del servidor...
call npm install --omit=dev --no-audit --no-fund >nul 2>&1

echo.
echo 4. Verificando entorno de MixNet y directorios de sincronizacion...
node auto-detect-mixnet.js

echo.
echo 5. Iniciando servidor en segundo plano...
wscript start-hidden.vbs
timeout /t 3 /nobreak >nul

echo.
echo ========================================================
echo   [EXITO] SERVIDOR JJ PAPER ACTUALIZADO Y REINICIADO
echo ========================================================
echo.
echo Puedes consultar el estado en vivo con ESTADO-SERVIDOR.bat
echo o desde el panel web de JJ Paper.
echo.
pause

