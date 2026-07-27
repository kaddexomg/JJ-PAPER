---
tags: [modulo, publico]
---

# Catálogo público, ficha y chatbot

## Catálogo (`catalogo.html` → `catalog.js`)

- Jerarquía: **grupos** (`jjp_category_groups`) → **categorías** → productos.
  URL: `?grupo=<slug>` y `?cat=<slug>` (abre su familia sola).
- Búsqueda indexa nombre, marca y SKU — pero **el SKU no se pinta** (es el código
  con el que compramos).
- Descripciones automáticas: si un producto no trae `description`, `catalog.js`
  genera una frase con emoji según palabras clave del nombre (ALFILER, CUADERNO,
  RESMA…). La [[Envio de documentos|ficha enviada al cliente]] usa la
  `description` real de la DB, así que vale la pena cargarlas.
- Productos `essential` van en la primera página; `featured` al home.
- Export del catálogo en PDF/Excel con estilos (`export.js`), precios USD + Bs a
  tasa BCV viva.

## Ficha de producto

Dos caras del mismo dato:
- **Modal** (`product-modal.js`) dentro del catálogo: galería (imagen del producto
  + imágenes por variante), selector de marca con precio propio, cantidad con
  mínimo, comprar / agregar / cotizar al mayor / consultar por WhatsApp, lightbox
  con zoom, compartir.
- **Página** `producto.html?id=` — enlace estable, es el destino del botón
  Compartir y del enlace que manda la [[Envio de documentos|📤 Ficha]].

**Semáforo de stock, nunca la cantidad**: "✔ Disponible / ⚠ Pocas unidades /
✕ Agotado". El tope de compra sí respeta el stock real, pero el número no se dice
(la competencia deduce rotación y proveedor con eso). Ver [[Modelo de seguridad]].

## Carrito y checkout

`cart.js` (localStorage, por variante) → `checkout.html` con pago en Bs,
comprobante de pago y envío cotizado por distancia (ver [[Delivery]]).

## Chatbot (`chatbot.js`)

FAB de WhatsApp en el sitio. Capta nombre + teléfono al abrir
(`jjp_capture_lead` → `jjp_customers`), busca productos por marca o descripción,
ofrece promociones vigentes y puede crear una cotización (`jjp_create_quote`) o
consultar estado (`jjp_track_order` / `jjp_track_quote`).

## Home y promociones

Hero con chapa 3D + carrusel de promociones (`hero-promos.js`), reseñas
(`reviews.js`), marquee de clientes fiables (`jjp_clients`), motion orgánico
(`motion.js`). `promociones.html` con filtros; admin las edita con preview en vivo.

> Cuidado: el `<style>` inline de `index.html` PISA `responsive.css` — las reglas
> del hero mobile viven en el HTML. Ver [[Incidentes]].

**Conceptos que toca**: [[Producto y variante]] (galería y precio "desde") ·
[[Stock]] (semáforo, nunca el número) · [[Dinero y tasas]] (USD + Bs) ·
[[Cliente]] (el chatbot capta leads) · [[Cotizacion]] (cotizar al mayor)

Relacionado: [[Ventas y cotizaciones]] · [[Envio de documentos]] · [[Inventario y conteo]]
