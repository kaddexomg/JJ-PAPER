@echo off
REM ============================================================
REM  JJ Paper - Servidor (WhatsApp + tasas + correo + conteo)
REM  Doble clic para PRENDER el servidor. Deja esta ventana abierta.
REM  - Desde el panel de admin puedes REINICIAR (relanza aqui solo)
REM    o DETENER (esta ventana se cierra).
REM ============================================================
title JJ Paper - Servidor
cd /d "%~dp0"

:loop
echo.
echo [%date% %time%] Verificando conexion y ruta de MixNet...
node auto-detect-mixnet.js
echo.
echo [%date% %time%] Iniciando servidor JJ Paper...
node src/index.js

REM Codigo 3 = Ya hay una instancia corriendo en el sistema
if "%errorlevel%"=="3" (
  echo.
  echo ============================================================
  echo [INFO] El servidor JJ Paper YA SE ENCUENTRA ACTIVO en el sistema.
  echo        (Hay un proceso en ejecucion protegiendo los sockets).
  echo        El sistema esta 100%% operativo en http://localhost:8787
  echo ============================================================
  echo Presiona una tecla para cerrar esta ventana...
  pause >nul
  exit /b 0
)

REM Codigo 2 = DETENER pedido desde el panel -> no relanzar
if "%errorlevel%"=="2" goto end

echo.
echo [%date% %time%] El servidor se detuvo (codigo %errorlevel%). Relanzando en 3s...
echo    (para apagarlo del todo cierra esta ventana o usa DETENER en el panel)
timeout /t 3 /nobreak >nul
goto loop

:end
echo.
echo [%date% %time%] Servidor DETENIDO desde el panel. Puedes cerrar esta ventana.
echo    Para volver a prenderlo: doble clic a START-SERVIDOR.bat
pause
