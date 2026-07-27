---
tags: [concepto, entidad]
---

# Producto y variante

**La decisión estructural más importante del catálogo**: el producto es el
concepto ("Cuaderno universitario"); la **variante es lo que realmente se vende**
(cuaderno de la marca X, con su precio, su costo, su código de barras y su stock).

```
jjp_products  (nombre, descripción, foto, unidad, categoría)
      │  1─N   ← trigger sincroniza resumen al padre
jjp_product_variants  (marca, presentación, sku, barcode,
                       price_usd, costo, stock, min_qty, foto propia)
```

## Consecuencias prácticas (esto rompe cosas si se olvida)

- **El precio mostrado es el mínimo** entre variantes activas ("desde $X"), salvo
  que el cliente elija marca.
- **El stock real vive en la variante.** Un pedido sin `variant_id` no puede bajar
  stock: fue un bug real y caro ([[Incidentes]], [[Stock]]).
- Las fotos pueden ser del producto **o** de cada variante; el modal arma una
  galería con ambas.
- Los códigos de barras son de la variante, por eso el escáner resuelve
  `barcode → variante` ([[Inventario y conteo]]).

## Qué se muestra y qué se esconde

| Campo | Público | Staff |
|---|---|---|
| Nombre, descripción, foto, unidad | ✅ | ✅ |
| Precio USD/Bs | ✅ | ✅ |
| Stock | solo semáforo (Disponible / Pocas / Agotado) | número exacto |
| SKU, código de barras | ❌ (buscable, no visible) | ✅ |
| Costo | ❌ (cerrado por permisos de columna) | solo admin |

Ver [[Modelo de seguridad]].

## Dónde vive en el código

- Catálogo público y modal: `catalog.js`, `product-modal.js`, `producto.html`
- Administración: `admin/products.js` (+ variantes), `admin/pricing.js` (precios)
- Buscador staff (nombre/SKU/código/marca): `vendedor/product-finder.js`
- Ficha enviable al cliente: `ficha-producto.js` ([[Envio de documentos]])
- Importación masiva por CSV con upsert; imágenes vía `wa-server/upload-images.js`
  (que **no** crea productos, solo enlaza por SKU)

## Descripciones

Si un producto no tiene `description`, el catálogo público **genera una frase con
emoji** según palabras del nombre. Pero la [[Envio de documentos|ficha que se
manda al cliente]] usa la descripción real de la base de datos: cargarlas mejora
directamente lo que recibe el cliente ([[Pendientes]]).

Relacionado: [[Stock]] · [[Dinero y tasas]] · [[Catalogo publico]] · [[Inventario y conteo]]
