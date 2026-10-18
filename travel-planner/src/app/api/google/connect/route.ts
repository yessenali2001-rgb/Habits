import { NextResponse, type NextRequest } from 'next/server';
import { randomNonce, signState } from '@/lib/crypto';
import { googleConfigured, siteUrl } from '@/lib/env';
import { safeNext } from '@/lib/auth';
import { buildAuthUrl } from '@/lib/google';
import { createClient } from '@/lib/supabase/server';

/** Starts the Google OAuth flow for the signed-in user. State is signed and tied to this browser via a cookie. */
export async function GET(req: NextRequest) {
  if (!googleConfigured()) return NextResponse.redirect(`${siteUrl()}/settings?google=unavailable`);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${siteUrl()}/login?next=${encodeURIComponent('/settings')}`);

  const nonce = randomNonce();
  const state = signState({ u: user.id, n: nonce, exp: Date.now() + 10 * 60_000 });
  const res = NextResponse.redirect(buildAuthUrl({
    clientId: process.env.GOOGLE_CLIENT_ID!, redirectUri: `${siteUrl()}/api/google/callback`, state, loginHint: user.email ?? undefined,
  }));
  const opts = { httpOnly: true, secure: siteUrl().startsWith('https'), sameSite: 'lax' as const, path: '/api/google', maxAge: 600 };
  res.cookies.set('g_nonce', nonce, opts);
  res.cookies.set('g_next', safeNext(req.nextUrl.searchParams.get('next'), '/settings'), opts);
  return res;
}
