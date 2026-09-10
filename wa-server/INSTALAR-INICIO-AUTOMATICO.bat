@echo off
REM ============================================================
REM  JJ Paper - Instalar Inicio Automatico en Segundo Plano
REM
REM  Que hace:
REM  1. Configura el arranque automatico al encender la PC / iniciar sesion.
REM  2. Usa start-hidden.vbs para que NO aparezca NINGUNA ventana negra.
REM  3. Funciona en Windows 7, 10 y 11 con unidades de red mapeadas (M:, P:).
REM  4. Inicia el servidor de inmediato en segundo plano.
REM ============================================================
title JJ Paper - Instalar Inicio Automatico
cd /d "%~dp0"

echo ============================================================
echo   JJ PAPER -- CONFIGURADOR DE ARRANQUE AUTOMATICO SILENCIOSO
echo ============================================================
echo.

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_TARGET=%STARTUP_DIR%\JJPaperServidor.vbs
set TAREA=JJPaperServidor

echo  1. Configurando arranque silencioso en Carpeta de Inicio de Windows...
echo  Ruta de inicio: %STARTUP_DIR%

REM Crear archivo .vbs puente en la carpeta Startup
echo ' Lanzador de inicio JJ Paper > "%VBS_TARGET%"
echo Set WshShell = CreateObject("WScript.Shell") >> "%VBS_TARGET%"
echo WshShell.CurrentDirectory = "%~dp0" >> "%VBS_TARGET%"
echo WshShell.Run Chr(34) ^& "%~dp0start-hidden.vbs" ^& Chr(34), 0, False >> "%VBS_TARGET%"
echo Set WshShell = Nothing >> "%VBS_TARGET%"

if exist "%VBS_TARGET%" (
  echo  [OK] Acceso directo silencioso creado en carpeta de inicio.
) else (
  echo  [!] Advertencia: no se pudo escribir en la carpeta de inicio.
)

echo.
echo  2. Verificando tarea programada de respaldo...
net session >nul 2>&1
if "%errorlevel%"=="0" (
  schtasks /Delete /TN "%TAREA%" /F >nul 2>&1
  schtasks /Create ^
    /TN "%TAREA%" ^
    /TR "wscript.exe \"%~dp0start-hidden.vbs\"" ^
    /SC ONLOGON ^
    /RL HIGHEST ^
    /F >nul 2>&1
  if "%errorlevel%"=="0" (
    echo  [OK] Tarea programada de Windows creada con privilegios elevados.
  )
) else (
  echo  [i] Tarea de inicio configurada a nivel de usuario (100%% funcional sin requerir Admin).
)

echo.
echo  3. Iniciando el servidor AHORA en segundo plano...
wscript start-hidden.vbs

timeout /t 3 /nobreak >nul

echo.
echo ============================================================
echo   INSTALACION COMPLETADA CON EXITO
echo ============================================================
echo.
echo   * El servidor ya se encuentra corriendo en segundo plano.
echo   * Cada vez que se encienda la PC, arrancara automaticamente sin ventana negra.
echo   * Para revisar su estado o registros, haz doble clic en:
echo     ESTADO-SERVIDOR.bat
echo   * Para detenerlo cuando lo necesites, haz doble clic en:
echo     DETENER-SERVIDOR.bat
echo.
pause
