# Script optimizado para traducir todas las skills al español
# Traduce párrafos completos para ser más eficiente

$skillsPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$count = 0
$errors = 0

function Translate-Paragraph {
    param([string]$text)
    
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $text
    }
    
    # Limitar a 500 caracteres por solicitud
    if ($text.Length -gt 500) {
        $text = $text.Substring(0, 500)
    }
    
    $encoded = [System.Uri]::EscapeUriString($text)
    $url = "https://api.mymemory.translated.net/get?q=$encoded&langpair=en|es"
    
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
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

function Translate-MarkdownFile {
    param([string]$filePath, [string]$outputPath)
    
    $content = Get-Content -Path $filePath -Encoding UTF8 -Raw
    
    # Separar frontmatter YAML
    if ($content -match '^---\r?\n(.*?)\r?\n---\r?\n(.*)$' -or $content -match '^---\n(.*?)\n---\n(.*)$') {
        $frontmatter = $Matches[1]
        $body = $Matches[2]
    } else {
        $frontmatter = ""
        $body = $content
    }
    
    $bodyLines = $body -split "`n"
    $translatedLines = @()
    $inCode = $false
    $buffer = ""
    
    foreach ($line in $bodyLines) {
        if ($line -match '^```') {
            # Traducir buffer si existe
            if ($buffer.Trim()) {
                $translatedLines += (Translate-Paragraph $buffer)
                $buffer = ""
            }
            $inCode = -not $inCode
            $translatedLines += $line
        }
        elseif ($inCode) {
            $translatedLines += $line
        }
        else {
            # Acumular líneas en buffer
            if ([string]::IsNullOrWhiteSpace($line)) {
                if ($buffer.Trim()) {
                    $translatedLines += (Translate-Paragraph $buffer)
                    $buffer = ""
                }
                $translatedLines += ""
            } else {
                if ($buffer) {
                    $buffer += " " + $line
                } else {
                    $buffer = $line
                }
                
                # Traducir cuando el buffer es suficientemente grande
                if ($buffer.Length -gt 300) {
                    $translatedLines += (Translate-Paragraph $buffer)
                    $buffer = ""
                }
            }
        }
    }
    
    # Traducir buffer final
    if ($buffer.Trim()) {
        $translatedLines += (Translate-Paragraph $buffer)
    }
    
    # Reconstruir contenido
    $translated = ""
    if ($frontmatter) {
        $translated = "---`n" + $frontmatter + "`n---`n"
    }
    $translated += ($translatedLines -join "`n").TrimEnd() + "`n"
    
    Set-Content -Path $outputPath -Value $translated -Encoding UTF8
}

# Procesar todas las carpetas
$dirs = Get-ChildItem -Path $skillsPath -Directory | Where-Object { $_.Name -notlike '.venv' -and $_.Name -notlike 'venv' }
$total = ($dirs | Measure-Object).Count

$dirs | ForEach-Object {
    $skillDir = $_
    $skillFile = Join-Path $skillDir.FullName "SKILL.md"
    $outputFile = Join-Path $skillDir.FullName "SKILL-es.md"
    
    if (Test-Path $skillFile) {
        try {
            $percent = [int](($count / $total) * 100)
            Write-Host "[$percent%] Traduciendo $($skillDir.Name)..." -ForegroundColor Cyan
            Translate-MarkdownFile $skillFile $outputFile
            $count++
            Write-Host "  ✓ OK" -ForegroundColor Green
        }
        catch {
            Write-Host "  ✗ ERROR: $_" -ForegroundColor Red
            $errors++
        }
        
        Start-Sleep -Milliseconds 300
    }
}

Write-Host "`n===== RESULTADO =====" -ForegroundColor Green
Write-Host "Skills traducidas: $count de $total" -ForegroundColor Green
Write-Host "Errores: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host "Status: $(if ($errors -eq 0 -and $count -eq $total) { '✓ COMPLETADO' } else { '⚠ VERIFICAR' })" -ForegroundColor $(if ($errors -eq 0 -and $count -eq $total) { "Green" } else { "Yellow" })
