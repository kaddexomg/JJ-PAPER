/* ======================================================
   JJ Paper — Puente de Facturación MixNet / Mixer (Independiente)
   ------------------------------------------------------
   Este script está diseñado para correr directamente en la PC de MixNet.
   Se conecta a la base de datos de Supabase en la nube y exporta
   los pedidos en tiempo real a la carpeta C:/JJ-PAPER-MIXER local.
   ====================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const log = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MIXER_EXPORT_DIR = process.env.MIXER_EXPORT_DIR || 'C:/JJ-PAPER-MIXER';
const HISTORY_FILE = './exported-orders.json';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  log.error('❌ Faltan credenciales de Supabase en el archivo .env');
  log.info('Asegúrate de tener un archivo .env en la misma carpeta con:');
  log.info('SUPABASE_URL=...');
  log.info('SUPABASE_SERVICE_ROLE_KEY=...');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
let exportedOrders = new Set();

// Carga el historial de órdenes ya exportadas
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      exportedOrders = new Set(JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) || []);
      log.info(`📦 Cargadas ${exportedOrders.size} órdenes en el historial de exportación.`);
    }
  } catch (err) {
    log.error('⚠️ Error cargando historial: ' + err.message);
  }
}

// Guarda el historial de órdenes exportadas
function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(Array.from(exportedOrders), null, 2));
  } catch (err) {
    log.error('⚠️ Error guardando historial: ' + err.message);
  }
}

// Escapa valores para formato CSV
function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Exporta un pedido individual
function exportOrder(o) {
  if (exportedOrders.has(o.order_number)) {
    return false;
  }

  log.info(`🚚 Exportando pedido #${o.order_number} a archivos locales...`);
  const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);

  // 1. Generar CSV estructurado
  const csvHeaders = ['Pedido', 'Fecha', 'Cliente', 'RIF', 'Telefono', 'SKU', 'Producto', 'Marca', 'Cantidad', 'PrecioUnitario', 'SubtotalLinea', 'TotalPedidoUSD', 'TasaCambio', 'TotalPedidoBs'];
  const csvRows = items.map(i => [
    o.order_number,
    o.created_at,
    o.client_name,
    o.rif || '',
    o.phone || '',
    i.sku || '',
    i.name || '',
    i.brand || '',
    i.qty,
    i.price_usd,
    (i.subtotal_usd ?? (i.price_usd * i.qty)).toFixed(2),
    o.total_usd,
    o.exchange_rate || 0,
    (o.total_usd * (o.exchange_rate || 0)).toFixed(2)
  ].map(escapeCSV).join(','));
  
  const csvContent = csvHeaders.join(',') + '\n' + csvRows.join('\n');

  // 2. Generar TXT tipo ticket
  const txtLines = [
    '================================================',
    `PEDIDO: ${o.order_number}`,
    `Fecha: ${new Date(o.created_at).toLocaleString('es-VE')}`,
    `Cliente: ${o.client_name}`,
    o.rif ? `RIF/CI: ${o.rif}` : '',
    o.phone ? `Teléfono: ${o.phone}` : '',
    '================================================',
    'Detalle:',
    'Cant.   Producto [Marca]            P.Unit   Subtotal',
    '------------------------------------------------'
  ];
  
  items.forEach(i => {
    const brandStr = i.brand ? ` [${i.brand}]` : '';
    const namePart = `${i.name}${brandStr}`.substring(0, 28).padEnd(28, ' ');
    const qtyPart = String(i.qty).padStart(4, ' ');
    const pricePart = parseFloat(i.price_usd).toFixed(2).padStart(8, ' ');
    const subPart = parseFloat(i.subtotal_usd ?? (i.price_usd * i.qty)).toFixed(2).padStart(9, ' ');
    txtLines.push(`${qtyPart} x ${namePart} ${pricePart} ${subPart}`);
  });
  
  txtLines.push(
    '------------------------------------------------',
    `TOTAL USD: $${parseFloat(o.total_usd).toFixed(2)}`
  );
  if (o.exchange_rate) {
    txtLines.push(
      `Tasa de cambio: ${parseFloat(o.exchange_rate).toFixed(2)} Bs/$`,
      `TOTAL BS:  ${parseFloat(o.total_usd * o.exchange_rate).toFixed(2)} Bs`
    );
  }
  txtLines.push('================================================');
  const txtContent = txtLines.filter(Boolean).join('\n');

  // Crear directorio si no existe
  if (!fs.existsSync(MIXER_EXPORT_DIR)) {
    fs.mkdirSync(MIXER_EXPORT_DIR, { recursive: true });
  }

  try {
    fs.writeFileSync(path.join(MIXER_EXPORT_DIR, `pedido_${o.order_number}.csv`), csvContent, 'utf8');
    fs.writeFileSync(path.join(MIXER_EXPORT_DIR, `pedido_${o.order_number}.txt`), txtContent, 'utf8');
    
    exportedOrders.add(o.order_number);
    saveHistory();
    log.info(`✅ Pedido #${o.order_number} exportado correctamente.`);
    return true;
  } catch (err) {
    log.error(`❌ Error exportando pedido #${o.order_number}: ` + err.message);
    return false;
  }
}

// Barrido de las últimas 48 horas para asegurar resiliencia
async function sweepOrders() {
  try {
    const windowStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: orders, error } = await db.from('jjp_orders')
      .select('*')
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true });

    if (error) throw error;

    let count = 0;
    (orders || []).forEach(o => {
      if (exportOrder(o)) count++;
    });
    if (count > 0) {
      log.info(`🧹 Barrido periódico: Se exportaron ${count} nuevos pedidos.`);
    }
  } catch (err) {
    log.error('⚠️ Error en el barrido de pedidos: ' + err.message);
  }
}

// Escuchar cambios en tiempo real vía Realtime
function listenRealtime() {
  log.info('📡 Conectando con Supabase Realtime para pedidos en vivo...');
  db.channel('mixer-orders')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_orders' }, p => {
      log.info(`🔥 Nuevo pedido insertado detectado: ${p.new.order_number}`);
      exportOrder(p.new);
    })
    .subscribe((status) => {
      log.info(`📡 Estado del canal Realtime: ${status}`);
    });
}

// Inicialización
log.info('🚀 Iniciando Puente Independiente MixNet...');
log.info(`📂 Carpeta de exportación destino: ${MIXER_EXPORT_DIR}`);
loadHistory();
sweepOrders();
setInterval(sweepOrders, 30000); // Barrido cada 30 segundos
listenRealtime();
