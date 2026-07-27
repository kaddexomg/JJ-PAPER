---
tags: [concepto, entidad, seguridad]
---

# Sesión y roles

## Los cuatro actores

| Actor | Credencial | Alcance |
|---|---|---|
| Visitante | clave `anon` | catálogo, promos, reseñas; crear cotización/lead; rastrear su pedido |
| Vendedor | JWT rol seller | su cartera de [[Cliente|clientes]] + los libres, sus ventas, su WhatsApp y correo |
| Admin | JWT rol admin (máx 4) | todo el panel |
| Servidor | `service_role` | todo, sin RLS — la clave vive solo en `wa-server/.env` |

## Puerta única

`admin/login.html` es la **única** entrada del staff (correo/contraseña o Google
OAuth) y redirige según el rol guardado en `jjp_profiles`. Un trigger provisiona
el perfil al registrarse con Google.

**Guardas activas**:
- `jjp_admin_limit`: máximo 4 admins, con **anti-lockout** (no permite quedarse
  sin ninguno).
- Regla de Auth del proyecto: **Email provider ON / Confirm email OFF** —
  activar la confirmación dejó a todo el equipo fuera una vez ([[Incidentes]]).

## Cómo lo aplica el código

- `assets/js/admin/auth.js` → guarda de sesión y rol en cada página de staff.
- `assets/js/vendedor/vcommon.js` → `initSellerPage()`: valida rol y carga
  notificaciones. **Toda página nueva de vendedor debe llamarlo.**
- La autorización real no está en el JS: está en **RLS** ([[Modelo de seguridad]]).
  El guardia del front es comodidad, no seguridad.

## Identidad del vendedor en el negocio

`jjp_profiles` guarda además metas, comisiones y `ref_code`. Ese código alimenta
la atribución `?ref=` del sitio público (resuelta con `jjp_seller_by_ref`): una
venta que entra por su enlace queda a su nombre ([[Ventas y cotizaciones]]).

Cada vendedor tiene **su propia sesión de WhatsApp** ([[CRM WhatsApp]]) y **su
propia cuenta de correo** ([[Correo]]); las colas se despachan por `owner_id`
([[Cola de mensajes]]).

Relacionado: [[Modelo de seguridad]] · [[Cliente]] · [[Configuracion]] · [[Incidentes]]
