---
tags: [concepto, entidad, critico]
---

# Stock (existencias)

> ⚠️ **Zona prohibida sin permiso**: nunca modificar datos de inventario sin orden
> explícita del dueño ([[Reglas de trabajo]], regla 6). Es el activo del negocio.

## Dónde vive el número real

En `jjp_product_variants.stock` — por producto **y marca**. Un trigger sincroniza
el resumen al producto padre, pero **la verdad es la variante**
([[Producto y variante]]).

## Las 4 formas de que cambie

| Vía | Quién | RPC |
|---|---|---|
| Venta pagada | admin marca pagado | `jjp_apply_order_stock` (reversible) |
| Ajuste manual | admin en inventario | `jjp_set_stock` |
| Conteo físico | varias personas contando | `jjp_count_*` (por deltas) |
| Devolución/reversa | admin | `jjp_revert_order_stock` |

**Toda** vía escribe en el **kardex** `jjp_stock_moves` con razón y número de
pedido. Regla de auditoría: *cambio de stock sin fila de kardex = bug*
([[Guia maestra de auditoria]], bloque B).

## Conteo físico: por qué es por deltas

Varias personas cuentan a la vez con el mismo login. Si cada teléfono escribiera
**totales**, el último en enviar pisaría a los demás. Por eso todo suma de a uno
(`jjp_count_scan`, `jjp_count_add`) y cada escaneo se etiqueta con `counted_by`.
Detalle en [[Inventario y conteo]].

## Qué ve el cliente

**Nunca el número.** Solo semáforo: ✔ Disponible / ⚠ Pocas unidades / ✕ Agotado.
El tope de compra sí respeta el stock real, pero al topar dice "cantidad máxima
alcanzada" sin revelar cuánto hay. Razón: con el stock exacto la competencia
deduce rotación y proveedor ([[Modelo de seguridad]]).

En la lista de precios al público tampoco se dice "Agotado" (decisión de negocio
del 7-jul: no espantar al cliente, se conversa la disponibilidad).

## Señales de que algo anda mal

- Pedido `pagado` sin movimientos en el kardex → el stock quedó inflado.
- Stock negativo o padre ≠ suma de variantes → trigger o escritura directa.
- Conteo aplicado dos veces → revisar bitácora y usar `jjp_count_revert`.

Relacionado: [[Producto y variante]] · [[Pedido]] · [[Inventario y conteo]] · [[Incidentes]]
