---
tags: [sistema]
---

# Arquitectura

```
┌────────────────────────┐        ┌──────────────────────────────────┐
│  Cloudflare Pages      │        │  Supabase  oeiuczltgdexwjjgquyq  │
│  jj-paper.pages.dev    │◄──────►│  Postgres + RLS + Realtime       │
│  (este repo → build.sh │  anon  │  Storage + Auth + pg_cron        │
│   → dist/, estático)   │        └──────────────┬───────────────────┘
└────────────────────────┘                       │ service_role
                                  ┌──────────────┴───────────────┐
                                  │  wa-server (PC de la tienda) │
                                  │  WhatsApp Baileys · Gmail    │
                                  │  campañas · LAN · heartbeat  │
                                  └──────────────────────────────┘
```

## Decisiones estructurales (y por qué)

- **Sin framework, sin build del front**: HTML+CSS+JS vanilla. Mantenible por
  cualquiera, corre en PCs viejas, cero dependencias que se pudran. El "build"
  (`build.sh`) solo COPIA lo web a `dist/` excluyendo lo interno.
- **Sin API propia**: el frontend habla directo con Supabase (clave anon + RLS).
  La lógica sensible vive en RPCs `jjp_*` con `security definer` y en el
  [[wa-server]] (service_role). Ver [[Base de datos]] y [[Modelo de seguridad]].
- **JS global, sin módulos ES**: cada página carga `<script>` en orden:
  `supabase-2.58.0.js → config.js → toast.js → admin/auth.js → sidenav.js →
  módulos`. **El orden importa** — un módulo que usa `sendPorWhatsApp` carga
  después de `send-hub.js`.
- **Colas, no llamadas directas**: enviar WhatsApp/correo = insertar fila
  `pending` en la tabla; el wa-server la despacha (Realtime + barrido de
  respaldo). El front nunca depende de que el server esté encendido.
- **Todo listener Realtime tiene sweep de respaldo** (`setInterval`) por si el
  socket se cae. Patrón en todo el wa-server.
- **Heartbeat**: el server late cada 20 s en `jjp_server_control`; el panel pinta
  🟢 si el último latido tiene < 70 s.

## Los tres frentes

| Frente | Carpeta | Auth | Nota |
|---|---|---|---|
| Público | raíz | anon | [[Catalogo publico]] |
| Vendedor | `vendedor/` | rol seller | [[Paginas y rutas]] |
| Admin | `admin/` | rol admin (máx 4, anti-lockout) | [[Paginas y rutas]] |

Login único en `admin/login.html` (email o Google OAuth), redirige por rol
(`jjp_profiles`). Regla de Auth: Email provider ON / Confirm email OFF
(incidente jul 2026 — ver [[Incidentes]]).

## Convenciones de código

- Prefijo de función = módulo: `pf*` product-finder, `send*` send-hub, `ficha*`
  ficha-producto, `doc*` doc-engine, `wa*` CRM WhatsApp, `cons*` consulta,
  `cust*` clientes, `opt*`/`fmt*` helpers de config.
- `escapeHTML()` SIEMPRE al interpolar datos (definida en `assets/js/config.js`).
- Cache-busting `?v=YYYYMMDD` en cada `<script src>` compartido.
- CSS compartido en `assets/css/`; ojo: estilos inline de `index.html` y
  `pedidos.html` PISAN `responsive.css` (ver [[Incidentes]]).
- Sidebar staff: SOLO desde `assets/js/admin/sidenav.js` (el HTML se reconstruye).

Relacionado: [[Base de datos]] · [[wa-server]] · [[Configuracion]] · [[Paginas y rutas]]
