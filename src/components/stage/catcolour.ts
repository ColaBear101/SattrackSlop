/* The catalogue's colours by class (CHANGES-FROM-LEGACY.md, L76): a chunk of its own, fetched the first time a reader chooses a
 * colouring other than "One colour" in the Layers panel, and never before. It holds the classes (lib/catalogue/classify.ts), the
 * palette, the key and the notes (lib/text/catcolour-key.ts); CelesTrak's table of types and purposes (data/satcat.json) is a chunk
 * of its own again, asked for by "By type" and "By purpose" only, since "By orbit" is read from the elements.
 *
 * The catalogue is handed in by the globe's controller (globe-state.svelte.ts), which imports this file only by import(): a module
 * that the entry and a lazy chunk both import is split by the bundler into a chunk of its own, which the first screen would then
 * fetch as one more file. */
import {
  orbitOf, purposeAt, tableFits, typeAt, unrecorded, type ObjType, type Orbit, type Purpose, type SatcatTable
} from '../../lib/catalogue/classify';
import {
  ORBIT_NAME, ORBIT_ROWS, PURPOSE_NAME, PURPOSE_ROWS, STALE_NOTE, TYPE_NAME, TYPE_ROWS, orbitNote, purposeNote, tagFor, typeNote
} from '../../lib/text/catcolour-key';

export type CatMode = 'orbit' | 'type' | 'purpose';
/** one class in the key: its name, and the colour its dots are seen in at rest */
export interface KeyItem { t: string; c: string }
export interface CatTint {
  /** one linear RGB per catalogue entry, in its order: what the scene draws each dot in (Orbit3D.setCloudTint) */
  rgb: Float32Array;
  /** what follows each entry's name under the pointer */
  tags: string[];
  /** the key's rows */
  key: KeyItem[][];
  /** the note under the choice */
  note: string;
}

/* The palette. r128 reads a hex colour as linear, each channel over 255 (it has no colour management), and that is how these are
   read here, so a class's dots are what the one colour's would be in its hue: the scene dims every dot but the hovered one to 0.55, the
   renderer encodes to sRGB, and the material is 0.92 opaque over black. A dot at rest is therefore far less saturated than its hex,
   and these are near the strongest the dim leaves of each hue, chosen by comparing the dots as they rest (seenAs) in OKLab, under
   normal sight and under protanopia and deuteranopia simulated (Machado 2009). Teal is the one colour itself (SPACE.track, at rest
   #3A93A3, the swatch the key always drew), kept for the sun-synchronous orbits and the payloads, which most of the dots are, and for
   Earth observation, which is mostly sun-synchronous, so that a colouring changes as few dots as it can; "other or unknown" is a dark
   grey, the backdrop the classes stand on. Every pair of classes in a colouring is 14.6 or more apart (OKLab x 100) to normal sight
   and 8.6 or more to either simulation, but two pairs of classes that do not meet on the globe: LEO's orange and IGSO's lime, and
   navigation's orange (in medium and geosynchronous orbits) and amateur and education's lime (in low ones), 4.8 apart under
   deuteranopia (tests/lib/classify.test.ts holds these figures). Every class is also named under the pointer, so no dot is known by
   its colour alone. Gold, the selected spacecraft's and the in-view track's, and the observer's pink are not used. */
const TEAL = '#17A3CC', ORANGE = '#FF3D00', RED = '#F0000C', BLUE = '#0A48FF', LIME = '#56B000', MAGENTA = '#FB00A7', WHITE = '#E8E8E8', GREY = '#2A3036';
export const ORBIT_COLOUR: Record<Orbit, string> = { leo: ORANGE, sso: TEAL, meo: RED, geo: BLUE, igso: LIME, heo: MAGENTA, beyond: WHITE };
export const TYPE_COLOUR: Record<ObjType, string> = { pay: TEAL, rb: ORANGE, deb: MAGENTA, unk: WHITE };
export const PURPOSE_COLOUR: Record<Purpose, string> = { comms: BLUE, nav: ORANGE, eo: TEAL, sci: MAGENTA, crew: WHITE, mil: RED, edu: LIME, other: GREY };

const channels = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const srgb = (c: number): number => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** What a dot drawn in `hex` looks like on the globe, at rest (dim 0.55) or under the pointer (1): r128's sRGB encode of the dimmed
 *  colour, 0.92 opaque over black. #17A3CC at rest is #3A93A3, the swatch the key draws for the one colour. */
export function seenAs(hex: string, dim = 0.55): string {
  return '#' + channels(hex).map(c => Math.round(255 * 0.92 * srgb(Math.min(1, c * dim))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

let table: Promise<SatcatTable> | null = null;
/** CelesTrak's table, fetched once (its own chunk); a failed fetch is let go, so that the next choice asks again */
function loadTable(): Promise<SatcatTable> {
  table ??= import('../../../data/satcat.json').then(m => m.default as unknown as SatcatTable, (e: unknown) => { table = null; throw e; });
  return table;
}

/** Each entry's class, coloured: the scene's tint and tags, the key's rows, and the note, which is given the count in each class. */
function paint<K extends string>(cls: readonly K[], colour: Record<K, string>, name: Record<K, string>, rows: K[][],
                                 say: (count: Record<K, number>) => string): CatTint {
  const keys = Object.keys(name) as K[];
  const rgbOf = Object.fromEntries(keys.map(k => [k, channels(colour[k])])) as Record<K, number[]>;
  const tagOf = Object.fromEntries(keys.map(k => [k, tagFor(name[k])])) as Record<K, string>;
  const count = Object.fromEntries(keys.map(k => [k, 0])) as Record<K, number>;
  const rgb = new Float32Array(cls.length * 3), tags: string[] = [];
  cls.forEach((k, i) => {
    const c = rgbOf[k]!;
    rgb[i * 3] = c[0]!; rgb[i * 3 + 1] = c[1]!; rgb[i * 3 + 2] = c[2]!;
    tags.push(tagOf[k]);
    count[k]++;
  });
  return { rgb, tags, key: rows.map(r => r.map(k => ({ t: name[k], c: seenAs(colour[k]) }))), note: say(count) };
}

/** The colours of the catalogue's dots by one classing. `cat` is the catalogue the cloud was built from, in its order (app.catalogue). */
export async function tintFor(cat: readonly { l2: string; satnum: string }[], mode: CatMode): Promise<CatTint> {
  if (mode === 'orbit') return paint(cat.map(e => orbitOf(e.l2)), ORBIT_COLOUR, ORBIT_NAME, ORBIT_ROWS, orbitNote);
  const t = await loadTable();
  const fits = tableFits(t, cat);
  if (mode === 'type') {
    const gone = fits ? cat.filter((_, i) => unrecorded(t, i)).length : 0;
    return paint(cat.map((_, i): ObjType => fits ? typeAt(t, i) : 'unk'), TYPE_COLOUR, TYPE_NAME, TYPE_ROWS,
      c => fits ? typeNote(c, gone, t.built) : STALE_NOTE);
  }
  return paint(cat.map((_, i): Purpose => fits ? purposeAt(t, i) : 'other'), PURPOSE_COLOUR, PURPOSE_NAME, PURPOSE_ROWS,
    c => fits ? purposeNote(c.other, t.built) : STALE_NOTE);
}
