@echo off
rem JJ PAPER -- Acceso directo a Cockpit Antigravity Tienda
title Abriendo Cockpit JJ Paper Tienda...

if exist "%~dp0mixnet-ai-panel\active_url.txt" (
    for /f "delims=" %%u in (%~dp0mixnet-ai-panel\active_url.txt) do start %%u & exit /b 0
)
if exist "%~dp0active_url.txt" (
    for /f "delims=" %%u in (%~dp0active_url.txt) do start %%u & exit /b 0
)

start http://localhost:3300
