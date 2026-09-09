# Motor de Búsqueda Inteligente de Productos — JJ Paper C.A.
# Este documento es leído por las APIs de Gemini como contexto estructurado
# para resolver búsquedas de productos con precisión absoluta.

## Taxonomía de Productos JJ Paper

### NIVEL 1: CATEGORÍAS PRINCIPALES
Los productos de JJ Paper se clasifican en estas familias primarias:

1. **PAPELERÍA Y HOJAS** → Resmas de papel bond, hojas sueltas, papel fotocopia
2. **CUADERNOS Y BLOCKS** → Cuadernos engrapados, espirales, cosidos, blocks de notas
3. **INSTRUMENTOS DE ESCRITURA** → Bolígrafos, lápices, marcadores, resaltadores, plumas
4. **ORGANIZACIÓN Y ARCHIVO** → Carpetas, archivadores, folders, sobres, bandejas
5. **CORTE Y FIJACIÓN** → Tijeras, guillotinas, grapadoras, perforadoras, clips
6. **ADHESIVOS Y CINTAS** → Pegamento, silicón, cinta adhesiva, tirro, teipe
7. **ÚTILES ESCOLARES** → Plastilina, temperas, pinceles, escarcha, colores
8. **CONSUMIBLES DE OFICINA** → Tóner, tintas, rollos térmicos, etiquetas
9. **EMBALAJE** → Papel de embalaje, stretch film, cinta de embalaje

---

### NIVEL 2: ATRIBUTOS CRÍTICOS DE DIFERENCIACIÓN

Cada producto tiene atributos que lo hacen ÚNICO. Estos atributos deben coincidir
TODOS para considerar que un resultado es el correcto:

#### Para MARCADORES:
- **Tipo**: Pizarra (borrable) | Permanente | Para pintar | Resaltador | Señalizador
- **Marca**: Kores | Studmark | Expo | Sharpie | Pilot | Artline | Mayka
- **Punta**: Fina (0.5-1mm) | Media (1-2mm) | Gruesa/Biselada/Chisel (3-6mm)
- **Color**: Individual (negro, azul, rojo) | Surtido/Multicolor
- **Presentación**: Individual | Caja x6 | Caja x10 | Caja x12

#### Para BOLÍGRAFOS:
- **Tipo**: Tinta aceite | Gel | Roller | Retráctil
- **Marca**: Kores | Paper Mate | InkJoy | BIC | Luxor | Esfer
- **Punta**: Fina (0.5mm) | Media (0.7mm) | Gruesa (1.0mm)
- **Color**: Azul | Negro | Rojo | Surtido
- **Presentación**: Individual | Caja x12 | Blister

#### Para RESMAS DE PAPEL:
- **Gramaje**: 75g | 80g
- **Tamaño**: Carta | Oficio | Extra Oficio | Tabloide | A4
- **Marca**: Printon | Papers | Rosal | HP
- **Presentación**: Resma 500 hojas | Bulto x5 resmas

#### Para CARPETAS:
- **Tipo**: Fibra Manila | Plástico | Cartón | Pressboard | Hanging/Colgante
- **Tamaño**: Carta | Oficio
- **Color**: Marrón/Kraft | Azul | Verde | Rojo | Surtido
- **Presentación**: Individual | Caja x25 | Caja x50 | Caja x100

#### Para CUADERNOS:
- **Tipo**: Engrapado | Doble espiral | Espiral sencillo | Cosido
- **Líneas**: Cuadriculado | Rayado | Doble línea | Blanco
- **Tamaño**: Media carta | Carta | Oficio
- **Hojas**: 50 | 80 | 100 | 200 | 300
- **Marca**: Norma | Caribe | Crisby

#### Para CINTAS / TIRRO:
- **Tipo**: Transparente | Empaque marrón | Tirro/Masking | Doble faz
- **Ancho**: 1/2" | 3/4" | 1" | 2" | 3"
- **Marca**: Mr. Bobina | Tuk | 3M
- **Metraje**: 20m | 40m | 50m | 100m

---

### NIVEL 3: REGLAS DE RESOLUCIÓN DE AMBIGÜEDAD

**REGLA 1 — Coincidencia Obligatoria del Tipo Base**:
Si el usuario dice "marcador", el resultado DEBE ser un marcador.
NO puede ser un resaltador, bolígrafo ni lápiz.

**REGLA 2 — Coincidencia de Marca Exacta**:
Si el usuario dice "marcador Servicio", la marca debe ser "Servicio" o
contener "Servicio" en el nombre. No sirve un "marcador Expo" aunque sea similar.

**REGLA 3 — Coincidencia de Medida/Especificación**:
Si el usuario dice "80" como atributo, hay que determinar por contexto:
- En resmas: 80g de gramaje
- En marcadores: NO hay marcadores de "80", podría ser SKU, código, o cantidad
- En cuadernos: 80 hojas
- En cintas: 80 metros

**REGLA 4 — Coincidencia de Variante de Punta**:
"Punta gruesa" = Punta biselada = Chisel tip (3-6mm)
"Punta fina" = Fine tip (0.5-1mm)
"Punta media" = Medium tip (1-2mm)
Esto DEBE coincidir en la variante, no en el nombre del producto genérico.

**REGLA 5 — Jerarquía de Prioridad en el Scoring**:
1. TIPO BASE (peso 50): ¿Es el tipo correcto? (marcador, bolígrafo, resma, etc.)
2. MARCA (peso 30): ¿Coincide la marca exacta?
3. VARIANTE/ESPECIFICACIÓN (peso 20): ¿Coincide la punta, tamaño, gramaje, etc.?
4. PRESENTACIÓN (peso 5): ¿Coincide la presentación? (caja, individual, etc.)
5. COLOR (peso 3): ¿Coincide el color?

**REGLA 6 — Descarte Absoluto**:
Si el tipo base NO coincide, el producto se DESCARTA independientemente de
cuántos otros tokens coincidan. Un "bolígrafo Kores" NUNCA es resultado válido
para una búsqueda de "marcador Kores".

---

### NIVEL 4: SINÓNIMOS Y VOCABULARIO VENEZOLANO

| Término del usuario | Equivalencias en BD |
|---------------------|---------------------|
| tirro | cinta masking, masking tape, cinta de enmascarar |
| teipe | cinta adhesiva, tape, cinta transparente |
| pega | pegamento, cola, adhesivo |
| silicon | silicón, silicona |
| sacapuntas | afilador, tajador |
| goma | borrador, goma de borrar |
| carpeta | folder, file folder |
| archivador | binder, lever arch file |
| engrapadora | grapadora, cosedora |
| clip | sujetapapeles, clips, gancho |
| punta gruesa | chisel, biselada, broad tip |
| punta fina | fine tip, micro, 0.5mm |
| surtido | multicolor, colores variados, assorted |
| caja | box, paquete, display |
| resma | ream, paquete 500 hojas |
| nota adhesiva | post-it, sticky note, banderita |

---

### NIVEL 5: ESTRUCTURA DE RESPUESTA JSON PARA LA IA

Cuando Gemini procesa una búsqueda, debe devolver:

```json
{
  "interpretacion": {
    "tipo_base": "marcador",
    "marca": "Servicio",
    "especificacion": "80",
    "variante_punta": "punta gruesa",
    "color": null,
    "presentacion": null
  },
  "query_tokens_criticos": ["marcador", "servicio", "80", "punta", "gruesa"],
  "filtros_obligatorios": {
    "nombre_contiene": ["marcador", "servicio"],
    "variante_contiene": ["gruesa", "chisel", "biselada"]
  },
  "descarte_si_no_tiene": ["marcador"]
}
```
