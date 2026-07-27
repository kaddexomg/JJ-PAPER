---
tags: [modulo, ventas]
---

# Ventas, cotizaciones y comisiones

## El ciclo completo

```
Cliente pregunta → [[Envio de documentos|📤 Ficha]] / cotización
        ↓
Cotizador (vendedor) o pedidos.html (público)  →  jjp_quotes
        ↓  jjp_convert_quote  (conserva variant_id ⚠️)
     jjp_orders  →  admin verifica pago  →  jjp_apply_order_stock
        ↓                                         ↓
   rastreo público                        kardex jjp_stock_moves
```

## POS (`vendedor/pos.html` → `pos.js`)

Venta directa en mostrador. Usa `product-finder.js` (nombre/SKU/código/marca,
escáner físico y cámara, puente teléfono→PC vía `jjp_pos_scans`). Parámetros:
`?add=<productId>` agrega solo, `?cliente=<id>` precarga cliente. Al cobrar
genera pedido pagado + comprobante imprimible y puede enviarlo con 📤.

## Cotizador (`vendedor/cotizador.html` → `vquotes.js`)

Mismo buscador. Guarda en `jjp_quotes` con descuento opcional. Desde
`cotizaciones.html` (`vquotes-list.js`) se envía el PDF al cliente y se convierte
en pedido con `jjp_convert_quote`.

> ⚠️ **Lección grabada**: la conversión perdía `variant_id` y el stock NUNCA
> bajaba. Corregido el 26-jul. Cualquier cambio en el flujo debe preservar
> `variant_id` de punta a punta. Ver [[Incidentes]].

## Pedidos (admin: `orders.js` · vendedor: `vorders.js`)

- Estados: `pendiente_pago → verificando → pagado → preparando → enviado →
  entregado`, más `cancelado` / `rechazado`.
- Al marcar **pagado**: `jjp_apply_order_stock` baja stock por variante y escribe
  kardex. `jjp_revert_order_stock` deshace.
- Descuentos: `jjp_decide_discount` (aprueba/niega; **conserva el delivery fee**).
- `jjp_delete_order` borra solo cancelados/rechazados (limpiar pruebas).
- Delivery: el staff confirma el fee calculado o lo regala con "🆓 gratis"
  (ver [[Delivery]]).
- Botón 📤 en cada fila: factura, recibo, estado del pedido.

## Clientes (`vendedor/clientes.html` → `vcustomers.js`)

Cartera con filtros míos / sin vendedor / inactivos (+60 días sin comprar → 😴).
"Tomar" un cliente libre lo asigna. Importación masiva desde Excel/CSV con
normalización de teléfonos venezolanos y deduplicación por teléfono/correo.
Accesos directos: vender, cotizar, chat CRM, WhatsApp de reactivación, 📤
catálogo/lista.

Contadores `total_orders`/`total_usd`: recálculo **idempotente** (hubo doble
conteo por sumar en dos caminos distintos).

## Precios (`admin/precios.html` → `pricing.js`)

Precio por variante (marca). Cálculo sugerido desde costo + margen
(`default_margin_pct`) + tasas. Actualización masiva. Lista imprimible en
`lista_costos.html` (modo costo solo staff, agrupada por segmento, A-Z).

## Vendedores y comisiones (`admin/vendedores.html` → `sellers.js`)

Roles y metas en `jjp_profiles`; ranking con `jjp_seller_ranking`; atribución por
`?ref=<código>` (resuelto con `jjp_seller_by_ref`). **Las comisiones excluyen el
costo de envío**. Notificaciones in-app (`jjp_notifications`) + crons diario y
semanal de resumen.

**Conceptos que toca**: [[Pedido]] · [[Cotizacion]] · [[Cliente]] · [[Stock]] ·
[[Dinero y tasas]] · [[Producto y variante]] · [[Sesion y roles]] (comisiones y `?ref=`)

Relacionado: [[Envio de documentos]] · [[Inventario y conteo]] · [[Delivery]] · [[Base de datos]]
