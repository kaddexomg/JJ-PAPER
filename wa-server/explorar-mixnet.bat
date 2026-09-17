@echo off
chcp 65001 >nul
title JJ Paper - Explorador de datos MixNet
echo.
echo ========================================================
echo    EXPLORADOR DE DATOS MIXNET  (solo lectura)
echo ========================================================
echo.
echo  Buscando Node.js instalado...
echo.

REM 1) ¿Node esta en el PATH?
where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE=node"
  goto RUN
)

REM 2) Rutas comunes de instalacion (x64, x86, portable)
set "NODE="
for %%p in (
  "%ProgramFiles%\nodejs\node.exe"
  "%ProgramFiles(x86)%\nodejs\node.exe"
  "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  "%APPDATA%\npm\node.exe"
  "%USERPROFILE%\nodejs\node.exe"
  "%USERPROFILE%\AppData\Roaming\npm\node.exe"
  "C:\nodejs\node.exe"
  "C:\node\node.exe"
  "C:\Program Files\nodejs\node.exe"
  "C:\Program Files (x86)\nodejs\node.exe"
  "D:\nodejs\node.exe"
  "D:\node\node.exe"
  "D:\Program Files\nodejs\node.exe"
  "C:\Archivos de Programa\nodejs\node.exe"
) do (
  if exist %%p set "NODE=%%~p"
)
if defined NODE goto RUN

REM 3) Busqueda amplia en el disco C: (puede tardar unos minutos la 1a vez)
echo  No esta en las rutas comunes. Buscando en todo el disco C: ...
echo  (Esto puede tardar; no cierres esta ventana)
for /f "delims=" %%f in ('where /R "C:\" node.exe 2^>nul') do (
  set "NODE=%%f"
  goto RUN
)
for /f "delims=" %%f in ('dir /s /b "C:\node.exe" 2^>nul') do (
  set "NODE=%%f"
  goto RUN
)

REM 4) Si aun no se encontro, probar el lanzador de npm/npx
if not exist "%NODE%" set "NODE="
where npx >nul 2>nul
if %errorlevel%==0 (
  echo  Se encontro herramientas Node (npx). Intentando localizar node.exe...
  for /f "delims=" %%f in ('where npx 2^>nul') do set "NPXDIR=%%~dpf"
  if exist "%NPXDIR%node.exe" set "NODE=%NPXDIR%node.exe"
)
if defined NODE goto RUN

echo.
echo  [ERROR] No se encontro Node.js en ninguna ubicacion.
echo.
echo  Para ejecutar este script se necesita Node.js (v13 o superior).
echo  Puedes instalarlo desde:  https://nodejs.org/
echo  (Elige "Windows Installer .msi", instala aceptando las opciones
echo   por defecto, cierra y abre esta ventana, y vuelve a probar).
echo.
echo  - O -  si sabes la carpeta exacta donde esta instalado Node,
echo  edita este archivo y pon en la linea de abajo SX:
echo    set "NODE=C:\ruta\exacta\a\node.exe"
echo.
pause
exit /b 1

:RUN
echo.
echo  Node encontrado: %NODE%
echo.
"%NODE%" "%~dp0explorar-mixnet.cjs" %*
echo.
echo --------------------------------------------------------
echo  Terminado. Los reportes estan junto a este archivo:
echo    reporte_mixnet.txt
echo    reporte_mixnet.json
echo.
pause
