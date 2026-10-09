/* Which entries match what was typed, in the order they should be offered.
 *
 * The old page's rank() (legacy/index.html, main@4eadd7a, lines 10864-10885). The reader's own orbits lead their group: there are few of
 * them, they are what was just made, and in index order they would sit 2,158 rows down behind "N more match". They match by NAME and by the
 * word "custom" (the tag the row carries), never by number: "O0001" is a placeholder, not a search term. A name or NORAD id that STARTS
 * with the query comes next, then one that merely contains it. Order: [custom starts][catalogue starts][custom contains][catalogue
 * contains]; the empty query is the customs and then the whole catalogue.
 *
 * Returns indices in the picker's one index space: 0..catalogue-1 are the catalogue, the rest the reader's orbits in order. */

export const SHOWN_MAX = 80;

export function rank(cat: readonly { name: string; satnum: string }[], query: string, mine: readonly { name: string }[] = []): number[] {
  const q = query.trim().toLowerCase();
  const cStarts: number[] = [], cHas: number[] = [];
  for (let k = 0; k < mine.length; k++) {
    const n = mine[k]!.name.toLowerCase();
    if (!q || n.startsWith(q) || 'custom'.startsWith(q)) cStarts.push(cat.length + k);
    else if (n.indexOf(q) >= 0) cHas.push(cat.length + k);
  }
  if (!q) return cStarts.concat(cat.map((_, i) => i));
  const starts: number[] = [], has: number[] = [];
  for (let i = 0; i < cat.length; i++) {
    const n = cat[i]!.name.toLowerCase(), id = cat[i]!.satnum;
    if (n.startsWith(q) || id.startsWith(q)) starts.push(i);
    else if (n.indexOf(q) >= 0 || id.indexOf(q) >= 0) has.push(i);
  }
  return cStarts.concat(starts, cHas, has);
}
