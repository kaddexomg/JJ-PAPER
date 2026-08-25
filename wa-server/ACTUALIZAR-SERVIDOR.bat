@echo off
title Actualizar Servidor JJ Paper
color 0A
echo ========================================================
echo        ACTUALIZANDO SERVIDOR JJ PAPER (WA-SERVER)
echo ========================================================
echo.
echo Descargando ultimas mejoras y correcciones del repositorio...
git pull
if errorlevel 1 (
    echo.
    echo [AVISO] Si git no esta configurado, copia los archivos modificados.
) else (
    echo.
    echo [OK] Servidor actualizado con exito.
    echo Instalando dependencias nuevas si las hubiere...
    call npm install
)
echo.
echo ========================================================
echo Listo. Ahora puedes ejecutar START-SERVIDOR.bat
echo ========================================================
pause
