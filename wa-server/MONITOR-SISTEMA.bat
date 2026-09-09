@echo off
title JJ Paper - Monitor de Cuotas & Optimizador
cd /d "%~dp0\.."

if exist "MONITOR-JJ-PAPER.bat" (
    call "MONITOR-JJ-PAPER.bat"
) else (
    start http://localhost:8787/admin/monitor.html
)
exit
