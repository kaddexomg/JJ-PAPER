---
tags: [concepto, patron]
---

# Cola de mensajes (el patrón central de comunicación)

**Nada se envía en directo desde el navegador.** Mandar un WhatsApp o un correo es
insertar una fila `pending`; el [[wa-server]] la despacha cuando puede. Este
patrón se repite idéntico en las dos colas, y entenderlo explica medio sistema.

## El ciclo

```
Front: sube archivo a Storage → INSERT status='pending'
                 │
      Realtime (INSERT pending)  +  barrido cada 20-30 s  ← respaldo si el socket cae
                 ▼
Server: UPDATE → 'sending'  (lock optimista: … WHERE status='pending')
                 │  si no afectó filas, otro ciclo ya lo tomó → salir
                 ▼
        envío real (Baileys / API de Gmail)
                 │
        ┌────────┴────────┐
     'sent'            reintento (retry_count++)
   + id externo         hasta MAX_RETRIES=3 → 'failed' + error legible
```

## Las dos colas

| | WhatsApp | Correo |
|---|---|---|
| Tabla | `jjp_wa_messages` | `jjp_emails` |
| Módulo | `wa-server/src/outbox.js` | `wa-server/src/email.js` |
| Adjuntos | bucket `jjp-wa-media` | bucket `jjp-email-media` |
| Tipos | text, image, video, audio (ptt), document | texto + `html` + adjuntos |
| Requiere | sesión Baileys `connected` | cuenta Gmail vinculada del usuario |

## Por qué se hizo así (tres razones)

1. **El servidor puede estar apagado** (es una PC de tienda). El vendedor sigue
   trabajando: el mensaje espera en la cola y sale al encender.
2. **Todo queda en el historial del [[Cliente]]**, cosa que un `wa.me` suelto no logra.
3. **Reintentos y errores visibles**: si Gmail rechaza, el panel muestra por qué.

## Cómo lo usa el front

`assets/js/send-hub.js` expone las dos funciones que todos reutilizan:
`sendPorWhatsApp({… mime, tipoMedia})` y `sendPorCorreo({… html})`. Con eso
funcionan el menú 📤 y la ficha de producto ([[Envio de documentos]]). El estado
del servidor se consulta con `sendServerOnline()` (heartbeat < 70 s) para avisar
con honestidad: *"queda en cola y saldrá al encenderlo"*.

## Diagnóstico

| Síntoma | Causa probable |
|---|---|
| Mucho `pending` con server 🟢 | la sesión de WhatsApp no está `connected` |
| `sending` viejo | un despacho murió a mitad (lock colgado) |
| `failed` con "Sin correo vinculado" | acción del usuario, no bug |
| Nada se mueve | server apagado o Realtime caído (el barrido debería cubrirlo) |

Consultas listas en el bloque C de la [[Guia maestra de auditoria]].

Relacionado: [[wa-server]] · [[CRM WhatsApp]] · [[Correo]] · [[Difusion]] · [[Envio de documentos]]
