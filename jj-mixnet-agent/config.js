/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Configuración Central y Mapeo Canónico
   ====================================================================== */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Credenciales Oficiales Supabase Core (Proyecto A)
export const SUPABASE_URL = process.env.SUPABASE_URL_CORE || 'http://166.0.112.247';
export const SERVICE_KEY  = process.env.SERVICE_KEY_CORE  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3Mjk1MDAwMDAsImV4cCI6MjA0NTAwMDAwMH0.Re_nlxR74OCn2LLRN78SKEHt8FxFYanYLsZr2Cvyf8s';

export const AGENT_PORT = parseInt(process.env.AGENT_PORT || '8790', 10);
export const AGENT_VERSION = '3.0.0-PROD';

// Mapeo Canónico de Vendedores (MixNet CODVEN <-> Supabase jjp_profiles)
export const SELLER_CODVEN_TO_PROFILE = {
  '001': { id: '86b0ef8b-a41b-4385-a8f9-314a5052cb94', name: 'Mary Garcia (001)' },
  '002': { id: 'e6957754-de00-4088-8e54-affcaa172247', name: 'Luis Alarcon (002)' },
  '004': { id: '07540d9c-4ed9-46d2-95ce-0a0200be6083', name: 'Yovanni Araujo (004)' },
  '006': { id: '07540d9c-4ed9-46d2-95ce-0a0200be6083', name: 'Yovanni Araujo (006)' },
  '009': { id: '07540d9c-4ed9-46d2-95ce-0a0200be6083', name: 'Yovanni Araujo (009)' },
  '008': { id: '3c9b7ddd-4b98-45c6-a646-5c557a2bc043', name: 'Marianela Ventas JJ (008)' },
  '010': { id: 'bddc57dc-5bf9-4a72-9e1c-751d07b03164', name: 'Keyder Salazar (010 - Admin)' },
  '020': { id: 'bddc57dc-5bf9-4a72-9e1c-751d07b03164', name: 'Keyder Salazar (020 - Cartera)' },
  '014': { id: '68c29cd3-760a-4282-8214-4e7c60413ec5', name: 'ANDREINA JJ VENTAS (014)' },
  '025': { id: '7eeb41f2-55e1-4e5e-b6c2-3da87582b51b', name: 'Ana Barajas (025)' },
  '026': { id: '4d76dc4c-503a-48ca-9c98-f9ea3d2af755', name: 'JJ Paper 26 (026)' },
  '032': { id: '9201071b-ab77-4de3-90a4-a79c93c4213c', name: 'JJ Paper 32 (032)' },
  '033': { id: '485e3fde-f95d-4857-9175-147051a54748', name: 'JJ Paper 33 (033)' }
};

export const PROFILE_ID_TO_CODVEN = {};
for (const [codven, profile] of Object.entries(SELLER_CODVEN_TO_PROFILE)) {
  if (!PROFILE_ID_TO_CODVEN[profile.id]) {
    PROFILE_ID_TO_CODVEN[profile.id] = codven;
  }
}

/**
 * Detecta la ruta maestra activa de MixNet (comp01).
 * Si corre en el servidor central (192.168.0.185): 'D:\\MIX11\\comp01'
 * Si corre en red local: 'M:\\MIX11\\comp01' o 'Z:\\comp01'
 */
export function getMixnetDir() {
  const candidates = [
    process.env.MIXNET_DIR,
    'D:\\MIX11\\comp01',
    'D:/MIX11/comp01',
    'M:\\MIX11\\comp01',
    'M:/MIX11/comp01',
    'Z:\\comp01',
    'Z:/comp01',
    '\\\\servidor\\MIX11\\comp01',
    '\\\\192.168.0.185\\MIX11\\comp01',
    'C:\\MIX11\\comp01'
  ].filter(Boolean);

  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand)) {
        const testFile = path.join(cand, 'MXNUMCOT.DBF');
        if (fs.existsSync(testFile)) {
          return cand;
        }
      }
    } catch (_) {}
  }
  return null;
}

export function log(msg, level = 'INFO') {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [${level}] ${msg}`);
}
