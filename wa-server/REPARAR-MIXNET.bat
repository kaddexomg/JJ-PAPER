@echo off
color 0A
title REPARADOR DE PUENTE MIXNET - JJ PAPER
echo ========================================================
echo   INICIANDO REPARACION DE ENLACE DE PEDIDOS A MIXNET
echo ========================================================
echo.
echo Forzando las rutas de sincronizacion hacia M:\comp01...
node fix-puente-mixnet.mjs
echo.
echo [!] IMPORTANTE: Ahora se reiniciara el servidor de JJ Paper
echo para que tome la nueva configuracion y comience a inyectar
echo los pedidos represados hacia MixNet.
echo.
pause
echo Deteniendo procesos node del servidor...
taskkill /F /IM node.exe /T >nul 2>&1
echo.
echo Reiniciando wa-server en 3 segundos...
timeout /t 3 /nobreak >nul
start /min cmd /c "node src/index.js"
echo [OK] El servidor JJ Paper se ha levantado de nuevo en segundo plano.
echo Ya puedes ir a la PC de Facturacion (MixNet) y verificar si llegan los pedidos.
echo.
pause
