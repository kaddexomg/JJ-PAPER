@echo off
REM ============================================================
REM  JJ Paper - Configurador de Acceso Remoto Seguro (PC Supervisor)
REM  Prepara la maquina para control remoto y enlace con la Laptop.
REM ============================================================
title JJ Paper - Enlace Remoto Supervisor
cd /d "%~dp0"

echo ============================================================
echo   JJ PAPER -- CONFIGURACION DE ACCESO REMOTO PARA SUPERVISOR
echo ============================================================
echo.
echo  Este script prepara esta maquina para que el administrador
echo  pueda conectarse desde su Laptop de forma remota, segura y
echo  sin necesidad de abrir puertos en el router.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar-remoto.ps1"

echo.
echo Presiona cualquier tecla para salir...
pause >nul
