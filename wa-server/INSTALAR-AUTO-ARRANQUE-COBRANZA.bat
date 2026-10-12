@echo off
title JJ PAPER -- INSTALADOR DE INICIO AUTOMATICO (PC COBRANZA)
color 0B
cls
echo ========================================================
echo    JJ PAPER - INSTALADOR DE INICIO AUTOMATICO (COBRANZA)
echo    Configura el arranque en segundo plano al encender la PC
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/3] Verificando archivos necesarios...
if not exist "start-hidden-cobranza.vbs" (
    echo [ERROR] No se encontro start-hidden-cobranza.vbs
    pause
    exit /b 1
)

echo [2/3] Creando acceso directo en la carpeta Inicio de Windows...
powershell -NoProfile -Command ^
  "$wsh = New-Object -ComObject WScript.Shell; " ^
  "$startup = [System.Environment]::GetFolderPath('Startup'); " ^
  "$link = $wsh.CreateShortcut(\"$startup\JJ-Paper-Cobranza.lnk\"); " ^
  "$link.TargetPath = 'wscript.exe'; " ^
  "$link.Arguments = '\"%~dp0start-hidden-cobranza.vbs\"'; " ^
  "$link.WorkingDirectory = '%~dp0'; " ^
  "$link.Description = 'Puente MixNet Autonomo JJ Paper'; " ^
  "$link.Save()"

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] No se pudo crear el acceso directo automatico.
    pause
    exit /b 1
)

echo [3/3] Iniciando el servicio ahora mismo en segundo plano...
start wscript.exe "%~dp0start-hidden-cobranza.vbs"

echo.
echo ========================================================
echo   INSTALACION COMPLETADA CON EXITO!
echo   El puente ya esta corriendo de forma 100%% invisible.
echo   Se iniciara automaticamente cada vez que enciendas la PC.
echo ========================================================
echo.
pause
