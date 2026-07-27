#!/usr/bin/env bash
# Build para Cloudflare Pages: publica SOLO lo web en dist/.
# Deja fuera el código de servidor, migraciones y config para no exponerlos.
set -e

rm -rf dist
mkdir -p dist

for item in *; do
  case "$item" in
    wa-server|sql|dist|node_modules)  continue ;;   # nunca publicar
    docs|cerebro)                     continue ;;   # documentación interna del negocio
    build.sh|skills-lock.json)       continue ;;   # herramientas del repo
    *.md|*.code-workspace)           continue ;;   # docs / config de editor
    *.pdf|*.xlsx|*.xls|*.csv|*.jpeg|*.jpg) continue ;; # datos de negocio sueltos
    *) cp -r "$item" dist/ ;;
  esac
done

# Los dotfiles (.claude, .git, .gitignore, .env…) no los toca el bucle (glob * los ignora),
# así que jamás llegan a dist. _headers, _redirects y 404.html sí (empiezan con _/letra).
echo "dist listo:"; ls dist
