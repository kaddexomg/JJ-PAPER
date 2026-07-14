# wa-server — Puente WhatsApp ↔ Supabase (JJ Paper CRM)

Proceso Node que corre en **esta PC** y conecta las cuentas de WhatsApp del equipo
(via [Baileys](https://github.com/WhiskeySockets/Baileys), protocolo WhatsApp Web)
con el CRM del sitio. El frontend nunca habla con esta PC: todo viaja por Supabase
(tablas `jjp_wa_*` + Realtime + Storage `jjp-wa-media`).

> ⚠️ **Importante**: Baileys usa el protocolo de WhatsApp Web y **no es una API oficial**
> (va contra los términos de servicio de WhatsApp). Usado para chat manual 1:1 el riesgo
> de bloqueo es bajo, pero existe. **Nunca** enviar mensajes masivos sin el throttling
> de la Fase 2, y preferir números con antigüedad.

## Instalación (una sola vez)

1. Instalar [Node.js](https://nodejs.org) 18 o superior (ya está: `node --version`).
2. En esta carpeta:
   ```
   npm install
   copy .env.example .env
   ```
3. Abrir `.env` y pegar la **service_role key**:
   Supabase Dashboard → Project Settings → API keys → `service_role` (secret).
   > Esa clave da acceso total a la base de datos. Vive SOLO en este archivo,
   > en esta PC. Jamás subirla a git ni ponerla en el sitio web.

## Uso diario

```
npm start
```

Dejar la ventana abierta. Mientras corra:
- Cada miembro del staff vincula su WhatsApp desde el panel web
  (`/vendedor/whatsapp.html` o `/admin/whatsapp.html`) escaneando el QR
  (WhatsApp → Dispositivos vinculados) o con código de emparejamiento.
- Los chats se sincronizan en vivo con el sitio; los mensajes escritos en el panel
  salen por la cuenta de cada quien.

Si la PC se apaga: el módulo queda offline. Los mensajes escritos en el panel quedan
"pendientes" (⏳) y salen solos al volver a arrancar; los recibidos llegan al reconectar.
Las sesiones vinculadas se guardan en `sessions/` — no hay que reescanear el QR.

## Auto-arranque con Windows (recomendado)

Para que el puente arranque solo al encender la PC, **sin ventana visible**, usa el
lanzador `start-wa.vbs` (incluido) con el Programador de tareas:

1. Menú Inicio → **Programador de tareas** → *Crear tarea…* (no "básica").
2. Pestaña **General**: nombre `JJ Paper WhatsApp`. Marcar *Ejecutar sólo cuando el
   usuario haya iniciado sesión*.
3. Pestaña **Desencadenadores** → *Nuevo* → Iniciar la tarea: **Al iniciar sesión**.
4. Pestaña **Acciones** → *Nueva* → Iniciar un programa:
   - Programa/script: `wscript.exe`
   - Agregar argumentos: `"C:\Users\PC\Desktop\JJ PAPER\wa-server\start-wa.vbs"`
5. Pestaña **Configuración**: marcar *Si la tarea falla, reiniciarla cada 1 minuto*
   (hasta 3 veces) para recuperarse de cortes de red al arrancar.
6. Aceptar. Reiniciar la PC para probar: el puente queda activo en segundo plano.

> Verificar que corre: Administrador de tareas → pestaña *Detalles* → debe haber un
> proceso `node.exe`. Para ver los logs, abrir la ventana manualmente con `npm start`.

Alternativa manual (con ventana visible, para depurar): `npm start` en esta carpeta.

## Actualizar Baileys

La versión está **fijada** en `package.json` (`6.7.23`, sin `^`) porque la librería
cambia rápido (jids `@lid`, firmas de eventos). Para actualizar:
```
npm view @whiskeysockets/baileys dist-tags
npm install @whiskeysockets/baileys@<version>
```
y probar vinculación + envío/recepción antes de darlo por bueno.

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/index.js` | Arranque: levanta sesiones habilitadas, Realtime, cola |
| `src/session-manager.js` | Una sesión Baileys por perfil; ejecuta acciones pedidas desde el panel |
| `src/wa-session.js` | Conexión, QR/pairing, entrantes, acuses, reconexión |
| `src/outbox.js` | Cola de salientes (pending → sent) con reintentos |
| `src/chats.js` | Hilos `jjp_wa_chats` + vínculo con clientes del CRM |
| `src/media.js` | Media entrante/saliente ↔ Storage `jjp-wa-media` |
| `src/phone.js` | Normalización de números venezolanos |
| `sessions/` | Credenciales de WhatsApp por perfil (¡sensible, gitignored!) |
