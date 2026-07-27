---
tags: [modulo, ventas, crm]
---

# Envío de documentos y fichas (el botón 📤)

Todo lo que se le manda a un cliente sale por el CRM propio, **nunca** por
`wa.me` a secas: así queda en su historial. Tres piezas encajadas:

```
doc-engine.js  →  genera el PDF (Blob)
send-hub.js    →  menú 📤 + encola en jjp_wa_messages / jjp_emails
ficha-producto.js → caso especial: foto del catálogo + reseña + link de compra
                     ↓
              wa-server (outbox.js / email.js) despacha
```

## `assets/js/doc-engine.js` — motor único de documentos

UNA plantilla para todo: **catálogo, lista de precios, factura, recibo,
presupuesto** → devuelve `Blob` PDF. Funciones clave:

- `docArchivoDelDia(tipo, bucket)` — catálogo/lista del día (cachea en Storage
  para no regenerar el mismo PDF a cada cliente).
- `docResolvePedido(order)` / `docResolveCotizacion(quote)` — traen las LÍNEAS.
  Necesarias porque desde el chat solo llega el resumen (número y total) y sin
  líneas no hay documento que dibujar.
- `docPdfDocumento(datos, tipo)` — dibuja factura/recibo/presupuesto.
- `docDescargar(blob, filename)` — descarga local (respaldo manual).

La factura tiene **apariencia formal**: Nº de control correlativo (serie
`doc_control_serie`), IVA 16% desglosado hacia atrás, alícuota por línea —
pero declara que NO tiene valor fiscal. No "arreglar" eso (ver [[Vision y metas]]).
Colores/logo/pie salen de las claves `doc_*` de [[Configuracion]].

## `assets/js/send-hub.js` — el menú 📤

`sendMenuAbrir(event, ctx)` donde `ctx = { nombre, telefono, email, customerId,
order, quote, docs:[claves] }`. El catálogo `SEND_DOCS` define qué se puede
mandar y con qué texto: `catalogo`, `lista`, `cotizacion` (needs quote),
`factura`, `recibo`, `estado` (needs order; solo texto con link de rastreo).

Funciones reutilizables (las usa también la ficha):
- `sendPorWhatsApp({ telefono, nombre, texto, blob, filename, path, customerId,
  mime='application/pdf', tipoMedia='document' })` — abre/reusa chat con
  `jjp_wa_ensure_chat`, sube a `jjp-wa-media`, inserta fila `pending`.
- `sendPorCorreo({ email, asunto, cuerpo, html, blob, filename, path, customerId })`
  — sube a `jjp-email-media`, inserta en `jjp_emails` con `attachments` JSON.
- `sendServerOnline()` — heartbeat < 70 s.

**Servidor apagado**: el mensaje NO se pierde, queda `pending` y el menú avisa
🔴; además ofrece descargar el PDF y abrir WhatsApp Web con el texto listo para
adjuntar a mano. Nadie se queda sin atender a un cliente.

Dónde vive el botón: `admin/pedidos.html`, `admin/cotizaciones.html`,
`vendedor/pedidos.html`, `vendedor/cotizaciones.html`, `vendedor/clientes.html`
(catálogo/lista), POS, cotizador y el chat de [[CRM WhatsApp]].

## `assets/js/ficha-producto.js` — 📤 Ficha (27-jul-2026)

El caso más pedido: el cliente pregunta "¿tienen X?" y hay que mandarle la foto.

- Entrada: `fichaAbrir(event, productId)` desde `vendedor/consulta.html`
  (Consultar stock) y `admin/productos.html`.
- Toma la **foto que ya está en el catálogo** (`jjp_products.image_url`) — no se
  sube nada nuevo. Si no hay foto o el fetch falla, sale solo texto (no se pierde
  el envío).
- Arma la reseña: nombre, `description`, precio mínimo entre variantes activas en
  USD y Bs (tasa viva), marcas disponibles, y el enlace `producto.html?id=`
  (ficha pública ya existente → comprar o cotizar).
- El vendedor puede **editar el mensaje** antes de enviar.
- Cliente: buscador sobre `jjp_customers` (nombre/teléfono/correo, respeta RLS) o
  teléfono/correo escritos a mano. Si se eligió cliente, se enlaza `customer_id`.
- WhatsApp → imagen con caption (`tipoMedia:'image'`). Correo → tarjeta HTML con
  foto y botón "🛒 Comprar o cotizar" (columna `jjp_emails.html`).
- **No requirió cambios en [[wa-server]]**: el outbox ya soportaba `type:'image'`
  y el correo ya leía `html`.

## Ciclo de vida de un envío

`insert pending` → (Realtime o sweep) → `sending` (lock optimista) → envío real →
`sent` (+ `wa_msg_id`/`message_id`) o reintento hasta `MAX_RETRIES=3` → `failed`
con el mensaje de error visible en el panel.

Relacionado: [[CRM WhatsApp]] · [[Correo]] · [[Ventas y cotizaciones]] · [[wa-server]]
