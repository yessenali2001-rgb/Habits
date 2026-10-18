import { NextResponse, type NextRequest } from 'next/server';
import { encryptSecret, safeEqual, verifyState } from '@/lib/crypto';
import { googleConfigured, siteUrl } from '@/lib/env';
import { safeNext } from '@/lib/auth';
import { emailFromIdToken, exchangeCode, GoogleApiError } from '@/lib/google';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

export async function GET(req: NextRequest) {
  const next = safeNext(req.cookies.get('g_next')?.value, '/settings');
  const back = (flag: string) => {
    const url = new URL(`${siteUrl()}${next}`);
    url.searchParams.set('google', flag);
    const res = NextResponse.redirect(url);
    res.cookies.delete('g_nonce'); res.cookies.delete('g_next');
    return res;
  };
  if (!googleConfigured()) return back('unavailable');
  const sp = req.nextUrl.searchParams;
  if (sp.get('error')) return back('denied');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const claim = verifyState(sp.get('state') ?? '');
  const nonce = req.cookies.get('g_nonce')?.value ?? '';
  // the state must be ours, fresh, for THIS signed-in user, and started from THIS browser (CSRF protection)
  if (!user || !claim || claim.u !== user.id || !nonce || !safeEqual(claim.n, nonce)) return back('invalid');
  const code = sp.get('code');
  if (!code) return back('invalid');

  try {
    const tok = await exchangeCode({
      clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, redirectUri: `${siteUrl()}/api/google/callback`, code,
    });
    if (!tok.scope?.split(' ').includes(SCOPE)) return back('scope');          // the user unticked the calendar permission
    if (!tok.refresh_token) return back('norefresh');
    const admin = createAdminClient();
    await admin.from('calendar_secrets').upsert({
      user_id: user.id, refresh_token_enc: encryptSecret(tok.refresh_token), access_token_enc: encryptSecret(tok.access_token),
      access_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(), updated_at: new Date().toISOString(),
    });
    await admin.from('calendar_connections').upsert({
      user_id: user.id, provider: 'google', account_email: emailFromIdToken(tok.id_token), scope: tok.scope, last_error: null,
    });
    return back('connected');
  } catch (e) {
    return back(e instanceof GoogleApiError ? 'failed' : 'error');
  }
}
