/* Element sets and decay-history pages made to measure, for tests that need a particular epoch, number or shape. */
import { tleEpochMs } from '../../../shared/tle.js';

/** The TLE mod-10 checksum: the digits of the first 68 columns, a '-' counting 1, anything else 0. */
export function checksum(line: string): number {
  let s = 0;
  for (const c of line.substring(0, 68)) {
    if (c >= '0' && c <= '9') s += Number(c);
    else if (c === '-') s += 1;
  }
  return s % 10;
}
export const withChecksum = (body68: string): string => body68 + checksum(body68);

/* A real set, the ISS from data/catalogue.txt, used as the template: every column is where a real TLE has it. */
const ISS1 = '1 25544U 98067A   26255.20788499  .00004954  00000-0  97729-4 0  9997';
const ISS2 = '2 25544  51.6305 229.4056 0004953 131.3152 228.8264 15.49086570585248';

export const ISS = { l1: ISS1, l2: ISS2 };
export const ISS_EPOCH_MS = tleEpochMs(ISS1);                            // 2026 day 255.20788499

/** The two columns of line 1 that hold the epoch: two-digit year and day of year with 8 decimals (12 characters). */
export function epochField(epochMs: number): string {
  const d = new Date(epochMs);
  const year = d.getUTCFullYear();
  const doy = (epochMs - Date.UTC(year, 0, 1)) / 86400000 + 1;
  return String(year % 100).padStart(2, '0') + doy.toFixed(8).padStart(12, '0');
}

export interface MakeTle { l1: string; l2: string }

/** A valid pair (checksums recomputed) for `norad`, with the epoch at `epochMs`. `meanMotion` replaces the 11-column
 *  mean-motion field when given. The number is written zero-padded to five columns, as a real TLE spells it. */
export function makeTle(norad: number | string, epochMs: number, o: { meanMotion?: number; bstarExp?: string } = {}): MakeTle {
  const id = String(Number(norad)).padStart(5, '0');
  const b1 = ISS1.substring(0, 2) + id + ISS1.substring(7, 18) + epochField(epochMs) + ISS1.substring(32, 68);
  let b2 = ISS2.substring(0, 2) + id + ISS2.substring(7, 68);
  if (o.meanMotion !== undefined) b2 = b2.substring(0, 52) + o.meanMotion.toFixed(8).padStart(11, ' ') + b2.substring(63, 68);
  return { l1: withChecksum(b1), l2: withChecksum(b2) };
}

/** What CelesTrak's gp.php sends: a 24-character name line, then the two lines, CRLF-ended. */
export function celestrakText(name: string, t: MakeTle): string {
  return name.padEnd(24) + '\r\n' + t.l1 + '\r\n' + t.l2 + '\r\n';
}

/** What the TLE mirror sends: JSON with line1 and line2 among other fields. */
export function mirrorJson(name: string, t: MakeTle, id: number | string): string {
  return JSON.stringify({ '@context': 'https://www.w3.org/ns/hydra/context.jsonld', '@type': 'Tle',
    satelliteId: Number(id), name, date: '2026-09-12T04:59:21+00:00', line1: t.l1, line2: t.l2 });
}

/* ---- the decay-history page (the shapes verification/verify-lifetime.js builds) ----------------------- */

const DAY = 86400000;
export interface PlotRowSpec { t: number; sma: number; ecc: number | null }

/** A falling orbit, one element set a day: `from` km to about `to` km over 220 days, steepening as it goes, which is
 *  the shape of KNACKSAT-2's record. Ending `endAgo` days before `nowMs`. */
export function falling(nowMs: number, ecc: number | null, endAgo: number, from: number, to: number): PlotRowSpec[] {
  const t1 = nowMs - endAgo * DAY, n = 221, rows: PlotRowSpec[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    rows.push({ t: t1 - (n - 1 - i) * DAY, sma: from - (from - to) * (0.72 * t + 0.28 * t * t), ecc });
  }
  return rows;
}

/** The page CelesTrak serves: one plotData string, header first. */
export function plotPage(rows: PlotRowSpec[]): string {
  return '<html><body><script>var plotData = "Date,RAAN,Inclination,Arg of Perigee,SMA,Eccentricity|' +
    rows.map(r => [new Date(r.t).toISOString().replace('Z', ''), 0, 0, 0, r.sma, r.ecc === null ? '' : r.ecc].join(',')).join('|') +
    '";</script></body></html>';
}

/** A history with a header and no rows at all. */
export const EMPTY_PLOT = 'var plotData = "Date,RAAN,Inclination,Arg of Perigee,SMA,Eccentricity"';
