---
tags: [concepto, entidad]
---

# Cotización

**Tabla**: `jjp_quotes`. Es el paso previo a la venta al mayor: mismo formato de
líneas que un [[Pedido]], pero sin compromiso ni movimiento de [[Stock]].

## De dónde viene

| Origen | Quién | RPC |
|---|---|---|
| `pedidos.html` (público) | el cliente pide cotización al mayor | `jjp_create_quote` |
| Chatbot del sitio | conversación guiada | `jjp_create_quote` |
| Cotizador del vendedor | staff, con buscador de productos | insert directo |

## Qué se hace con ella

1. **Enviarla en PDF** al cliente por WhatsApp o correo con el botón 📤
   ([[Envio de documentos]]). El PDF sale del motor único `doc-engine.js`.
2. **Convertirla en pedido** con `jjp_convert_quote`, que además enlaza
   `quote_id` y `customer_id`.

> ⚠️ **La conversión debe conservar `variant_id`.** Cuando lo perdía, el pedido
> nacía sin variante y el stock nunca bajaba: el inventario del sistema se iba
> separando del real sin que nadie lo notara. Corregido el 26-jul, pero es el
> primer punto a verificar si alguien toca este flujo ([[Incidentes]]).

## Detalles que importan

- Los precios llevan la advertencia de que **están sujetos a la tasa del día**
  ([[Dinero y tasas]]).
- Puede llevar descuento propio, que viaja al pedido al convertirse.
- Rastreo público de cotización: `jjp_track_quote`.
- El documento se llama "Presupuesto" al imprimirse (no "Factura").

## Dónde vive en el código

- Vendedor: `assets/js/vendedor/vquotes.js` (crear), `vquotes-list.js` (listar,
  enviar, convertir)
- Admin: `assets/js/admin/quotes.js`
- Público: `assets/js/orders.js`, `chatbot.js`
- Documento: `doc-engine.js` → `docResolveCotizacion()` + `docPdfDocumento(…, 'presupuesto')`

> Nota técnica: desde el chat solo llega el **resumen** de la cotización (número y
> total). Por eso existe `docResolveCotizacion()`: sin traer las líneas no hay
> documento que dibujar.

Relacionado: [[Pedido]] · [[Cliente]] · [[Ventas y cotizaciones]] · [[Envio de documentos]]
