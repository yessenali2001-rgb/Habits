export interface Timed {
  id: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}

/**
 * Finds timed items that clash. Works on absolute instants, so a flight that lands in another zone is
 * compared correctly with whatever else is planned.
 *
 * Rules:
 *   - all-day / "any time" items never clash;
 *   - an item without an end time is a moment: it clashes with an interval that contains it, or with
 *     another item that starts at exactly the same moment;
 *   - intervals that merely touch (one ends when the next begins) do not clash.
 *
 * Returns a map  itemId → ids of the items it clashes with  (only items that clash appear).
 */
export function findOverlaps(items: Timed[]): Map<string, string[]> {
  const timed = items
    .filter((i) => !i.all_day)
    .map((i) => {
      const s = Date.parse(i.starts_at);
      const e = i.ends_at ? Date.parse(i.ends_at) : s;
      return { id: i.id, s, e: Number.isFinite(e) ? e : s };
    })
    .filter((i) => Number.isFinite(i.s))
    .sort((a, b) => a.s - b.s || a.e - b.e);

  const out = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    out.set(a, [...(out.get(a) ?? []), b]);
    out.set(b, [...(out.get(b) ?? []), a]);
  };

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      // sorted by start: once b starts after a is over, no later item can clash with a either
      if (b.s > a.e && b.s > a.s) break;
      if (b.s === a.s || (a.s < b.e && b.s < a.e)) link(a.id, b.id);
    }
  }
  return out;
}
