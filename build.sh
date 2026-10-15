#!/usr/bin/env bash
# Build para Cloudflare Pages: publica SOLO lo web en dist/.
# Deja fuera el código de servidor, migraciones y config para no exponerlos.
set -e

rm -rf dist
mkdir -p dist

for item in *; do
  case "$item" in
    wa-server|sql|dist|node_modules|scripts|_archive|_archivo|backups|audits|CLIENTES|functions|MAPEO-TOTAL-MIXNET|tools) continue ;; # nunca publicar
    docs|cerebro|planes)             continue ;; # documentación interna del negocio
    build.sh|skills-lock.json)       continue ;; # herramientas del repo
    *.md|*.code-workspace|*.bat|*.vbs|*.zip|*.bundle) continue ;; # docs / launchers / zips
    *.pdf|*.xlsx|*.xls|*.csv|*.jpeg|*.jpg|*.docx|*.txt) continue ;; # datos de negocio sueltos
    *) cp -r "$item" dist/ ;;
  esac
done

# Copiar paquete del puente autónomo Windows 7 para descarga directa segura HTTPS
if [ -d "puente-win7" ]; then
  mkdir -p dist/puente-win7
  cp -r puente-win7/* dist/puente-win7/
fi
if [ -f "puente-win7.zip" ]; then
  cp puente-win7.zip dist/puente-win7.zip
fi

# Los dotfiles (.claude, .git, .gitignore, .env…) no los toca el bucle (glob * los ignora),
# así que jamás llegan a dist. _headers, _redirects y 404.html sí (empiezan con _/letra).
echo "dist listo:"; ls dist

