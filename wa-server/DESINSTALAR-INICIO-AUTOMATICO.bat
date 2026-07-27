@echo off
REM ============================================================
REM  JJ Paper - Quitar el arranque automatico del servidor
REM  Clic derecho -> "Ejecutar como administrador".
REM  El servidor sigue pudiendose prender a mano con START-SERVIDOR.bat
REM ============================================================
title JJ Paper - Quitar inicio automatico

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo  [!] Ejecutalo como ADMINISTRADOR.
  pause
  exit /b 1
)

schtasks /Delete /TN "JJPaperServidor" /F
echo.
echo  Arranque automatico retirado.
echo  Para prender el servidor: doble clic a START-SERVIDOR.bat
echo.
pause
