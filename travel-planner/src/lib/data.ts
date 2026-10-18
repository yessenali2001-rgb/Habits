import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile, Trip } from './types';

/** Deterministic gradient for trips without a cover photo. */
export function coverGradient(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  return `linear-gradient(135deg, hsl(${a} 62% 38%), hsl(${(a + 48) % 360} 68% 26%))`;
}

/** Cover URL per trip: an external https link, or a signed URL for an uploaded file in the private bucket. */
export async function resolveCovers(supabase: SupabaseClient, trips: Pick<Trip, 'id' | 'cover_url' | 'cover_path'>[]) {
  const out = new Map<string, string | null>();
  const toSign: { id: string; path: string }[] = [];
  for (const t of trips) {
    if (t.cover_url) out.set(t.id, t.cover_url);
    else if (t.cover_path) toSign.push({ id: t.id, path: t.cover_path });
    else out.set(t.id, null);
  }
  if (toSign.length) {
    const { data } = await supabase.storage.from('trip-files').createSignedUrls(toSign.map((x) => x.path), 3600);
    toSign.forEach((x, i) => out.set(x.id, data?.[i]?.signedUrl ?? null));
  }
  return out;
}

export type PersonLite = Pick<Profile, 'id' | 'display_name' | 'avatar_url'>;

export async function loadProfiles(supabase: SupabaseClient, ids: string[]): Promise<Map<string, PersonLite>> {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return new Map();
  const { data } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', unique);
  return new Map(((data ?? []) as PersonLite[]).map((p) => [p.id, p]));
}

export const unknownPerson = (id: string): PersonLite => ({ id, display_name: 'Former member', avatar_url: null });
