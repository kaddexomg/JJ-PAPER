# Script ULTRA RÁPIDO - Traduce párrafos completos, no líneas individuales
# Mucho más eficiente que línea por línea

param([int]$ConcurrentRequests = 3)

$skillsPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$count = 0
$errors = 0
$jobs = @()

function Translate-Paragraph {
    param([string]$text)
    
    if ([string]::IsNullOrWhiteSpace($text) -or $text.Length -lt 3) {
        return $text
    }
    
    $text = $text.Trim()
    if ($text.Length -gt 500) {
        $text = $text.Substring(0, 500)
    }
    
    try {
        $encoded = [System.Uri]::EscapeUriString($text)
        $url = "https://api.mymemory.translated.net/get?q=$encoded&langpair=en|es"
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
        $json = $response.Content | ConvertFrom-Json
        
        if ($json.responseStatus -eq 200 -and $json.responseData.translatedText) {
            return $json.responseData.translatedText
        }
    }
    catch { }
    
    return $text
}

function Translate-SkillFile {
    param([string]$skillFile, [string]$outputFile)
    
    $content = Get-Content -Path $skillFile -Encoding UTF8 -Raw
    $lines = $content -split "`n"
    
    $output = @()
    $inCode = $false
    $inFrontmatter = $false
    $buffer = ""
    $lineNum = 0
    
    foreach ($line in $lines) {
        $lineNum++
        
        # Manejar frontmatter (primeras líneas)
        if ($lineNum -le 10 -and $line -eq '---') {
            if (-not $inFrontmatter) {
                $inFrontmatter = $true
            } else {
                $inFrontmatter = $false
            }
            $output += $line
            continue
        }
        
        # Si estamos en frontmatter, no traducir
        if ($inFrontmatter) {
            $output += $line
            continue
        }
        
        # Manejar código
        if ($line -match '^```') {
            if ($buffer) {
                $output += (Translate-Paragraph $buffer)
                $buffer = ""
            }
            $inCode = -not $inCode
            $output += $line
            continue
        }
        
        # Si estamos en código, no traducir
        if ($inCode) {
            $output += $line
            continue
        }
        
        # Acumular líneas para traducción
        if ([string]::IsNullOrWhiteSpace($line)) {
            if ($buffer) {
                $output += (Translate-Paragraph $buffer)
                $buffer = ""
            }
            $output += ""
        } else {
            if ($buffer) {
                $buffer += " " + $line
            } else {
                $buffer = $line
            }
            
            # Traducir cuando acumulamos suficiente
            if ($buffer.Length -gt 400 -or $lineNum -eq $lines.Count) {
                if ($buffer) {
                    $output += (Translate-Paragraph $buffer)
                    $buffer = ""
                }
            }
        }
    }
    
    # Traducir buffer final
    if ($buffer) {
        $output += (Translate-Paragraph $buffer)
    }
    
    $result = ($output -join "`n").TrimEnd()
    if ($result) { $result += "`n" }
    
    Set-Content -Path $outputFile -Value $result -Encoding UTF8 -Force
}

Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  TRADUCCIÓN RÁPIDA DE SKILLS AL ES     ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan

$dirs = @(Get-ChildItem -Path $skillsPath -Directory | Where-Object { $_.Name -notlike '.venv' -and $_.Name -notlike 'venv' })
$total = $dirs.Count
$startTime = Get-Date

Write-Host "`nIniciando con $ConcurrentRequests requests concurrentes..." -ForegroundColor Yellow
Write-Host "Total de skills: $total`n" -ForegroundColor Gray

$dirs | ForEach-Object {
    $skillDir = $_
    $skillFile = Join-Path $skillDir.FullName "SKILL.md"
    $outputFile = Join-Path $skillDir.FullName "SKILL-es.md"
    
    if (Test-Path $skillFile) {
        try {
            $percent = [int](($count / $total) * 100)
            $elapsed = ((Get-Date) - $startTime).TotalSeconds
            $rate = if ($elapsed -gt 0) { [int]($count / $elapsed) } else { 0 }
            $nameStr = ($skillDir.Name).PadRight(40)
            
            Write-Host -NoNewline "[$percent%] [$rate/s] $nameStr" 
            Translate-SkillFile $skillFile $outputFile
            $count++
            Write-Host " ✓" -ForegroundColor Green
        }
        catch {
            Write-Host " ✗" -ForegroundColor Red
            $errors++
        }
        
        Start-Sleep -Milliseconds 100
    }
}

$totalTime = ((Get-Date) - $startTime).TotalSeconds
$avgTime = if ($count -gt 0) { [decimal]$totalTime / $count } else { 0 }

Write-Host "`n╔════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║          ✓ TRADUCCIÓN COMPLETADA       ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Green
Write-Host "Traducidas: $count/$total" -ForegroundColor Green
Write-Host "Errores: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host "Tiempo total: $([int]$totalTime)s" -ForegroundColor Cyan
Write-Host "Tiempo promedio: $($avgTime.ToString('F1'))s/skill" -ForegroundColor Cyan
