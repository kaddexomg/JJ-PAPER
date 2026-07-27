---
tags: [seguridad]
---

# Modelo de seguridad

## Quién es quién

| Actor | Clave | Puede |
|---|---|---|
| Visitante | `anon` | leer catálogo/promos/reseñas, crear cotización y lead, rastrear su pedido |
| Vendedor | JWT rol seller | su cartera de clientes + los libres, sus pedidos/cotizaciones, su WhatsApp y correo |
| Admin | JWT rol admin (máx 4) | todo el panel |
| wa-server | `service_role` | todo, sin RLS — la clave vive SOLO en `wa-server/.env` |

Login único en `admin/login.html` (email o Google). Trigger `jjp_admin_limit`:
máximo 4 admins con **anti-lockout** (no deja quedarse sin ninguno). Regla de
Auth del proyecto: **Email provider ON / Confirm email OFF** (cambiarlo dejó a
todo el mundo fuera una vez — ver [[Incidentes]]).

## Reglas de RLS

- Toda tabla `jjp_*` con RLS activo.
- Políticas escritas como `(select auth.uid())`, **no** `auth.uid()` pelado
  (rendimiento: se migraron 62 políticas el 25-jul).
- Nada de `USING (true)` en escritura para `anon`.

## Funciones RPC

- Las sensibles llevan `REVOKE EXECUTE FROM public, anon`.
- ⚠️ **`REVOKE ... FROM anon` NO basta** si el `EXECUTE` viene de `PUBLIC`: hay que
  revocar de `PUBLIC` también. Así quedó `purge_chats` borrable por anon una vez.
- Las públicas a propósito: `jjp_capture_lead`, `jjp_track_order`,
  `jjp_track_quote`, `jjp_create_quote`, `jjp_best_sellers`, `jjp_seller_by_ref`.
- `search_path` fijado en las funciones `security definer`.

## Qué NUNCA ve el público

| Dato | Por qué | Cómo se protege |
|---|---|---|
| Stock exacto | la competencia deduce rotación y proveedor | semáforo en UI + columnas cerradas |
| SKU | es el código con el que compramos | indexado para buscar, nunca pintado |
| Costos | margen del negocio | permisos por columna + Realtime por columnas |
| `oauth_refresh` / `app_pass` de correo | tomar la cuenta de Gmail | fuera del alcance de anon |

Cualquier `select('*')` nuevo en una página pública debe revisarse contra esta tabla.

## Storage

| Bucket | Visibilidad |
|---|---|
| `jjp-receipts` | **privado**, signed URLs (comprobantes de pago de clientes) |
| `jjp-wa-media`, `jjp-email-media` | privados, acceso por el server / RLS |
| imágenes de producto, `jjp-brands` | públicos (son catálogo) |

## Deploy y repo

- `build.sh` publica SOLO lo web: excluye `wa-server/`, `sql/`, `docs/`,
  `cerebro/`, `*.md` y datos sueltos. **Carpeta interna nueva ⇒ agregarla ahí.**
- `_headers` aporta cabeceras de seguridad en Cloudflare.
- `.gitignore` blindado contra datos de negocio (CSV de costos fuera del repo).
- Repo privado. `.env` jamás en git.

Relacionado: [[Incidentes]] · [[Guia maestra de auditoria]] · [[Base de datos]] · [[Configuracion]]
