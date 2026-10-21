@echo off
REM ============================================================
REM   JJ PAPER — Instalador de Servicio de Inicio Automatico
REM   Registra una tarea programada para que el Demonio corra
REM   al encender la maquina sin requerir inicio de sesion de usuario.
REM ============================================================
cd /d "%~dp0"

echo Registrando tarea programada JJ-Paper-MixNet-Daemon...
schtasks /create /tn "JJ-Paper-MixNet-Daemon" /tr "\"%~dp0start-daemon.bat\"" /sc onstart /ru "SYSTEM" /f

if %errorlevel% equ 0 (
  echo [OK] Tarea programada registrada exitosamente.
  echo El demonio arrancara solo con Windows.
) else (
  echo [AVISO] Se requiere ejecutar como Administrador para registrar la tarea SYSTEM.
  echo Alternativa para usuario actual:
  schtasks /create /tn "JJ-Paper-MixNet-Daemon-User" /tr "\"%~dp0start-daemon.bat\"" /sc onlogon /f
)

pause
