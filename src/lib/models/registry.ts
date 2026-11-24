/* The spacecraft models the page ships, and which catalogue numbers wear them (CHANGES-FROM-LEGACY.md, L72).
 *
 * New in the rebuild. A station is several catalogue objects flying one element set (the ISS's Zarya, Nauka and Poisk; the
 * Chinese station's Tianhe, Wentian and Mengtian), and all of them are one model. Vehicles that come and go (crew and cargo
 * ships docked for a few months) are left out: their numbers fly the station's elements only while they are docked.
 *
 * Every model is exported in the canonical frame (lib/models/attitude.ts): +Z along the track, +Y away from the Earth, metres.
 * The files themselves, their words and their credits live with the close-up (scene/closeup-pass.ts, lib/text/closeup-card.ts);
 * this is data only, so the page can ask "is there a model of this one?" without fetching anything. Pure. */
import type { Axis } from './attitude';

export type ModelId = 'knacksat2' | 'iss' | 'css';

export interface BuiltIn {
  id: ModelId;
  /** the catalogue numbers that are this spacecraft */
  sats: readonly string[];
  /** a slow turn about one of the model's canonical axes, for a spacecraft that is not pointed */
  spin?: { axis: Axis; degPerSec: number };
  /** the radius the camera frames, m, when the model's own bounding box would frame its antennas rather than the spacecraft */
  frame?: number;
}

export const BUILT_IN: readonly BuiltIn[] = [
  /* KNACKSAT-2 has no attitude control to speak of; its reception sheet says "satellite is rotating". The rate is not published, so
     this is a slow two degrees a second about its long axis, enough to show all four faces. */
  { id: 'knacksat2', sats: ['67683'], spin: { axis: '+Z', degPerSec: 2 }, frame: 0.21 },   // the body; its VHF dipole is 1.09 m across
  { id: 'iss', sats: ['25544', '49044', '36086'] },              // ZARYA, NAUKA, POISK
  { id: 'css', sats: ['48274', '53239', '54216'] }               // TIANHE-1, WENTIAN, MENGTIAN
];

/** The model a catalogue number wears, or null. */
export const builtInFor = (satnum: string): BuiltIn | null => BUILT_IN.find(m => m.sats.includes(satnum)) ?? null;
