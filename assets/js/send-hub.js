/* ======================================================
   JJ Paper — Hub de envío

   Un solo botón "📤 Enviar" para todo el panel: catálogo, lista de
   precios, cotización, factura, orden de recibo y estado del pedido,
   por WhatsApp o por correo, con el PDF adjunto de verdad.

   Sale por el CRM propio (jjp_wa_messages / jjp_emails), así que el
   envío queda guardado en el historial del cliente. Antes todo era
   wa.me: se abría WhatsApp Web aparte, iba texto pelado y no quedaba
   registro de nada.

   Si el servidor de la tienda está apagado, no se pierde la venta:
   el mensaje queda encolado y además se ofrece abrir WhatsApp Web con
   el PDF ya descargado para adjuntarlo a mano.

   Depende de: config.js, doc-engine.js (y wa-common.js si está).
   ====================================================== */

/* ---------------- Estado del servidor ---------------- */
// 🟢 si el último latido llegó hace menos de 70s (late cada 20s)
async function sendServerOnline() {
  try {
    const { data } = await sb.from('jjp_server_control').select('heartbeat_at').eq('id', 1).maybeSingle();
    if (!data?.heartbeat_at) return false;
    return (Date.now() - new Date(data.heartbeat_at).getTime()) < 70_000;
  } catch (e) { return false; }
}

// ¿La sesión de WhatsApp de este usuario está conectada?
async function sendWaSessionOk(ownerId) {
  try {
    const { data } = await sb.from('jjp_wa_sessions').select('status').eq('profile_id', ownerId).maybeSingle();
    return data?.status === 'connected';
  } catch (e) { return false; }
}

function sendSafeName(nombre) {
  return String(nombre || 'documento.pdf').replace(/[^\w.\-]/g, '_');
}

function sendToast(msg, tipo) {
  if (typeof showToast === 'function') showToast(msg, tipo);
  else console.log(msg);
}

/* ====================================================================
   ENVÍO POR WHATSAPP (vía CRM)
   ==================================================================== */
// mime/tipoMedia opcionales: por defecto PDF adjunto (comportamiento histórico);
// la ficha de producto los usa para mandar la FOTO como imagen con caption.
async function sendPorWhatsApp({ telefono, nombre, texto, blob, filename, path, customerId, mime = 'application/pdf', tipoMedia = 'document' }) {
  if (!telefono) throw new Error('El cliente no tiene teléfono cargado');

  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Sin sesión');

  // Firma personal del vendedor (si la tiene configurada) al pie del mensaje
  if (typeof sellerSign === 'function') texto = sellerSign(texto);

  // Abre (o reusa) el chat con esa persona: sin chat no hay dónde encolar.
  let chatId = null;
  const norm = typeof normVePhone === 'function' ? normVePhone(telefono) : telefono.replace(/\D/g, '');
  const jid = norm.includes('@') ? norm : (norm.startsWith('58') ? norm : ('58' + norm.replace(/^0/, ''))) + '@s.whatsapp.net';
  const cleanPhone = jid.split('@')[0];

  try {
    const { data: rpcChat, error: rpcErr } = await sb.rpc('jjp_wa_ensure_chat', {
      p_phone: telefono, p_name: nombre || null,
    });
    if (!rpcErr && rpcChat) {
      chatId = rpcChat;
    }
  } catch (e) {
    // Fallback a consulta e inserción directa
  }

  if (!chatId) {
    const { data: existingChat } = await sb.from('jjp_wa_chats')
      .select('id').eq('owner_id', user.id).eq('jid', jid).maybeSingle();
    
    if (existingChat?.id) {
      chatId = existingChat.id;
    } else {
      const { data: newChat, error: insErr } = await sb.from('jjp_wa_chats').upsert({
        owner_id: user.id,
        jid,
        phone: cleanPhone,
        customer_id: customerId || null,
        display_name: nombre || cleanPhone
      }, { onConflict: 'owner_id,jid' }).select('id').single();

      if (insErr) throw new Error('No se pudo abrir el chat: ' + insErr.message);
      chatId = newChat.id;
    }
  }

  let mediaPath = path || null;
  let mediaSize = blob?.size || null;

  if (!mediaPath && blob) {
    mediaPath = `${user.id}/${chatId}/${Date.now()}-${sendSafeName(filename)}`;
    const { error } = await sb.storage.from('jjp-wa-media')
      .upload(mediaPath, blob, { contentType: mime, upsert: true });
    if (error) throw new Error('No se pudo subir el archivo: ' + error.message);
  }

  const insert = mediaPath ? {
    chat_id: chatId, owner_id: user.id, direction: 'out', type: tipoMedia,
    body: texto || null, media_path: mediaPath, media_mime: mime,
    media_filename: filename || 'documento.pdf', media_size: mediaSize, status: 'pending',
  } : {
    chat_id: chatId, owner_id: user.id, direction: 'out', type: 'text',
    body: texto || '', status: 'pending',
  };

  const { error } = await sb.from('jjp_wa_messages').insert(insert);
  if (error) throw new Error('No se pudo encolar el envío: ' + error.message);

  // Enlaza el chat con el cliente del CRM si aún no lo estaba
  if (customerId) {
    sb.from('jjp_wa_chats').update({ customer_id: customerId })
      .eq('id', chatId).is('customer_id', null).then(() => {}, () => {});
  }
  return chatId;
}

/* ====================================================================
   ENVÍO POR CORREO
   ==================================================================== */
// html opcional: versión con formato del cuerpo (jjp_emails.html);
// el servidor la prefiere sobre el texto plano si viene cargada.
async function sendPorCorreo({ email, asunto, cuerpo, html, blob, filename, path, customerId }) {
  if (!email) throw new Error('El cliente no tiene correo cargado');

  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Sin sesión');

  // Firma personal del vendedor (si la tiene configurada) al pie del correo
  if (typeof sellerSign === 'function') cuerpo = sellerSign(cuerpo);

  const adjuntos = [];
  let attPath = path || null;
  if (!attPath && blob) {
    attPath = `${user.id}/${Date.now()}-${sendSafeName(filename)}`;
    const { error } = await sb.storage.from('jjp-email-media')
      .upload(attPath, blob, { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error('No se pudo subir el PDF: ' + error.message);
  }
  if (attPath) {
    adjuntos.push({
      path: attPath, name: filename || 'documento.pdf',
      mime: 'application/pdf', size: blob?.size || null,
    });
  }

  const { error } = await sb.from('jjp_emails').insert({
    owner_id: user.id, direction: 'out', to_addr: email,
    subject: asunto || '(sin asunto)', body: cuerpo || '', html: html || null,
    status: 'pending', customer_id: customerId || null, attachments: adjuntos,
  });
  if (error) throw new Error('No se pudo encolar el correo: ' + error.message);
}

/* ====================================================================
   CATÁLOGO DE DOCUMENTOS ENVIABLES
   Cada entrada sabe generar su PDF y su mensaje de acompañamiento.
   ==================================================================== */
const SEND_DOCS = {
  catalogo: {
    label: '📗 Catálogo completo',
    hint: 'Todos los productos con precios en $ y Bs',
    async build() {
      const f = await docArchivoDelDia('catalogo', 'jjp-wa-media');
      return { ...f, clase: 'catalogo' };
    },
    async buildMail() {
      const f = await docArchivoDelDia('catalogo', 'jjp-email-media');
      return { ...f, clase: 'catalogo' };
    },
    texto: ctx => `📗 *Catálogo JJ Paper*\n\nHola${ctx.nombre ? ' ' + ctx.nombre : ''}, te comparto nuestro catálogo completo con los precios del día.\n\nCualquier producto que necesites, escríbenos por aquí. 📄`,
    asunto: () => 'Catálogo JJ Paper',
  },
  lista: {
    label: '💵 Lista de precios',
    hint: 'Precios del día, sin existencias',
    async build() {
      const f = await docArchivoDelDia('lista', 'jjp-wa-media');
      return { ...f, clase: 'lista' };
    },
    async buildMail() {
      const f = await docArchivoDelDia('lista', 'jjp-email-media');
      return { ...f, clase: 'lista' };
    },
    texto: ctx => `💵 *Lista de precios JJ Paper*\n\nHola${ctx.nombre ? ' ' + ctx.nombre : ''}, aquí tienes nuestra lista de precios actualizada al día de hoy.\n\nLos precios están en dólares y en bolívares a la tasa BCV vigente. 📄`,
    asunto: () => 'Lista de precios — JJ Paper',
  },
  cotizacion: {
    label: '📋 Cotización',
    hint: 'Presupuesto en PDF',
    needs: 'quote',
    // Resolver primero: desde el chat solo llega el resumen (número y total),
    // sin las líneas, y sin ellas no hay documento que dibujar.
    async build(ctx) { return await docPdfDocumento(await docResolveCotizacion(ctx.quote), 'presupuesto'); },
    texto: ctx => `📋 *COTIZACIÓN ${ctx.quote?.order_number || ''}* — JJ Paper\n\nHola ${ctx.nombre || ''}, te envío tu cotización en PDF.\n\n💰 *Total estimado: $${Number(ctx.quote?.total_usd || 0).toFixed(2)}*\n_Precios sujetos a cambio según la tasa del día._`,
    asunto: ctx => `Cotización ${ctx.quote?.order_number || ''} — JJ Paper`,
  },
  factura: {
    label: '🧾 Factura',
    hint: 'Documento de la venta',
    needs: 'order',
    async build(ctx) { return await docPdfDocumento(await docResolvePedido(ctx.order), 'factura'); },
    texto: ctx => `🧾 *FACTURA ${ctx.order?.order_number || ''}* — JJ Paper\n\nHola ${ctx.nombre || ''}, adjunto la factura de tu compra.\n\n💰 *Total: $${Number(ctx.order?.total_usd || 0).toFixed(2)}*\n\n¡Gracias por tu compra! 📄`,
    asunto: ctx => `Factura ${ctx.order?.order_number || ''} — JJ Paper`,
  },
  recibo: {
    label: '📦 Orden de recibo',
    hint: 'Para firmar al entregar',
    needs: 'order',
    async build(ctx) { return await docPdfDocumento(await docResolvePedido(ctx.order), 'recibo'); },
    texto: ctx => `📦 *ORDEN DE RECIBO ${ctx.order?.order_number || ''}* — JJ Paper\n\nHola ${ctx.nombre || ''}, adjunto la orden de entrega de tu pedido.`,
    asunto: ctx => `Orden de recibo ${ctx.order?.order_number || ''} — JJ Paper`,
  },
  estado: {
    label: '🔎 Estado del pedido',
    hint: 'Mensaje con el enlace de rastreo',
    needs: 'order',
    build: null,   // solo texto, sin adjunto
    texto: ctx => {
      const base = location.origin + location.pathname.replace(/\/(admin|vendedor)\/.*$/, '');
      const n = ctx.order?.order_number || '';
      return `🛒 *PEDIDO ${n}* — JJ Paper\n\nHola ${ctx.nombre || ''}, tu pedido está en estado: *${SEND_ESTADOS[ctx.order?.status] || ctx.order?.status || '—'}*.\n\n💰 Total: $${Number(ctx.order?.total_usd || 0).toFixed(2)}\n\n🔎 Rastrea tu pedido aquí:\n${base}/rastreo.html?n=${encodeURIComponent(n)}`;
    },
    asunto: ctx => `Tu pedido ${ctx.order?.order_number || ''} — JJ Paper`,
  },
};

const SEND_ESTADOS = {
  pendiente_pago: 'Pendiente de pago', verificando: 'Verificando pago',
  pagado: 'Pagado', preparando: 'Preparando', enviado: 'Enviado',
  entregado: 'Entregado', cancelado: 'Cancelado', rechazado: 'Rechazado',
};

/* ====================================================================
   MENÚ DE ENVÍO — el botón que ve el vendedor
   ctx: { nombre, telefono, email, customerId, order, quote, docs:[claves] }
   ==================================================================== */
let _sendCtx = null;

function sendMenuAbrir(ev, ctx) {
  ev?.stopPropagation?.();
  _sendCtx = ctx || {};
  sendMenuCerrar();

  const claves = ctx.docs || Object.keys(SEND_DOCS).filter(k => {
    const d = SEND_DOCS[k];
    if (d.needs === 'order') return !!ctx.order;
    if (d.needs === 'quote') return !!ctx.quote;
    return true;
  });

  const hayTel  = !!ctx.telefono;
  const hayMail = !!ctx.email;

  const menu = document.createElement('div');
  menu.className = 'send-menu';
  menu.id = 'sendMenu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="send-menu-head">
      Enviar a <strong>${escapeHTML(ctx.nombre || 'el cliente')}</strong>
      <div class="send-menu-sub">${hayTel ? '📱 ' + escapeHTML(ctx.telefono) : ''}${hayTel && hayMail ? ' · ' : ''}${hayMail ? '📧 ' + escapeHTML(ctx.email) : ''}</div>
    </div>
    ${claves.map(k => {
      const d = SEND_DOCS[k];
      if (!d) return '';
      return `<div class="send-row">
        <div class="send-row-txt">
          <span class="send-row-label">${d.label}</span>
          <span class="send-row-hint">${escapeHTML(d.hint || '')}</span>
        </div>
        <button class="send-go wa" onclick="sendEjecutar('${k}','wa')" ${hayTel ? '' : 'disabled title="Sin teléfono cargado"'}
                aria-label="Enviar ${escapeHTML(d.label)} por WhatsApp">💬</button>
        <button class="send-go mail" onclick="sendEjecutar('${k}','mail')" ${hayMail ? '' : 'disabled title="Sin correo cargado"'}
                aria-label="Enviar ${escapeHTML(d.label)} por correo">📧</button>
      </div>`;
    }).join('')}
    <div class="send-menu-foot" id="sendMenuFoot"></div>`;

  document.body.appendChild(menu);

  // Colocar junto al botón, sin salirse de la pantalla
  const r = ev?.currentTarget?.getBoundingClientRect?.();
  const w = menu.offsetWidth || 300;
  if (r) {
    menu.style.top  = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 10) + 'px';
    menu.style.left = Math.max(10, Math.min(r.left, window.innerWidth - w - 10)) + 'px';
  } else {
    menu.style.top = '80px';
    menu.style.left = Math.max(10, (window.innerWidth - w) / 2) + 'px';
  }

  setTimeout(() => {
    document.addEventListener('click', sendMenuFuera, true);
    document.addEventListener('keydown', sendMenuEsc);
  }, 0);

  // Aviso honesto: si el servidor está apagado, el envío queda en cola
  sendServerOnline().then(on => {
    const foot = document.getElementById('sendMenuFoot');
    if (!foot) return;
    foot.innerHTML = on
      ? '<span class="send-ok">🟢 Servidor encendido — sale de inmediato</span>'
      : '<span class="send-off">🔴 Servidor apagado — queda en cola y saldrá al encenderlo</span>';
  });
}

function sendMenuCerrar() {
  document.getElementById('sendMenu')?.remove();
  document.removeEventListener('click', sendMenuFuera, true);
  document.removeEventListener('keydown', sendMenuEsc);
}
function sendMenuFuera(e) {
  if (!e.target.closest('#sendMenu')) sendMenuCerrar();
}
function sendMenuEsc(e) {
  if (e.key === 'Escape') sendMenuCerrar();
}

/* ---------------- Ejecutar el envío ---------------- */
let _sendBusy = false;

async function sendEjecutar(clave, via) {
  if (_sendBusy) return;
  const ctx = _sendCtx || {};
  const def = SEND_DOCS[clave];
  if (!def) return;

  _sendBusy = true;
  const foot = document.getElementById('sendMenuFoot');
  if (foot) foot.innerHTML = '<span class="send-wait">⏳ Preparando el documento…</span>';

  try {
    let archivo = null;
    if (def.build) {
      archivo = (via === 'mail' && def.buildMail) ? await def.buildMail(ctx) : await def.build(ctx);
    }

    if (via === 'wa') {
      await sendPorWhatsApp({
        telefono: ctx.telefono, nombre: ctx.nombre,
        texto: def.texto(ctx),
        blob: archivo?.blob || null, path: archivo?.path || null,
        filename: archivo?.filename, customerId: ctx.customerId,
      });
      sendMenuCerrar();
      const on = await sendServerOnline();
      sendToast(on ? '📤 Enviado por WhatsApp' : '📤 En cola: saldrá cuando enciendas el servidor', on ? 'ok' : 'warn');
      if (!on) sendOfrecerRespaldo(ctx, def, archivo);
    } else {
      await sendPorCorreo({
        email: ctx.email, asunto: def.asunto(ctx),
        cuerpo: def.texto(ctx).replace(/\*/g, ''),
        blob: archivo?.blob || null, path: archivo?.path || null,
        filename: archivo?.filename, customerId: ctx.customerId,
      });
      sendMenuCerrar();
      const on = await sendServerOnline();
      sendToast(on ? '📧 Correo enviado' : '📧 En cola: saldrá cuando enciendas el servidor', on ? 'ok' : 'warn');
    }
  } catch (e) {
    console.error('envío falló:', e);
    sendToast('No se pudo enviar: ' + (e.message || e), 'err');
    if (foot) foot.innerHTML = `<span class="send-off">${escapeHTML(e.message || 'Error')}</span>`;
  } finally {
    _sendBusy = false;
  }
}

/* Respaldo cuando el servidor está apagado: descarga el PDF y abre
   WhatsApp Web con el mensaje listo, para adjuntarlo a mano. Nadie
   se queda sin poder atender a un cliente por esto. */
function sendOfrecerRespaldo(ctx, def, archivo) {
  const tel = String(ctx.telefono || '').replace(/\D/g, '');
  if (!tel) return;
  const seguir = confirm(
    'El servidor está apagado, así que el mensaje quedó en cola.\n\n' +
    '¿Quieres enviarlo ahora a mano por WhatsApp Web?\n' +
    'Se descargará el PDF y se abrirá el chat con el mensaje escrito.');
  if (!seguir) return;
  if (archivo?.blob) docDescargar(archivo.blob, archivo.filename);
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(def.texto(ctx))}`, '_blank');
}

/* ---------------- Botón reutilizable ----------------
   Devuelve el HTML del botón "📤 Enviar". El contexto se pasa por una
   función global que la página define (así no hay que serializar
   objetos grandes en el atributo onclick).                         */
function sendBotonHTML(fnCtx, extraClase = '') {
  return `<button class="btn-send ${extraClase}" onclick="sendMenuAbrir(event, ${fnCtx})"
            aria-haspopup="menu">📤 Enviar</button>`;
}
