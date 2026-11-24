/* What the close-up says (CHANGES-FROM-LEGACY.md, L72, L77): the card over the view, the state of the model, and each model's credit.
 * In the close-up's own chunk. A model's credit is shown here, beside the model, and not in the footer, whose line is pinned.
 *
 * The credits are what each source asks for. NASA's 3D models are not under copyright, and NASA asks to be named and not to be
 * taken as endorsing anything. The Tiangong model is CC BY 4.0, which asks for the title, the author, the source, the licence and
 * whether it was changed (it was: simplified for a browser). KNACKSAT-2 was built for this page from its team's photographs and
 * specifications, and carries the marks of the team and its partners as the flight model does (at the owner's word). */
import { link, type Inline } from './rich';
import type { ModelId } from '../models/registry';
import { spinSpeed, type Attitude, type Axis, type Pointing, type V3 } from '../models/attitude';

export const CARD_LABEL = 'Close-up';
export const HINT = 'Drag to orbit · scroll or pinch to zoom';
export const RESET = 'Reset view';
/** The card folded to its title bar and opened again (L77), so the view behind it is clear. */
export const HIDE_CARD = 'Hide';
export const SHOW_CARD = 'Show';
/** The model put straight again: along the track, its front leading, no yaw, pitch or roll, from now; its spin rates as they are. */
export const RESET_TURN = 'Reset orientation';
export const REALISTIC = 'Realistic Earth';
export const YOUR_MODEL = 'Your model…';

/** What the close-up calls each model's spacecraft. */
export const MODEL_NAMES: Record<ModelId, string> = { knacksat2: 'KNACKSAT-2', iss: 'the ISS', css: 'Tiangong' };

export const CREDITS: Record<ModelId, Inline> = {
  knacksat2: 'Model built for this page from the KNACKSAT-2 team’s photographs and specifications (KMUTNB): 3U, cells on all four sides, the VHF, UHF and LoRa dipoles out of NBSPACE’s antenna modules at its ends, and the marks of the team and its partners as the flight model carries them.',
  iss: ['Model: ', link('https://science.nasa.gov/3d-resources/international-space-station-iss-d-igoal/', 'NASA/JSC IGOAL'),
        ', from NASA 3D Resources, simplified for this page. NASA does not endorse this page.'],
  css: ['Model: “', link('https://sketchfab.com/3d-models/aca22b1dd6d242c1ae7b88de2f483b77', 'tianGong'), '” by w29572227, ',
        link('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'), ', simplified for this page.']
};

export const loading = (name: string): string => 'Loading the model of ' + name + '…';
export const failed = (name: string): string => 'The model of ' + name + ' could not be loaded.';
export const noModel = (name: string): string => 'There is no 3D model of ' + name + ' yet. You can add your own; it is kept only in this browser.';
export const yours = (file: string): string => 'Your model, ' + file + ', kept only in this browser.';
export const NO_POSITION = 'There is no position for this spacecraft at this time, so there is nothing to look at.';
export const IN_SHADOW = 'In the Earth’s shadow.';

/* How the model flies (L77): the card's button for its panel (lib/text/attitude.ts says the panel), and the line beside it, which says
   how the model is flying and, when it is the reader's setting rather than the model's own, says so first. */
export const FLIGHT = 'How it flies…';
/** The three pointings, as the panel offers them. */
export const POINTING_NAMES: Record<Pointing, string> = { track: 'Along the track', sun: 'Toward the Sun', stars: 'Fixed among the stars' };
const FACE_WORDS: Record<Axis, string> = { '+Z': 'front', '-Z': 'back', '+Y': 'top', '-Y': 'bottom', '+X': 'left side', '-X': 'right side' };
/** An angle or a rate as the close-up says it: to a tenth at most. */
export const num = (x: number): string => String(Math.round(x * 10) / 10);

export function flightLine(a: Attitude, mine: boolean): string {
  const said = [a.pointing === 'track' ? 'along the track' + (a.face === '+Z' ? '' : ', its ' + FACE_WORDS[a.face] + ' leading')
    : a.pointing === 'sun' ? 'its ' + FACE_WORDS[a.face] + ' toward the Sun' : 'fixed among the stars'];
  if (a.ypr[0]) said.push('yaw ' + num(a.ypr[0]) + '°');
  if (a.ypr[1]) said.push('pitch ' + num(a.ypr[1]) + '°');
  if (a.ypr[2]) said.push('roll ' + num(a.ypr[2]) + '°');
  const v = spinSpeed(a.spin);
  if (v) said.push('turning ' + num(v) + '° a second');
  const s = said.join(', ');
  return (mine ? 'As you set it: ' + s : s.charAt(0).toUpperCase() + s.slice(1)) + '.';
}

/* The spin's three rates (L77): on the card itself, under a button that shows and hides them; a slider and a number for each of the
   model's own axes, how long a turn takes and which way, and where a change is kept when this browser keeps nothing. */
export const SPIN_BUTTON = 'Spin rates';
export const SPIN_GROUP = 'Spin rates about the model’s own axes';
export type SpinAxis = 'X' | 'Y' | 'Z';
export const SPIN_ORDER: readonly SpinAxis[] = ['X', 'Y', 'Z'];
export const SPIN_LABELS: Record<SpinAxis, string> = { X: 'X °/s', Y: 'Y °/s', Z: 'Z °/s' };
export const SPIN_SIGNS = 'Degrees a second about the model’s own axes (X side to side, Y top to bottom, Z front to back); + turns it anticlockwise seen from the axis’s tip. Together they turn it about one direction.';
export const rateField = (ax: SpinAxis): string => 'Spin about ' + ax + ', in degrees a second';
export const OWN_SPIN = 'Its own spin';
export const STOP_SPIN = 'Stop';
export const CLOCK_NOTE = 'It turns with the page’s clock: still while the clock is paused, faster when it runs fast.';
export const NOT_KEPT = 'This browser is not keeping settings for this page (a private window, or storage turned off), so this one holds only until you leave.';
export const SNAPSHOT = 'This is a snapshot of the page (?tle=embedded), which keeps nothing, so this setting holds only until you leave.';

const SEEN: Record<SpinAxis, string> = { X: 'from its left', Y: 'from above', Z: 'from in front' };
const way = (d: number, ax: SpinAxis): string => (d > 0 ? 'anticlockwise' : 'clockwise') + ' seen ' + SEEN[ax];

/** One rate as its slider is read out. */
export const rateText = (d: number, ax: SpinAxis): string => (d ? num(Math.abs(d)) + ' degrees a second, ' + way(d, ax) : 'not turning');

/** How long one turn takes and which way, for the three rates together (null or all 0: not turning). */
export function period(r: V3 | null): string {
  const v = r ? Math.hypot(r[0], r[1], r[2]) : 0;
  if (!r || !v) return 'Not turning.';
  const s = 360 / v, every = 'One turn every ' + (s < 120 ? num(s) + ' s' : s < 7200 ? num(s / 60) + ' min' : num(s / 3600) + ' h');
  const on = SPIN_ORDER.filter((_, i) => r[i] !== 0);
  if (on.length === 1) return every + ', ' + way(r[SPIN_ORDER.indexOf(on[0]!)]!, on[0]!) + '.';
  const d = (x: number): string => num(x / v * 100) + ' %';
  return every + ', about the direction X ' + d(r[0]) + ', Y ' + d(r[1]) + ', Z ' + d(r[2]) + '.';
}
