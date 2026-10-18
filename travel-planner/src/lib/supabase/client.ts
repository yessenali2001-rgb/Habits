'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Browser client (anon key + the user's session). Everything it can do is limited by row level security. */
export function getBrowserClient(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    // keep the realtime socket authenticated as the signed-in user, including after silent token refreshes
    const c = client;
    c.auth.onAuthStateChange((_event, session) => { if (session) c.realtime.setAuth(session.access_token); });
  }
  return client;
}

/**
 * A client whose realtime socket is guaranteed to carry the user's access token.
 *
 * The SSR browser client loads the session lazily, so a channel subscribed straight after page load would
 * join as the anonymous role — and Realtime applies row level security per subscriber, so an anonymous
 * channel silently receives nothing. Awaiting the session first fixes that.
 */
export async function getRealtimeClient(): Promise<SupabaseClient> {
  const supabase = getBrowserClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) supabase.realtime.setAuth(data.session.access_token);
  return supabase;
}
