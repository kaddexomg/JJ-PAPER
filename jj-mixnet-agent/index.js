/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Punto de Entrada Principal (index.js)
   ====================================================================== */

export * from './config.js';
export * from './supabase-client.js';
export * from './dbf-driver.js';
export * from './ntx-builder.js';
export * from './sync-catalog.js';
export * from './sync-documents.js';
export * from './task-runner.js';
export * from './client-reconciler.js';

// Si se ejecuta directamente desde node, arranca el agente
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  import('./agent.js');
}
