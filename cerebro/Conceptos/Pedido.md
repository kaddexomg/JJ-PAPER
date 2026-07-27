---
tags: [concepto, entidad]
---

# Pedido

**Tabla**: `jjp_orders`. Es donde el sistema toca dinero de verdad: cambia stock,
genera comisión y produce documentos.

## Ciclo de vida

```
pendiente_pago → verificando → pagado → preparando → enviado → entregado
                      ↘ rechazado        ↘ cancelado
```

El salto crítico es **→ pagado**: dispara `jjp_apply_order_stock`, que baja
[[Stock]] por variante y escribe el kardex. `jjp_revert_order_stock` lo deshace.
`jjp_delete_order` solo borra cancelados o rechazados (limpiar pruebas).

## De dónde viene

| Origen | Cómo |
|---|---|
| Checkout público | el cliente compra y sube comprobante de pago |
| POS | venta de mostrador, ya pagada |
| Conversión de [[Cotizacion]] | `jjp_convert_quote` |

> ⚠️ En los tres casos las líneas **deben llevar `variant_id`**. Sin él, el stock
> nunca baja — bug histórico documentado en [[Incidentes]].

## Qué carga encima

- **Cliente** (`customer_id`) → alimenta los contadores de [[Cliente]].
- **Vendedor** (`seller_id`) → comisión, que **excluye el costo de envío**.
- **Envío** (`delivery_*`) → calculado por distancia y confirmado por el staff
  ([[Delivery]]).
- **Descuento** → `jjp_decide_discount` aprueba o niega y **debe conservar el fee
  de envío** (si se pierde, el total queda mal).
- **Origen** (`quote_id`) si vino de una cotización.

## Qué produce

- Documentos: factura, recibo, presupuesto ([[Envio de documentos]]).
- Rastreo público: `rastreo.html?n=<número>` (tolerante, busca teléfono por dígitos).
- Movimientos de kardex ([[Stock]]).
- Notificaciones al vendedor.

## Dónde vive en el código

- Público: `checkout.js`, `orders.js`, `rastreo.html`
- Admin: `assets/js/admin/orders.js` (verificar pago, descuentos, envío, 📤)
- Vendedor: `assets/js/vendedor/vorders.js`, `pos.js`
- Documentos: `doc-engine.js` + `comprobante.html`

## Al auditar

Bloque B de la [[Guia maestra de auditoria]]: `variant_id` presente, kardex sin
huecos, totales que cuadren (líneas + envío − descuento), contadores de cliente
correctos.

Relacionado: [[Cliente]] · [[Cotizacion]] · [[Stock]] · [[Dinero y tasas]] · [[Ventas y cotizaciones]]
