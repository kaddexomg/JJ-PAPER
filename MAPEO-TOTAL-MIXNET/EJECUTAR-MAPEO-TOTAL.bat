@echo off
chcp 65001 >nul
title JJ Paper - Mapeador Total de Directorios y Bases de Datos
color 0b
cls

echo ====================================================================
echo    JJ PAPER -- MAPEO EXHAUSTIVO DE TODA LA UNIDAD Y ARCHIVOS
echo    (100%% Seguro - Solo Lectura - No Modifica Ningun Archivo)
echo ====================================================================
echo.
echo  Buscando Node.js en esta maquina...
echo.

cd /d "%~dp0"
set "NODE_CMD="

where node >nul 2>nul
if %errorlevel%==0 (
    set "NODE_CMD=node"
    goto :RUN_MAPPER
)

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files\nodejs\node.exe"
    goto :RUN_MAPPER
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files (x86)\nodejs\node.exe"
    goto :RUN_MAPPER
)
if exist "C:\nodejs\node.exe" (
    set "NODE_CMD=C:\nodejs\node.exe"
    goto :RUN_MAPPER
)
if exist "%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe" (
    set "NODE_CMD=%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe"
    goto :RUN_MAPPER
)
if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
    goto :RUN_MAPPER
)

echo [AVISO] Node.js no esta en el PATH directo. Buscando en rutas del sistema...
for /f "delims=" %%f in ('where /R "C:\" node.exe 2^>nul') do (
    set "NODE_CMD=%%f"
    goto :RUN_MAPPER
)

echo [ERROR] No se pudo encontrar Node.js en esta PC.
echo Instala Node.js v13 o copia node.exe directamente en esta carpeta.
pause
exit /b 1

:RUN_MAPPER
echo [OK] Node detectado: %NODE_CMD%
echo.
echo Iniciando mapeo integral de cada archivo y carpeta en unidades M:, P:, C:, D:...
echo Se catalogaran todos los formatos (.DBF, .NTX, .INI, .DAT, .PRG, .CSV, etc.)
echo y se inspeccionaran las matrices de permisos de usuarios.
echo.

"%NODE_CMD%" "%~dp0mapeador-exhaustivo.cjs"

echo.
echo ====================================================================
echo  Mapeo completado.
echo  Se han generado los reportes con el inventario completo:
echo    - MAPA_TOTAL_DIRECTORIOS.txt  (Resumen legible y descriptivo)
echo    - MAPA_TOTAL_DIRECTORIOS.json (Estructura tecnica completa)
echo ====================================================================
echo.
pause
