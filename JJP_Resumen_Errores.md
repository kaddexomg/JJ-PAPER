# 📋 Memoria de Contexto y Registro Maestro de Cambios — JJ PAPER
**Última actualización:** 23 de Septiembre de 2026 — 23:05  
**Rama activa:** `main` (Totalmente sincronizada con `origin/main`)

---

## 1. ✅ Formato Fiscal IVA Aditivo (16%) en Pantalla y PDF
**Commits:** `bc28763`, `814ebef`, `b02bb7f` — En producción.
- **Causa raíz:** En sesiones previas se editaba únicamente `doc-engine.js`, pero la impresión física y comprobantes en pantalla se abrían desde `comprobante.html`, el cual tenía `const ivaPct = 0;` hardcodeado.
- **Solución implementada:**
  - Cálculo aditivo: `Subtotal neto` - `Descuento` = `Base imponible` + `16% IVA` = `Total a pagar`.
  - Conversión a Bs con IVA incluido multiplicando por la tasa oficial BCV.
  - Eliminada la columna por producto "Alíc." para cumplir con el formato de factura limpia de 5 columnas.
  - Actualizados `vquotes.js` (ticket, modal y mensaje de WhatsApp), `comprobante.html` y `doc-engine.js`.

---

## 2. 🎛️ Controles y Flujo del Cotizador (UX / Hotkeys)
**Commits:** `66a06c7`, `f90ca5f` — En producción.
- **Teclas + y - :** Permite incrementar y decrementar cantidades directamente desde el teclado o con clics.
- **Selector de precios simétrico (A, B, C, D, M):**
  - Matriz 2x2 para niveles A, B, C, D y tarjeta dedicada de ancho completo para Precio Personalizado (M).
  - Hotkeys directas `A`, `B`, `C`, `D`, `M` en el modal de selección.
  - Botón táctil `[M]` en cada línea de ticket para ingresar precio manual con foco automático.
- **Corrección tecla Enter:** Se eliminó la llamada residual a `quoteNavTab(1)` que hacía saltar el cursor accidentalmente al campo "Nombre del Cliente" (`qCliName`).

---

## 3. 🍏 Rediseño UI/UX: Apple Dynamic Island & Liquid Glass
**Commits:** `62271fa`, `85ee747` — En producción.
- **Tipografía Apple San Francisco:** Pila `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto` con antialiasing y tracking óptico (`letter-spacing: -0.011em`).
- **Eliminación del negro plano/ceniza:** Fondo ambiental de **Titanio Espacial (`#090d16`)** con gradientes radiales de luz aurora (menta `#10b981` y cian) que brindan profundidad tridimensional real.
- **Cápsulas flotantes (Dynamic Island):**
  - Buscador `#posSearch` como barra Spotlight flotante con curvas continuas (`border-radius: 9999px`).
  - Tarjetas y paneles con curvatura continua (`border-radius: 22px`), brillo superior (`inset 0 1px 0`) y desenfoque `backdrop-filter: blur(28px) saturate(200%)`.
  - Botones táctiles de cantidad con micro-interacción elástica (`scale(0.88)` / `scale(1.12)`).
  - Segmentos de precios tipo pastillas flotantes de iOS.
  - Motor global de tema (`theme.js`) con persistencia en `localStorage` y cero parpadeo (no-FOUC).

---

## 4. 🪟 Compatibilidad Total con Windows 7 y PCs de Oficina
**Commit:** `744495a` — En producción.
- **Causa raíz:** Windows 7 carece de fuentes de emojis Unicode en color (Segoe UI Emoji). Emojis como 📋, 📊, 🛒, 🔄, 🗑️, ⚡, 🌙, ☀️ se renderizaban como rectángulos vacíos rotos (`▯` o `[?]`), confundiendo a los empleados sobre qué botón pulsar.
- **Solución implementada:**
  - **Motor Universal SVG (`assets/js/icons.js`):** Librería vectorial ligera sin dependencias que reemplaza automáticamente cualquier emoji en el DOM por gráficos vectoriales SVG matemáticos que se dibujan con 100% de nitidez bajo Windows 7 ClearType.
  - **Botones con etiquetas explícitas en español:**
    - Botón de reemplazo: icono SVG + texto claro **`[Cambiar]`**.
    - Botón de eliminación: icono SVG + texto claro **`[Quitar]`**.
    - Barra del cotizador: **`[Abrir (F4)]`**, **`[Ver Todas (F8)]`**, **`[Nueva (Alt+N)]`**, **`[Atajos (F1)]`**, **`[Facturar en POS (F7)]`**, **`[Presupuesto PDF (F10)]`**.
    - Interruptor de tema: SVGs vectoriales de Sol y Luna.
    - Interruptor de rendimiento: Texto claro **"Modo rápido"** / **"Efectos"**.

---

## 5. 📡 Pendiente para Próxima Sesión: Sincronización MixNet ⇄ JJ Paper (AnyDesk)
- **Problema detectado:** Un pedido de MixNet quedó vacío porque se sobreescribió un correlativo (`NUMPED`) en `MXENCPED.DBF` sin sus correspondientes renglones en `MXRENPED.DBF`.
- **Topología de red:**
  - Laptop del usuario: `192.168.1.9`.
  - PC Supervisor (Oficina): `192.168.0.172` (corre `wa-server` en `:8787` / `:8788`).
  - Servidor MixNet: `192.168.0.185` (unidad `M:\comp01`).
  - Conexión AnyDesk activa a la PC de la empresa.
- **Pasos a seguir al retomar:**
  1. Abrir navegador en la PC remota vía AnyDesk e ingresar a `http://localhost:8787/lan/mixnet/status`.
  2. Proveer el número de pedido en MixNet que quedó vacío.
  3. Reconstruir los renglones huérfanos o restaurar desde las copias de seguridad existentes en `backups/backup_MXENCPED` y `backups/backup_MXRENPED`.
