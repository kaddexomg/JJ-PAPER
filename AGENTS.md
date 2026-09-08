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
- **Estrategia**: El proyecto original (czzvsqnmxtjzqzioknnn) excedió su cuota. Se migró exitosamente el Core a Proyecto A (`qxgdrfkobbhdzgtoiavv`). Las credenciales multi-proyecto residen en `.env.supabase-multi`.
- **Estado Actual (07-09-2026)**:
  - **Proyecto A (Core)**: 100% ACTIVO en producción (`assets/js/config.js`, `_headers`, `wa-server/.env`).
  - **Proyecto B (Comunicación)**: WhatsApp, CRM, Sesiones y emails enrutados. Tablas `jjp_server_control` y `jjp_emails` sincronizadas en DDL con Proyecto B.
  - **wa-server Multi-Instancia**: Módulos que manejan pedidos (`mixer.js` y `count-lan.js`) y facturas de compra (`invoices.js`) configurados para consultar a Core (`dbCore`), eliminando errores de schema cache.
  - **Esquema Maestro Consolidado**: `sql/SQL_Proyecto_A_Fixed.sql` (incluye correcciones de storage, grants a public/anon, constraints de templates y funciones actualizadas).
  - **Datos Restaurados**: 1,808 clientes, 1,012 productos y variantes, 601 conteos de inventario, tasas de cambio y perfiles de staff.
  - **Admin Activo**: Usuario Google `picoj386@gmail.com` activado con UID `bddc57dc-5bf9-4a72-9e1c-751d07b03164` (`role: 'admin'`, `ref_code: 'jose'`).
  - **Prevención 42P13 / Limpieza**: Si se reinstala en un proyecto nuevo, ejecutar `sql/LIMPIAR_NUEVO_SUPABASE.sql` antes de aplicar el DDL maestro.

## Catálogo de Productos y Lista de Precios (Septiembre 2026)
- **Sincronización Catálogo (04-09-2026)**: Catálogo sincronizado en Supabase con 767 variantes y productos activos según `catalogo actualizado 03_09_2026 - Hoja 1.csv`.
- **Clasificación Estricta**: La regla de asignación en `verificar_catalogo.mjs` no debe forzar productos con 'P' (Porta Taco, Porta Clip) o 'D' (Dispensadores) dentro de `BANDEJAS`.
- **Lista de Costos / Precios (`lista_costos.html`)**:
  - Organizada por defecto en modo **🔤 Por Letra Inicial (A - Z)** (`GROUP_MODE = 'letra'`) para orden correlativo estricto.
  - Impresión optimizada a **13 - 15 páginas** exactas con diseño de alta densidad, cabeceras repetidas (`thead { display: table-header-group }`) y filas protegidas contra cortes (`break-inside: avoid !important`).
  - Habilitado para vendedores (`requireAuth('vendedor')`). Documento de costos interno requiere admin (`?mode=cost`).