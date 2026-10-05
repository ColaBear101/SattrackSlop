/* Reading CelesTrak's decay-history page. MOVED, not rewritten, from src/lib/planner/lifetime.ts (old lines 287-316;
 * ported verbatim there from legacy/earth/lifetime.js, main@4eadd7a, lines 281-310) so that the browser and the API
 * read the page with ONE implementation. Pure TypeScript: no DOM, no Node, no imports. The arithmetic, the order of
 * the checks and the comments are the originals; only the types are new.
 *
 * What the page is: graph-orbit-data.php?CATNR=<id> returns an HTML page with the whole run of mean
 * elements embedded in one `plotData` string - a header, then one row per element set CelesTrak has held:
 *
 *     var plotData = "Date,RAAN,Inclination,Arg of Perigee,SMA,Eccentricity|2026-09-12T07:29:12.345,0,0,0,362.9,0.0008|..."
 *
 * The "SMA" column is the mean ALTITUDE a - Re in km, not the semi-major axis.
 */

/* The mean altitudes a row may have and still be read. The bounds are there to
   throw out garbage, not orbits: the ceiling was 60,000 km, which threw out
   every row of every high eccentric orbit - XMM-NEWTON's mean altitude is
   60,550 km, the Cluster II spacecraft's about 65,600 - and the page then
   reported the history as missing. Nothing past the Moon's distance is an
   Earth orbit worth reading.                                                  */
export const SMA_MIN = 80, SMA_MAX = 400000;

/** One element set of the run: epoch (ms since 1970), mean altitude (km) and eccentricity (NaN when the
 *  row carries none - a number, as in the original; it becomes `null` only on the wire). */
export interface PlotRow { t: number; sma: number; ecc: number }

/** What readPlot found: the rows, how many rows there were before the bounds above, and whether the page
 *  had a `plotData` string at all. */
export interface PlotReading { P: PlotRow[] | null; rows: number; found: boolean }

/* The run of rows, and how many rows there were before the bounds above. A
   history that arrived and was all filtered out is a different answer from one
   that never arrived, and the page says which. */
export function readPlot(txt: string): PlotReading {
  const m = txt.match(/var plotData = "([^"]*)"/);
  if(!m) return {P:null, rows:0, found:false};
  const rows = m[1].split('|'); rows.shift();          // header line
  const P: PlotRow[] = [];
  let n = 0;
  for(const r of rows){
    const f = r.split(',');
    if(f.length < 6) continue;
    n++;
    const t = Date.parse(f[0] + 'Z'), sma = parseFloat(f[4]);
    if(isFinite(t) && isFinite(sma) && sma > SMA_MIN && sma < SMA_MAX)
      P.push({t, sma, ecc: parseFloat(f[5])});
  }
  P.sort((a,b)=>a.t-b.t);
  return {P: P.length ? P : null, rows:n, found:true};
}
export function parsePlot(txt: string): PlotRow[] | null { return readPlot(txt).P; }
