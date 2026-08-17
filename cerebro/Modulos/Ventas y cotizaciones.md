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
- **Precios personalizables**: El vendedor puede editar manualmente el precio de venta unitario de cada ítem en el ticket, recalculando subtotales y totales inmediatamente.

## Cotizador (`vendedor/cotizador.html` → `vquotes.js`)

Mismo buscador. Guarda en `jjp_quotes` con descuento opcional. Desde
`cotizaciones.html` (`vquotes-list.js`) se envía el PDF al cliente y se convierte
en pedido con `jjp_convert_quote`.
- **Precios personalizables**: El vendedor tiene la facultad de modificar en vivo el precio unitario del artículo en el carrito antes de emitir la cotización.

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
- **Integración con MixNet**: Los pedidos se exponen a través del servidor local de la PC de la tienda en `http://localhost:8787/lan/mixnet/pedidos` (formatos JSON y CSV), se guardan automáticamente en `wa-server/pedidos_mixnet_local.csv` cada 60 segundos, y adicionalmente el puente `wa-server/src/mixer.js` genera en tiempo real archivos individuales CSV y TXT por cada pedido en `C:/JJ-PAPER-MIXER` para facilitar que el Mixer de facturación los jale de forma aislada. Para entornos donde el servidor principal no está en la misma LAN, se dispone de la solución puente autónoma [`mixer-bridge.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/mixer-bridge.js) que se ejecuta con Node.js 13.14.0 en una de las PC de los vendedores de la tienda, escribiendo los pedidos directamente en la unidad de red mapeada `M:\mixnet` de Windows 7 sin requerir permisos de administrador. Ver [[DISEÑO_RED_MIXNET]].

## Clientes (`vendedor/clientes.html` → `vcustomers.js`)

Cartera con filtros míos / sin vendedor / inactivos (+60 días sin comprar → 😴).
"Tomar" un cliente libre lo asigna. Importación masiva desde Excel/CSV con
normalización de teléfonos venezolanos y deduplicación por teléfono/correo.
Accesos directos: vender, cotizar, chat CRM, WhatsApp de reactivación, 📤
catálogo/lista.

Contadores `total_orders`/`total_usd`: recálculo **idempotente** (hubo doble
conteo por sumar en dos caminos distintos).

## Precios (`admin/precios.html` → `pricing.js` y `vendedor/productos.html` → `vproducts.js`)

- **General**: Precio por variante (marca). Cálculo sugerido desde costo + margen (`default_margin_pct`) + tasas. Actualización masiva. Lista imprimible en `lista_costos.html` (modo costo solo staff, agrupada por segmento, A-Z).
- **Personalizados por Vendedor**: Cada vendedor puede personalizar precios base para variantes y productos en `vendedor/productos.html` (tabla `jjp_seller_prices`). El buscador universal `product-finder.js` (`pfLoad`) inyecta automáticamente estos precios en el POS y el Cotizador si hay un vendedor activo.

## Vendedores y comisiones (`admin/vendedores.html` → `sellers.js`)

Roles y metas en `jjp_profiles`; ranking con `jjp_seller_ranking`; atribución por
`?ref=<código>` (resuelto con `jjp_seller_by_ref`). **Las comisiones excluyen el
costo de envío**. Notificaciones in-app (`jjp_notifications`) + crons diario y
semanal de resumen.

**Conceptos que toca**: [[Pedido]] · [[Cotizacion]] · [[Cliente]] · [[Stock]] ·
[[Dinero y tasas]] · [[Producto y variante]] · [[Sesion y roles]] (comisiones y `?ref=`)

Relacionado: [[Envio de documentos]] · [[Inventario y conteo]] · [[Delivery]] · [[Base de datos]]
