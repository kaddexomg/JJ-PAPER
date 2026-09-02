# AGENTS.md — contexto del proyecto

> Generado por AgentForge el 2026-08-26 10:23. El agente lo consulta (load_project_context)
> ANTES de escribir o modificar codigo para respetar stack y convenciones.

## Tech Stack
no detectado

## Estructura
```
.claude/ (skills)
.env.local
.gitignore
.vscode/
404.html
_headers
_redirects
admin/
  clientes.html        ← gestión global de clientes (tabla + modal con address/notes)
AGENTS.md
assets/ (css, img, js, vendor)
audits/
backups/
  jjp_customers_antes_actualizar_*.json  ← backups de BD previos a correcciones
build.sh               ← Cloudflare Pages: publica solo dist/
cargar_clientes.mjs    ← script legacy de carga (usa IDs viejos de seller)
corregir_cartera_mixnet.cjs  ← genera CSV corregido desde MixNet (commit en repo)
actualizar_clientes_bd.mjs   ← actualiza/inserta en Supabase (--dry-run/--execute)
catalogo.html
cerebro/ (.obsidian, Conceptos, Indices, Modulos, Proyecto, Seguridad, Sesiones, Sistema)
checkout.html
CLAUDE.md
CLIENTES/
  clientes_importables_zonas.csv   ← cartera original (1811 filas, phone simulado)
  cartera_corregida_mixnet.csv     ← corregida: RIF real, phone real, address (NO subir a git)
comprobante.html
CONEXION_MIXNET.md
wa-server/
  clientes_mixnet_20263108_1529.csv ← datos reales extraidos de MixNet (6170 filas)
  extraer-clientes-mixnet.cjs       ← extractor v2 (Node 13+)
  extraer-clientes-mixnet.bat       ← menú para el usuario
  ...
```

## Comandos utiles
- `node corregir_cartera_mixnet.cjs` → genera CSV corregido con address (requiere MixNet CSV en wa-server/)
- `node actualizar_clientes_bd.mjs --dry-run` → simula updates en Supabase sin tocar nada
- `node actualizar_clientes_bd.mjs --execute` → aplica updates + inserts a jjp_customers
- `bash build.sh` → genera dist/ para Cloudflare Pages (excluye .csv, wa-server, cerebro)
- Deploy: push a main en kaddexomg/JJ-PAPER dispara Cloudflare Pages automaticamente

## Convenciones
- Repo git (kaddexomg/JJ-PAPER)
- Deploy: Cloudflare Pages via build.sh → dist/
- DB: Supabase (jjp_customers, jjp_profiles)
- Datos de negocio (.csv, .pdf, backups) NUNCA al repo (.gitignore lo bloquea)
- Vendedores actuales: Yovanni (004/006), Marianela (008), Andreina (014)

## Tests
No se detectaron tests.

## Migración a 3 Proyectos Supabase (Septiembre 2026)
- **Estrategia**: El proyecto original (czzvsqnmxtjzqzioknnn) excedió su cuota, por lo que el sistema se está migrando a 3 proyectos paralelos: Proyecto A (Core), Proyecto B (Comunicación) y Proyecto C (Inventario). Las credenciales se encuentran en `.env.supabase-multi`.
- **Regla Crítica de SQL (Fuente de la Verdad)**: **NUNCA guiarse únicamente por `INSTALACION_DEFINITIVA_TOTAL.sql`**. El esquema real en producción incluye múltiples parches y reparaciones posteriores (hasta el 31 de agosto). El archivo `sql/SQL_Proyecto_A_Fixed.sql` contiene la consolidación correcta que incluye estas reparaciones (ej. `jjp_wa_messages`, correcciones de conteo).
- **Prevención de Errores (42P13)**: Cuando se aplica el esquema maestro en uno de los nuevos proyectos, si la base de datos no está vacía (tiene restos de intentos previos), dará un error `42P13` (existing function) que abortará el script y provocará errores en cadena (`42P01` relation does not exist).
- **Solución Obligatoria**: Antes de aplicar cualquier esquema, se debe ejecutar `sql/LIMPIAR_NUEVO_SUPABASE.sql` en el SQL Editor del proyecto destino para vaciar el esquema `public` y garantizar que el script maestro corra sin interrupciones.