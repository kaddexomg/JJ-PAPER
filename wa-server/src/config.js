import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cargar .env explícitamente desde la carpeta wa-server (evita problemas de CWD al ejecutar desde .bat o accesos directos)
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config(); // fallback estándar

export const SUPABASE_URL = process.env.SUPABASE_URL_COMM || process.env.SUPABASE_URL;
export const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY_COMM || process.env.SUPABASE_SERVICE_ROLE_KEY;

export const SUPABASE_URL_CORE = process.env.SUPABASE_URL_CORE || process.env.SUPABASE_URL;
export const SERVICE_KEY_CORE  = process.env.SUPABASE_SERVICE_ROLE_KEY_CORE || process.env.SUPABASE_SERVICE_ROLE_KEY;

export const SUPABASE_URL_COMM = process.env.SUPABASE_URL_COMM || process.env.SUPABASE_URL;
export const SERVICE_KEY_COMM  = process.env.SUPABASE_SERVICE_ROLE_KEY_COMM || process.env.SUPABASE_SERVICE_ROLE_KEY;

export const SUPABASE_URL_INV  = process.env.SUPABASE_URL_INV || 'https://nmcamjxhyysmmvgxgabo.supabase.co';
export const SERVICE_KEY_INV   = process.env.SUPABASE_SERVICE_ROLE_KEY_INV || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tY2FtanhoeXlzbW12Z3hnYWJvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjA2MTQ2NCwiZXhwIjoyMDk3NjM3NDY0fQ.QvuDcLSJleatqDcglU_w0fRnXbz9N6scGaDVqCUgoXg';

export const PG_CORE = {
  host: process.env.PG_HOST_CORE || 'aws-0-us-east-2.pooler.supabase.com',
  port: parseInt(process.env.PG_PORT_CORE || '5432', 10),
  user: process.env.PG_USER_CORE || 'postgres.qxgdrfkobbhdzgtoiavv',
  password: process.env.PG_PASS_CORE || '30909109KJSP',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
};

export const PG_COMM = {
  host: process.env.PG_HOST_COMM || 'aws-0-us-east-2.pooler.supabase.com',
  port: parseInt(process.env.PG_PORT_COMM || '5432', 10),
  user: process.env.PG_USER_COMM || 'postgres.klcibjwleiqppedefpxw',
  password: process.env.PG_PASS_COMM || 'Samily*30909109',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
};

export const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');
export const MEDIA_BUCKET = 'jjp-wa-media';

export const COUNT_LAN_PORT   = parseInt(process.env.COUNT_LAN_PORT || '8787', 10); // servidor de conteo offline (WiFi local)
export const COUNT_SESSION     = process.env.COUNT_SESSION || 'default';
export const COUNT_SYNC_MS     = 15_000;   // intenta subir el conteo bufferizado
export const COUNT_ONLINE_MS   = 30_000;  // chequeo de conexión a Supabase
export const COUNT_CATALOG_MS  = 300_000; // refresco del catálogo local (5 min)
export const REPO_ROOT         = path.join(__dirname, '..', '..');  // raíz del sitio (para servir la app por LAN)
export const MIXER_EXPORT_DIR  = process.env.MIXER_EXPORT_DIR || path.join(REPO_ROOT, 'mixer_export');


export const OUTBOX_SWEEP_MS   = 5_000;   // barrido de salientes pendientes (latencia ultra-baja)
export const SESSIONS_SWEEP_MS = 45_000;  // barrido de requested_action perdidos
export const CAMPAIGN_SWEEP_MS = 42_000;  // tick asimétrico del despachador de difusión
export const INVOICE_SWEEP_MS  = 60_000;  // avisos de facturas por pagar (los genera el cron de la BD)
export const EMAIL_SWEEP_MS    = 60_000;  // barrido de correos pendientes (Gmail SMTP)
export const MAX_RETRIES       = 3;

// Correo del CRM. Método principal: cada usuario VINCULA su Gmail con Google
// (OAuth, permiso gmail.send) desde el panel — sin contraseñas. El server usa
// estas credenciales de OAuth (las mismas del login con Google) para renovar el
// acceso y enviar por la API de Gmail.
export const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// Respaldo opcional por SMTP (si algún día se usa una cuenta con contraseña de app).
export const GMAIL_USER     = process.env.GMAIL_USER || '';
export const GMAIL_APP_PASS = process.env.GMAIL_APP_PASS || '';
export const GMAIL_FROM     = process.env.GMAIL_FROM || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en wa-server/.env');
  console.error('Copia .env.example como .env y pega la service_role key del dashboard de Supabase.');
  process.exit(1);
}
