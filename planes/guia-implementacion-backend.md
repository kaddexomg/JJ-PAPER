# 🔧 GUÍA DE IMPLEMENTACIÓN — Estabilización Backend wa-server JJ Paper

> **⚠️ PARA EL AGENTE QUE EJECUTE ESTO: Lee TODA esta guía antes de tocar código.**
> 
> Esta guía fue creada el 28 de agosto de 2026 por un agente que ya leyó TODO el código
> del proyecto. Contiene instrucciones EXACTAS con código listo para copiar.
> NO necesitas "entender" el proyecto — solo sigue los pasos EN ORDEN.

---

## 🏛️ REGLAS DE ORO (INQUEBRANTABLES)

> [!CAUTION]
> Violar CUALQUIERA de estas reglas puede tumbar el sistema en producción.
> El wa-server es un proceso Node.js que CORRE 24/7 en la PC de la tienda.

1. **NUNCA borres archivos ni tablas.** Solo EDITA lo indicado.
2. **NUNCA cambies credenciales** (.env, claves, URLs de Supabase).
3. **NUNCA toques `wa-session.js` más allá de lo indicado** — es el archivo más delicado.
4. **SIEMPRE haz UN cambio a la vez.** No combines múltiples pasos en una sola edición.
5. **SIEMPRE preserva los comentarios existentes** — son documentación viva.
6. **NUNCA agregues dependencias/paquetes npm** — todo se hace con lo que ya existe.
7. **Los imports deben quedar EXACTAMENTE como están** salvo que se indique lo contrario.
8. **Si algo sale mal, DESHAZ el último cambio.** No intentes "arreglarlo sobre el arreglo".
9. **El servidor se reinicia DESPUÉS de cada cambio** — el código viejo sigue en RAM hasta reiniciar.
10. **NO hagas cambios en el frontend (HTML/JS del sitio)** — esta guía es SOLO backend (`wa-server/src/`).

---

## 📍 CONTEXTO DEL PROYECTO (lo mínimo que necesitas saber)

### Arquitectura
```
Cloudflare Pages (sitio web) ←→ Supabase (base de datos en la nube)
                                     ↕ service_role
                              wa-server (PC de la tienda, Node.js)
                              ├── WhatsApp via Baileys
                              ├── Gmail API
                              └── Campañas masivas
```

### Archivos que VAS a editar (y SOLO estos):
| Archivo | Ruta absoluta | Qué hace |
|---|---|---|
| `config.js` | `C:\Users\PC\Desktop\JJ PAPER\wa-server\src\config.js` | Intervalos de polling y constantes |
| `outbox.js` | `C:\Users\PC\Desktop\JJ PAPER\wa-server\src\outbox.js` | Cola de envío de mensajes WA |
| `campaigns.js` | `C:\Users\PC\Desktop\JJ PAPER\wa-server\src\campaigns.js` | Despachador de campañas masivas |
| `session-manager.js` | `C:\Users\PC\Desktop\JJ PAPER\wa-server\src\session-manager.js` | Gestor de sesiones WhatsApp |
| `wa-session.js` | `C:\Users\PC\Desktop\JJ PAPER\wa-server\src\wa-session.js` | UNA sesión de WhatsApp (Baileys) |
| `heartbeat.js` | `C:\Users\PC\Desktop\JJ PAPER\wa-server\src\heartbeat.js` | Latido del servidor + control remoto |

### Cómo funciona el flujo de una campaña (para entender qué estamos mejorando):
1. El vendedor crea una campaña desde el panel web → se guarda en `jjp_wa_campaigns` + `jjp_wa_campaign_targets`
2. `campaigns.js` hace un sweep cada 15s → toma 1 target pendiente → crea un mensaje `pending` en `jjp_wa_messages`
3. `outbox.js` detecta el mensaje `pending` (por Realtime o sweep 30s) → lo envía por WhatsApp
4. Si el mensaje tiene media (PDF/imagen) → `outbox.js` llama a `downloadOutgoingMedia()` en `media.js` → descarga el archivo del Storage de Supabase → lo envía

**EL PROBLEMA:** El paso 4 descarga el MISMO PDF 300 veces (una por contacto). Eso son 300 MB de egress por campaña.

---

## 📋 ORDEN DE IMPLEMENTACIÓN

> [!IMPORTANT]
> Ejecuta los pasos EN ESTE ORDEN. Cada paso es independiente y se puede probar por separado.
> Entre cada paso, el servidor debe reiniciarse.

| Orden | Paso | Archivo | Riesgo | Impacto |
|---|---|---|---|---|
| 1 | Reducir intervalos de polling | `config.js` + `heartbeat.js` | ⬜ Cero | Ahorra ~70% queries de fondo |
| 2 | Caché de media en outbox | `outbox.js` | 🟩 Bajo | Ahorra ~99% egress de campañas |
| 3 | Skip rápido de targets inválidos | `campaigns.js` | 🟩 Bajo | Campañas 10x más rápidas |
| 4 | Validar número en WhatsApp | `campaigns.js` | 🟩 Bajo | Elimina envíos fantasma |
| 5 | Contadores enriquecidos | `campaigns.js` + SQL | 🟩 Bajo | Más info en la UI |
| 6 | Proteger watchdog | `session-manager.js` | 🟨 Medio | Evita doble-socket |
| 7 | Ampliar guardia anti doble-socket | `wa-session.js` | 🟨 Medio | Más estable en redes lentas |

---

## PASO 1: Reducir intervalos de polling

### Qué hacer
Cambiar las constantes numéricas en `config.js` y `heartbeat.js`. Nada más.

### Archivo: `wa-server/src/config.js`
**Líneas 25-29** — Reemplazar EXACTAMENTE estas 5 líneas:

```javascript
// CÓDIGO ACTUAL (líneas 25-29):
export const OUTBOX_SWEEP_MS   = 30_000;  // barrido de salientes pendientes
export const SESSIONS_SWEEP_MS = 15_000;  // barrido de requested_action perdidos
export const CAMPAIGN_SWEEP_MS = 15_000;  // tick del despachador de difusión
export const INVOICE_SWEEP_MS  = 60_000;  // avisos de facturas por pagar (los genera el cron de la BD)
export const EMAIL_SWEEP_MS    = 20_000;  // barrido de correos pendientes (Gmail SMTP)
```

```javascript
// CÓDIGO NUEVO (reemplaza las mismas 5 líneas):
export const OUTBOX_SWEEP_MS   = 30_000;  // barrido de salientes pendientes (NO cambiar — Realtime cubre el resto)
export const SESSIONS_SWEEP_MS = 45_000;  // barrido de requested_action perdidos (antes: 15s)
export const CAMPAIGN_SWEEP_MS = 30_000;  // tick del despachador de difusión (antes: 15s)
export const INVOICE_SWEEP_MS  = 60_000;  // avisos de facturas por pagar (sin cambio)
export const EMAIL_SWEEP_MS    = 60_000;  // barrido de correos pendientes (antes: 20s)
```

**Líneas 18-19** — Reemplazar EXACTAMENTE estas 2 líneas:

```javascript
// CÓDIGO ACTUAL (líneas 18-19):
export const COUNT_SYNC_MS     = 5_000;   // intenta subir el conteo bufferizado
export const COUNT_ONLINE_MS   = 10_000;  // chequeo de conexión a Supabase
```

```javascript
// CÓDIGO NUEVO (reemplaza las mismas 2 líneas):
export const COUNT_SYNC_MS     = 15_000;  // intenta subir el conteo bufferizado (antes: 5s)
export const COUNT_ONLINE_MS   = 30_000;  // chequeo de conexión a Supabase (antes: 10s)
```

### Archivo: `wa-server/src/heartbeat.js`
**Líneas 11-12** — Reemplazar EXACTAMENTE estas 2 líneas:

```javascript
// CÓDIGO ACTUAL (líneas 11-12):
const HEARTBEAT_MS = 20_000;   // cada cuánto late
const POLL_MS      = 10_000;   // respaldo si Realtime está caído
```

```javascript
// CÓDIGO NUEVO (reemplaza las mismas 2 líneas):
const HEARTBEAT_MS = 30_000;   // cada cuánto late (antes: 20s — el panel tolera hasta 70s)
const POLL_MS      = 30_000;   // respaldo si Realtime está caído (antes: 10s)
```

### Cómo verificar que funciona
1. Reiniciar el servidor: detener y ejecutar `START-SERVIDOR.bat`
2. Abrir los logs (`wa-server/logs/`) y verificar que el servidor arranca normal
3. Verificar en el panel admin (ajustes.html) que el indicador 🟢 sigue verde
4. Esperar 2 minutos. Si el panel sigue verde → ✅ funciona

### Si algo sale mal
El panel muestra 🔴 después de 70 segundos sin latido. Como pusimos 30s, está bien. 
Si el panel muestra 🔴 constantemente, revierte los valores a los originales.

---

## PASO 2: Caché de media en outbox (EL MÁS IMPORTANTE)

### Qué hacer
Agregar un caché en memoria en `outbox.js` para que el MISMO PDF no se descargue 300 veces.

### Archivo: `wa-server/src/outbox.js`
**Después de la línea 5** (después de `import { touchChat, PREVIEW_BY_TYPE } from './chats.js';`), agregar EXACTAMENTE:

```javascript
// --- Caché de media en memoria ---
// Evita descargar el MISMO archivo de Supabase Storage por cada mensaje.
// Impacto: una campaña de 300 contactos con PDF de 1 MB pasa de 300 MB a 1 MB de egress.
const mediaCache = new Map();
const MEDIA_CACHE_TTL = 30 * 60_000;  // 30 minutos — más que suficiente para una campaña

async function getCachedMedia(mediaPath) {
  const cached = mediaCache.get(mediaPath);
  if (cached && Date.now() - cached.ts < MEDIA_CACHE_TTL) {
    return cached.buffer;
  }
  const buffer = await downloadOutgoingMedia(mediaPath);
  mediaCache.set(mediaPath, { buffer, ts: Date.now() });
  // Limpiar entradas viejas para no acumular RAM infinitamente
  if (mediaCache.size > 50) {
    for (const [k, v] of mediaCache) {
      if (Date.now() - v.ts > MEDIA_CACHE_TTL) mediaCache.delete(k);
    }
  }
  return buffer;
}
```

**Línea 86** — Reemplazar EXACTAMENTE esta línea:

```javascript
// CÓDIGO ACTUAL (línea 86):
  const buffer = await downloadOutgoingMedia(row.media_path);
```

```javascript
// CÓDIGO NUEVO (reemplaza esa línea):
  const buffer = await getCachedMedia(row.media_path);
```

### ⚠️ NO tocar NADA más en este archivo. El resto de `buildContent()` queda igual.

### Cómo verificar que funciona
1. Reiniciar el servidor
2. Enviar UN mensaje manual con PDF desde el CRM WhatsApp (no campaña) → debe llegar normal
3. Si llega → el caché funciona (en este caso no ahorra nada porque es 1 solo, pero confirma que no rompió nada)
4. Si tienes una campaña pequeña de prueba (5-10 contactos con PDF), lanzarla y verificar que todos reciben el PDF
5. Revisar los logs: NO deben aparecer errores nuevos de "descarga Storage falló"

### Si algo sale mal
Borrar todo el bloque nuevo (`mediaCache`, `getCachedMedia`) y revertir la línea 86 al original. Reiniciar.

---

## PASO 3: Skip rápido de targets inválidos en campañas

### Qué hacer
Modificar `step()` en `campaigns.js` para que procese múltiples targets inválidos en un solo tick, en vez de esperar 30 segundos entre cada skip.

### Archivo: `wa-server/src/campaigns.js`
**Reemplazar TODA la función `step`** (líneas 47-141). La función empieza con `async function step(camp, dailyLimit) {` y termina en el `}` de cierre justo antes de la línea del comentario `// Chat del destinatario`.

```javascript
// CÓDIGO NUEVO — reemplaza TODA la función step (líneas 47-141):
async function step(camp, dailyLimit) {
  const session = manager.get(camp.owner_id);
  if (!session?.isConnected()) return;                 // espera a que la sesión conecte

  if (Date.now() < (nextSendAt.get(camp.owner_id) || 0)) return;

  const sentToday = await countSentToday(camp.owner_id);
  if (sentToday >= dailyLimit) {
    log.warn({ owner: camp.owner_id, sentToday, dailyLimit }, 'tope diario de difusión alcanzado');
    return;
  }

  // Traer hasta 20 targets: los inválidos se saltan sin delay, solo el envío real pone delay
  const { data: targets } = await db.from('jjp_wa_campaign_targets')
    .select('*')
    .eq('campaign_id', camp.id)
    .in('status', ['pending', 'en_cola'])
    .order('created_at', { ascending: true })
    .limit(20);

  if (!targets?.length) { await finish(camp); return; }

  if (camp.status === 'en_cola' || camp.status === 'pending') {
    await db.from('jjp_wa_campaigns')
      .update({ status: 'enviando', started_at: camp.started_at || new Date().toISOString() })
      .eq('id', camp.id);
  }

  for (const t of targets) {
    // --- Validaciones rápidas (sin delay entre skips) ---

    // Opt-out
    if (t.customer_id) {
      const { data: cust } = await db.from('jjp_customers')
        .select('wa_opt_out').eq('id', t.customer_id).maybeSingle();
      if (cust?.wa_opt_out) { await skip(camp, t, 'cliente con opt-out'); continue; }
    }

    // Formato de teléfono
    const norm = normVePhone(t.phone);
    if (!/^58\d{10}$/.test(norm)) { await skip(camp, t, 'teléfono inválido: ' + t.phone); continue; }

    // --- Este target es válido → intentar enviar ---
    try {
      const chatId = await ensureChat(camp.owner_id, norm, t);
      const realVars = {
        ...(t.vars || {}),
        nombre: t.name || (t.vars || {}).nombre || '',
        empresa: t.name || (t.vars || {}).empresa || '',
      };
      const body = renderTemplate(camp.body || camp.message || '', realVars);

      const msgPayload = {
        chat_id: chatId,
        owner_id: camp.owner_id,
        direction: 'out',
        type: camp.media_path ? (camp.media_type || 'document') : 'text',
        body,
        media_path: camp.media_path || null,
        media_mime: camp.media_mime || null,
        media_filename: camp.media_filename || null,
        media_size: camp.media_size || null,
        status: 'pending'
      };

      const { data: msg, error: msgErr } = await db.from('jjp_wa_messages')
        .insert(msgPayload)
        .select('id').single();
      if (msgErr) throw new Error(msgErr.message);

      await db.from('jjp_wa_campaign_targets')
        .update({ status: 'sent', message_id: msg.id, sent_at: new Date().toISOString(), error: null })
        .eq('id', t.id);
      await syncCounts(camp.id);

      const minS = Number(camp.delay_min_s) || 45;
      const maxS = Number(camp.delay_max_s) || 90;
      let delayMs = 1000 * (minS + Math.random() * Math.max(1, maxS - minS));

      const batchSize = Number(camp.batch_size) || 0;
      const batchPauseM = Number(camp.batch_pause_m) || 5;
      const currentSent = (camp.sent_count || 0) + 1;

      if (batchSize > 0 && currentSent % batchSize === 0) {
        const longPauseMs = batchPauseM * 60 * 1000;
        delayMs = longPauseMs;
        log.info({ campaign: camp.name, sent: currentSent, pauseMin: batchPauseM }, 'difusión: pausa de lote (descanso humano anti-bloqueo)');
      }

      nextSendAt.set(camp.owner_id, Date.now() + delayMs);
      log.info({ campaign: camp.name, to: norm, nextInS: Math.round(delayMs / 1000) }, 'difusión: mensaje encolado');
      break;  // Solo 1 envío real por tick (delay anti-baneo), pero todos los skips fueron instantáneos
    } catch (e) {
      await db.from('jjp_wa_campaign_targets')
        .update({ status: 'failed', error: e.message }).eq('id', t.id);
      await syncCounts(camp.id);
      log.warn({ campaign: camp.name, target: t.id, err: e.message }, 'difusión: target falló');
      break;  // No seguir si hubo error de envío
    }
  }
}
```

### Cómo verificar que funciona
1. Reiniciar el servidor
2. Si hay una campaña activa, observar los logs. Ahora deben verse los skips consecutivos SIN pausa de 30s entre ellos
3. Los mensajes "difusión: mensaje encolado" deben seguir apareciendo con normalidad
4. Verificar que la campaña sigue respetando el delay entre envíos reales (45-90s)

---

## PASO 4: Validar número en WhatsApp antes de encolar

### Qué hacer
Agregar una verificación `sock.onWhatsApp()` en `campaigns.js` DENTRO del bucle de targets, justo después de la validación de formato de teléfono.

### Archivo: `wa-server/src/campaigns.js`
**En la función `step` que acabamos de reescribir en el Paso 3**, buscar estas dos líneas consecutivas:

```javascript
    // --- Este target es válido → intentar enviar ---
    try {
```

**Insertar ANTES de `try {` y DESPUÉS del comentario**, exactamente este bloque:

```javascript
    // Verificar si el número tiene WhatsApp activo
    try {
      const [waCheck] = await session.sock.onWhatsApp(norm + '@s.whatsapp.net');
      if (!waCheck?.exists) {
        await skip(camp, t, 'número sin WhatsApp: ' + t.phone);
        continue;
      }
    } catch (e) {
      // Si la verificación falla (red, etc.), intentar enviar de todas formas
      log.warn({ phone: norm, err: e.message }, 'verificación WA falló, se intenta enviar');
    }
```

**El resultado debe verse así** (contexto para que no te pierdas):

```javascript
    // Formato de teléfono
    const norm = normVePhone(t.phone);
    if (!/^58\d{10}$/.test(norm)) { await skip(camp, t, 'teléfono inválido: ' + t.phone); continue; }

    // Verificar si el número tiene WhatsApp activo
    try {
      const [waCheck] = await session.sock.onWhatsApp(norm + '@s.whatsapp.net');
      if (!waCheck?.exists) {
        await skip(camp, t, 'número sin WhatsApp: ' + t.phone);
        continue;
      }
    } catch (e) {
      // Si la verificación falla (red, etc.), intentar enviar de todas formas
      log.warn({ phone: norm, err: e.message }, 'verificación WA falló, se intenta enviar');
    }

    // --- Este target es válido → intentar enviar ---
    try {
```

### Cómo verificar que funciona
1. Reiniciar el servidor
2. Lanzar una campaña pequeña (3-5 contactos). Incluir al menos 1 número que sepas que NO tiene WhatsApp
3. En los logs deben aparecer líneas con `'número sin WhatsApp'` para esos números
4. Los targets saltados deben mostrarse como `skipped` en la base de datos (`jjp_wa_campaign_targets`)

---

## PASO 5: Contadores de campaña enriquecidos (sent + failed + skipped)

### Qué hacer
DOS cosas: (A) ejecutar SQL en Supabase, (B) modificar `syncCounts` en `campaigns.js`.

### (A) SQL en Supabase — PRIMERO, ANTES de tocar código
Ir al **SQL Editor** de Supabase (`https://supabase.com/dashboard` → proyecto `czzvsqnmxtjzqzioknnn` → SQL Editor) y ejecutar:

```sql
-- Agregar columna skipped_count a jjp_wa_campaigns
ALTER TABLE jjp_wa_campaigns 
ADD COLUMN IF NOT EXISTS skipped_count integer DEFAULT 0;
```

### (B) Archivo: `wa-server/src/campaigns.js`
**Buscar la función `syncCounts`** (debe estar cerca de la línea 194 original, pero puede haber cambiado por los cambios anteriores). Buscar EXACTAMENTE este bloque:

```javascript
// Recalcula contadores desde los targets (fuente de verdad)
async function syncCounts(campaignId) {
  const [{ count: sent }, { count: failed }] = await Promise.all([
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['sent', 'enviado']),
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['failed', 'fallido', 'skipped', 'omitido']),
  ]);
  await db.from('jjp_wa_campaigns')
    .update({ sent_count: sent || 0, failed_count: failed || 0 })
    .eq('id', campaignId);
}
```

**Reemplazar por:**

```javascript
// Recalcula contadores desde los targets (fuente de verdad)
async function syncCounts(campaignId) {
  const [{ count: sent }, { count: failed }, { count: skipped }] = await Promise.all([
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['sent', 'enviado']),
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['failed', 'fallido']),
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['skipped', 'omitido']),
  ]);
  await db.from('jjp_wa_campaigns')
    .update({ sent_count: sent || 0, failed_count: failed || 0, skipped_count: skipped || 0 })
    .eq('id', campaignId);
}
```

**Diferencia clave:** Antes `skipped` se contaba junto con `failed`. Ahora se separan.

### Cómo verificar que funciona
1. Ejecutar el SQL primero → verificar que no dé error
2. Reiniciar el servidor
3. Lanzar una campaña pequeña con algunos números inválidos
4. En Supabase, verificar que `jjp_wa_campaigns` tiene `skipped_count` con un valor > 0

---

## PASO 6: Proteger el watchdog contra doble-socket

### Qué hacer
Modificar `startWatchdog()` en `session-manager.js` para que respete el candado `working`.

### Archivo: `wa-server/src/session-manager.js`
**Buscar la función `startWatchdog`** (líneas 58-75). Reemplazar TODA la función:

```javascript
// CÓDIGO ACTUAL (líneas 58-75):
function startWatchdog() {
  setInterval(() => {
    for (const s of sessions.values()) {
      if (s.stopped || !s.hasCreds()) continue;   // desvinculada o apagada a propósito
      if (s.isHealthy()) continue;
      if (s.reconnectTimer) continue;             // ya se está reintentando
      // Arranque EN CURSO: si el vigilante llamaba start() otra vez, quedaban
      // DOS sockets de Baileys con las mismas credenciales y WhatsApp empezaba
      // a fallar el descifrado ("Bad MAC"). Se le dan 3 minutos.
      if (s.startingSince && Date.now() - s.startingSince < 180_000) continue;
      const min = Math.round((Date.now() - (s.lastEventAt || 0)) / 60000);
      log.warn({ profile: s.profileId, sinSenalMin: min }, 'sesión caída sin avisar — reconectando');
      s.setSession({ status: 'disconnected', last_error: 'Reconectada por el vigilante' }).catch(() => {});
      s.start().catch(e => log.error({ err: e.message, profile: s.profileId }, 'watchdog no pudo reconectar'));
    }
  }, 60_000);
  log.info('vigilante de sesiones activo (revisa cada minuto)');
}
```

```javascript
// CÓDIGO NUEVO (reemplaza TODA la función):
function startWatchdog() {
  setInterval(async () => {
    for (const s of sessions.values()) {
      if (s.stopped || !s.hasCreds()) continue;
      if (s.isHealthy()) continue;
      if (s.reconnectTimer) continue;
      if (s.startingSince && Date.now() - s.startingSince < 180_000) continue;
      if (working.has(s.profileId)) continue;  // respetar el candado: otra acción ya está en curso

      const min = Math.round((Date.now() - (s.lastEventAt || 0)) / 60000);
      log.warn({ profile: s.profileId, sinSenalMin: min }, 'sesión caída sin avisar — reconectando');

      working.add(s.profileId);
      try {
        await s.setSession({ status: 'disconnected', last_error: 'Reconectada por el vigilante' });
        await s.start();
      } catch (e) {
        log.error({ err: e.message, profile: s.profileId }, 'watchdog no pudo reconectar');
      } finally {
        working.delete(s.profileId);
      }
    }
  }, 60_000);
  log.info('vigilante de sesiones activo (revisa cada minuto)');
}
```

**Diferencias clave:**
1. El callback del `setInterval` es ahora `async` (antes no lo era)
2. Se agrega `if (working.has(s.profileId)) continue;`
3. Se envuelve en `working.add/delete` + try/finally (igual que `handleRow`)
4. Se usa `await` en `s.setSession` y `s.start` en vez de `.catch()`

### Cómo verificar que funciona
1. Reiniciar el servidor
2. Verificar en los logs que dice `'vigilante de sesiones activo (revisa cada minuto)'`
3. Todas las sesiones de WhatsApp deben seguir conectadas (🟢 en el panel)
4. NO deben aparecer errores `Bad MAC` en los logs

---

## PASO 7: Ampliar guardia anti doble-socket de 30s a 90s

### Qué hacer
Cambiar UN solo número en `wa-session.js`.

### Archivo: `wa-server/src/wa-session.js`
**Línea 109** — Reemplazar EXACTAMENTE esta línea:

```javascript
// CÓDIGO ACTUAL (línea 109):
    if (this.startingSince && Date.now() - this.startingSince < 30_000) {
```

```javascript
// CÓDIGO NUEVO (reemplaza esa línea):
    if (this.startingSince && Date.now() - this.startingSince < 90_000) {
```

**Eso es TODO. No toques NADA más en este archivo.**

### Cómo verificar que funciona
1. Reiniciar el servidor
2. Verificar que las sesiones conectan normalmente
3. En los logs, si aparece el mensaje `'arranque ya en curso — ignoro el nuevo start()'`, eso está BIEN — significa que la guardia está funcionando

---

## ✅ CHECKLIST FINAL DE VERIFICACIÓN

Después de aplicar TODOS los pasos, verificar:

- [ ] El servidor arranca sin errores (`START-SERVIDOR.bat`)
- [ ] Los logs muestran las líneas de arranque normales:
  - `JJ Paper wa-server — puente WhatsApp ↔ Supabase`
  - `sesiones al arranque`
  - `realtime outbox`
  - `vigilante de sesiones activo`
  - `heartbeat + control activos`
- [ ] El panel admin (ajustes.html) muestra 🟢
- [ ] Las sesiones de WhatsApp están conectadas (verificar en admin/whatsapp.html)
- [ ] Enviar un mensaje de texto manual desde el CRM → debe llegar
- [ ] Enviar un mensaje con PDF manual → debe llegar
- [ ] Lanzar una campaña pequeña (5 contactos) → debe completarse
- [ ] Los targets skipped muestran motivo (opt-out, sin WhatsApp, teléfono inválido)
- [ ] Los contadores de la campaña muestran sent + failed + skipped por separado

---

## 🚨 PROCEDIMIENTO DE EMERGENCIA

Si algo deja de funcionar después de un cambio:

1. **Identificar cuál fue el último archivo editado**
2. **Revertir ESE archivo** a su versión original (usar `git checkout -- wa-server/src/ARCHIVO.js`)
3. **Reiniciar el servidor** (`START-SERVIDOR.bat`)
4. **Si git no está disponible**, los archivos originales están documentados en esta guía — las secciones "CÓDIGO ACTUAL" muestran exactamente cómo era antes

**Para revertir TODO de golpe** (si hiciste varios cambios y no sabes cuál rompió):
```bash
cd "C:\Users\PC\Desktop\JJ PAPER"
git checkout -- wa-server/src/config.js wa-server/src/outbox.js wa-server/src/campaigns.js wa-server/src/session-manager.js wa-server/src/wa-session.js wa-server/src/heartbeat.js
```

---

## 📝 NOTAS PARA EL AGENTE

1. **El archivo `media.js` NO se edita** — el caché se agrega en `outbox.js` que es quien llama a `downloadOutgoingMedia()`
2. **El archivo `supabase.js` NO se edita** — son solo 8 líneas y está perfecto
3. **El archivo `index.js` NO se edita** — solo arranca los módulos
4. **No cambies el puerto 8787/8788** del conteo LAN
5. **Los delays anti-baneo (45-90s) NO se tocan** — son críticos para que WhatsApp no bloquee el número
6. **Si el usuario pide "hacer todo más rápido"**, NO reduzcas los delays de campaña. Explica que WhatsApp banea números que envían demasiado rápido
7. **La base de datos está en Supabase proyecto `czzvsqnmxtjzqzioknnn`** — las credenciales están en `wa-server/.env`
