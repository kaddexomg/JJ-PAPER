@echo off
REM ============================================================
REM  JJ Paper - Servidor (WhatsApp + tasas + correo + conteo)
REM  Doble clic para PRENDER el servidor. Deja esta ventana abierta.
REM  - Desde el panel de admin puedes REINICIAR (relanza aqui solo)
REM    o DETENER (esta ventana se cierra).
REM ============================================================
title JJ Paper - Servidor
cd /d "%~dp0"

REM ============================================================
REM  DESACTIVAR QUICKEDIT EN WINDOWS:
REM  Evita terminantemente que clics o selecciones del mouse
REM  congelen el proceso de Node.js en la consola.
REM ============================================================
reg add "HKCU\Console" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\Console\JJ Paper - Servidor" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1
if exist disable-quickedit.ps1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File disable-quickedit.ps1 >nul 2>&1
)

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
  echo  [AVISO] Ya hay una instancia del servidor en ejecucion.
  echo ============================================================
  echo  1. Si deseas CERRAR la instancia previa y REINICIAR:
  echo     Escribe R y presiona Enter.
  echo  2. Para salir dejando el servidor actual corriendo:
  echo     Presiona Enter.
  echo.
  set /p ACT="Opcion [R = Reiniciar / Enter = Salir]: "
  if /i "%ACT%"=="R" (
    echo.
    echo [%date% %time%] Cerrando procesos node previos...
    taskkill /F /IM node.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
    goto loop
  )
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
