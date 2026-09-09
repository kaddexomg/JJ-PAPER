@echo off
title JJ Paper - Reiniciar Servidor
cd /d "%~dp0\wa-server"

echo ============================================================
echo   JJ Paper - Reinicio Limpio del Servidor Local
echo ============================================================
echo.
echo [%date% %time%] Cerrando procesos anteriores de node.exe...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [%date% %time%] Arrancando servidor con el codigo mas reciente...
start "JJ Paper - Servidor" START-SERVIDOR.bat
echo.
echo [OK] El servidor se ha reiniciado limpiamente.
timeout /t 3 /nobreak >nul
