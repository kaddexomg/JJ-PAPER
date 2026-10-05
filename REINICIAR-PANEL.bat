@echo off
title JJ Paper - Liberar Puerto y Reiniciar Panel
color 0b
echo ====================================================================
echo    JJ PAPER - REINICIAR PANEL AGENTICO Y LIBERAR PUERTO 3300
echo ====================================================================
echo.
echo Cerrando cualquier instancia previa de Node en el puerto 3300...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :3300 ^| findstr LISTENING') do (
    echo [OK] Matando proceso anterior con PID: %%p
    taskkill /F /PID %%p >nul 2>nul
)
echo.
echo Puerto 3300 liberado con exito.
echo Iniciando el panel ahora...
echo.
timeout /t 1 /nobreak >nul
call "%~dp0INICIAR-PANEL-TIENDA.bat"
