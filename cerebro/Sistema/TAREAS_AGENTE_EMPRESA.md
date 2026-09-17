# 📌 Tareas Asignadas al Agente de la PC Empresa (Tienda)

> **Contexto para el Agente**: La PC de la empresa es el **servidor maestro de producción**. La laptop remota ya preparó y corrigió el código, y tiene su propio servidor apagado. Sigue esta lista de verificación paso a paso al iniciar tu turno.

---

## 🎯 Lista de Tareas Prioritarias

### Paso 1: Sincronizar el repositorio
```bash
git pull origin main
```
*Trae los fixes de WhatsApp, campañas, protocolo multi-agente y el importador DBF.*

---

### Paso 2: Reiniciar el `wa-server` en producción
1. Detén el servidor actual si está corriendo (`taskkill /F /IM node.exe` o cerrando la consola).
2. Inicia el servidor maestro:
   - Doble clic a `START-SERVIDOR.bat` (o mediante `run-service.bat`).
3. Revisa `wa-server/logs/server.log` y confirma que:
   - `realtime sesiones`, `outbox`, `mixer` aparezcan como `SUBSCRIBED`.
   - La unidad de MixNet (`M:/comp01`) sea detectada correctamente.

---

### Paso 3: Vincular la cuenta de WhatsApp
1. Abre en el navegador local: `admin/whatsapp.html` (o `vendedor/whatsapp.html`).
2. Haz clic en **📷 Generar código QR**.
3. Pídele al usuario que lo escanee desde su WhatsApp.
4. **Verificación**: Confirma que el estado pase a `🟢 Conectado`.
   *(Nota: Ya no se borrará al reiniciar el servidor, el bug de purga zombie fue resuelto en `97953c9`).*

---

### Paso 4: Probar despacho de Campaña WhatsApp
1. Desde `admin/difusion.html` o `vendedor/difusion.html`, realiza una prueba de envío a un número de control o reanuda la campaña pendiente.
2. Revisa `server.log`:
   - Confirma que los mensajes se encolen y despachen sin el error previo (`msgTemplate is not defined` fue corregido en `7d94531`).

---

### Paso 5: Supervisar la sincronización de precios de MixNet
1. Como esta PC tiene acceso físico a `M:\comp01\` (tablas DBF), verifica que `sweepMixnetProducts()` en `wa-server/src/mixer.js`:
   - Lea `VICTAINV.DBF` o `MXCTAINV.DBF`.
   - Actualice `price_a`, `price_b`, `price_usd`, `price_c_bs`, `price_d_bs` y `stock` en `jjp_products` y `jjp_product_variants`.
2. Verifica en consola que no haya errores de lectura o tipos de datos en los campos numéricos.

---

### Paso 6: Validar ciclo con Caja de MixNet
1. Crear una cotización de prueba en el cotizador de JJ Paper (`admin/cotizador.html`).
2. Verificar que se cree el archivo `cotizacion_COT-*.csv/.txt` en la carpeta compartida de MixNet.
3. Confirmar que la Caja de MixNet pueda jalar la cotización y transformarla en pedido.
4. Asegurarse de que el pedido importado (`MIX-*`) no se re-exporte hacia MixNet (guard anti round-trip).
