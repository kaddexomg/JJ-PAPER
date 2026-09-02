@echo off
cd /d "%~dp0"
echo EJECUTANDO AUDITORIA DE PRODUCTOS MIXNET...
echo Por favor, espera mientras escaneo todas las tablas...
node auditor-mixnet.cjs
echo.
echo Proceso terminado. Revisa el archivo auditoria-productos.txt
pause