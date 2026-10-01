@echo off
REM ============================================================
REM  JJ Paper - Reparar y Activar Escritorio Remoto (RDP)
REM ============================================================
title JJ Paper - Reparar y Activar Escritorio Remoto RDP
cd /d "%~dp0"

REM Verificar elevacion como Administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Solicitando permisos de Administrador...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/k cd /d `\"%~dp0`\" && `\"%~f0`\"' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   REPARANDO Y ACTIVANDO ESCRITORIO REMOTO (PUERTO 3389)
echo ============================================================
echo.

echo [1/6] Configurando permisos criptograficos para NETWORK SERVICE...
icacls "C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys" /grant "*S-1-5-20":(OI)(CI)F /T /C >nul 2>&1
icacls "C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys" /grant "Todos":(OI)(CI)R >nul 2>&1
icacls "C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys" /grant "Everyone":(OI)(CI)R >nul 2>&1

echo [2/6] Limpiando certificados RDP previos corruptos...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem 'Cert:\LocalMachine\Remote Desktop' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue" >nul 2>&1

echo [3/6] Habilitando RDP y desactivando bloqueo NLA...
reg add "HKLM\System\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f >nul
reg add "HKLM\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" /v UserAuthentication /t REG_DWORD /d 0 /f >nul
reg add "HKLM\System\CurrentControlSet\Control\Lsa" /v LimitBlankPasswordUse /t REG_DWORD /d 0 /f >nul

echo [4/6] Abriendo puerto 3389 en Firewall de Windows...
netsh advfirewall firewall set rule group="remote desktop" new enable=Yes >nul 2>&1
netsh advfirewall firewall set rule group="escritorio remoto" new enable=Yes >nul 2>&1
netsh advfirewall firewall add rule name="JJ Paper RDP 3389" dir=in action=allow protocol=TCP localport=3389 >nul 2>&1

echo [5/6] Reiniciando servicios de Escritorio Remoto...
sc config SessionEnv start= auto >nul
sc config TermService start= auto >nul
sc config UmRdpService start= auto >nul

net start SessionEnv >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Restart-Service TermService -Force -ErrorAction SilentlyContinue" >nul 2>&1
net start TermService >nul 2>&1
net start UmRdpService >nul 2>&1

echo [6/6] Verificando puerto 3389...
timeout /t 3 /nobreak >nul
netstat -ano | findstr /R /C:":3389 " >nul
if %errorlevel% equ 0 (
    echo.
    echo ============================================================
    echo   [EXITO TOTAL] PUERTO 3389 ESTA ESCUCHANDO Y ACTIVO!
    echo ============================================================
) else (
    echo.
    echo   [!] Reiniciando servicio TermService una vez mas...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Restart-Service TermService -Force" >nul 2>&1
    timeout /t 2 /nobreak >nul
    netstat -ano | findstr /R /C:":3389 "
)

echo.
echo ============================================================
echo   DATOS DE CONEXION DESDE LA LAPTOP (100.67.139.121):
echo ============================================================
echo   Equipo  : 100.103.110.44
echo   Usuario : Supervisor
echo ============================================================
echo.
pause
