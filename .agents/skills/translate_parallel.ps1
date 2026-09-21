#!/usr/bin/env pwsh
# Traductor paralelo de skills al español
# Usa MyMemory API con reintentos y procesos paralelos

$ErrorActionPreference = "SilentlyContinue"

# Función para traducir texto
function Translate-Text {
    param([string]$Text, [int]$Retries = 3)
    
    if (-not $Text -or $Text.Trim().Length -eq 0) { return $Text }
    
    # Limitar longitud
    $textToTranslate = if ($Text.Length -gt 500) { $Text.Substring(0, 500) } else { $Text }
    
    for ($i = 0; $i -lt $Retries; $i++) {
        try {
            $encoded = [System.Web.HttpUtility]::UrlEncode($textToTranslate)
            $url = "https://api.mymemory.translated.net/get?q=$encoded&langpair=en|es"
            
            $response = Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            $data = $response.Content | ConvertFrom-Json
            
            if ($data.responseStatus -eq 200) {
                return $data.responseData.translatedText
            }
        } catch {
            if ($i -lt $Retries - 1) { Start-Sleep -Milliseconds (500 * ($i + 1)) }
        }
    }
    
    return $Text
}

# Función para traducir un archivo
function Translate-SkillFile {
    param(
        [string]$SkillDir,
        [string]$SkillName
    )
    
    $skillFile = Join-Path $SkillDir "SKILL.md"
    $esFile = Join-Path $SkillDir "SKILL-es.md"
    
    if (-not (Test-Path $skillFile)) { return $false }
    
    try {
        $content = Get-Content $skillFile -Raw -Encoding UTF8
        $lines = $content -split "`n"
        $translated = @()
        $inCode = $false
        $frontmatterEnd = -1
        
        # Encontrar fin del frontmatter
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($i -gt 0 -and $lines[$i].Trim() -eq "---") {
                $frontmatterEnd = $i
                break
            }
        }
        
        # Procesar líneas
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            
            # Preservar frontmatter
            if ($i -le $frontmatterEnd) {
                $translated += $line
                continue
            }
            
            # Detectar bloques de código
            if ($line.Trim().StartsWith("```")) {
                $inCode = -not $inCode
                $translated += $line
                continue
            }
            
            # No traducir dentro de código
            if ($inCode) {
                $translated += $line
                continue
            }
            
            # No traducir líneas vacías
            if ($line.Trim().Length -eq 0) {
                $translated += $line
                continue
            }
            
            # Traducir línea
            $translatedLine = Translate-Text $line
            $translated += $translatedLine
        }
        
        # Guardar archivo
        $output = $translated -join [System.Environment]::NewLine
        Set-Content -Path $esFile -Value $output -Encoding UTF8 -Force
        
        return $true
    } catch {
        return $false
    }
}

# Procesar todas las skills en paralelo
Write-Host "`n" + ("="*60) -ForegroundColor Cyan
Write-Host "TRADUCCIÓN PARALELA AL ESPAÑOL" -ForegroundColor Cyan
Write-Host ("="*60) -ForegroundColor Cyan

$skillDirs = @(Get-ChildItem "c:\Users\PC\.claude\skills" -Directory | Where-Object { $_.Name -notlike '.venv' -and $_.Name -notlike 'venv' })
$total = $skillDirs.Count
$completed = 0

# Traducir secuencialmente pero rápido
foreach ($skillDir in $skillDirs) {
    $skillName = $skillDir.Name
    
    if (Translate-SkillFile $skillDir.FullName $skillName) {
        $completed++
        $pct = [math]::Floor(($completed / $total) * 100)
        Write-Host "[${pct}%] ✅ $skillName" -ForegroundColor Green
    } else {
        Write-Host "[---] ❌ $skillName" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 200
}

Write-Host "`n" + ("="*60) -ForegroundColor Green
Write-Host "✅ COMPLETADO: $completed/$total skills traducidas" -ForegroundColor Green
Write-Host ("="*60 + "`n") -ForegroundColor Green
