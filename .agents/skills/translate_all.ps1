# Script para traducir todas las skills al español
# Usa Google Translate API (gratuito a través de HTTP)

$skillsPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$count = 0
$errors = 0

function Translate-Text {
    param([string]$text)
    
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $text
    }
    
    # Escapar caracteres especiales para URL
    $text = [System.Uri]::EscapeUriString($text)
    $url = "https://api.mymemory.translated.net/get?q=$text&langpair=en|es"
    
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
        $json = $response.Content | ConvertFrom-Json
        
        if ($json.responseStatus -eq 200 -and $json.responseData.translatedText) {
            return $json.responseData.translatedText
        }
    }
    catch {
        # Si falla, retornar el original
    }
    
    return $text
}

function Translate-Line {
    param([string]$line, [bool]$inCode = $false)
    
    if ($inCode -or [string]::IsNullOrWhiteSpace($line)) {
        return $line
    }
    
    # No traducir líneas de frontmatter YAML vacías o separadores
    if ($line -eq '---') {
        return $line
    }
    
    # No traducir directamente campos de metadatos
    if ($line -match '^(name|metadata|origin):') {
        return $line
    }
    
    # Traducir descripción
    if ($line -match '^description:') {
        $value = $line -replace '^description:\s*', ''
        if ($value) {
            $translated = Translate-Text $value
            return "description: $translated"
        }
        return $line
    }
    
    # Traducir línea regular
    $translated = Translate-Text $line
    return $translated
}

function Translate-File {
    param([string]$filePath, [string]$outputPath)
    
    $content = Get-Content -Path $filePath -Encoding UTF8 -Raw
    $lines = $content -split "`n"
    $translated = @()
    $inCode = $false
    
    foreach ($line in $lines) {
        if ($line -match '^```') {
            $inCode = -not $inCode
            $translated += $line
        }
        elseif ($inCode) {
            $translated += $line
        }
        else {
            $translated += (Translate-Line $line $inCode)
        }
    }
    
    $output = ($translated -join "`n").TrimEnd() + "`n"
    Set-Content -Path $outputPath -Value $output -Encoding UTF8
}

# Procesar todas las carpetas
Get-ChildItem -Path $skillsPath -Directory | Where-Object { $_.Name -notlike '.venv' -and $_.Name -notlike 'venv' } | ForEach-Object {
    $skillDir = $_
    $skillFile = Join-Path $skillDir.FullName "SKILL.md"
    $outputFile = Join-Path $skillDir.FullName "SKILL-es.md"
    
    if (Test-Path $skillFile) {
        try {
            Write-Host "[Traduciendo] $($skillDir.Name)..."
            Translate-File $skillFile $outputFile
            $count++
            Write-Host "  ✓ OK"
        }
        catch {
            Write-Host "  ✗ ERROR: $_"
            $errors++
        }
        
        # Pequeña pausa para no sobrecargar la API
        Start-Sleep -Milliseconds 500
    }
}

Write-Host "`n=== RESULTADO ===" -ForegroundColor Green
Write-Host "Skills traducidas: $count" -ForegroundColor Green
Write-Host "Errores: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
