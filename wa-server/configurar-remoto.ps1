# ============================================================
#  JJ Paper - Configurador de Acceso Remoto Seguro (PC Supervisor)
#  Prepara Tailscale, RDP, SSH y carpeta compartida de MixNet
# ============================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   CONFIGURANDO ENLACE REMOTO EN PC SUPERVISOR (TIENDA)     " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 0. Verificar privilegios de Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[!] AVISO: Este script requiere privilegios de Administrador para configurar Firewall y Servicios." -ForegroundColor Yellow
    Write-Host "    Si algún paso falla, haz clic derecho en el archivo .BAT y selecciona 'Ejecutar como Administrador'.`n" -ForegroundColor DarkYellow
}

# 1. Habilitar Escritorio Remoto (RDP) en Windows
Write-Host "1. Verificando Escritorio Remoto (RDP)..." -ForegroundColor Yellow
try {
    # Permisos en MachineKeys para que TermService (NetworkService) pueda crear/leer el certificado SSL de RDP
    cmd.exe /c 'icacls "C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys" /grant "*S-1-5-20":(OI)(CI)F /T /C >nul 2>&1'
    Get-ChildItem 'Cert:\LocalMachine\Remote Desktop' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

    Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name "fDenyTSConnections" -Value 0 -ErrorAction SilentlyContinue
    Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name "UserAuthentication" -Value 0 -ErrorAction SilentlyContinue
    Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Lsa' -Name "LimitBlankPasswordUse" -Value 0 -ErrorAction SilentlyContinue
    Enable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
    Enable-NetFirewallRule -DisplayGroup "Escritorio remoto" -ErrorAction SilentlyContinue
    Set-Service -Name SessionEnv -StartupType Automatic -ErrorAction SilentlyContinue
    Start-Service -Name SessionEnv -ErrorAction SilentlyContinue
    Set-Service -Name TermService -StartupType Automatic -ErrorAction SilentlyContinue
    Restart-Service -Name TermService -Force -ErrorAction SilentlyContinue
    Set-Service -Name UmRdpService -StartupType Automatic -ErrorAction SilentlyContinue
    Start-Service -Name UmRdpService -ErrorAction SilentlyContinue
    Write-Host "   [OK] Escritorio Remoto (RDP) activado y servicios reiniciados." -ForegroundColor Green
} catch {
    Write-Host "   [!] Aviso al configurar RDP: $($_.Exception.Message)" -ForegroundColor DarkYellow
}

# 2. Habilitar puertos del servidor local de JJ Paper en el firewall
Write-Host "`n2. Habilitando puertos del servidor JJ Paper (8786, 8787)..." -ForegroundColor Yellow
try {
    New-NetFirewallRule -DisplayName "JJ Paper Server Mutex" -Direction Inbound -LocalPort 8786 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null
    New-NetFirewallRule -DisplayName "JJ Paper Server HTTP" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null
    Write-Host "   [OK] Puertos 8786 y 8787 habilitados en el firewall." -ForegroundColor Green
} catch {
    Write-Host "   [!] Aviso en firewall: $($_.Exception.Message)" -ForegroundColor DarkYellow
}

# 3. Verificar / Compartir la carpeta de MixNet (comp01)
Write-Host "`n3. Verificando carpeta de MixNet (comp01)..." -ForegroundColor Yellow
$mixnetPath = ""
if (Test-Path "M:\comp01") { $mixnetPath = "M:\comp01" }
elseif (Test-Path "Z:\comp01") { $mixnetPath = "Z:\comp01" }
elseif (Test-Path "M:\MIX11\comp01") { $mixnetPath = "M:\MIX11\comp01" }
elseif (Test-Path "C:\RESPAMIX\MIX11 (servidor)\comp01") { $mixnetPath = "C:\RESPAMIX\MIX11 (servidor)\comp01" }
elseif (Test-Path "M:\") { $mixnetPath = "M:\" }

if ($mixnetPath) {
    Write-Host "   [OK] Carpeta MixNet localizada en: $mixnetPath" -ForegroundColor Green
    try {
        $existingShare = Get-SmbShare -Name "comp01" -ErrorAction SilentlyContinue
        if (-not $existingShare) {
            New-SmbShare -Name "comp01" -Path $mixnetPath -FullAccess "Everyone" -ErrorAction SilentlyContinue | Out-Null
            Write-Host "   [OK] Carpeta compartida en red local como '\\<IP>\comp01'." -ForegroundColor Green
        } else {
            Write-Host "   [OK] El recurso comp01 ya existe en red." -ForegroundColor Green
        }
    } catch {
        Write-Host "   [i] Unidad de red mapeada accesible directamente desde esta PC." -ForegroundColor DarkYellow
    }
} else {
    Write-Host "   [!] Advertencia: No se detectó la unidad M:\ o Z:\ en esta máquina." -ForegroundColor Red
}

# 4. Verificar instalación de Tailscale
Write-Host "`n4. Verificando Tailscale (Red Privada Cifrada)..." -ForegroundColor Yellow
$tailscaleExe = "$env:ProgramFiles\Tailscale\tailscale.exe"
$tailscaleInstalled = Test-Path $tailscaleExe

if (-not $tailscaleInstalled) {
    Write-Host "   Tailscale NO esta instalado en esta PC." -ForegroundColor Cyan
    Write-Host "   Descargando instalador oficial de Tailscale..." -ForegroundColor Yellow
    $installerUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
    $installerPath = "$env:TEMP\tailscale-setup.exe"
    try {
        if (-not (Test-Path $installerPath)) {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
        }
        Write-Host "   Ejecutando instalador de Tailscale..." -ForegroundColor Green
        Start-Process -FilePath $installerPath -ArgumentList "/quiet" -Wait
        Start-Sleep -Seconds 5
        $tailscaleInstalled = Test-Path $tailscaleExe
    } catch {
        Write-Host "   [!] Error descargando automaticamente: $($_.Exception.Message)" -ForegroundColor Red
    }
}

if ($tailscaleInstalled) {
    Write-Host "   [OK] Tailscale esta instalado correctamente." -ForegroundColor Green
    
    # Asegurar servicio Tailscale activo
    try {
        Set-Service -Name "Tailscale" -StartupType Automatic -ErrorAction SilentlyContinue
        Start-Service -Name "Tailscale" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    } catch {}

    # Iniciar sesion con soporte de SSH
    Write-Host "`n   Activando Tailscale con soporte de SSH y control remoto..." -ForegroundColor Yellow
    try {
        & "$tailscaleExe" up --ssh --operator=$env:USERNAME --accept-routes --advertise-routes=192.168.0.0/24
    } catch {}

    # Obtener IP de Tailscale
    $tsIp = ""
    try {
        $tsIp = (& "$tailscaleExe" ip -4 2>$null).Trim()
    } catch {}

    # Guardar reporte de conexión
    $logDir = Join-Path $PSScriptRoot "logs"
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $infoFile = Join-Path $logDir "acceso-remoto-info.txt"
    $infoContent = @"
============================================================
   JJ PAPER -- DATOS DE ENLACE REMOTO SUPERVISOR
============================================================
IP Tailscale      : $(if ($tsIp) { $tsIp } else { 'Pendiente Login en app Tailscale' })
Nombre del Equipo : $env:COMPUTERNAME
Usuario Windows   : $env:USERNAME
RDP (Puerto 3389) : Activo (TermService Running)
Servidor HTTP     : http://$(if ($tsIp) { $tsIp } else { '100.x.y.z' }):8787/lan/monitor/stats
Generado el       : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
============================================================
"@
    Set-Content -Path $infoFile -Value $infoContent -Encoding UTF8

    Write-Host "`n============================================================" -ForegroundColor Green
    Write-Host "   DATOS DE CONEXION REMOTA LISTOS PARA TU LAPTOP           " -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    if ($tsIp) {
        Write-Host "   IP Privada Tailscale de esta PC : " -NoNewline -ForegroundColor White
        Write-Host "$tsIp" -ForegroundColor Cyan
    } else {
        Write-Host "   Abre la app de Tailscale en la barra de tareas y haz login." -ForegroundColor Yellow
    }
    Write-Host "   Nombre del equipo               : $env:COMPUTERNAME" -ForegroundColor White
    Write-Host "   Usuario de Windows actual       : $env:USERNAME" -ForegroundColor White
    Write-Host "   Reporte guardado en             : wa-server\logs\acceso-remoto-info.txt" -ForegroundColor White
    Write-Host "============================================================" -ForegroundColor Green
} else {
    Write-Host "`n============================================================" -ForegroundColor Yellow
    Write-Host "   PASO PENDIENTE: INSTALAR TAILSCALE MANUALMENTE          " -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host "   1. Descarga e instala Tailscale desde: https://tailscale.com/download"
    Write-Host "   2. Inicia sesion con tu cuenta de Google / Microsoft."
    Write-Host "   3. Vuelve a ejecutar este script para obtener los datos de enlace."
}

Write-Host ""
