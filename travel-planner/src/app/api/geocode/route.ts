import { NextResponse, type NextRequest } from 'next/server';
import tzlookup from 'tz-lookup';
import { createClient } from '@/lib/supabase/server';
import { isValidZone } from '@/lib/time';

/*
 * Place search / reverse lookup through OpenStreetMap's Nominatim, proxied so that
 *   - only signed-in users can use it,
 *   - we can send the identifying User-Agent Nominatim's usage policy requires,
 *   - we stay under its 1 request/second limit (per user, best-effort) and cache answers.
 * For heavy production use, point this at your own Nominatim or a commercial geocoder.
 */

const lastCall = new Map<string, number>();

interface Nominatim {
  lat: string; lon: string; display_name: string; name?: string;
  address?: Record<string, string>;
}

function shape(r: Nominatim) {
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  const a = r.address ?? {};
  const name = r.name || a.city || a.town || a.village || a.municipality || a.county || a.state || r.display_name.split(',')[0];
  let timezone: string | null = null;
  try { const z = tzlookup(lat, lng); timezone = isValidZone(z) ? z : null; } catch { /* ocean etc. */ }
  return { name, display: r.display_name, lat, lng, country: a.country ?? null, address: r.display_name, timezone };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const now = Date.now();
  if (now - (lastCall.get(user.id) ?? 0) < 900) return NextResponse.json({ error: 'Slow down a little.' }, { status: 429 });
  lastCall.set(user.id, now);
  if (lastCall.size > 5000) lastCall.clear();

  const sp = req.nextUrl.searchParams;
  const headers = {
    'user-agent': `Wanderplan/0.1 (${process.env.NOMINATIM_CONTACT_EMAIL || 'set NOMINATIM_CONTACT_EMAIL'})`,
    'accept-language': 'en',
  };

  try {
    const lat = sp.get('lat');
    const lng = sp.get('lng');
    if (lat !== null && lng !== null) {
      const la = Number(lat), lo = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return NextResponse.json({ error: 'Bad coordinates.' }, { status: 400 });
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${la}&lon=${lo}`, { headers, next: { revalidate: 86400 } });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as Nominatim & { error?: string };
      if (j.error) return NextResponse.json({ results: [{ ...shape({ ...j, lat: String(la), lon: String(lo), display_name: `${la.toFixed(5)}, ${lo.toFixed(5)}` }) }] });
      return NextResponse.json({ results: [shape({ ...j, lat: String(la), lon: String(lo) })] });
    }

    const q = (sp.get('q') ?? '').trim();
    if (q.length < 3 || q.length > 120) return NextResponse.json({ results: [] });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`, { headers, next: { revalidate: 86400 } });
    if (!res.ok) throw new Error(String(res.status));
    return NextResponse.json({ results: ((await res.json()) as Nominatim[]).map(shape) });
  } catch {
    return NextResponse.json({ error: 'The place search service is unavailable.' }, { status: 502 });
  }
}
