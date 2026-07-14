import { db } from './supabase.js';
import { log } from './logger.js';

// Refresca las tasas cada hora. Corre en esta PC (Node), sin pg_net ni extensiones.
const RATE_SWEEP_MS = 60 * 60 * 1000;

// Fuentes VE (dolarapi): oficial = BCV (con esta se COBRA en Bs, legal)
//                        paralelo ≈ Binance/USDT (a esta se REPONE la mercancía)
async function fetchOne(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return Number(j.promedio || j.venta || j.compra) || null;
}

async function fetchRates() {
  let bcv = null, usdt = null;
  try { bcv  = await fetchOne('https://ve.dolarapi.com/v1/dolares/oficial'); }
  catch (e) { log.warn({ err: e.message }, 'fetch BCV falló'); }
  try { usdt = await fetchOne('https://ve.dolarapi.com/v1/dolares/paralelo'); }
  catch (e) { log.warn({ err: e.message }, 'fetch paralelo/USDT falló'); }
  return { bcv, usdt };
}

async function setSetting(key, value) {
  const { error } = await db.from('jjp_settings')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) log.error({ key, error: error.message }, 'setSetting falló');
}

export async function updateRates() {
  const { bcv, usdt } = await fetchRates();
  if (!bcv && !usdt) { log.warn('ambas fuentes de tasa fallaron; conservo la anterior'); return; }

  const rateBcv  = bcv || usdt;
  const rateUsdt = Math.max(usdt || 0, bcv || 0) || rateBcv;   // paralelo nunca por debajo del BCV
  const gap      = rateBcv > 0 ? (rateUsdt / rateBcv - 1) * 100 : 0;
  // Factor de protección de margen: cuánto hay que subir el PRECIO en USD para que,
  // cobrando en Bs a BCV, el ingreso real (en USDT) mantenga el margen. = USDT/BCV.
  const factor   = rateBcv > 0 ? rateUsdt / rateBcv : 1;

  const nowIso = new Date().toISOString();
  await setSetting('exchange_rate',     rateBcv.toFixed(2));    // COBRO en Bs = BCV (legal). La usa todo el sitio.
  await setSetting('rate_bcv',          rateBcv.toFixed(2));
  await setSetting('usdt_rate',         rateUsdt.toFixed(2));   // referencia de reposición
  await setSetting('rate_gap_pct',      gap.toFixed(1));        // brecha BCV↔USDT
  await setSetting('rate_factor',       factor.toFixed(4));     // multiplicador para proteger margen
  await setSetting('rates_updated_iso', nowIso);
  await setSetting('rates_updated_at',  nowIso);

  log.info({ bcv: rateBcv, usdt: rateUsdt, brecha: gap.toFixed(1) + '%', factor: factor.toFixed(4) },
    'tasas actualizadas ✅ (se cobra a BCV; factor para proteger margen)');
}

export function startRates() {
  updateRates().catch(e => log.error({ err: e.message }, 'updateRates inicial'));
  setInterval(() => updateRates().catch(e => log.error({ err: e.message }, 'updateRates')), RATE_SWEEP_MS);
  log.info('actualizador de tasas activo (cada 60 min)');
}
