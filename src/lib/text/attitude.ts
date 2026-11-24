/* What the "How it flies" panel says (CHANGES-FROM-LEGACY.md, L77): its controls and the signs of its three turns. In the panel's own
   chunk (flight); the card's button, the line beside it, the pointings' names, the spin's three rates (on the card itself) and where a
   setting is kept when it is not kept in this browser are lib/text/closeup-card.ts's, in the close-up's chunk. */
import type { Axis } from '../models/attitude';
import { num } from './closeup-card';
export { NOT_KEPT, SNAPSHOT } from './closeup-card';

export const PANEL_LABEL = 'How it flies';
export const POINTING_LABEL = 'Pointing';
export const FACE_LABEL = { track: 'Leading face', sun: 'Face to the Sun' } as const;
/** The six faces, in the order the panel offers them. */
export const FACE_ORDER: readonly Axis[] = ['+Z', '-Z', '+Y', '-Y', '+X', '-X'];
export const FACES: Record<Axis, string> = {
  '+Z': 'Front (+Z)', '-Z': 'Back (-Z)', '+Y': 'Top (+Y)', '-Y': 'Bottom (-Y)', '+X': 'Left (+X)', '-X': 'Right (-X)'
};
export const STARS_NOTE = 'Held as it was among the stars when this was chosen, or when the model is next put up (after a reload, or another model), as a spacecraft left to itself is: the Earth turns past it.';
export const ANGLE_LABELS = ['Yaw', 'Pitch', 'Roll'] as const;
export const SIGNS = 'Degrees from the pointing: yaw + turns the front to the right, pitch + raises it, roll + lowers the right side.';
export const OWN = 'Reset to its own';
export const CLOSE = 'Close';

/** A number field's name, for the slider's twin. */
export const fieldName = (label: string): string => label + ', in degrees';
export const degrees = (v: number): string => num(v) + ' degrees';
