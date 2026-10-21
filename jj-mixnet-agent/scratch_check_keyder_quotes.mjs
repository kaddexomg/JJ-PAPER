import { sbGet } from './supabase-client.js';

const quotes = await sbGet('jjp_quotes', 'seller_id=eq.bddc57dc-5bf9-4a72-9e1c-751d07b03164&select=id,quote_number,client_name,seller_id,source,notes,created_at&limit=30');
console.log(`Total quotes assigned to Keyder in sample: ${quotes.length}`);
for (const q of quotes) {
  console.log(`Quote #${q.quote_number} | Cli: '${q.client_name}' | Src: '${q.source}' | Created: ${q.created_at}`);
}
