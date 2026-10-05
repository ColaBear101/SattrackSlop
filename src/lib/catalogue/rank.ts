/* Which catalogue entries match what was typed, in the order they should be offered.
 *
 * The old page's rank(), minus the reader's own orbits (which lead their group and arrive with the planner).
 * A name or NORAD id that STARTS with the query comes first, then one that merely contains it; the empty
 * query is the whole catalogue in order. Returns indices into the catalogue. */

export const SHOWN_MAX = 80;

export function rank(cat: readonly { name: string; satnum: string }[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return cat.map((_, i) => i);
  const starts: number[] = [], has: number[] = [];
  for (let i = 0; i < cat.length; i++) {
    const n = cat[i]!.name.toLowerCase(), id = cat[i]!.satnum;
    if (n.startsWith(q) || id.startsWith(q)) starts.push(i);
    else if (n.indexOf(q) >= 0 || id.indexOf(q) >= 0) has.push(i);
  }
  return starts.concat(has);
}
