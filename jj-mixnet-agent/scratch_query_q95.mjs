import { sbGet } from './supabase-client.js';

const quotes = await sbGet('jjp_quotes', 'quote_number=eq.00053495');
console.log('Quote 00053495 in Supabase:');
console.log(JSON.stringify(quotes, null, 2));
