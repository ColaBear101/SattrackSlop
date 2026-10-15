/* Which entries match what was typed, in the order they should be offered.
 *
 * The old page's rank() (legacy/index.html, main@4eadd7a, lines 10864-10885). The reader's own orbits lead their group: there are few of
 * them, they are what was just made, and in index order they would sit 2,158 rows down behind "N more match". They match by NAME and by the
 * word "custom" (the tag the row carries), never by number: "O0001" is a placeholder, not a search term. A name or NORAD id that STARTS
 * with the query comes next, then one that merely contains it. Order: [custom starts][catalogue starts][custom contains][catalogue
 * contains]; the empty query is the customs and then the whole catalogue.
 *
 * CHANGED (search tokens): one tier more, the lowest, after those four (CHANGES-FROM-LEGACY.md, L58). What they did not find is matched
 * word by word: the query is split at its spaces, each word lowercased and stripped of everything but a-z and 0-9, and an entry matches
 * when every word is in its name stripped the same way ("iss zarya" finds ISS (ZARYA), "ao91" finds AO-91). A word of digits alone may
 * instead be the entry's whole catalogue number, the two compared without their leading zeros ("007530" and "oscar 7530" find OSCAR 7,
 * 07530; only the whole number, so the 9 of "landsat 9" is not looked for inside LANDSAT 8's 39084). The reader's orbits lead this tier
 * too, by name only: a placeholder number is still never a search term. Every order the old page gave is unchanged; rows are only added
 * after it.
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
  const listed = cStarts.concat(starts, cHas, has);                    // CHANGED (search tokens): the old page's order, then
  return listed.concat(byWords(cat, q, mine, listed));                 // CHANGED (search tokens): what only the words of the query find
}

/* CHANGED (search tokens): the lowest tier, the rows `listed` does not hold (q is already trimmed and lowercased). A word may instead be
   the whole catalogue number without its leading zeros: the numbers are all digits, so only a word of digits can be one, and the
   reader's orbits are never asked theirs (fits() without a number). */
const bare = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const unpad = (s: string): string => s.replace(/^0+/, '');

function byWords(cat: readonly { name: string; satnum: string }[], q: string, mine: readonly { name: string }[], listed: number[]): number[] {
  const words = q.split(/\s+/).map(bare).filter(Boolean), seen = new Set(listed), out: number[] = [];
  const fits = (name: string, num?: string) => { const b = bare(name); return words.every(w => b.includes(w) || unpad(w) === num); };
  if (words.length) {
    mine.forEach((m, k) => { if (!seen.has(cat.length + k) && fits(m.name)) out.push(cat.length + k); });     // by name, never by number
    cat.forEach((c, i) => { if (!seen.has(i) && fits(c.name, unpad(c.satnum))) out.push(i); });
  }
  return out;
}
