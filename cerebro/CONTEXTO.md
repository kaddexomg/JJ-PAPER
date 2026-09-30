---
tags: [embudo, contexto]
---

# ⚡ CONTEXTO — lee esto primero

> **El embudo del cerebro.** Una sola lectura y ya tienes el 80% del contexto para
> trabajar sin romper nada. Cada enlace baja al detalle. Si solo vas a leer una
> nota de todo el baúl, que sea esta.

## En una frase

Sistema completo de una papelería real en Venezuela: tienda online + POS +
cotizador + CRM de WhatsApp y correo + inventario con conteo físico + delivery +
comisiones. HTML/CSS/JS vanilla sobre Supabase, con un servidor Node en la PC de
la tienda que despacha WhatsApp y correo. Ver [[Vision y metas]].

## Las 6 verdades que cambian cómo trabajas

1. **Es producción de un negocio real.** Si el WhatsApp se cae o el stock queda
   mal, la tienda pierde ventas ese mismo día. Por eso: confirmar el plan antes de
   tocar, nunca inventarios sin orden, no romper el [[wa-server]] ([[Reglas de trabajo]]).
2. **No hay framework ni build del front.** Todo es JS global cargado por
   `<script>` **en orden**; `escapeHTML()` obligatorio; subir el `?v=` al editar un
   JS compartido ([[Arquitectura]]).
3. **No hay API propia.** El navegador habla directo con Supabase usando la clave
   anon + RLS. La lógica sensible vive en RPCs `jjp_*` y en el servidor
   ([[Base de datos]], [[Modelo de seguridad]]).
4. **Nada se envía en directo: todo se encola.** Mandar un WhatsApp o un correo es
   insertar una fila `pending`; el servidor la despacha. Si el servidor está
   apagado, no se pierde nada ([[Cola de mensajes]]).
5. **El público no ve stock exacto, ni SKU, ni costos.** Es información con la que
   la competencia deduce proveedores y márgenes ([[Modelo de seguridad]]).
6. **Cada error ya cometido está escrito.** Antes de tocar una zona, mira
   [[Incidentes]]: ahí está por qué las cosas son como son.

## El mapa mental en 30 segundos

```
        CLIENTE                          NOSOTROS
  ─────────────────────         ──────────────────────────────
  catálogo público      ←──→    admin/ y vendedor/ (paneles)
  carrito + checkout             POS · cotizador · CRM · inventario
        │                                   │
        └──────► Supabase (RLS) ◄───────────┘
                     │
                     ▼
              wa-server (PC tienda)
              WhatsApp · Gmail · LAN
```

Entidades que atraviesan TODO el sistema (los nodos del grafo):
[[Cliente]] · [[Producto y variante]] · [[Pedido]] · [[Cotizacion]] · [[Stock]] ·
[[Dinero y tasas]] · [[Cola de mensajes]] · [[Sesion y roles]]

## Los 4 flujos que sostienen el negocio

| Flujo | Recorrido | Nota |
|---|---|---|
| **Venta pública** | catálogo → carrito → checkout (Bs + comprobante + envío) → verificar pago → baja stock → rastreo | [[Pedido]] |
| **Venta asistida** | cliente pregunta → 📤 ficha o cotización → convertir → cobrar | [[Ventas y cotizaciones]] |
| **Conversación** | WhatsApp/correo entrante → CRM → ficha 360° del cliente → responder o enviar documento | [[CRM WhatsApp]] |
| **Reposición** | conteo físico multi-persona → cruces → aplicar al stock → kardex | [[Inventario y conteo]] |

## Coordenadas de producción

| Qué | Dónde |
|---|---|
| Sitio | **jj-paper.pages.dev** (Cloudflare Pages; Netlify obsoleto) |
| Base de datos | Supabase Multi-Proyecto: **A (Core: `wwcdxqpibequfohbgejs`)**, **B (Comm: `klcibjwleiqppedefpxw`)**, **C (Storage: `nmcamjxhyysmmvgxgabo`)**. |
| Servidor | `wa-server/` en la PC de la tienda (Windows 7/10 en `192.168.0.172`); 🟢/🔴 por heartbeat en el panel |
| MixNet | Sistema administrativo en comp01 (`\\192.168.0.185\comp01` / Unidad M:). |
| Guías Clave | [[REGLAS_AGENTE.md]] (reglas para agentes IA) · [[MAPA_SISTEMA.md]] (mapa de 54 páginas y módulos) |
| Repo | privado `github.com/kaddexomg/JJ-PAPER`, rama `main` |

Detalle en [[Configuracion]], [[REGLAS_AGENTE.md]] y [[MAPA_SISTEMA.md]].

## Antes de escribir una sola línea

1. ¿Qué entidad toco? → lee su nota de concepto (arriba).
2. ¿Qué archivos? → [[Mapa de archivos]] (índice inverso código → documentación).
3. ¿Es una tarea típica? → [[Por tarea]] (ruta de lectura y pasos ya trazados).
4. ¿Esa zona ya mordió antes? → [[Incidentes]].
5. Confirma el plan con el dueño ([[Reglas de trabajo]], regla 1).

## Al terminar

Actualiza la nota del módulo tocado, agrega una línea a [[Historia]] y, si nació
una trampa nueva, escríbela en [[Incidentes]]. Este cerebro solo sirve si refleja
el código de hoy.

---

Siguiente parada: [[INICIO]] (mapa completo del baúl) · [[Glosario]] (términos del negocio)
