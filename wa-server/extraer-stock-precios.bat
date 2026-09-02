@echo off
echo =======================================================
echo    JJ PAPER - EXTRACTOR DE STOCK Y PRECIOS REALES
echo =======================================================
echo.
echo Escaneando el servidor en busca del stock y precios...
echo.
node extraer-stock-precios.cjs
echo.
echo Presiona cualquier tecla para salir...
pause > nul
