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

export class WaSession {
  constructor(profileId) {
    this.profileId = profileId;
    this.sock = null;
    this.stopped = true;        // true = no reconectar
    this.pairingPhone = null;   // si está seteado, pedir pairing code en vez de QR
    this.pairingRequested = false;
    this.reconnectMs = 2000;
    this.dir = path.join(SESSIONS_DIR, profileId);
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
    await this.setSession({ status: 'starting', last_error: null });
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.dir);
      const { version } = await fetchLatestBaileysVersion();
      const sock = makeWASocket({
        version,
        auth: state,
        logger: baileysLogger,
        printQRInTerminal: false,
        browser: ['JJ Paper CRM', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false
      });
      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', u => this.onConnection(u, state));
      sock.ev.on('messages.upsert', ev => this.onMessages(ev).catch(e =>
        log.error({ err: e.message, profile: this.profileId }, 'messages.upsert falló')));
      sock.ev.on('messages.update', ups => this.onReceipts(ups).catch(() => {}));
    } catch (e) {
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
    }

    if (connection === 'close') {
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
    const wait = this.reconnectMs;
    this.reconnectMs = Math.min(this.reconnectMs * 2, 60_000);
    log.info({ profile: this.profileId, wait }, 'reintento de conexión programado');
    setTimeout(() => { if (!this.stopped) this.start(); }, wait);
  }

  // ---------- Entrantes (y enviados desde el teléfono) ----------
  async onMessages({ messages, type }) {
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

      const parsed = parseMessage(msg);
      if (!parsed) continue;

      const phone = jidToPhone(jid);
      const chat = await upsertChat(this.profileId, jid, phone, msg.pushName);
      if (!chat) continue;

      let media = null;
      if (HAS_MEDIA.has(parsed.type)) {
        media = await uploadIncomingMedia(msg, this.sock, this.profileId, chat.id, parsed.mime);
      }

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

  isConnected() {
    return !!this.sock?.user && !this.stopped;
  }

  async send(jid, content) {
    if (!this.isConnected()) throw new Error('sesión no conectada');
    return this.sock.sendMessage(jid, content);
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
