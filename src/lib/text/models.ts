/* What the "Your model" panel says (CHANGES-FROM-LEGACY.md, L73): its controls, what happens to a file, and every reason a file is
   refused, one sentence each, in the order lib/models/validate.ts checks them. In the uploads chunk. */
import { MODEL_MAX_BYTES, TRIANGLES_MAX, type Refusal, type Units } from '../models/validate';

export const PANEL_LABEL = 'Your model';
export const CHOOSE = 'Choose a .glb or .gltf file';
export const DROP = 'or drop one on the globe';
export const ONLY_HERE = 'Kept only in this browser, never sent anywhere.';
export const UNITS_LABEL = 'Units in the file';
export const UNIT_NAMES: Record<Units, string> = { m: 'metres', cm: 'centimetres', mm: 'millimetres' };
export const FORWARD_LABEL = 'Forward (along the track)';
export const UP_LABEL = 'Up (away from the Earth)';
export const AXES_CLASH = 'Forward and up have to be two different axes at right angles.';
export const KEEP = 'Keep this model';
export const REMOVE = 'Remove my model';
export const CLOSE = 'Close';
export const READING = 'Reading the model…';
export const KEPT = 'Kept. It is shown whenever this spacecraft is in close-up, in this browser.';
export const REMOVED = 'Removed. The page’s own model, if it has one, is back.';
export const NOT_KEPT = 'This browser is not keeping files for this page (a private window, or storage turned off), so the model is shown only until you leave.';
export const SNAPSHOT = 'This is a snapshot of the page (?tle=embedded), which keeps nothing, so the model is shown only until you leave.';
export const PARSE_FAILED = 'The model could not be read';
export const TIMED_OUT = 'Reading the model took too long.';

export const tooMany = (n: number): string => 'At most ' + n + ' models are kept; remove one first.';
export const heavy = (t: number): string => 'This model has ' + t.toLocaleString('en-US') + ' triangles, so it may be slow to draw.';

const len = (m: number): string =>
  m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km'
    : m >= 1 ? m.toFixed(m >= 100 ? 0 : m >= 10 ? 1 : 2) + ' m' : (m * 100).toFixed(1) + ' cm';
/** The model's size as the units make it, so a millimetre file read as metres shows itself up. */
export const sizeLine = (x: number, y: number, z: number): string => 'Size: ' + [x, y, z].map(len).join(' × ');

const mb = (n: number): string => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0) + ' MB';

export function refusal(r: Refusal): string {
  switch (r.why) {
    case 'empty': return 'That file is empty.';
    case 'too-big': return 'That file is ' + mb(r.bytes) + '; the page takes models of up to ' + mb(MODEL_MAX_BYTES) + '.';
    case 'not-gltf': return 'That is not a glTF model. Export it as .glb (binary glTF) and try again.';
    case 'version': return 'That is glTF ' + r.version + '; the page reads glTF 2.0.';
    case 'truncated': return 'That file is cut short or damaged.';
    case 'json': return 'The description inside the model could not be read.';
    case 'external': return 'That model points to other files (' + r.uri + '), which the page will not fetch. Export it as one .glb with its textures inside.';
    case 'decoder': return 'That model is compressed with ' + r.ext + ', which the page cannot read. Export it without mesh or texture compression.';
    case 'extension': return 'That model needs ' + r.ext + ', which the page cannot read.';
    case 'no-mesh': return 'That file has no shapes in it.';
    case 'too-much-data': return 'That model holds more data than a browser tab can safely load.';
    case 'too-many-triangles': return 'That model has ' + r.triangles.toLocaleString('en-US') + ' triangles; the page draws up to ' + TRIANGLES_MAX.toLocaleString('en-US') + '. Simplify it and try again.';
  }
}
