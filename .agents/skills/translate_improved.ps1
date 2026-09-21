# Script de traducción MEJORADO - preserva formato YAML y código
# Traduce línea por línea de forma robusta

$skillsPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$count = 0
$errors = 0
$cache = @{}  # Cache para evitar re-traducir el mismo texto

function Translate-Text {
    param([string]$text)
    
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $text
    }
    
    # Verificar cache
    if ($cache.ContainsKey($text)) {
        return $cache[$text]
    }
    
    # Limitar longitud
    $original = $text
    if ($text.Length -gt 300) {
        $text = $text.Substring(0, 300)
    }
    
    try {
        $encoded = [System.Uri]::EscapeUriString($text)
        $url = "https://api.mymemory.translated.net/get?q=$encoded&langpair=en|es"
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        $json = $response.Content | ConvertFrom-Json
        
        if ($json.responseStatus -eq 200 -and $json.responseData.translatedText) {
            $result = $json.responseData.translatedText
            $cache[$original] = $result  # Cachear
            return $result
        }
    }
    catch { }
    
    $cache[$original] = $original  # Cachear el original si falló
    return $original
}

function Translate-FileLine {
    param([string]$filePath, [string]$outputPath)
    
    $lines = @(Get-Content -Path $filePath -Encoding UTF8)
    $output = @()
    $inCode = $false
    $inFrontmatter = $false
    $frontmatterEnd = $false
    
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        
        # Detectar frontmatter (primeras 10 líneas)
        if ($i -le 10 -and $line -eq '---') {
            if (-not $inFrontmatter -and -not $frontmatterEnd) {
                $inFrontmatter = $true
                $output += $line
                continue
            }
            elseif ($inFrontmatter) {
                $inFrontmatter = $false
                $frontmatterEnd = $true
                $output += $line
                continue
            }
        }
        
        # Detectar bloques de código
        if ($line -match '^```') {
            $inCode = -not $inCode
            $output += $line
            continue
        }
        
        # No traducir si estamos en frontmatter o código
        if ($inFrontmatter -or $inCode) {
            $output += $line
            continue
        }
        
        # Traducir línea regular si no está vacía
        if ([string]::IsNullOrWhiteSpace($line)) {
            $output += $line
        }
        else {
            $translated = Translate-Text $line
            $output += $translated
        }
    }
    
    $outputText = ($output -join "`n").TrimEnd()
    if ($outputText) {
        $outputText += "`n"
    }
    
    Set-Content -Path $outputPath -Value $outputText -Encoding UTF8 -Force
}

Write-Host "===== INICIANDO TRADUCCIÓN =====" -ForegroundColor Cyan

# Procesar todas las carpetas
$dirs = @(Get-ChildItem -Path $skillsPath -Directory | Where-Object { $_.Name -notlike '.venv' -and $_.Name -notlike 'venv' })
$total = $dirs.Count

$dirs | ForEach-Object {
    $skillDir = $_
    $skillFile = Join-Path $skillDir.FullName "SKILL.md"
    $outputFile = Join-Path $skillDir.FullName "SKILL-es.md"
    
    if (Test-Path $skillFile) {
        $percent = [int](($count / $total) * 100)
        Write-Host "[$percent%] $($skillDir.Name)..." -NoNewline
        
        try {
            Translate-FileLine $skillFile $outputFile
            $count++
            Write-Host " ✓" -ForegroundColor Green
        }
        catch {
            Write-Host " ✗ ERROR" -ForegroundColor Red
            $errors++
        }
        
        # Pausa para no sobrecargar API
        Start-Sleep -Milliseconds 200
    }
}

Write-Host "`n===== RESUMEN =====" -ForegroundColor Green
Write-Host "✓ Traducidas: $count" -ForegroundColor Green
Write-Host "✗ Errores: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host "Cache hits: $($cache.Count) textos únicos cacheados" -ForegroundColor Cyan
