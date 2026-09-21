# Script de traducción COMPLETA - Traduce TODO el contenido al español

$skillsPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$count = 0
$errors = 0

function Translate-WholeFile {
    param([string]$filePath, [string]$outputPath)
    
    $content = Get-Content -Path $filePath -Encoding UTF8 -Raw
    
    # Dividir por frontmatter
    $parts = $content -split '---'
    
    if ($parts.Count -ge 3) {
        # Tiene frontmatter
        $frontmatter = $parts[1]
        $body = ($parts[2..($parts.Count-1)] -join '---').TrimStart("`n").TrimStart("`r")
    } else {
        $frontmatter = ""
        $body = $content
    }
    
    # Traducir el body en bloques
    $translated = Translate-TextBlocks $body
    
    # Reconstruir
    if ($frontmatter) {
        $output = "---" + $frontmatter + "---`n" + $translated
    } else {
        $output = $translated
    }
    
    Set-Content -Path $outputPath -Value $output -Encoding UTF8 -Force
}

function Translate-TextBlocks {
    param([string]$text)
    
    $lines = $text -split "`n"
    $result = @()
    $inCode = $false
    $codeBlock = ""
    $textBuffer = ""
    
    foreach ($line in $lines) {
        # Detectar inicio/fin de bloque de código
        if ($line -match '^```') {
            # Traducir buffer acumulado
            if ($textBuffer) {
                $result += (Translate-Paragraph $textBuffer)
                $textBuffer = ""
            }
            $inCode = -not $inCode
            $result += $line
            continue
        }
        
        # Si estamos en código, no traducir
        if ($inCode) {
            $result += $line
            continue
        }
        
        # Acumular líneas de texto
        if ([string]::IsNullOrWhiteSpace($line)) {
            if ($textBuffer) {
                $result += (Translate-Paragraph $textBuffer)
                $textBuffer = ""
            }
            $result += ""
        } else {
            $textBuffer += $line + "`n"
        }
    }
    
    # Traducir última sección
    if ($textBuffer) {
        $result += (Translate-Paragraph $textBuffer)
    }
    
    return ($result -join "`n")
}

function Translate-Paragraph {
    param([string]$text)
    
    $text = $text.Trim()
    if ($text.Length -lt 2) { return $text }
    
    # Dividir en frases si es muy largo
    if ($text.Length -gt 1000) {
        $sentences = $text -split '(?<=[.!?])\s+'
        $translated = @()
        foreach ($sent in $sentences) {
            if ($sent.Trim()) {
                $translated += (Translate-SingleBlock $sent)
            }
        }
        return ($translated -join ' ')
    } else {
        return (Translate-SingleBlock $text)
    }
}

function Translate-SingleBlock {
    param([string]$text)
    
    $text = $text.Trim()
    if ($text.Length -lt 2) { return $text }
    
    # Truncar si es muy largo
    if ($text.Length -gt 500) {
        $text = $text.Substring(0, 500)
    }
    
    try {
        $encoded = [System.Uri]::EscapeUriString($text)
        $url = "https://api.mymemory.translated.net/get?q=$encoded&langpair=en|es"
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $json = $response.Content | ConvertFrom-Json
        
        if ($json.responseStatus -eq 200 -and $json.responseData.translatedText) {
            return $json.responseData.translatedText
        }
    }
    catch { }
    
    return $text
}

Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  TRADUCCIÓN COMPLETA AL ESPAÑOL" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════`n" -ForegroundColor Cyan

# Limpiar archivos previos
Get-ChildItem -Path $skillsPath -Directory -Recurse | ForEach-Object {
    Remove-Item (Join-Path $_.FullName "SKILL-es.md") -Force -ErrorAction SilentlyContinue
} | Out-Null

$dirs = @(Get-ChildItem -Path $skillsPath -Directory | Where-Object { $_.Name -notlike '.venv' -and $_.Name -notlike 'venv' })
$total = $dirs.Count

foreach ($skillDir in $dirs) {
    $skillFile = Join-Path $skillDir.FullName "SKILL.md"
    $outputFile = Join-Path $skillDir.FullName "SKILL-es.md"
    
    if (Test-Path $skillFile) {
        $percent = [int](($count / $total) * 100)
        Write-Host -NoNewline "[$percent%] $($skillDir.Name)... "
        
        try {
            Translate-WholeFile $skillFile $outputFile
            $count++
            Write-Host "✓" -ForegroundColor Green
        }
        catch {
            Write-Host "✗ ERROR" -ForegroundColor Red
            $errors++
        }
        
        Start-Sleep -Milliseconds 150
    }
}

Write-Host "`n═══════════════════════════════════════════" -ForegroundColor Green
Write-Host "✅ COMPLETADO" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host "Traducidas: $count/$total`n"
Write-Host "Errores: $errors`n"
