import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SERVICE_KEY } from './config.js';

export const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 20 } }
});
