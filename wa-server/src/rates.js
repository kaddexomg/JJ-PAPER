import { db } from './supabase.js';
import { log } from './logger.js';

// Refresca las tasas cada hora. Corre en esta PC (Node), sin pg_net ni extensiones.
const RATE_SWEEP_MS = 60 * 60 * 1000;

// Tres tasas del mercado venezolano:
//   BCV     → oficial; con esta se COBRA en Bs (legal, la ve el cliente)
//   Binance → USDT P2P real; a esta cobran los PROVEEDORES (reposición)
//   Monitor → paralelo de referencia (EnParaleloVzla); informativa
async function fetchJson(url, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Binance P2P real vía CriptoYa. Si binancep2p falla, mediana de los demás P2P.
async function fetchBinance() {
  const j = await fetchJson('https://criptoya.com/api/USDT/VES/1');
  const mid = x => (x && x.ask > 0 && x.bid > 0) ? (x.ask + x.bid) / 2
            : (x?.ask > 0 ? x.ask : (x?.bid > 0 ? x.bid : null));
  const bin = mid(j.binancep2p);
  if (bin) return bin;
  const others = ['bybitp2p', 'bitgetp2p', 'bingxp2p', 'okexp2p', 'kucoinp2p']
    .map(k => mid(j[k])).filter(Boolean).sort((a, b) => a - b);
  return others.length ? others[Math.floor(others.length / 2)] : null;
}

// BCV + Monitor vía dolarapi (fallback: pydolarve para el BCV)
async function fetchBcvMonitor() {
  try {
    const data = await fetchJson('https://ve.dolarapi.com/v1/dolares');
    const find = f => Number(data.find(d => d.fuente === f)?.promedio) || null;
    return { bcv: find('oficial'), monitor: find('paralelo') };
  } catch (e) {
    const j = await fetchJson('https://pydolarve.org/api/v2/dollar?page=bcv');
    return { bcv: Number(j?.monitors?.usd?.price) || null, monitor: null };
  }
}

// Euro oficial BCV (Bs/EUR) vía dolarapi
async function fetchEur() {
  const data = await fetchJson('https://ve.dolarapi.com/v1/euros');
  return Number(data.find(d => d.fuente === 'oficial')?.promedio) || null;
}

async function fetchAll() {
  const [bm, binance, eur] = await Promise.allSettled([fetchBcvMonitor(), fetchBinance(), fetchEur()]);
  const bcv     = bm.status === 'fulfilled' ? bm.value.bcv : null;
  const monitor = bm.status === 'fulfilled' ? bm.value.monitor : null;
  const bin     = binance.status === 'fulfilled' ? binance.value : null;
  const rateEur = eur.status === 'fulfilled' ? eur.value : null;
  if (bm.status === 'rejected')      log.warn({ err: bm.reason?.message }, 'fetch BCV/monitor falló');
  if (binance.status === 'rejected') log.warn({ err: binance.reason?.message }, 'fetch Binance falló');
  if (eur.status === 'rejected')     log.warn({ err: eur.reason?.message }, 'fetch euro falló');
  return { bcv, binance: bin, monitor, eur: rateEur };
}

async function setSetting(key, value) {
  const { error } = await db.from('jjp_settings')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) log.error({ key, error: error.message }, 'setSetting falló');
}

export async function updateRates() {
  const { bcv, binance, monitor, eur } = await fetchAll();
  if (!bcv && !binance && !monitor) { log.warn('todas las fuentes de tasa fallaron; conservo la anterior'); return; }

  const rateBcv = bcv || monitor || binance;
  // Reposición: Binance real; si falta, el monitor; nunca por debajo del BCV.
  const rateBin = Math.max(binance || monitor || 0, rateBcv || 0) || rateBcv;
  const rateMon = monitor || null;
  const gap     = rateBcv > 0 ? (rateBin / rateBcv - 1) * 100 : 0;
  // Factor de protección de margen: cuánto subir el PRECIO en USD para que,
  // cobrando en Bs a BCV, el ingreso real (en USDT) mantenga el margen. = Binance/BCV.
  const factor  = rateBcv > 0 ? rateBin / rateBcv : 1;

  const nowIso = new Date().toISOString();
  await setSetting('exchange_rate',     rateBcv.toFixed(2));   // COBRO en Bs = BCV (legal). La usa todo el sitio.
  await setSetting('rate_bcv',          rateBcv.toFixed(2));
  await setSetting('usdt_rate',         rateBin.toFixed(2));   // Binance P2P real (reposición)
  await setSetting('rate_binance',      rateBin.toFixed(2));
  if (rateMon) await setSetting('rate_monitor', rateMon.toFixed(2));
  if (eur)     await setSetting('rate_eur',     eur.toFixed(2));     // Bs por EURO (BCV oficial)
  await setSetting('rate_gap_pct',      gap.toFixed(1));       // brecha BCV↔Binance
  await setSetting('rate_factor',       factor.toFixed(4));    // multiplicador para proteger margen
  await setSetting('rates_updated_iso', nowIso);
  await setSetting('rates_updated_at',  nowIso);

  // Historial para ver la tendencia diaria (tabla jjp_fx_rates)
  const { error: hErr } = await db.from('jjp_fx_rates')
    .insert({ bcv: rateBcv, binance: rateBin, monitor: rateMon, eur });
  if (hErr) log.warn({ err: hErr.message }, 'no se guardó historial de tasas');

  log.info({ bcv: rateBcv, binance: rateBin, monitor: rateMon, eur, brecha: gap.toFixed(1) + '%', factor: factor.toFixed(4) },
    'tasas actualizadas ✅ (se cobra a BCV; factor Binance/BCV protege margen)');
}

export function startRates() {
  updateRates().catch(e => log.error({ err: e.message }, 'updateRates inicial'));
  setInterval(() => updateRates().catch(e => log.error({ err: e.message }, 'updateRates')), RATE_SWEEP_MS);
  log.info('actualizador de tasas activo (cada 60 min)');
}
