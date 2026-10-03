import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  proto
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './supabase.js';
import { log, baileysLogger } from './logger.js';
import { SESSIONS_DIR } from './config.js';
import { jidToPhone } from './phone.js';
import { upsertChat, touchChat, PREVIEW_BY_TYPE } from './chats.js';
import { uploadIncomingMedia } from './media.js';
import { publishPresence } from './wa-presence.js';

// Estados de WhatsApp (proto WebMessageInfo.Status) → nuestros estados
const RECEIPT_STATUS = { 3: 'delivered', 4: 'read' };
// No retroceder: read no vuelve a delivered
const UPGRADABLE = { delivered: ['sending', 'sent'], read: ['sending', 'sent', 'delivered'] };

// Caché en memoria para stanzas de reintento (evita "Esperando este mensaje" en WhatsApp)
class RetryCounterCache {
  constructor(limit = 2000) {
    this.map = new Map();
    this.limit = limit;
  }
  get(key) { return this.map.get(key); }
  set(key, val) {
    if (this.map.size >= this.limit) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
    this.map.set(key, val);
    return true;
  }
  del(key) { return this.map.delete(key); }
}

function unwrap(m) {
  return m?.ephemeralMessage?.message || m?.viewOnceMessage?.message
      || m?.viewOnceMessageV2?.message || m;
}

// Extrae tipo/cuerpo/media de un mensaje Baileys. null = ignorar (protocolo, reacciones…)
function parseMessage(msg) {
  const m = unwrap(msg.message);
  if (!m) return null;
  if (m.protocolMessage || m.reactionMessage || m.pollUpdateMessage) return null;
  if (m.conversation)              return { type: 'text', body: m.conversation };
  if (m.extendedTextMessage?.text) return { type: 'text', body: m.extendedTextMessage.text };
  if (m.imageMessage)    return { type: 'image',    body: m.imageMessage.caption || '',  mime: m.imageMessage.mimetype };
  if (m.videoMessage)    return { type: 'video',    body: m.videoMessage.caption || '',  mime: m.videoMessage.mimetype };
  if (m.audioMessage)    return { type: 'audio',    body: '',                            mime: m.audioMessage.mimetype };
  if (m.stickerMessage)  return { type: 'sticker',  body: '',                            mime: m.stickerMessage.mimetype };
  if (m.documentMessage) return { type: 'document', body: m.documentMessage.caption || '',
                                  mime: m.documentMessage.mimetype, filename: m.documentMessage.fileName };
  return { type: 'unsupported', body: '[Contenido no soportado en el CRM]' };
}

const HAS_MEDIA = new Set(['image', 'video', 'audio', 'document', 'sticker']);

// contextInfo (cita/reenvío) vive dentro del sub-mensaje (extendedText, image…)
function getContextInfo(m) {
  if (!m) return null;
  for (const k of Object.keys(m)) {
    const ci = m[k]?.contextInfo;
    if (ci) return ci;
  }
  return null;
}
// Texto/etiqueta para mostrar el mensaje citado
function quotedPreview(q) {
  const p = parseMessage({ message: q });
  if (!p) return '';
  return p.body || PREVIEW_BY_TYPE[p.type] || '';
}

// Versión de WhatsApp Web cacheada por proceso: evita una llamada de red en CADA
// arranque (era la causa principal del QR lento). Si el fetch falla, devuelve
// undefined → Baileys usa su versión embebida, y reintenta el fetch al próximo start.
let _waVersion = null;
async function resolveWaVersion() {
  if (_waVersion) return _waVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    _waVersion = version;
    return version;
  } catch (e) {
    log.warn({ err: e.message }, 'fetchLatestBaileysVersion falló; uso la versión embebida de Baileys');
    return undefined;
  }
}

export class WaSession {
  constructor(profileId) {
    this.profileId = profileId;
    this.sock = null;
    this.stopped = true;        // true = no reconectar
    this.pairingPhone = null;   // si está seteado, pedir pairing code en vez de QR
    this.pairingRequested = false;
    this.reconnectMs = 2000;
    this.reconnectTimer = null;   // hay un reintento ya programado
    this.startingSince = 0;       // arranque en curso: NADIE más debe arrancar
    this.lastEventAt = 0;         // última señal de vida de WhatsApp
    this.qrTimeouts = 0;          // contador de expiraciones consecutivas de QR sin escanear
    this.dir = path.join(SESSIONS_DIR, profileId);
    this.cacheFile = path.join(this.dir, 'sent-cache.json');
    this.messageStore = new Map();
    this.storeSaveTimer = null;
    this.loadMessageStore();
    // Presencia: chats cuya presencia estamos observando y hasta cuándo nos
    // declaramos "disponibles" (WhatsApp solo entrega el "escribiendo…" del
    // cliente si nosotros estamos available; el panel renueva cada 4 min).
    this.watched = new Set();
    this.onlineUntil = 0;
    this.onlineSent = false;
  }

  loadMessageStore() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = fs.readFileSync(this.cacheFile, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const [id, entry] of list) {
            if (!id || !entry) continue;
            try {
              if (typeof entry === 'string') {
                // Entrada codificada en Base64 protobuf binario
                const decoded = proto.Message.decode(Buffer.from(entry, 'base64'));
                this.messageStore.set(id, decoded);
              } else if (typeof entry === 'object') {
                this.messageStore.set(id, entry);
              }
            } catch {}
          }
        }
        log.info({ profile: this.profileId, cached: this.messageStore.size }, 'MessageStore cargado desde disco');
      }
    } catch (e) {
      log.warn({ profile: this.profileId, err: e.message }, 'no se pudo cargar sent-cache.json');
    }
  }

  saveMessageToStore(id, msg) {
    if (!id || !msg) return;
    this.messageStore.set(id, msg);
    while (this.messageStore.size > 10000) {
      const oldestKey = this.messageStore.keys().next().value;
      this.messageStore.delete(oldestKey);
    }
    this.scheduleSaveStore();
  }

  scheduleSaveStore() {
    if (this.storeSaveTimer) return;
    this.storeSaveTimer = setTimeout(() => {
      this.storeSaveTimer = null;
      this.flushStoreToDisk().catch(() => {});
    }, 2000);
  }

  async flushStoreToDisk() {
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
      const entries = [];
      const slice = Array.from(this.messageStore.entries()).slice(-5000);
      for (const [id, msg] of slice) {
        try {
          const protoMsg = (msg instanceof proto.Message) ? msg : proto.Message.fromObject(msg);
          const b64 = Buffer.from(proto.Message.encode(protoMsg).finish()).toString('base64');
          entries.push([id, b64]);
        } catch {
          entries.push([id, msg]);
        }
      }
      await fs.promises.writeFile(this.cacheFile, JSON.stringify(entries), 'utf8');
    } catch (e) {
      log.warn({ profile: this.profileId, err: e.message }, 'error guardando sent-cache.json');
    }
  }

  getMessageFromStore(id) {
    const raw = this.messageStore.get(id);
    if (!raw) return undefined;
    if (raw instanceof proto.Message) return raw;
    try {
      return proto.Message.fromObject(raw);
    } catch {
      return raw;
    }
  }

  cleanCorruptedSessions() {
    try {
      if (!fs.existsSync(this.dir)) return;
      const files = fs.readdirSync(this.dir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          const full = path.join(this.dir, f);
          let shouldRemove = false;
          try {
            const stat = fs.statSync(full);
            if (stat.size === 0) {
              shouldRemove = true;
            } else {
              const raw = fs.readFileSync(full, 'utf8');
              JSON.parse(raw); // Verificar que no esté truncado o con sintaxis inválida
            }
          } catch {
            shouldRemove = true;
          }
          if (shouldRemove) {
            log.warn({ profile: this.profileId, file: f }, 'Eliminando archivo auth corrupto o truncado (0 bytes / JSON inválido)');
            try { fs.unlinkSync(full); } catch {}
          }
        }
      }
    } catch (e) {
      log.warn({ profile: this.profileId, err: e.message }, 'cleanCorruptedSessions error');
    }
  }

  hasCreds() { return fs.existsSync(path.join(this.dir, 'creds.json')); }

  async setSession(fields) {
    const { error } = await db.from('jjp_wa_sessions')
      .update(fields).eq('profile_id', this.profileId);
    if (error) log.error({ error: error.message }, 'update jjp_wa_sessions falló');
  }

  async start() {
    // Defensa extra: si otro flujo (panel, vigilante, barrido) ya está
    // arrancando hace menos de 90 s, no abrir un segundo socket con el mismo
    // auth — DOS sockets = WhatsApp expulsa a ambos y el QR se regenera.
    if (this.startingSince && Date.now() - this.startingSince < 90_000) {
      log.warn({ profile: this.profileId }, 'arranque ya en curso — ignoro el nuevo start()');
      return;
    }
    this.stopped = false;
    this.pairingRequested = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.lastEventAt = Date.now();
    this.startingSince = Date.now();   // se limpia al abrir o al cerrar la conexión
    await this.setSession({ status: 'starting', last_error: null, qr_data: null });
    try {
      this.cleanCorruptedSessions();
      const { state, saveCreds } = await useMultiFileAuthState(this.dir);
      const version = await resolveWaVersion();
      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        logger: baileysLogger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        generateHighQualityLinkPreview: true,
        patchMessageBeforeSending: (message) => {
          const requiresPatch = !!(
            message.buttonsMessage ||
            message.templateMessage ||
            message.listMessage
          );
          if (requiresPatch) {
            message = {
              viewOnceMessage: {
                message: {
                  messageContextInfo: {
                    deviceListMetadataVersion: 2,
                    deviceListMetadata: {},
                  },
                  ...message,
                },
              },
            };
          }
          return message;
        },
        syncFullHistory: false,
        shouldSyncHistoryMessage: (msg) => {
          const ts = Number(msg?.messageTimestamp || 0);
          const now = Math.floor(Date.now() / 1000);
          if (ts && (now - ts > 7 * 86400)) return false;
          const jid = msg?.key?.remoteJid || '';
          if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@newsletter')) return false;
          return true;
        },
        shouldIgnoreJid: (jid) => !jid || jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@newsletter'),
        markOnlineOnConnect: false,
        msgRetryCounterCache: new RetryCounterCache(),
        getMessage: async (key) => {
          try {
            const id = key?.id;
            if (!id) return undefined;
            // 1. Verificar MessageStore en memoria/disco (contiene el proto COMPLETO)
            const cached = this.getMessageFromStore(id);
            if (cached) {
              return cached;
            }
            // 2. Fallback a Supabase jjp_wa_messages
            const { data } = await db.from('jjp_wa_messages')
              .select('body, type, media_path, media_mime, media_filename')
              .eq('wa_msg_id', id)
              .limit(1);
            if (!data || !data.length) return undefined;
            const m = data[0];
            const text = m.body || '';
            if (m.type === 'text') {
              return text.includes('\n') ? { extendedTextMessage: { text } } : { conversation: text };
            }
            if (m.type === 'image') {
              return { imageMessage: { caption: text, mimetype: m.media_mime || 'image/jpeg' } };
            }
            if (m.type === 'video') {
              return { videoMessage: { caption: text, mimetype: m.media_mime || 'video/mp4' } };
            }
            if (m.type === 'document') {
              return { documentMessage: { caption: text, fileName: m.media_filename || 'documento.pdf', mimetype: m.media_mime || 'application/pdf' } };
            }
            if (m.type === 'audio') {
              return { audioMessage: { mimetype: m.media_mime || 'audio/ogg; codecs=opus' } };
            }
            return { conversation: text };
          } catch (e) {
            return undefined;
          }
        }
      });
      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', u => this.onConnection(u, state));
      sock.ev.on('messages.upsert', ev => this.onMessages(ev).catch(e =>
        log.error({ err: e.message, profile: this.profileId }, 'messages.upsert falló')));
      sock.ev.on('messages.update', ups => this.onReceipts(ups).catch(() => {}));
      sock.ev.on('presence.update', ev => this.onPresence(ev));
      sock.ev.on('messaging-history.set', ev => this.onHistory(ev).catch(e =>
        log.error({ err: e.message, profile: this.profileId }, 'messaging-history.set falló')));
    } catch (e) {
      this.startingSince = 0;
      log.error({ err: e.message, profile: this.profileId }, 'start de sesión falló');
      await this.setSession({ status: 'error', last_error: e.message });
      this.scheduleReconnect();
    }
  }

  async onConnection(update, state) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.qrTimeouts = 0;
      if (this.pairingPhone && !state.creds.registered && !this.pairingRequested) {
        // Alternativa al QR: código de emparejamiento de 8 caracteres
        this.pairingRequested = true;
        try {
          const code = await this.sock.requestPairingCode(this.pairingPhone);
          await this.setSession({ status: 'pending_pairing', pairing_code: code, qr_data: null });
          log.info({ profile: this.profileId, code }, 'pairing code generado');
        } catch (e) {
          await this.setSession({ status: 'error', last_error: 'Pairing falló: ' + e.message, qr_data: null });
        }
        return;
      }
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      await this.setSession({ status: 'pending_qr', qr_data: dataUrl, qr_updated_at: new Date().toISOString() });
      log.info({ profile: this.profileId }, 'QR publicado (rota ~60s)');
      return;
    }

    if (connection === 'open') {
      this.reconnectMs = 2000;
      this.qrTimeouts = 0;
      this.lastEventAt = Date.now();
      this.startingSince = 0;
      this.pairingPhone = null;
      const me = this.sock.user || {};
      await this.setSession({
        status: 'connected',
        wa_number: jidToPhone(me.id),
        wa_name: me.name || me.verifiedName || null,
        qr_data: null, pairing_code: null,
        last_connected_at: new Date().toISOString(),
        last_error: null
      });
      log.info({ profile: this.profileId, num: jidToPhone(me.id) }, 'WhatsApp CONECTADO ✅');
      // Las suscripciones de presencia mueren con la conexión: si el panel sigue
      // abierto, volvemos a pedirlas para no perder el "escribiendo…".
      this.onlineSent = false;
      if (this.onlineUntil > Date.now()) this.setAvailable(true).catch(() => {});
    }

    if (connection === 'close') {
      this.startingSince = 0;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.warn({ profile: this.profileId }, 'sesión cerrada desde el teléfono (logged out)');
        this.stopped = true;
        fs.rmSync(this.dir, { recursive: true, force: true });
        await this.setSession({ status: 'logged_out', qr_data: null, pairing_code: null, wa_number: null, wa_name: null });
        return;
      }
      if (this.stopped) return;

      // Código 515 (restartRequired) es NORMAL tras escanear QR: Baileys necesita
      // reiniciar de INMEDIATO (1s) para fijar el cifrado con las credenciales nuevas.
      // Si se retrasa por backoff, WhatsApp en el teléfono cancela por timeout.
      if (code === DisconnectReason.restartRequired) {
        log.info({ profile: this.profileId, code }, 'Código 515 restartRequired tras escanear QR — reconexión inmediata (1s) para consolidar sesión ✅');
        this.reconnectMs = 1000;
        await this.setSession({ status: 'reconnecting', last_error: null, qr_data: null });
        this.scheduleReconnect();
        return;
      }

      // Código 408 (timedOut) mientras se esperaba escaneo del QR (sin credenciales previas)
      if (code === DisconnectReason.timedOut && !this.hasCreds()) {
        this.qrTimeouts = (this.qrTimeouts || 0) + 1;
        if (this.qrTimeouts <= 4) {
          log.info({ profile: this.profileId, intento: this.qrTimeouts }, 'QR expiró sin escanear. Regenerando nuevo código QR de inmediato…');
          this.reconnectMs = 1000;
          await this.setSession({ status: 'reconnecting', qr_data: null });
          this.scheduleReconnect();
          return;
        } else {
          log.warn({ profile: this.profileId }, 'QR expiró tras múltiples intentos sin escaneo. Pausando reconexión para no ciclar.');
          this.stopped = true;
          this.qrTimeouts = 0;
          await this.setSession({
            status: 'disconnected',
            qr_data: null,
            pairing_code: null,
            last_error: 'El código QR caducó por inactividad. Haz clic en "Generar código QR" para solicitar uno nuevo.'
          });
          return;
        }
      }

      const isExpectedRestart = code === DisconnectReason.connectionClosed
                             || code === DisconnectReason.timedOut;
      const uiStatus = isExpectedRestart ? 'reconnecting' : 'disconnected';
      await this.setSession({ status: uiStatus, last_error: isExpectedRestart ? null : (lastDisconnect?.error?.message || null) });
      if (isExpectedRestart) {
        log.info({ profile: this.profileId, code }, 'reconexión esperada / transitoria — reconectando…');
      }
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped) return;
    if (this.reconnectTimer) return;          // ya hay uno en camino
    const wait = this.reconnectMs;
    this.reconnectMs = Math.min(this.reconnectMs * 2, 60_000);
    log.info({ profile: this.profileId, wait }, 'reintento de conexión programado');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.start();
    }, wait);
  }

  // ¿El websocket con WhatsApp sigue realmente abierto? Baileys puede quedarse
  // con sock.user cargado y el socket muerto SIN emitir 'close': ahí el panel
  // mostraba 🟢 y no entraba ni salía nada.
  wsOpen() {
    const ws = this.sock?.ws;
    if (!ws) return false;
    if (typeof ws.isOpen === 'boolean') return ws.isOpen;
    const rs = ws.readyState ?? ws.socket?.readyState;
    return rs === undefined ? true : rs === 1;   // 1 = OPEN
  }

  // Sana = conectada, con el socket abierto y sin un reintento pendiente
  isHealthy() {
    return !this.stopped && this.isConnected() && this.wsOpen() && !this.reconnectTimer;
  }

  // ---------- Entrantes (y enviados desde el teléfono) ----------
  async onMessages({ messages, type }) {
    this.lastEventAt = Date.now();
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages) {
      const key = msg.key || {};
      if (key.id && msg.message) {
        this.saveMessageToStore(key.id, msg.message);
      }
      let jid = key.remoteJid || '';
      if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@newsletter')) continue;
      if (jid.endsWith('@lid')) {
        // jid anónimo: usar el número real si Baileys lo trae
        const alt = key.senderPn || key.participantPn || key.remoteJidAlt;
        if (!alt) { log.warn({ jid }, 'mensaje @lid sin número real, ignorado'); continue; }
        jid = alt;
      }

      // Reacción entrante (👍❤️…): no es un mensaje nuevo, actualiza el reaccionado
      const raw = unwrap(msg.message);
      if (raw?.reactionMessage) { await this.applyReaction(msg, raw.reactionMessage).catch(() => {}); continue; }

      const parsed = parseMessage(msg);
      if (!parsed) continue;

      const phone = jidToPhone(jid);
      const chat = await upsertChat(this.profileId, jid, phone, msg.pushName);
      if (!chat) continue;

      let media = null;
      if (HAS_MEDIA.has(parsed.type)) {
        media = await uploadIncomingMedia(msg, this.sock, this.profileId, chat.id, parsed.mime);
      }

      const ctx = getContextInfo(raw);
      const fromMe = !!key.fromMe;

      // Si fue enviado por el CRM (outbox), ya existe en la base. Evitar duplicar la fila.
      if (fromMe && key.id) {
        const { data: existing } = await db.from('jjp_wa_messages')
          .select('id').eq('owner_id', this.profileId).eq('wa_msg_id', key.id).limit(1);
        if (existing && existing.length > 0) {
          await db.from('jjp_wa_messages')
            .update({
              status: 'sent',
              wa_timestamp: msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString()
            })
            .eq('id', existing[0].id);
          continue;
        }
      }

      const row = {
        chat_id: chat.id,
        owner_id: this.profileId,
        wa_msg_id: key.id || null,
        direction: fromMe ? 'out' : 'in',
        type: parsed.type,
        body: parsed.body || null,
        media_path: media?.path || null,
        media_mime: parsed.mime ? parsed.mime.split(';')[0] : null,
        media_size: media?.size || null,
        media_filename: parsed.filename || null,
        status: fromMe ? 'sent' : 'received',
        reply_to_wa_id: ctx?.quotedMessage ? (ctx.stanzaId || null) : null,
        reply_preview: ctx?.quotedMessage ? quotedPreview(ctx.quotedMessage) : null,
        wa_timestamp: msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : null
      };
      const { error } = await db.from('jjp_wa_messages').insert(row);
      if (error) {
        if (error.code === '23505') continue; // duplicado (replay) — ya lo tenemos
        log.error({ error: error.message }, 'insert mensaje entrante falló');
        continue;
      }
      const preview = parsed.body || PREVIEW_BY_TYPE[parsed.type] || '';
      await touchChat(chat.id, preview, fromMe ? 'me' : 'them', !fromMe);
    }
  }

  // ---------- Sincronización de historial (al vincular y al re-sincronizar) ----------
  // Baileys entrega los chats/mensajes anteriores por chunks en 'messaging-history.set'.
  // Importamos texto + metadatos; la media vieja NO se descarga (serían miles de archivos):
  // el hilo la muestra como "📷 Foto/🎥 Video…". Los mensajes nuevos sí traen media completa.
  async onHistory({ messages }) {
    if (!messages?.length) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const MAX_HISTORY_SEC = 7 * 86400; // Máximo 7 días de mensajes anteriores
    log.info({ profile: this.profileId, n: messages.length }, 'sincronizando historial (máx 7 días)…');
    const chats = new Map();   // jid -> { chat, ts, preview, from }
    let batch = [];
    let saved = 0;

    for (const msg of messages) {
      const key = msg.key || {};
      let jid = key.remoteJid || '';
      if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@newsletter')) continue;
      if (jid.endsWith('@lid')) {
        const alt = key.senderPn || key.participantPn || key.remoteJidAlt;
        if (!alt) continue;
        jid = alt;
      }
      if (!key.id) continue;                 // sin id no se puede deduplicar
      const tsSec = Number(msg.messageTimestamp || 0);
      if (tsSec && (nowSec - tsSec > MAX_HISTORY_SEC)) continue; // descartar mensaje si tiene más de 7 días
      if (msg.message) this.saveMessageToStore(key.id, msg.message);
      const parsed = parseMessage(msg);
      if (!parsed) continue;

      let entry = chats.get(jid);
      if (!entry) {
        const chat = await upsertChat(this.profileId, jid, jidToPhone(jid), msg.pushName);
        if (!chat) continue;
        entry = { chat, ts: 0, preview: '', from: 'them' };
        chats.set(jid, entry);
      }

      const fromMe = !!key.fromMe;
      batch.push({
        chat_id: entry.chat.id,
        owner_id: this.profileId,
        wa_msg_id: key.id,
        direction: fromMe ? 'out' : 'in',
        type: parsed.type,
        body: parsed.body || null,
        media_mime: parsed.mime ? parsed.mime.split(';')[0] : null,
        media_filename: parsed.filename || null,
        status: fromMe ? 'sent' : 'received',
        wa_timestamp: tsSec ? new Date(tsSec * 1000).toISOString() : null
      });
      if (tsSec >= entry.ts) {               // recordar el más reciente para el preview de la lista
        entry.ts = tsSec;
        entry.preview = parsed.body || PREVIEW_BY_TYPE[parsed.type] || '';
        entry.from = fromMe ? 'me' : 'them';
      }
      if (batch.length >= 200) { saved += await this.flushHistory(batch); batch = []; }
    }
    if (batch.length) saved += await this.flushHistory(batch);

    // Ordena/previsualiza la bandeja con el último mensaje de cada chat
    for (const e of chats.values()) {
      if (!e.ts) continue;
      await db.from('jjp_wa_chats').update({
        last_message_at: new Date(e.ts * 1000).toISOString(),
        last_message_preview: (e.preview || '').slice(0, 120),
        last_message_from: e.from
      }).eq('id', e.chat.id);
    }
    log.info({ profile: this.profileId, chats: chats.size, mensajes: saved }, 'historial sincronizado ✅');
  }

  async flushHistory(rows) {
    const { error } = await db.from('jjp_wa_messages')
      .upsert(rows, { onConflict: 'owner_id,wa_msg_id', ignoreDuplicates: true });
    if (error) { log.error({ error: error.message }, 'flush historial falló'); return 0; }
    return rows.length;
  }

  // ---------- Acuses (entregado/leído) ----------
  async onReceipts(updates) {
    for (const { key, update } of updates) {
      const st = RECEIPT_STATUS[update?.status];
      if (!st || !key?.id) continue;
      // Intentar matchear por owner_id (caso normal)
      const { data: updated } = await db.from('jjp_wa_messages')
        .update({ status: st })
        .eq('owner_id', this.profileId).eq('wa_msg_id', key.id)
        .in('status', UPGRADABLE[st])
        .select('id');
      // Si no matcheó (ej: mensaje enviado por fallback), buscar por sent_by
      if (!updated?.length) {
        await db.from('jjp_wa_messages')
          .update({ status: st })
          .eq('sent_by', this.profileId).eq('wa_msg_id', key.id)
          .in('status', UPGRADABLE[st]);
      }
    }
  }

  // ---------- Presencia del cliente (escribiendo / grabando / en línea) ----------
  // Llega de WhatsApp y se reenvía al panel por Broadcast (nada toca la base).
  onPresence(ev) {
    const jid = ev?.id;
    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@newsletter')) return;
    const entry = ev.presences?.[jid] || Object.values(ev.presences || {})[0];
    if (!entry) return;
    publishPresence(this.profileId, {
      jid,
      phone: jidToPhone(jid),          // el panel casa por teléfono si el jid difiere (@lid)
      state: entry.lastKnownPresence || 'unavailable',
      lastSeen: entry.lastSeen || null
    });
  }

  // El panel está a la vista → nos declaramos disponibles (requisito de WhatsApp
  // para recibir presencia). Al cerrarlo, o a los 5 min sin señal, volvemos a
  // invisible: así el número NO aparece en línea las 24 horas.
  async setAvailable(on) {
    this.onlineUntil = on ? Date.now() + 5 * 60_000 : 0;
    if (!this.isConnected()) return;
    if (on || this.onlineSent) {
      try { await this.sock.sendPresenceUpdate(on ? 'available' : 'unavailable'); }
      catch (e) { log.warn({ err: e.message }, 'sendPresenceUpdate falló'); }
    }
    this.onlineSent = on;
    if (on) for (const jid of this.watched) this.subscribePresence(jid);
  }

  // Observar la presencia de un chat (el panel lo pide al abrirlo)
  async watch(jid) {
    if (!jid) return;
    this.watched.add(jid);
    // Tope: los chats más viejos dejan de observarse (se re-piden al abrirlos)
    while (this.watched.size > 60) this.watched.delete(this.watched.values().next().value);
    await this.setAvailable(true);
    this.subscribePresence(jid);
  }

  subscribePresence(jid) {
    if (!this.isConnected()) return;
    try { Promise.resolve(this.sock.presenceSubscribe(jid)).catch(() => {}); }
    catch (e) { /* la suscripción se reintenta al reabrir el chat */ }
  }

  // Llamado cada minuto por wa-actions: renueva o retira la disponibilidad
  tickPresence() {
    if (!this.isConnected()) return;
    const activo = this.onlineUntil > Date.now();
    if (activo) this.setAvailable(true).catch(() => {});
    else if (this.onlineSent) this.setAvailable(false).catch(() => {});
  }

  isConnected() {
    return !!this.sock?.user && !this.stopped;
  }

  async send(jid, content, options) {
    if (!this.isConnected()) throw new Error('sesión no conectada');

    // 1. Aserción de sesiones Signal antes de cifrar:
    // Asegura que tanto el destinatario como el teléfono primario del vendedor (:0)
    // tengan la sesión criptográfica activa y los PreKey bundles cargados en Baileys.
    if (this.sock.assertSessions) {
      try {
        const jids = [jid];
        if (this.sock.user?.id) jids.push(this.sock.user.id);
        await this.sock.assertSessions(jids, false);
      } catch (err) {
        log.warn({ err: err.message, jid }, 'assertSessions advertencia pre-envío');
      }
    }

    // 2. Presencia composing humana
    try {
      await this.sock.sendPresenceUpdate('composing', jid);
      await new Promise(r => setTimeout(r, 600));
    } catch (_) {}

    const res = await this.sock.sendMessage(jid, content, options);

    // Detener estado composing
    try {
      await this.sock.sendPresenceUpdate('paused', jid);
    } catch (_) {}

    if (res?.key?.id && res?.message) {
      this.saveMessageToStore(res.key.id, res.message);
    }
    return res;
  }

  // Reacción entrante → actualiza el mensaje reaccionado (emoji '' = quitada)
  async applyReaction(msg, reaction) {
    const targetId = reaction.key?.id;
    if (!targetId) return;
    const fromMe = !!msg.key?.fromMe;
    await db.from('jjp_wa_messages')
      .update({ reaction: reaction.text || '', reaction_from: fromMe ? 'me' : 'them' })
      .eq('owner_id', this.profileId).eq('wa_msg_id', targetId);
  }

  // Acciones efímeras pedidas desde el panel (jjp_wa_actions)
  async doAction(a) {
    const jid = a.jid;
    if (a.kind === 'typing')      return void this.sock.sendPresenceUpdate('composing', jid);
    if (a.kind === 'stop_typing') return void this.sock.sendPresenceUpdate('paused', jid);
    if (a.kind === 'watch')       return void await this.watch(jid);
    if (a.kind === 'online')      return void await this.setAvailable(true);
    if (a.kind === 'offline')     return void await this.setAvailable(false);
    if (a.kind === 'read') {
      const { data: msgs } = await db.from('jjp_wa_messages')
        .select('wa_msg_id').eq('owner_id', this.profileId).eq('chat_id', a.chat_id)
        .eq('direction', 'in').not('wa_msg_id', 'is', null)
        .order('created_at', { ascending: false }).limit(20);
      const keys = (msgs || []).filter(m => m.wa_msg_id)
        .map(m => ({ remoteJid: jid, id: m.wa_msg_id, fromMe: false }));
      if (keys.length) await this.sock.readMessages(keys);
      return;
    }
    if (a.kind === 'react') {
      if (!a.target_wa_id) return;
      const { data } = await db.from('jjp_wa_messages')
        .select('direction').eq('owner_id', this.profileId).eq('wa_msg_id', a.target_wa_id).maybeSingle();
      const fromMe = data?.direction === 'out';
      await this.sock.sendMessage(jid, { react: { text: a.emoji || '', key: { remoteJid: jid, id: a.target_wa_id, fromMe } } });
    }
  }

  async stop(statusRow = 'disabled') {
    this.stopped = true;
    this.startingSince = 0;   // liberar guarda de arranque
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.storeSaveTimer) { clearTimeout(this.storeSaveTimer); this.storeSaveTimer = null; }
    await this.flushStoreToDisk().catch(() => {});
    try { this.sock?.end?.(new Error('detenida por el CRM')); } catch {}
    this.sock = null;
    await this.setSession({ status: statusRow, qr_data: null, pairing_code: null });
  }

  async logout() {
    this.stopped = true;
    try { await this.sock?.logout?.(); } catch {}
    this.sock = null;
    fs.rmSync(this.dir, { recursive: true, force: true });
    await this.setSession({ status: 'logged_out', qr_data: null, pairing_code: null, wa_number: null, wa_name: null });
  }
}
