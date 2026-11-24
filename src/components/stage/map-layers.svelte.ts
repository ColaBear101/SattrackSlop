import type { CatalogueEntry } from '../../lib/catalogue/parse';
import type { Track } from '../../lib/types';
import type { CatTint } from './catcolour';
import { sgp4Track } from '../../lib/core/propagator';
import { CATCOL_FAILED } from '../../lib/text/catcolour';
import { BODY, satellite } from '../../state/engine';
import { live } from '../../state/live.svelte';

/* The catalogue on the flat map (CHANGES-FROM-LEGACY.md, L86), in the map's chunk: where the catalogue's spacecraft are at an instant,
 * and the colours they are drawn in while the Layers panel colours them by class (L76).
 *
 * The positions are the globe's (orbit3d's updateCloud): each entry flown on the same propagator, and propagated again only when the
 * instant has moved a second or more from the one the dots are for. The colours are asked of the colours' own chunk (catcolour.ts) by
 * the map itself, so they are there whether or not a globe was ever drawn (no WebGL, or the map chosen first); the latest choice wins
 * over a slower earlier one, and one that cannot be had leaves the one colour and says so, as the globe's panel does. */

const DEG = 180 / Math.PI;
/** the one colour: the globe's dot at rest, the swatch its key draws (#17A3CC dimmed to 0.55, catcolour.ts seenAs) */
export const ONE_COLOUR = '#3A93A3';

class MapCatalogue {
  /** the colours by class for the latest choice, or null for the one colour (or while they are on their way) */
  tint = $state.raw<CatTint | null>(null);
  /** the note under the choices: what the colouring found, or that it could not be had */
  note = $state('');

  lat = new Float32Array(0);
  lon = new Float32Array(0);
  ok = new Uint8Array(0);
  private tracks: (Track | null)[] = [];
  private builtFor: readonly CatalogueEntry[] | null = null;
  private atMs = NaN;
  private seq = 0;
  private asked = '';

  /** Colour the dots by `mode` ('one' is the old page's one colour). */
  want(mode: string, cat: readonly CatalogueEntry[]): void {
    const key = mode + '|' + cat.length;
    if (key === this.asked) return;
    this.asked = key;
    const s = ++this.seq;
    if (mode === 'one') { this.tint = null; this.note = ''; return; }
    import('./catcolour').then(c => c.tintFor(cat, mode as 'orbit' | 'type' | 'purpose')).then(t => {
      if (s === this.seq) { this.tint = t; this.note = t.note; }
    }, () => {
      if (s === this.seq) { this.tint = null; this.note = CATCOL_FAILED; this.asked = ''; }
    });
  }

  /** Where each entry of `cat` is at `ms`: lat, lon (degrees) and ok, in the catalogue's order. */
  place(cat: readonly CatalogueEntry[], ms: number): void {
    if (this.builtFor !== cat) {
      this.tracks = cat.map(c => { try { const t = sgp4Track(BODY, live.effective(c), satellite); return t.ok ? t : null; } catch { return null; } });
      this.lat = new Float32Array(cat.length); this.lon = new Float32Array(cat.length); this.ok = new Uint8Array(cat.length);
      this.builtFor = cat; this.atMs = NaN;
    }
    if (Math.abs(ms - this.atMs) < 1000) return;              // also false while atMs is NaN
    this.atMs = ms;
    const th = BODY.spin(new Date(ms));
    for (let i = 0; i < this.tracks.length; i++) {
      const t = this.tracks[i];
      let st = null;
      try { st = t ? t.at(ms) : null; } catch { st = null; }
      if (st && isFinite(st.r.x)) {
        const gd = BODY.toGeodetic(st.r, th);
        let lo = gd.longitude * DEG;
        while (lo > 180) lo -= 360;
        while (lo < -180) lo += 360;
        this.lat[i] = gd.latitude * DEG; this.lon[i] = lo; this.ok[i] = 1;
      } else this.ok[i] = 0;
    }
  }
}

export const mapcat = new MapCatalogue();
