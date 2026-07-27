@echo off
REM ============================================================
REM  JJ Paper - Instalar el servidor como TAREA DE WINDOWS
REM
REM  Que hace: el servidor arranca SOLO al prender la PC, sin que
REM  nadie tenga que hacer doble clic ni dejar una ventana abierta.
REM  Si se cae, Windows lo vuelve a levantar.
REM
REM  Se ejecuta UNA SOLA VEZ, en la PC donde vive el servidor.
REM  Clic derecho -> "Ejecutar como administrador".
REM
REM  Para quitarlo:  DESINSTALAR-INICIO-AUTOMATICO.bat
REM ============================================================
title JJ Paper - Instalar inicio automatico
cd /d "%~dp0"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo.
  echo  [!] Falta ejecutarlo como ADMINISTRADOR.
  echo      Cierra esta ventana, haz clic derecho en el archivo
  echo      y elige "Ejecutar como administrador".
  echo.
  pause
  exit /b 1
)

set TAREA=JJPaperServidor

echo.
echo  Instalando la tarea "%TAREA%"...
echo  Carpeta del servidor: %~dp0
echo.

schtasks /Query /TN "%TAREA%" >nul 2>&1
if "%errorlevel%"=="0" (
  echo  Ya existia: se reemplaza con la configuracion actual.
  schtasks /Delete /TN "%TAREA%" /F >nul 2>&1
)

REM /RU SYSTEM no sirve aqui: Baileys guarda la sesion en el perfil del usuario
REM y el servidor debe correr con la misma cuenta que uso para vincular el QR.
schtasks /Create ^
  /TN "%TAREA%" ^
  /TR "\"%~dp0START-SERVIDOR.bat\"" ^
  /SC ONLOGON ^
  /RL HIGHEST ^
  /F

if not "%errorlevel%"=="0" (
  echo.
  echo  [!] No se pudo crear la tarea. Revisa el mensaje de arriba.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo   LISTO. El servidor arrancara solo al iniciar sesion en Windows.
echo  ============================================
echo.
echo   Para prenderlo AHORA sin reiniciar:
echo      schtasks /Run /TN "%TAREA%"
echo.
echo   Para ver si esta corriendo:
echo      schtasks /Query /TN "%TAREA%"
echo.
echo   Los registros quedan en:  %~dp0logs\server.log
echo.
pause
