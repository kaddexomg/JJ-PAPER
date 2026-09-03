@echo off
echo.
echo  ============================================================
echo    JJ PAPER - EXPORTAR PRODUCTOS Y PRECIOS (USD)
echo  ============================================================
echo.
echo  Leyendo datos del servidor MixNet...
echo.
node extraer-stock-precios.cjs
echo.
echo  Presiona cualquier tecla para salir...
pause > nul
