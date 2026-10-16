/* The picker's search by the other names of the catalogue's spacecraft (CHANGES-FROM-LEGACY.md, L61).
 *
 * New in the rebuild. The catalogue names an object as its element-set source does, and a radio amateur knows many by an AMSAT
 * designator or a mission name it does not carry: "so50" finds nothing in SAUDISAT 1C, "rs44" nothing in BREEZE-KM R/B. SatNOGS
 * DB keeps those names; the few a search of the catalogue's own name would miss are baked into data/aliases.json
 * (verification/tools/fetch-aliases.js), which lib/data/aliases.ts loads as a chunk of its own.
 *
 * A wrapper around rank(), which is not edited: rank.ts is the old page's order with the word tier of L58, pinned by its own tests
 * and mutants. What rank() listed comes first, as it was; then the catalogue's rows it did not list that one of their other names
 * matches. A name is stripped as rank()'s word tier strips the catalogue's (the same bare(): NFKC, lowercased, only letters, marks
 * and digits, of any script), and the query is taken word by word: every word of it must begin a word of the name (a run of letters
 * and marks, or of digits), in any order, so "rs44", "rs-44", "RS 44" and "44 rs" all find RS-44, while "iss" is not looked for inside
 * "Mission" (rank()'s tier finds a word anywhere in a name; a table of a few hundred short names would answer a short query with
 * names it only happens to contain). The rows are ordered by how well the name matched: a name that is the whole query (stripped)
 * first ("ao7": OSCAR 7 for AO-7, before FUNCUBE 1 for AO-73), then one that starts with the first word, then one that only holds the
 * words; in catalogue order within each, and each row by its best name (the first the table gives, of the best kind). The table
 * holds no name the catalogue's own already holds (stripped), so what rank() would find by such a name it finds first. Only the
 * catalogue is searched: an orbit of the reader's own is never matched this way, by name or by its placeholder number, whatever
 * number the test hook gives it, since the picker's indices past the catalogue are never looked at. Pure. */
import { loadAliases } from '../data/aliases';
import { aliasSaid } from '../text/alias';

/** rank()'s own comparison (rank.ts, the word tier): the two must agree, or a name could be offered twice or not at all */
const bare = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
const unpad = (s: string): string => s.replace(/^0+/, '');
/** A name as bare() strips it (`b`, the runs joined), and where in that each of its words starts (`at`): a word is a run of letters and
 *  marks, or of digits, so "RS-44" is "rs44" with words at 0 and 2, and "RS0ISS" has three */
export const parts = (s: string): { b: string; at: number[] } => {
  const at: number[] = [];
  let b = '';
  for (const r of s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}]+|\p{N}+/gu) ?? []) { at.push(b.length); b += r; }
  return { b, at };
};

/** NORAD number without its leading zeros -> the other names */
export type AliasTable = Readonly<Record<string, readonly string[]>>;

/** The catalogue rows that `listed` (rank()'s rows for the query) does not hold and that an other name of theirs matches, each mapped to
 *  the name that matched, in the order they are offered. Empty for the empty query. */
export function byAlias(cat: readonly { satnum: string }[], query: string, table: AliasTable, listed: readonly number[]): Map<number, string> {
  const words = query.trim().split(/\s+/).map(bare).filter(Boolean), whole = words.join(''), seen = new Set(listed);
  const kinds: [number, string][][] = [[], [], []], out = new Map<number, string>();
  if (!words.length) return out;
  cat.forEach((c, i) => {
    const key = unpad(c.satnum);
    const names = seen.has(i) || !Object.prototype.hasOwnProperty.call(table, key) ? [] : table[key]!;
    let best = 3, hit = '';
    for (const n of names) {
      const { b, at } = parts(n);
      const k = !words.every(w => at.some(p => b.startsWith(w, p))) ? 3 : b === whole ? 0 : b.startsWith(words[0]!) ? 1 : 2;
      if (k < best) { best = k; hit = n; }
    }
    if (best < 3) kinds[best]!.push([i, hit]);
  });
  for (const k of kinds) for (const [i, n] of k) out.set(i, n);
  return out;
}

/** What the picker calls once the table has come: the rows byAlias() finds, each mapped to the words its option says ("matches RS-44"). */
export type AliasFinder = (cat: readonly { satnum: string }[], query: string, listed: readonly number[]) => Map<number, string>;

let finder: Promise<AliasFinder> | null = null;
/** The finder, over the table fetched on first use (its own chunk) and kept. */
export function aliasFinder(): Promise<AliasFinder> {
  finder ??= loadAliases().then(d => (cat, query, listed) => {
    const m = byAlias(cat, query, d.a, listed);
    for (const [i, n] of m) m.set(i, aliasSaid(n));
    return m;
  });
  return finder;
}
