---
tags: [modulo, ventas]
---

# Delivery cotizado por distancia

Implementado el 25-jul-2026. Frontend: `assets/js/checkout.js` (+ Leaflet
**vendoreado**, sin CDN externo). Confirmación: `admin/pedidos.html`.

## Cómo se calcula

1. El cliente marca su ubicación en el checkout: pin en el mapa, GPS del
   navegador o búsqueda de dirección (Nominatim).
2. Distancia = **haversine × 1.4** (factor de calles reales, no línea recta)
   desde `map_lat`/`map_lng` de la tienda ([[Configuracion]]).
3. Precio = `delivery_base_usd` + `delivery_per_km_usd` × km, y **gratis** si el
   pedido supera `delivery_free_over_usd`. Las tres claves se editan en ajustes.

## Confirmación humana

El fee calculado es una **propuesta**: en `admin/pedidos.html` el staff lo
confirma, lo edita o lo regala con el botón "🆓 gratis". Nada sale automático
hacia el cliente sin que alguien lo mire.

## Reglas que no se pueden romper

- Las **comisiones de vendedor EXCLUYEN el envío** (no se comisiona flete).
- `jjp_decide_discount` **conserva el delivery fee** al aprobar/negar descuentos
  (si se pierde, el total queda mal y el vendedor cobra de menos).

**Conceptos que toca**: [[Pedido]] (el fee viaja en el pedido) ·
[[Dinero y tasas]] (no comisiona) · [[Cliente]] (su dirección)

Relacionado: [[Ventas y cotizaciones]] · [[Catalogo publico]] · [[Configuracion]]
