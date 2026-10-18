import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseConfig } from '../env';

const PROTECTED = ['/dashboard', '/trips', '/notifications', '/settings'];
const AUTH_PAGES = ['/login', '/signup'];

/** Refreshes the session cookie on every request and gates the signed-in area. */
export async function updateSession(request: NextRequest) {
  const cfg = supabaseConfig();
  const { pathname } = request.nextUrl;

  if (!cfg) {
    // not configured yet: only the landing page and the setup guide work
    if (pathname === '/' || pathname === '/setup') return NextResponse.next({ request });
    return NextResponse.redirect(new URL('/setup', request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(cfg.url, cfg.anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() validates the token with the auth server (getSession() alone would trust the cookie)
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && PROTECTED.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (user && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}
