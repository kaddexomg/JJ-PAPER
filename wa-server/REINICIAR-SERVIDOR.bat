@echo off
title JJ Paper - Reiniciar Servidor
cd /d "%~dp0"

echo ============================================================
echo   JJ Paper - Reinicio Limpio del Servidor Local
echo ============================================================
echo.
echo [%date% %time%] Deteniendo servidor...
call DETENER-SERVIDOR.bat
timeout /t 2 /nobreak >nul

echo [%date% %time%] Arrancando servidor en segundo plano...
wscript start-hidden.vbs

echo.
echo  [OK] El servidor ha sido reiniciado en segundo plano.
echo  Puedes consultar su estado con ESTADO-SERVIDOR.bat
echo.
timeout /t 3 /nobreak >nul
