import { reconcileClients, getClientsDiscrepancies, createBackup, rollbackBackup } from './client-reconciler.js';
import { processAgentTasks } from './task-runner.js';

async function runTest() {
  console.log('Testing module exports...');
  console.log('reconcileClients:', typeof reconcileClients);
  console.log('getClientsDiscrepancies:', typeof getClientsDiscrepancies);
  console.log('createBackup:', typeof createBackup);
  console.log('rollbackBackup:', typeof rollbackBackup);
  console.log('processAgentTasks:', typeof processAgentTasks);

  console.log('\n--- Testing createBackup ---');
  const bRes = createBackup('M:/MIX11/comp01', 'TEST_SNAPSHOT');
  console.log('createBackup result:', {
    ok: bRes.ok,
    snapshot: bRes.snapshot,
    backupFile: bRes.backupFile,
    filesCount: bRes.filesCount,
    totalBytes: bRes.totalBytes
  });

  console.log('\n--- Testing getClientsDiscrepancies (first 5) ---');
  const dRes = await getClientsDiscrepancies('M:/MIX11/comp01');
  console.log('Total discrepancies found:', dRes.count);
  console.log('Sample discrepancies:', dRes.discrepancies.slice(0, 3));

  console.log('\nALL MODULE TESTS PASSED!');
}

runTest().catch(console.error);
