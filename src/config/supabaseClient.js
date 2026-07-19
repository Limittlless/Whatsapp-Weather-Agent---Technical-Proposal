import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

function createSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing Supabase configuration. Please set SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY in your .env file (see .env.example).'
    );
  }
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let cachedClient = null;
export function getSupabaseClient() {
  if (!cachedClient) {
    cachedClient = createSupabaseClient();
  }
  return cachedClient;
}

export async function verifySupabaseConnection() {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true });
  if (error) {
    throw new Error(`Supabase connection check failed: ${error.message}`);
  }
  return true;
}

export function __resetClientForTests() {
  cachedClient = null;
}
