import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');
export const MEDIA_BUCKET = 'jjp-wa-media';

export const COUNT_LAN_PORT   = parseInt(process.env.COUNT_LAN_PORT || '8787', 10); // servidor de conteo offline (WiFi local)
export const COUNT_SESSION     = process.env.COUNT_SESSION || 'default';
export const COUNT_SYNC_MS     = 8_000;   // intenta subir el conteo bufferizado
export const COUNT_ONLINE_MS   = 15_000;  // chequeo de conexión a Supabase
export const COUNT_CATALOG_MS  = 300_000; // refresco del catálogo local (5 min)
export const REPO_ROOT         = path.join(__dirname, '..', '..');  // raíz del sitio (para servir la app por LAN)

export const OUTBOX_SWEEP_MS   = 30_000;  // barrido de salientes pendientes
export const SESSIONS_SWEEP_MS = 15_000;  // barrido de requested_action perdidos
export const CAMPAIGN_SWEEP_MS = 15_000;  // tick del despachador de difusión
export const INVOICE_SWEEP_MS  = 60_000;  // avisos de facturas por pagar (los genera el cron de la BD)
export const MAX_RETRIES       = 3;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en wa-server/.env');
  console.error('Copia .env.example como .env y pega la service_role key del dashboard de Supabase.');
  process.exit(1);
}
