'use client';
import { Loader2, MapPin, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from './ui';

export interface PlaceHit { name: string; display: string; lat: number; lng: number; country: string | null; timezone: string | null }

/** Type-ahead place search via our own /api/geocode proxy (Nominatim). Degrades to plain typing if the lookup fails. */
export function PlaceSearch({ onPick, placeholder = 'Search for a city or place…', id }: {
  onPick: (p: PlaceHit) => void; placeholder?: string; id?: string;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); setMsg(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}`);
        if (mine !== seq.current) return;
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { results: PlaceHit[] };
        setHits(j.results);
        setMsg(j.results.length ? null : 'No matches — you can still type the place in by hand.');
      } catch {
        if (mine === seq.current) { setHits([]); setMsg('Place search is unavailable right now — type the details in by hand.'); }
      } finally { if (mine === seq.current) setBusy(false); }
    }, 450); // Nominatim allows ~1 request per second: debounce
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden />
      <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" autoComplete="off" role="combobox" aria-expanded={hits.length > 0} />
      {busy && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted" aria-hidden />}
      {(hits.length > 0 || msg) && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng},${i}`}>
              <button type="button" className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => { onPick(h); setQ(''); setHits([]); }}>
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden /><span><span className="font-medium">{h.name}</span><br /><span className="text-xs text-muted">{h.display}</span></span>
              </button>
            </li>
          ))}
          {msg && <li className="px-3 py-2 text-xs text-muted">{msg}</li>}
        </ul>
      )}
    </div>
  );
}
