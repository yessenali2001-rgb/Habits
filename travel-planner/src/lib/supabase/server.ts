import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from '../env';

/** Per-request server client acting as the signed-in user: row level security applies to every query. */
export async function createClient() {
  const store = await cookies(); // reading cookies marks the route as per-request (never prerendered)
  const cfg = supabaseConfig();
  if (!cfg) throw new Error('Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)');
  return createServerClient(cfg.url, cfg.anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component: the middleware refreshes the session instead
        }
      },
    },
  });
}
