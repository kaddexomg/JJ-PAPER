@echo off
title JJ Paper - Servidor Central
cd /d "%~dp0wa-server"
echo ========================================================
echo    JJ PAPER - SERVIDOR CENTRAL (WHATSAPP + CORREO + CRM)
echo ========================================================
echo.
echo Iniciando servidor de JJ Paper en segundo plano...
start "" wscript.exe start-hidden.vbs
timeout /t 3 /nobreak >nul
echo.
echo [OK] Servidor activo y persistente en segundo plano.
echo      - WhatsApp: Reconectado
echo      - Correo y Campanas: Activo
echo      - Conteo LAN: http://localhost:8787
echo.
echo Puedes cerrar esta ventana cuando quieras.
pause
