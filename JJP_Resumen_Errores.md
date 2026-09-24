# ✅ Resumen de Correcciones Aplicadas (Sesión 23 de Sep 2026 — Noche)

---

## ✅ CORREGIDO: Formato Fiscal IVA en Pantalla y PDF
**Commits:** `bc28763`, `814ebef`, `b02bb7f` — Desplegados a producción.

### Hallazgo Clave:
Durante 3 sesiones la IA modificaba únicamente `doc-engine.js` (generador de PDF descargable), mientras que el usuario al imprimir cotizaciones o facturas abría `comprobante.html`. En `comprobante.html`, el IVA estaba **hardcodeado en 0** (`ivaPct = 0`), lo que impedía que se mostrara la Base Imponible y el IVA.

### Qué se corrigió:
1. **En `comprobante.html`**:
   - Se activó el cálculo del IVA aditivo formal venezolano:
     - Subtotal neto
     - Descuento (si aplica)
     - Base imponible (Subtotal)
     - IVA (16%)
     - TOTAL A PAGAR (USD) (con IVA incluido)
     - TOTAL (Bs) (con IVA incluido a tasa BCV)
   - Se eliminó la columna "Alíc." por renglón para dejar una factura limpia de 5 columnas.
2. **En `vquotes.js` (Cotizador)**:
   - El sidebar del ticket muestra Subtotal neto, Descuento, Base imponible, IVA (16%) y Total estimado.
   - Se guarda `estimated_total_usd` con el 16% de IVA ya incluido.
   - El mensaje para WhatsApp y el modal de confirmación detallan el desglose fiscal.
3. **En `doc-engine.js`**:
   - Generación de PDF físico con la misma matemática aditiva y sin columna "Alíc.".

---

## 📡 CONTEXTO GUARDADO: Puente Bidireccional MixNet ⇄ JJ Paper (AnyDesk)

### Situación Detectada:
- Un pedido en MixNet apareció **vacío** porque se sobreescribió un correlativo (`NUMPED`) en `MXENCPED.DBF` sin sus correspondientes renglones en `MXRENPED.DBF`.
- La laptop del usuario está en la subred local `192.168.1.9`.
- La PC del Supervisor en la empresa está en `192.168.0.172` y el servidor MixNet en `192.168.0.185`.
- **El usuario tiene conexión activa por AnyDesk a la PC de la empresa**, lo cual permite acceder directamente a `wa-server` y a la unidad de red `M:\comp01`.

### Pasos a ejecutar cuando se retome MixNet:
1. Verificar en la PC de la oficina que la unidad de red `M:\comp01` esté montada.
2. Comprobar que `wa-server` esté activo visitando `http://localhost:8787/lan/mixnet/status`.
3. Identificar el número de pedido en MixNet para reconstruir sus renglones en `MXRENPED.DBF` o restaurar el respaldo de `backups/backup_MXENCPED` y `backups/backup_MXRENPED`.
