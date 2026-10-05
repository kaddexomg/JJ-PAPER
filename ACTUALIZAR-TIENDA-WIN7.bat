@echo off
rem ====================================================================
rem JJ PAPER -- ACTUALIZADOR Y RESTAURADOR DE NODO TIENDA (WINDOWS 7)
rem ====================================================================
title JJ PAPER -- Actualizar / Reparar Nodo Tienda Windows 7
color 0e
cls

echo ====================================================================
echo    JJ PAPER -- ACTUALIZAR / RESTAURAR NODO TIENDA WINDOWS 7
echo ====================================================================
echo.

echo  [1/3] Cerrando procesos previos en puertos 3300 y 3301...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3300"') do (
    echo   - Cerrando PID %%p
    taskkill /F /PID %%p >nul 2>nul
)
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3301"') do (
    taskkill /F /PID %%p >nul 2>nul
)

echo.
echo  [2/3] Intentando actualizar archivos desde repositorio si Git esta presente...
where git >nul 2>nul
if %errorlevel%==0 (
    git pull origin main
) else (
    echo   (Git no detectado en PATH, usando archivos locales)
)

echo.
echo  [3/3] Listo para arrancar.
echo.
echo  Presiona cualquier tecla para iniciar el micro-nodo ahora mismo...
pause >nul

call "%~dp0INICIAR-PANEL-TIENDA.bat"
