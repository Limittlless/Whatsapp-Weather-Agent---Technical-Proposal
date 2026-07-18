import 'dotenv/config';
import { getSupabaseClient, verifySupabaseConnection } from './config/supabaseClient.js';

async function main() {
  console.log('[boot] Starting WhatsApp Weather Agent (Phase 1 bootstrap)...');
  getSupabaseClient();
  console.log('[boot] Supabase client initialized.');
  try {
    await verifySupabaseConnection();
    console.log('[boot] Supabase connection verified.');
  } catch (err) {
    console.error('[boot] Supabase connection check failed:', err.message);
    console.error(
      '[boot] Confirm SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set correctly.'
    );
    process.exitCode = 1;
    return;
  }
  console.log('[boot] Environment ready. Handing off to Phase 2 (agent orchestration).');
}

main();
