import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL_COMM, SERVICE_KEY_COMM,
  SUPABASE_URL_CORE, SERVICE_KEY_CORE,
  SUPABASE_URL_INV, SERVICE_KEY_INV
} from './config.js';

// db principal de wa-server apunta a Proyecto B (Comunicación, CRM, Sesiones, Emails)
export const db = createClient(SUPABASE_URL_COMM, SERVICE_KEY_COMM, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 20 } }
});

// dbCore para lectura y actualización de datos centrales (Settings, Clientes, Catálogo, FX Rates)
export const dbCore = createClient(SUPABASE_URL_CORE, SERVICE_KEY_CORE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// dbInv para Storage e Inventario (Proyecto C: fotos WebP de catálogo y comprobantes)
export const dbInv = createClient(SUPABASE_URL_INV, SERVICE_KEY_INV, {
  auth: { persistSession: false, autoRefreshToken: false }
});
