---
tags: [modulo, inventario]
---

# Inventario, kardex y conteo físico

> ⚠️ Regla dura: **NUNCA tocar datos de inventario sin orden explícita del dueño**
> ([[Reglas de trabajo]]). Es el activo más delicado del negocio.

## Modelo de existencias

El stock real vive en `jjp_product_variants` (por producto **y marca**), con
trigger que sincroniza el resumen al producto padre. Cada variante tiene su
`sku`, `barcode`, `price_usd`, costo, `stock` y `min_qty`.

**Kardex** (`jjp_stock_moves`): TODO cambio de stock deja rastro — venta, conteo,
ajuste manual — con razón y número de pedido. Si algo cambió stock sin fila en el
kardex, es un bug.

## Inventario y escáner (`admin/inventario.html`, `escaner.html`)

`inventory.js` / `inv-scan.js`: ajustes con `jjp_set_stock`, alta de productos
desde el escáner, resolución de códigos desconocidos
(`jjp_count_unknown_resolve`), asignación/limpieza de códigos de barras
(`jjp_barcode_assign` / `jjp_barcode_clear`).

## Conteo físico multi-persona

Varias personas cuentan a la vez con el mismo login; cada escaneo se etiqueta con
`counted_by`. **Todo va por DELTAS** (`jjp_count_scan`, `jjp_count_add`), nunca
escribiendo totales absolutos — si dos teléfonos escribieran totales, se pisarían.

- Teléfono: `vendedor/scan.html` (o la app LAN) → suma de a uno.
- PC: feed en vivo del conteo.
- Cola offline en `localStorage` si se cae la conexión.
- `admin/conteo.html` (`count-control.js`): cruces de códigos, bitácora con
  **deshacer** (`jjp_count_revert`), transferencias (`jjp_count_transfer`),
  quién contó qué, explorador "sin código" y **valorización** en USD/Bs
  (incompleta mientras falten costos — ver [[Pendientes]]).

## Conteo offline por WiFi local (`count-lan.js`)

Cuando no hay internet en el depósito: el [[wa-server]] sirve la app y una API
local.

- Teléfono → `https://<ip-lan>:8788` (cert autofirmado, **necesario para que el
  navegador dé acceso a la cámara**). PC → `http://<ip-lan>:8787`.
- Buffer en disco + espejo por SSE; al reconectar sube en lote con
  `jjp_count_apply_batch`.
- QR de arranque en `/lan/start`; `admin/lan.html` muestra el estado.
- El server elige la IP real de WiFi (no la del VPN) y **no expone `.env`**.

## Puente teléfono → PC para vender (distinto del conteo)

`jjp_pos_scans`: el teléfono actúa como pistola de códigos para POS/cotizador
vía Realtime (`pfPhoneBridge`). **No afecta inventario ni conteo.**

Relacionado: [[Ventas y cotizaciones]] · [[Base de datos]] · [[wa-server]] · [[Catalogo publico]]
