/* ======================================================
   JJ Paper wa-server — Puente con el Mixer de facturación
   ------------------------------------------------------
   Escucha los nuevos pedidos creados en jjp_orders y exporta
   los datos en formato CSV y TXT en una carpeta local.
   Esto permite que el software Mixer de facturación
   "jale" o importe los pedidos localmente.
   ====================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './supabase.js';
import { MIXER_EXPORT_DIR } from './config.js';
import { log } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, '..', 'exported-orders.json');

// Auto-detección inteligente del directorio de MixNet / facturador
function detectMixerDirectory() {
  if (process.env.MIXER_EXPORT_DIR && fs.existsSync(process.env.MIXER_EXPORT_DIR)) {
    return process.env.MIXER_EXPORT_DIR;
  }

  const drives = ['C:', 'D:', 'E:', 'F:'];
  const candidateFolders = [
    'JJ-PAPER-MIXER',
    'MixNet',
    'Mixer',
    'MIXNET',
    'MIXER',
    'Facturacion',
    'FACTURACION',
    'Sistemas/MixNet',
    'Sistemas/Mixer',
    'Program Files/MixNet',
    'Program Files (x86)/MixNet',
    'Program Files/Mixer',
    'Program Files (x86)/Mixer',
    'MixNet/Pedidos',
    'MixNet/Import',
    'Mixer/Pedidos',
    'Mixer/Import'
  ];

  for (const drive of drives) {
    for (const folder of candidateFolders) {
      const fullPath = path.join(drive, folder);
      try {
        if (fs.existsSync(fullPath)) {
          log.info(`Puente Mixer: Directorio detectado automáticamente en -> ${fullPath}`);
          return fullPath;
        }
      } catch (_) {}
    }
  }

  // Fallback por defecto seguro si no se encontró una ruta previa
  const defaultPath = path.join('C:', 'JJ-PAPER-MIXER');
  try {
    if (!fs.existsSync(defaultPath)) {
      fs.mkdirSync(defaultPath, { recursive: true });
    }
  } catch (_) {}
  return defaultPath;
}

let activeExportDir = detectMixerDirectory();

// Carga el historial de órdenes ya exportadas para no volver a crearlas si el Mixer las borra
function loadExportHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      exportedOrders = new Set(data || []);
      log.info(`Puente Mixer: Cargadas ${exportedOrders.size} órdenes en el historial de exportación.`);
    }
  } catch (err) {
    log.error({ err: err.message }, 'Puente Mixer: Error cargando historial de exportación.');
  }
}

// Guarda el historial de órdenes exportadas
function saveExportHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(Array.from(exportedOrders), null, 2), 'utf8');
  } catch (err) {
    log.error({ err: err.message }, 'Puente Mixer: Error guardando historial de exportación.');
  }
}

// Escapa valores para formato CSV estándar
function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Genera y escribe los archivos de un pedido
function exportOrder(o) {
  if (exportedOrders.has(o.order_number)) {
    // Ya fue exportado en el pasado
    return false;
  }

  log.info(`Puente Mixer: Exportando pedido ${o.order_number} a archivos planos...`);
  
  const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);

  // 1. Generar CSV
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

  // 2. Generar TXT legible / formato ticket
  const txtLines = [];
  txtLines.push('================================================');
  txtLines.push(`PEDIDO: ${o.order_number}`);
  txtLines.push(`Fecha: ${new Date(o.created_at).toLocaleString('es-VE')}`);
  txtLines.push(`Cliente: ${o.client_name}`);
  if (o.rif) txtLines.push(`RIF/CI: ${o.rif}`);
  if (o.phone) txtLines.push(`Teléfono: ${o.phone}`);
  txtLines.push('================================================');
  txtLines.push('Detalle:');
  txtLines.push('Cant.   Producto [Marca]            P.Unit   Subtotal');
  txtLines.push('------------------------------------------------');
  items.forEach(i => {
    const brandStr = i.brand ? ` [${i.brand}]` : '';
    const nameWithBrand = `${i.name}${brandStr}`;
    // Ajustar nombre a 28 caracteres para formateo limpio
    const namePart = nameWithBrand.substring(0, 28).padEnd(28, ' ');
    const qtyPart = String(i.qty).padStart(4, ' ');
    const pricePart = parseFloat(i.price_usd).toFixed(2).padStart(8, ' ');
    const subPart = parseFloat(i.subtotal_usd ?? (i.price_usd * i.qty)).toFixed(2).padStart(9, ' ');
    txtLines.push(`${qtyPart} x ${namePart} ${pricePart} ${subPart}`);
  });
  txtLines.push('------------------------------------------------');
  txtLines.push(`TOTAL USD: $${parseFloat(o.total_usd).toFixed(2)}`);
  if (o.exchange_rate) {
    txtLines.push(`Tasa de cambio: ${parseFloat(o.exchange_rate).toFixed(2)} Bs/$`);
    txtLines.push(`TOTAL BS:  ${parseFloat(o.total_usd * o.exchange_rate).toFixed(2)} Bs`);
  }
  txtLines.push('================================================');
  const txtContent = txtLines.join('\n');

  // Asegurar directorio
  if (!fs.existsSync(activeExportDir)) {
    fs.mkdirSync(activeExportDir, { recursive: true });
  }

  // Escribir archivos
  const csvPath = path.join(activeExportDir, `pedido_${o.order_number}.csv`);
  const txtPath = path.join(activeExportDir, `pedido_${o.order_number}.txt`);

  try {
    fs.writeFileSync(csvPath, csvContent, 'utf8');
    fs.writeFileSync(txtPath, txtContent, 'utf8');
    
    // Registrar en el historial para evitar duplicar
    exportedOrders.add(o.order_number);
    saveExportHistory();
    log.info(`Puente Mixer: Pedido ${o.order_number} exportado correctamente.`);
    return true;
  } catch (err) {
    log.error({ err: err.message, order: o.order_number }, 'Puente Mixer: Error escribiendo archivos de exportación.');
    return false;
  }
}

// Barrido periódico de las últimas 48 horas
async function sweepRecentOrders() {
  try {
    const windowStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    
    const { data: orders, error } = await db.from('jjp_orders')
      .select('*')
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true });

    if (error) {
      log.error({ err: error.message }, 'Puente Mixer: Error consultando órdenes recientes.');
      return;
    }

    let count = 0;
    (orders || []).forEach(o => {
      if (exportOrder(o)) count++;
    });

    if (count > 0) {
      log.info(`Puente Mixer: Barrido completado. Exportados ${count} nuevos pedidos.`);
    }
  } catch (err) {
    log.error({ err: err.message }, 'Puente Mixer: Excepción en el barrido de pedidos.');
  }
}

// Escuchar cambios en tiempo real vía Realtime
function setupRealtimeListener() {
  log.info('Puente Mixer: Iniciando listener Realtime de pedidos...');
  
  return db.channel('mixer-orders')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_orders' },
      p => {
        log.info(`Puente Mixer: Recibida inserción de pedido ${p.new.order_number} por Realtime.`);
        exportOrder(p.new);
      }
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_orders' },
      p => {
        // En caso de que se actualice la orden (por ejemplo, cambio de ítems o confirmación),
        // pero solo la volvemos a exportar si no estaba exportada, o si queremos forzar actualización.
        // Si el Mixer ya la procesó y borró el archivo, exportarla de nuevo podría duplicarla.
        // Por eso, por defecto, el UPDATE solo exporta si el pedido es nuevo y no estaba en el historial.
        if (!exportedOrders.has(p.new.order_number)) {
          log.info(`Puente Mixer: Recibida actualización de pedido no exportado ${p.new.order_number}. Exportando...`);
          exportOrder(p.new);
        }
      }
    )
    .subscribe((status) => {
      log.info(`Puente Mixer: Estado del canal Realtime: ${status}`);
    });
}

export function startMixer() {
  activeExportDir = detectMixerDirectory();
  log.info(`Puente Mixer: Iniciando. Carpeta de exportación: ${activeExportDir}`);
  
  // Asegurar directorio
  if (!fs.existsSync(activeExportDir)) {
    fs.mkdirSync(activeExportDir, { recursive: true });
  }

  loadExportHistory();

  // 1. Barrido inicial
  sweepRecentOrders();

  // 2. Programar barrido cada 30 segundos (resiliencia)
  setInterval(sweepRecentOrders, 30_000);

  // 3. Activar listener Realtime para inmediatez
  setupRealtimeListener();
}
