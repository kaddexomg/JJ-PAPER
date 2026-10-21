@echo off
title JJ Paper - Puente MixNet ERP
cd /d "%~dp0"

set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;C:\Windows\System32;C:\Windows;%PATH%"

set "NODE_BIN=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE_BIN=C:\Program Files\nodejs\node.exe"
if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_BIN=C:\Program Files (x86)\nodejs\node.exe"

echo ============================================================
echo   JJ PAPER -- PUENTE DE SINCRONIZACION ERP MIXNET
echo   - Sincroniza pedidos y cotizaciones con M:\MIX11\comp01
echo   - Respeta correlativos soberanos y calcula IVA Exento
echo ============================================================
echo.

"%NODE_BIN%" daemon.js
if errorlevel 1 (
  echo.
  echo [ERROR] Hubo un error al ejecutar el puente. Revisa el mensaje arriba.
  pause
)
