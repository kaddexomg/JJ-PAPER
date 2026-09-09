@echo off
REM ════════════════════════════════════════════════════════════════
REM  JJ Paper — SETUP COMPLETO DEL SERVIDOR
REM  ────────────────────────────────────────
REM  Este script hace TODO automaticamente:
REM
REM  1. Verifica si la PC es compatible (Windows 10/11)
REM  2. Verifica si Node.js 18+ esta instalado
REM  3. Si no lo tiene, lo descarga e instala automaticamente
REM  4. Verifica si git esta instalado
REM  5. Hace git pull para traer la ultima version del codigo
REM  6. Instala todas las dependencias (npm install + pg)
REM  7. Configura el arranque automatico al encender la PC
REM  8. Verifica que el .env existe con las credenciales
REM  9. Arranca el servidor por primera vez
REM
REM  USO: Doble clic o "Ejecutar como administrador"
REM ════════════════════════════════════════════════════════════════
title JJ Paper — Setup Completo del Servidor
cd /d "%~dp0"
color 0A

set "PASO=0"
set "ERRORES=0"
set "WA_DIR=%~dp0"
set "PROJECT_DIR=%WA_DIR%.."

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║   JJ PAPER C.A. — INSTALADOR AUTOMATICO DEL SERVIDOR   ║
echo  ║         WhatsApp + Email + Campanas + Conteo LAN        ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
echo  Carpeta del servidor: %WA_DIR%
echo  Carpeta del proyecto: %PROJECT_DIR%
echo.
echo  ────────────────────────────────────────────────────────────

REM ════════════════════════════════════════════════════════════════
REM  PASO 1: VERIFICAR SISTEMA OPERATIVO
REM ════════════════════════════════════════════════════════════════
set /a PASO+=1
echo.
echo  [%PASO%/9] Verificando sistema operativo...

for /f "tokens=4-5 delims=[.] " %%i in ('ver') do set OS_VER=%%i.%%j

REM Windows 10 = 10.0, Windows 11 = 10.0 (build >= 22000)
ver | findstr /i "10\." >nul 2>&1
if "%errorlevel%"=="0" (
    echo         ✓ Windows 10/11 detectado — COMPATIBLE
) else (
    ver | findstr /i "6.3" >nul 2>&1
    if "%errorlevel%"=="0" (
        echo         ✓ Windows 8.1 detectado — Compatible con limitaciones
    ) else (
        echo         ✗ Sistema operativo NO compatible
        echo           Se requiere Windows 10 o superior.
        set /a ERRORES+=1
    )
)

REM ════════════════════════════════════════════════════════════════
REM  PASO 2: VERIFICAR NODE.JS
REM ════════════════════════════════════════════════════════════════
set /a PASO+=1
echo.
echo  [%PASO%/9] Verificando Node.js...

set "NODE_OK=0"
set "NODE_INSTALLED=0"

where node >nul 2>&1
if "%errorlevel%"=="0" (
    set "NODE_INSTALLED=1"
    for /f "tokens=1 delims=v" %%v in ('node -v 2^>nul') do set "NODE_RAW=%%v"
    for /f "tokens=1 delims=v." %%m in ('node -v 2^>nul') do set "NODE_MAJOR=%%m"
    REM Limpiar el "v" del inicio
    for /f "tokens=1,2 delims=." %%a in ('node -v 2^>nul') do (
        set "NODE_VER_FULL=%%a.%%b"
        set "NV=%%a"
    )
    node -e "process.exit(parseInt(process.version.slice(1))>=18?0:1)" 2>nul
    if "%errorlevel%"=="0" (
        set "NODE_OK=1"
        for /f %%v in ('node -v 2^>nul') do echo         ✓ Node.js %%v detectado — COMPATIBLE
    ) else (
        for /f %%v in ('node -v 2^>nul') do echo         ✗ Node.js %%v detectado — MUY ANTIGUO ^(se requiere v18+^)
    )
) else (
    echo         ✗ Node.js NO esta instalado
)

REM ════════════════════════════════════════════════════════════════
REM  PASO 3: INSTALAR NODE.JS SI NO ESTA O ES VIEJO
REM ════════════════════════════════════════════════════════════════
set /a PASO+=1

if "%NODE_OK%"=="1" (
    echo.
    echo  [%PASO%/9] Node.js OK — no necesita instalacion
) else (
    echo.
    echo  [%PASO%/9] Descargando e instalando Node.js 20 LTS...
    echo.
    echo         Esto puede tardar unos minutos. NO cierres esta ventana.
    echo.

    REM Verificar si hay permisos de administrador para instalar
    net session >nul 2>&1
    if not "%errorlevel%"=="0" (
        echo         [!] ATENCION: Para instalar Node.js necesitas ejecutar
        echo             este script como ADMINISTRADOR.
        echo.
        echo             Clic derecho en SETUP-SERVIDOR-JJ.bat
        echo             -^> "Ejecutar como administrador"
        echo.
        set /a ERRORES+=1
        goto check_git
    )

    set "NODE_MSI=%TEMP%\node-v20-setup.msi"
    set "NODE_URL=https://nodejs.org/dist/v20.17.0/node-v20.17.0-x64.msi"

    echo         Descargando desde nodejs.org...
    powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_MSI%' -UseBasicParsing }" 2>nul

    if exist "%NODE_MSI%" (
        echo         Instalando Node.js 20 LTS (silencioso)...
        msiexec /i "%NODE_MSI%" /qn /norestart ADDLOCAL=ALL 2>nul
        timeout /t 5 /nobreak >nul

        REM Refrescar PATH del sistema
        for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "PATH=%%B;%PATH%"

        where node >nul 2>&1
        if "%errorlevel%"=="0" (
            for /f %%v in ('node -v 2^>nul') do echo         ✓ Node.js %%v instalado correctamente
            set "NODE_OK=1"
        ) else (
            echo         ✗ La instalacion de Node.js fallo.
            echo           Instala manualmente desde: https://nodejs.org/
            set /a ERRORES+=1
        )

        del "%NODE_MSI%" 2>nul
    ) else (
        echo         ✗ No se pudo descargar Node.js.
        echo           Verifica la conexion a internet e intenta de nuevo.
        echo           O instala manualmente desde: https://nodejs.org/
        set /a ERRORES+=1
    )
)

REM ════════════════════════════════════════════════════════════════
REM  PASO 4: VERIFICAR GIT
REM ════════════════════════════════════════════════════════════════
:check_git
set /a PASO+=1
echo.
echo  [%PASO%/9] Verificando git...

set "GIT_OK=0"
where git >nul 2>&1
if "%errorlevel%"=="0" (
    for /f %%v in ('git --version 2^>nul') do set "GIT_VER=%%v"
    git --version 2>nul | findstr /i "git version" >nul
    if "%errorlevel%"=="0" (
        set "GIT_OK=1"
        for /f "tokens=3" %%v in ('git --version 2^>nul') do echo         ✓ Git %%v detectado
    )
) else (
    echo         ! Git NO esta instalado
    echo           El servidor funcionara pero no podras hacer git pull.
    echo           Puedes instalarlo desde: https://git-scm.com/
)

REM ════════════════════════════════════════════════════════════════
REM  PASO 5: GIT PULL (traer ultima version)
REM ════════════════════════════════════════════════════════════════
set /a PASO+=1
echo.
echo  [%PASO%/9] Actualizando codigo desde el repositorio...

cd /d "%PROJECT_DIR%"

if "%GIT_OK%"=="1" (
    REM Verificar si es un repositorio git
    git rev-parse --is-inside-work-tree >nul 2>&1
    if "%errorlevel%"=="0" (
        echo         Ejecutando git pull origin main...
        git pull origin main 2>&1
        if "%errorlevel%"=="0" (
            echo         ✓ Codigo actualizado a la ultima version
        ) else (
            echo         ! git pull tuvo problemas — el servidor usara la version actual
        )
    ) else (
        echo         ! No es un repositorio git — saltando actualizacion
    )
) else (
    echo         ! Git no disponible — saltando actualizacion
    echo           Copia manualmente la carpeta actualizada.
)

cd /d "%WA_DIR%"

REM ════════════════════════════════════════════════════════════════
REM  PASO 6: INSTALAR DEPENDENCIAS (npm install + pg)
REM ════════════════════════════════════════════════════════════════
set /a PASO+=1
echo.
echo  [%PASO%/9] Instalando dependencias del servidor...

if "%NODE_OK%"=="0" (
    echo         ✗ Node.js no esta disponible — no se pueden instalar dependencias
    set /a ERRORES+=1
    goto check_env
)

cd /d "%WA_DIR%"

echo         Ejecutando npm install...
call npm install --production 2>&1
if "%errorlevel%"=="0" (
    echo         ✓ Dependencias principales instaladas
) else (
    echo         ! npm install tuvo errores — revisa la salida arriba
    set /a ERRORES+=1
)

echo         Instalando dependencia PostgreSQL (pg)...
call npm install pg 2>&1
if "%errorlevel%"=="0" (
    echo         ✓ Modulo pg instalado correctamente
) else (
    echo         ! npm install pg fallo
    set /a ERRORES+=1
)

REM ════════════════════════════════════════════════════════════════
REM  PASO 7: VERIFICAR ARCHIVO .ENV
REM ════════════════════════════════════════════════════════════════
:check_env
set /a PASO+=1
echo.
echo  [%PASO%/9] Verificando credenciales (.env)...

if exist "%WA_DIR%.env" (
    echo         ✓ Archivo .env encontrado

    REM Verificar que las variables criticas existan
    findstr /i "SUPABASE_URL_CORE" "%WA_DIR%.env" >nul 2>&1
    if "%errorlevel%"=="0" (
        echo         ✓ Proyecto A (Core) configurado
    ) else (
        echo         ✗ Falta SUPABASE_URL_CORE
        set /a ERRORES+=1
    )

    findstr /i "SUPABASE_URL_COMM" "%WA_DIR%.env" >nul 2>&1
    if "%errorlevel%"=="0" (
        echo         ✓ Proyecto B (Comunicacion) configurado
    ) else (
        echo         ✗ Falta SUPABASE_URL_COMM
        set /a ERRORES+=1
    )

    findstr /i "GOOGLE_CLIENT_ID" "%WA_DIR%.env" >nul 2>&1
    if "%errorlevel%"=="0" (
        echo         ✓ Google OAuth configurado
    ) else (
        echo         ! Falta GOOGLE_CLIENT_ID — emails no funcionaran
    )
) else (
    echo         ✗ ARCHIVO .env NO ENCONTRADO
    echo.
    echo           El servidor NO puede arrancar sin el archivo .env
    echo           Copia el .env desde la PC principal a:
    echo           %WA_DIR%.env
    echo.
    set /a ERRORES+=1
)

REM ════════════════════════════════════════════════════════════════
REM  PASO 8: CONFIGURAR ARRANQUE AUTOMATICO + VBS DINAMICO
REM ════════════════════════════════════════════════════════════════
set /a PASO+=1
echo.
echo  [%PASO%/9] Configurando arranque automatico al encender la PC...

REM Generar start-wa.vbs dinámico con la ruta actual (no hardcodeada)
echo ' JJ Paper wa-server — lanzador oculto para Windows.> "%WA_DIR%start-wa.vbs"
echo ' Arranca el servidor SIN ventana visible al iniciar sesion.>> "%WA_DIR%start-wa.vbs"
echo ' Generado automaticamente por SETUP-SERVIDOR-JJ.bat>> "%WA_DIR%start-wa.vbs"
echo Set fso = CreateObject("Scripting.FileSystemObject")>> "%WA_DIR%start-wa.vbs"
echo Set sh = CreateObject("WScript.Shell")>> "%WA_DIR%start-wa.vbs"
echo curDir = fso.GetParentFolderName(WScript.ScriptFullName)>> "%WA_DIR%start-wa.vbs"
echo sh.CurrentDirectory = curDir>> "%WA_DIR%start-wa.vbs"
echo sh.Run "cmd /c START-SERVIDOR.bat", 0, False>> "%WA_DIR%start-wa.vbs"

echo         ✓ start-wa.vbs generado dinamicamente (compatible con cualquier carpeta)

REM Verificar permisos de administrador para crear tarea
net session >nul 2>&1
if "%errorlevel%"=="0" (
    set "TAREA=JJPaperServidor"

    REM Eliminar tarea anterior si existe
    schtasks /Query /TN "%TAREA%" >nul 2>&1
    if "%errorlevel%"=="0" (
        schtasks /Delete /TN "%TAREA%" /F >nul 2>&1
    )

    REM Crear tarea nueva con la ruta actual
    schtasks /Create /TN "%TAREA%" /TR "wscript.exe \"%WA_DIR%start-wa.vbs\"" /SC ONLOGON /RL HIGHEST /F >nul 2>&1

    if "%errorlevel%"=="0" (
        echo         ✓ Tarea "%TAREA%" creada en el Programador de Tareas
        echo           El servidor arrancara SOLO al iniciar sesion de Windows
    ) else (
        echo         ! No se pudo crear la tarea programada
        echo           Puedes ejecutar manualmente: START-SERVIDOR.bat
    )
) else (
    echo         ! Sin permisos de administrador — no se creo la tarea
    echo           Ejecuta este script como administrador para el auto-inicio.
    echo           O copia el acceso directo de start-wa.vbs a:
    echo           %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\

    REM Intentar al menos copiar al Startup del usuario actual
    if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\" (
        copy /Y "%WA_DIR%start-wa.vbs" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\start-wa.vbs" >nul 2>&1
        if "%errorlevel%"=="0" (
            echo         ✓ Acceso directo copiado a Startup del usuario
            echo           El servidor arrancara al iniciar sesion
        )
    )
)

REM ════════════════════════════════════════════════════════════════
REM  PASO 9: VERIFICACION FINAL Y ARRANQUE
REM ════════════════════════════════════════════════════════════════
set /a PASO+=1
echo.
echo  ────────────────────────────────────────────────────────────
echo.

if "%ERRORES%"=="0" (
    echo  ╔══════════════════════════════════════════════════════════╗
    echo  ║        ✓ SETUP COMPLETADO SIN ERRORES                   ║
    echo  ╚══════════════════════════════════════════════════════════╝
    echo.
    echo   Resumen:
    echo   • Node.js: OK
    echo   • Dependencias: Instaladas
    echo   • Credenciales (.env): Presentes
    echo   • Inicio automatico: Configurado
    echo.

    REM Verificar si ya hay una instancia corriendo
    netstat -an 2>nul | findstr ":8786 " | findstr "LISTENING" >nul 2>&1
    if "%errorlevel%"=="0" (
        echo   [i] El servidor YA esta corriendo en esta PC.
        echo       No se inicia otra instancia.
    ) else (
        echo   ¿Deseas arrancar el servidor ahora?
        echo.
        set /p ARRANCAR="   [S = Si / Enter = No]: "
        if /i "%ARRANCAR%"=="S" (
            echo.
            echo   Arrancando servidor...
            echo.
            start "" cmd /c "%WA_DIR%START-SERVIDOR.bat"
        ) else (
            echo.
            echo   OK. El servidor arrancara automaticamente la proxima vez
            echo   que se encienda la PC e inicie sesion de Windows.
        )
    )
) else (
    echo  ╔══════════════════════════════════════════════════════════╗
    echo  ║   ! SETUP COMPLETADO CON %ERRORES% ADVERTENCIA(S)              ║
    echo  ╚══════════════════════════════════════════════════════════╝
    echo.
    echo   Revisa los mensajes marcados con ✗ arriba.
    echo   Los problemas mas comunes:
    echo.
    echo   1. Falta el .env → Copialo desde la PC principal
    echo   2. Node.js no se instalo → Descarga de https://nodejs.org/
    echo   3. Sin permisos admin → Clic derecho, Ejecutar como admin
)

echo.
echo  ────────────────────────────────────────────────────────────
echo  Presiona cualquier tecla para cerrar...
pause >nul
