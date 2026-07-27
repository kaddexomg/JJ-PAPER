import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
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
    this.dir = path.join(SESSIONS_DIR, profileId);
    // Presencia: chats cuya presencia estamos observando y hasta cuándo nos
    // declaramos "disponibles" (WhatsApp solo entrega el "escribiendo…" del
    // cliente si nosotros estamos available; el panel renueva cada 4 min).
    this.watched = new Set();
    this.onlineUntil = 0;
    this.onlineSent = false;
  }

  hasCreds() { return fs.existsSync(path.join(this.dir, 'creds.json')); }

  async setSession(fields) {
    const { error } = await db.from('jjp_wa_sessions')
      .update(fields).eq('profile_id', this.profileId);
    if (error) log.error({ error: error.message }, 'update jjp_wa_sessions falló');
  }

  async start() {
    this.stopped = false;
    this.pairingRequested = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.lastEventAt = Date.now();
    this.startingSince = Date.now();   // se limpia al abrir o al cerrar la conexión
    await this.setSession({ status: 'starting', last_error: null });
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.dir);
      const version = await resolveWaVersion();
      const sock = makeWASocket({
        version,
        auth: state,
        logger: baileysLogger,
        printQRInTerminal: false,
        browser: ['JJ Paper CRM', 'Chrome', '1.0.0'],
        // NO arrastrar años de historial: en cada (re)conexión eso disparaba
        // una tormenta de escrituras en jjp_wa_chats → el panel recargaba la
        // bandeja cientos de veces y se quedaba "cargando". Baileys con false
        // igual entrega los chats/mensajes recientes; los viejos llegan al
        // usar cada chat. Los mensajes NUEVOS siempre entran completos.
        syncFullHistory: false,
        markOnlineOnConnect: false
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
      if (this.pairingPhone && !state.creds.registered && !this.pairingRequested) {
        // Alternativa al QR: código de emparejamiento de 8 caracteres
        this.pairingRequested = true;
        try {
          const code = await this.sock.requestPairingCode(this.pairingPhone);
          await this.setSession({ status: 'pending_pairing', pairing_code: code, qr_data: null });
          log.info({ profile: this.profileId, code }, 'pairing code generado');
        } catch (e) {
          await this.setSession({ status: 'error', last_error: 'Pairing falló: ' + e.message });
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
      await this.setSession({ status: 'disconnected', last_error: lastDisconnect?.error?.message || null });
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
        forwarded: !!ctx?.isForwarded,
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
    log.info({ profile: this.profileId, n: messages.length }, 'sincronizando historial…');
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
      const tsSec = Number(msg.messageTimestamp || 0);
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
      await db.from('jjp_wa_messages')
        .update({ status: st })
        .eq('owner_id', this.profileId).eq('wa_msg_id', key.id)
        .in('status', UPGRADABLE[st]);
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
    return this.sock.sendMessage(jid, content, options);
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
