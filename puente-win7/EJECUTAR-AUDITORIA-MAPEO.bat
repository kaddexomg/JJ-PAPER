@echo off
chcp 65001 >nul
title JJ Paper - Auditor y Cartografo Maestro MixNet ERP
color 0e
cls

echo ====================================================================
echo    JJ PAPER -- AUDITOR Y CARTOGRAFO MAESTRO DE MIXNET ERP
echo    (100%% Seguro - Solo Lectura - No Modifica Ningun Archivo)
echo ====================================================================
echo.
echo  Buscando Node.js en esta PC con Windows 7...
echo.

cd /d "%~dp0"
set "NODE_CMD="

where node >nul 2>nul
if %errorlevel%==0 (
    set "NODE_CMD=node"
    goto :RUN_AUDIT
)

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files\nodejs\node.exe"
    goto :RUN_AUDIT
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files (x86)\nodejs\node.exe"
    goto :RUN_AUDIT
)
if exist "C:\nodejs\node.exe" (
    set "NODE_CMD=C:\nodejs\node.exe"
    goto :RUN_AUDIT
)
if exist "%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe" (
    set "NODE_CMD=%USERPROFILE%\AppData\Local\Programs\nodejs\node.exe"
    goto :RUN_AUDIT
)
if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
    goto :RUN_AUDIT
)

echo [ERROR] No se encontro Node.js en la PC.
echo Instala Node.js o copia node.exe en esta carpeta.
pause
exit /b 1

:RUN_AUDIT
echo [OK] Node detectado: %NODE_CMD%
echo.
echo Iniciando auditoria profunda de unidades M:, P:, C:, D:...
echo Esto revisara todas las tablas DBF, campos y matriz de 200+ permisos.
echo.

"%NODE_CMD%" "%~dp0auditor-cartografo-mixnet.cjs"

echo.
echo ====================================================================
echo  Auditoria finalizada.
echo  Se han creado dos archivos con el mapa completo en esta carpeta:
echo    - AUDITORIA_MIXNET_MAPA.txt
echo    - AUDITORIA_MIXNET_MAPA.json
echo ====================================================================
echo.
pause
