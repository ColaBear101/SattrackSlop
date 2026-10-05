/* The words and the arithmetic around a pass's naked-eye verdict and its Doppler shift.
 *
 * `txFor`, `dopRows`, `opticalRows` and the magnitude formatters are moved from legacy/index.html (main@4eadd7a),
 * lines 9980-10080, with their comments. Three things differ, and nothing else: they take what the page's closure
 * supplied as arguments (the transmitter table, the selected downlink, the engine and its optics); they return rows
 * as data (src/lib/text/rich.ts) instead of strings of HTML; and a satellite is looked up in the table by its
 * NUMBER, not by the zero-padded text of its TLE column - the old page asked for "01804" in a table keyed 1804, so
 * the twenty satellites numbered under 10000 that have a downlink never showed one (CHANGES-FROM-LEGACY.md, item 1).
 */
import { ABBR } from '../text/fmt';
import { abbr, type Row } from '../text/rich';
import type { Downlink, TransmitterTable } from '../data/transmitters';
import type { Engine, Pass, Track } from '../types';
import type { Optics, PassOptical } from '../types';

/** The downlinks the entry can be tuned to. A planned orbit has no SatNOGS record, and its number must never be
 *  looked up: the table is keyed by NORAD number and holds 98247..99416, where real objects live. The one
 *  frequency it can have is the reader's own. */
export function txFor(entry: { satnum: string; custom?: boolean; dlHz?: number } | null | undefined,
                      table: TransmitterTable | null): Downlink[] {
  if (entry && entry.custom)
    return entry.dlHz && entry.dlHz > 0 ? [{ hz: entry.dlHz, mode: 'user', baud: 0, desc: 'entered in the planner', service: '' }] : [];
  return (table && entry) ? table.forSat(entry.satnum) : [];
}

/* Naked-eye visibility, said plainly. A pass that is radio-only is the normal case and should not read like a failure.

   The magnitude goes on screen with the standard magnitude it came from, and says whether that was looked up or
   assumed (see STD_MAG) - and, for a module or vehicle docked to a station, whose figure it took. "mag 3.1" printed
   bare would claim a precision it does not have; printed with its source, a reader who knows the object can correct
   it in their head. The row is long for the narrow rail, so each figure is bound to its unit with a no-break space
   and the line wraps between phrases, not inside "std mag / 5.0". */
const magStr = (v: number): string => (v <= -0.05 ? '−' : '') + Math.abs(v).toFixed(1);
const nobreak = (s: string): string => s.replace(/ /g, ' ');
const DEG = 180 / Math.PI;
const magText = (pk: NonNullable<PassOptical['peak']>): string => nobreak('mag ' + magStr(pk.mag)) + (pk.pen ? ' or fainter' : '')
  + ' at ' + nobreak(pk.rng.toFixed(0) + ' km')
  + ', ' + nobreak('phase ' + (pk.phase * DEG).toFixed(0) + '°');

export function opticalRows(o: PassOptical | null, NAKED_EYE_MAG: number): Row[] {
  if (!o) return [];
  const pct = (f: number): string => Math.round(100 * f) + '%';
  const why = o.lit === 0 ? 'spacecraft in eclipse'
    : o.dark === 0 ? 'daylight at the site'
    : 'not lit and dark together';
  const v = o.eye === 'yes'
      ? 'yes — ' + pct(o.frac) + ' of the pass'
        + (o.pen ? ', ' + pct(o.penFrac) + ' more in penumbra' : '')
    : o.eye === 'penumbra only' ? 'penumbra only — partly shadowed at its brightest'
    : o.eye === 'too faint'
      ? 'too faint — lit against a dark sky, but fainter than mag ' + NAKED_EYE_MAG
    : 'radio only — ' + why;
  const rows: Row[] = [['Naked eye', v]];
  if (o.peak) rows.push(['Brightness', [
    magText(o.peak) + ' ·  ', abbr(ABBR.STD),
    nobreak(' ' + magStr(o.std.mag) + (o.std.known ? ', Heavens-Above' : ' assumed'))
      + (o.std.via ? ' ·  ' + nobreak('docked to ' + o.std.via) : '')
  ]]);
  /* Both figures here are the mid-pass ones, and the row says so. It was "Sun at site", and its unqualified
     "spacecraft eclipsed" read as a contradiction of the "yes" above it, on a pass lit against the dark only
     before or after its middle. */
  rows.push(['At mid-pass', nobreak('sun ' + (o.sunEl! <= -0.05 ? '−' : '') + Math.abs(o.sunEl!).toFixed(1) + '°') + '  ·  '
    + nobreak(o.litAtMid === 'sun' ? 'spacecraft sunlit'
      : o.litAtMid === 'penumbra' ? 'spacecraft in penumbra'
      : 'spacecraft eclipsed')]);
  return rows;
}

/* Doppler at the three instants that matter, and the total swing - which is what a receiver actually has to track
   across, and roughly twice the AOS figure. */
export function dopRows(p: Pass, dopHz: number | null, track: Track, eng: Pick<Engine, 'rangeRateMs' | 'dopplerHz'>): Row[] {
  if (dopHz === null) return [];
  const rr = (ms: number): number | null => eng.rangeRateMs(track, ms);
  const kHz = (v: number | null): number | null => v === null ? null : eng.dopplerHz(dopHz, v)! / 1000;
  const a = kHz(rr(p.aos.getTime())), c = kHz(rr(p.maxAt.getTime())), l = kHz(rr(p.los.getTime()));
  if (a === null || c === null || l === null) return [];
  const f = (v: number): string => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
  return [
    ['Doppler', f(a) + ' → ' + f(c) + ' → ' + f(l) + ' kHz'],
    ['Swing', (Math.abs(a - l)).toFixed(2) + ' kHz at ' + (dopHz / 1e6).toFixed(3) + ' MHz']
  ];
}

export type { Optics };
