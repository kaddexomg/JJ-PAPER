import { sbGet } from './supabase-client.js';

const q94 = await sbGet('jjp_quotes', 'quote_number=eq.00053494');
console.log('Quote 00053494 in Supabase:');
console.log(JSON.stringify(q94, null, 2));

const q97 = await sbGet('jjp_quotes', 'quote_number=eq.00053497');
console.log('Quote 00053497 in Supabase:');
console.log(JSON.stringify(q97, null, 2));
