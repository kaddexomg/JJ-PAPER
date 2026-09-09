@echo off
REM ============================================================
REM  JJ Paper — EMPAQUETAR CREDENCIALES Y SESIONES
REM ============================================================
title JJ Paper — Empaquetar Credenciales
cd /d "%~dp0"

echo.
echo Creando wa-server-credenciales.zip en tu Escritorio...
echo.

powershell -NoProfile -Command "$zip = [System.IO.Path]::Combine($env:USERPROFILE, 'Desktop', 'wa-server-credenciales.zip'); if (Test-Path $zip) { Remove-Item $zip -Force }; $temp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ('jjp_pack_' + (Get-Random))); Copy-Item (Join-Path $pwd.Path '.env') (Join-Path $temp.FullName '.env'); if (Test-Path (Join-Path $pwd.Path 'sessions')) { Copy-Item (Join-Path $pwd.Path 'sessions') (Join-Path $temp.FullName 'sessions') -Recurse }; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($temp.FullName, $zip); Remove-Item $temp.FullName -Recurse -Force; Write-Host 'ZIP creado exitosamente:' $zip"

echo.
pause
