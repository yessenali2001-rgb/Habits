import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client: BYPASSES row level security. Server-side only, and only for jobs that have no
 * user session (calendar feeds, Google sync, cron). Every caller must authorize the request itself
 * *before* touching data with this client.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
