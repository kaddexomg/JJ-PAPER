---
tags: [cerebro, arquitectura, ia, ontologia, catalogo]
---

# Ontología y Motor Cognitivo de Productos JJ Paper

> **Directriz Sagrada**: La IA de JJ Paper NUNCA debe operar a ciegas ni asumir reglas rígidas superficiales ("nunca cajas", "siempre suelto", etc.). Los productos de papelería, oficina e industria tienen presentaciones comerciales exactas: unidades individuales, paquetes, cajas por docena (X12), bultos, resmas o estuches.

## 1. Reglas de Presentación Comercial

| Presentación | Patrón en Nombre / SKU | Regla de Representación Visual | Ejemplo |
|---|---|---|---|
| **Caja / Docena** | `X12`, `X 12`, `DOC`, `CAJA`, `C/12` | **Debe mostrarse la caja oficial con el producto** o la caja abierta exhibiendo las 12 unidades. Si es estuche de marcadores, se muestra la caja con sus marcadores. | `MARCADOR P/PIZARRA EXPO ROJO X12` |
| **Blíster / Paquete** | `BLISTER`, `PACK`, `X2`, `X3`, `X4`, `X6`, `PAQ` | **Debe mostrarse el blíster o paquete sellado** con la cantidad visible indicada. | `MARCADOR P/FINA PERMANENTE COL X 6` |
| **Resma / Bulto** | `RESMA`, `BULTO`, `500 HJS`, `C/5`, `C/10` | **Debe mostrarse la resma empacada en su papel impreso de marca** o el bulto correspondiente, no hojas blancas sueltas. | `PAPEL FOTOCOPIA REPORT CARTA RESMA` |
| **Unidad Suelta** | `UND`, `PZA`, `1 UNID`, sin multiplicador | **Debe mostrarse el artículo individual sin embalaje secundario**, en ángulo comercial con sombra natural. | `TIJERA 8 PULGADAS ACERO OFIMAK` |
| **Bandeja / Dispensador** | `DISPENSADOR`, `PORTA TACO`, `ORGANIZADOR` | **Debe mostrarse la pieza física completa** con su acabado real (acrílico, metal, etc.). | `BANDEJA ACRILICA DOBLE HUMO` |

## 2. Parámetros Obligatorios de Análisis (5 Dimensiones)

Antes de buscar o renderizar, la IA debe descomponer el producto en un JSON estricto:
```json
{
  "product_type": "marcador de pizarra",
  "brand": "Expo",
  "model_color": "Rojo",
  "packaging": "caja_x12",
  "quantity": 12,
  "unit": "doc",
  "visual_intent": "Caja oficial de 12 marcadores Expo para pizarra color rojo, fondo blanco puro #FFFFFF"
}
```

## 3. Pipeline de Búsqueda Web de Imágenes

1. **Expansión Semántica**: Con el JSON ontológico, generar 3 queries:
   - Query exacta: `"Marcador pizarra Expo rojo caja 12"`
   - Query fabricante / retail: `"Expo dry erase red box 12"`
   - Query genérica de respaldo: `"Expo marcador rojo docena"`
2. **Fuentes Validadas**: Comercios de papelería, MercadoLibre, distribuidores autorizados, Office Depot, Walmart, Librería La Alegría.
3. **Filtros Negativos**: Descartar imágenes de logos solos, hojas de especificaciones PDF, capturas de pantalla o fotos con marca de agua intrusiva.

## 4. Pipeline de Generación con IA (Cuando no hay foto web)

- Si el empaque es `caja_x12`, el prompt describe: *"The official retail packaging box of 12 [Brand] [Product], showing authentic brand graphics, with 1 marker placed neatly next to the box, on pure solid white background #FFFFFF, commercial product photography, 8k, sharp focus"*.
- Si el empaque es `unidad`, el prompt describe el artículo individual sin caja ni blíster.

## 5. Control de Calidad y Optimización (Sharp WebP)

- **Dimensiones**: Cuadrado 800x800 px (o centrado con canvas blanco si tiene otra relación de aspecto).
- **Formato**: WebP calidad 85 (sin pérdida perceptible).
- **Peso Máximo en DB / Storage**: **< 150 KB** (PROHIBIDO subir imágenes de 5 MB a 15 MB).
- **Bucket**: `jjp-products` en Proyecto C (`nmcamjxhyysmmvgxgabo`).
