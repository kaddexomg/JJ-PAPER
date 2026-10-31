@echo off
title JJ Paper C.A. - Estudio IA de Entrenamiento, Busqueda Exacta y Auditoria de Catalogo
cd /d "%~dp0"
start "" "http://localhost:8795"
python "tools\ai-catalog-studio\studio_server.py"
pause
