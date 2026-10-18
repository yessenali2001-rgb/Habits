import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/auth';
import { siteUrl } from '@/lib/env';

/** Completes e-mail confirmation and Google sign-in: swaps the one-time `code` for a session cookie. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${siteUrl()}${next}`);
  }
  return NextResponse.redirect(`${siteUrl()}/login?error=${encodeURIComponent('That sign-in link is invalid or has expired. Please try again.')}`);
}
