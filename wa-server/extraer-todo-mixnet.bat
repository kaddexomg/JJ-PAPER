@echo off
chcp 65001 >nul 2>nul
title JJ PAPER - Extractor TOTAL MixNet v3.0
color 0A

echo.
echo ========================================================
echo   JJ PAPER -- EXTRACTOR MIXNET v3.0
echo ========================================================
echo.
echo   Extrae de MixNet:
echo     - CLIENTES (nombre, RIF, email, vendedor, etc.)
echo     - PRODUCTOS (codigo, precios, existencia, familia)
echo     - MAESTRAS (vendedores, familias, proveedores)
echo.
echo   SOLO LEE. No modifica nada de MixNet.
echo   Los archivos CSV se guardan en el Escritorio.
echo.
echo ========================================================
echo.

echo  Buscando Node.js...
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE=node"
  goto FOUND
)

set "NODE="
for %%p in (
  "%ProgramFiles%\nodejs\node.exe"
  "%ProgramFiles(x86)%\nodejs\node.exe"
  "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  "C:\nodejs\node.exe"
  "C:\node\node.exe"
  "C:\Program Files\nodejs\node.exe"
  "C:\Program Files (x86)\nodejs\node.exe"
  "D:\nodejs\node.exe"
  "D:\Program Files\nodejs\node.exe"
) do (
  if exist %%p set "NODE=%%~p"
)
if defined NODE goto FOUND

echo.
echo  ============================================
echo   [ERROR] No se encontro Node.js
echo   Instale desde: https://nodejs.org/
echo  ============================================
echo.
pause
exit /b 1

:FOUND
echo  Node encontrado: %NODE%
echo.
echo  Ejecutando extraccion...
echo.
echo --------------------------------------------------------
echo.

"%NODE%" "%~dp0extraer-todo-mixnet.cjs"

echo.
echo ========================================================
echo   LISTO. Revisa tu Escritorio para los archivos:
echo     - jj_clientes_*.csv    (clientes con email/vendedor)
echo     - jj_productos_*.csv   (productos con precios/stock)
echo     - jj_maestras_*.csv    (vendedores, familias, etc.)
echo     - jj_resumen_*.txt     (resumen de la extraccion)
echo ========================================================
echo.
echo  Presiona cualquier tecla para cerrar...
pause >nul
