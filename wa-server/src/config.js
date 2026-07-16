import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');
export const MEDIA_BUCKET = 'jjp-wa-media';

export const OUTBOX_SWEEP_MS   = 30_000;  // barrido de salientes pendientes
export const SESSIONS_SWEEP_MS = 15_000;  // barrido de requested_action perdidos
export const CAMPAIGN_SWEEP_MS = 15_000;  // tick del despachador de difusión
export const MAX_RETRIES       = 3;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en wa-server/.env');
  console.error('Copia .env.example como .env y pega la service_role key del dashboard de Supabase.');
  process.exit(1);
}
