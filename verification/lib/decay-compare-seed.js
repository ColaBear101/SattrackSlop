/* decay-compare-seed.js - the decay comparison (CHANGES-FROM-LEGACY.md, L66) with something in it, without the network.
 *
 * The comparison asks CelesTrak for nothing unless the reader presses something, and the sweeps (verify-layout.js, axe.js) press
 * nothing there and have no CelesTrak to ask. What they need is the panel as a reader who has used it finds it on coming back: the
 * list in the browser's record (gt.decaycmp, open) and each history in the Decay section's own 12-hour cache (hist:<n>), which is
 * what the page reads back with no request. This writes those keys, and only those, into ONE page's storage before the page's own
 * code runs (page.addInitScript, never the context's: a context-wide seed would be in every other state's page too).
 *
 * The histories are made up here, in the shape verify-lifetime.js uses (one element set a day, the mean altitude falling along
 * 0.72t + 0.28t^2), each ending a little before `nowMs`, the suite's clock; `at` is that clock too, so the cache is fresh. Since L68
 * each carries its spacecraft's inclination and RAAN (plane(), below), as the page keeps them, but FLOCK 4G 24's, cached as a page
 * before L68 kept it: with Show at either, its row says it is not in that cached history.
 *
 * The list (9 rows, the selected spacecraft's first, so the fold has one row to open):
 *   KNACKSAT-2 (67683)        the page's default spacecraft: the Decay section and the comparison's first line paint from its cache
 *   in colour                 ISS (ZARYA), JILIN-01 GAOFEN 3D 27 (down to 190 km, its forecast days away; the search also marks it
 *                             "decayed now" at the sweeps' clock), HST, ARCTIC WEATHER SATELLITE (the catalogue's longest name)
 *   grey (context)            FLOCK 4G 24, HULIANWAN GAOGUI-01 (H*) (the longest name with a mark in it)
 *   waiting                   LEMUR 2 PETERG: nothing cached, so its row has Fetch
 *   not drawn                 ITASAT: a history at 2,400 km, "too high for drag to matter", its toggle aria-disabled
 */
'use strict';

const DAY = 86400000;

/** One element set a day, `n` of them, the mean altitude falling from `from` to `to` km, the last `endAgo` days before `nowMs`.
 *  `ecc` is the eccentricity of every row, or a function of the row's place from 0 (the first) to 1 (the last) that gives each
 *  row's (L67: the comparison's eccentricity and perigee views need lines that differ). `pl`, when given, is a plane (below): each
 *  row then carries its inclination and RAAN (L68); without it the rows have neither, as a history cached before L68. */
function falling(nowMs, ecc, endAgo, from, to, n, pl) {
  n = n || 221;
  const t1 = nowMs - endAgo * DAY, rows = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), at = t1 - (n - 1 - i) * DAY;
    const r = { t: at, sma: from - (from - to) * (0.72 * t + 0.28 * t * t), ecc: typeof ecc === 'function' ? ecc(t) : ecc };
    if (pl) Object.assign(r, pl(at));
    rows.push(r);
  }
  return rows;
}
const EPOCH = Date.UTC(2026, 0, 1);
const mod360 = x => ((x % 360) + 360) % 360;
/** A spacecraft's orbital plane (L68), a function of the instant (ms): its mean inclination (deg; each number its own, between 51.6
 *  and 61.2, drifting 0.00001 deg a day) and its RAAN (deg; each number its own node, precessing about 5 deg a day westward as a
 *  low orbit's does, a little faster or slower for each, so the offsets from the selected spacecraft drift by up to 0.02 deg a day),
 *  both to CelesTrak's four places. */
function plane(n) {
  const k = +n, inc0 = 51.6 + (k % 13) * 0.8, node0 = (k * 37) % 360, rate = -5 - ((k % 5) - 2) * 0.01;
  return t => {
    const d = (t - EPOCH) / DAY;
    return { inc: +(inc0 + 0.00001 * d).toFixed(4), raan: +mod360(node0 + rate * d).toFixed(4) };
  };
}
/** a row's column as the page writes it: blank for none (null), 0 where the made-up row has no such value at all */
const col = v => (v === undefined ? 0 : v === null ? '' : v);
/** The page CelesTrak serves for a history: one plotData string, header first. */
const plot = rows => 'var plotData = "Date,RAAN,Inclination,Arg of Perigee,SMA,Eccentricity|' +
  rows.map(r => [new Date(r.t).toISOString().replace('Z', ''), col(r.raan), col(r.inc), 0, r.sma, r.ecc === null ? '' : r.ecc].join(',')).join('|') + '"';
/** The Decay section's cache entry for a history fetched at `at` (lib/net/history-source.ts): with the rows' inclination and RAAN where
 *  they carry them, as the page keeps them since L68, and without where they do not, as a page before then kept them. */
const histEntry = (at, rows) => JSON.stringify({ at, P: rows.map(r => ('inc' in r ? { t: r.t, sma: r.sma, ecc: r.ecc, inc: r.inc, raan: r.raan } : { t: r.t, sma: r.sma, ecc: r.ecc })) });

/* [catalogue number, slot (0: grey), [from, to, endAgo, days] or null (nothing cached)] */
const LIST = [
  ['25544', 2, [421, 414, 1, 400]],
  ['52444', 3, [330, 190, 10, 221]],
  ['20580', 4, [522, 505, 1, 600]],
  ['60543', 5, [600, 596, 1, 300]],
  ['62637', 0, [470, 405, 1, 260]],
  ['59069', 0, [390, 380, 1, 260]],
  ['42841', 0, null],
  ['43786', 0, [2400, 2399, 1, 200]]
];
const SELECTED = '67683';
/** the one history cached as a page before L68 kept it, with no inclination or RAAN: FLOCK 4G 24's (grey) */
const OLD_CACHE = '62637';

/** The keys to write: the record, open, and the cached histories (the selected spacecraft's among them), each with its plane but one. */
function compareSeed(nowMs) {
  const seed = {};
  seed['hist:' + SELECTED] = histEntry(nowMs, falling(nowMs, 0.001, 2, 420, 359, 221, plane(SELECTED)));
  for (const [n, , c] of LIST) if (c) seed['hist:' + n] = histEntry(nowMs, falling(nowMs, 0.001, c[2], c[0], c[1], c[3], n === OLD_CACHE ? null : plane(n)));
  seed['gt.decaycmp'] = JSON.stringify({ o: 1, l: LIST.map(([n, h]) => (h ? { n, h } : { n })) });
  return seed;
}
/** For page.addInitScript(seedStorage, compareSeed(now)): written before the page's code reads the storage. */
function seedStorage(s) {
  try { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); } catch (e) { /* no storage: the page shows the comparison empty */ }
}

module.exports = { DAY, falling, plane, plot, histEntry, compareSeed, seedStorage, SEED_ROWS: LIST.length + 1, SELECTED, OLD_CACHE };
