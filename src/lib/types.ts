import type * as SatelliteJs from 'satellite.js';

/* The shapes the verbatim numerical core hands around. The core itself is moved unchanged from the
   old page (see the headers of core/ and analysis/engine.ts), so these describe what it already does;
   they do not constrain it. */

export type Satellite = typeof SatelliteJs;

export interface Vec3 { x: number; y: number; z: number }

/** An observer. `zone` appears only once a site picked by name has been applied. */
export interface Site { lat: number; lon: number; altKm: number; name: string; tz: number; zone?: string }

/** One catalogue record, exactly as parseCatalog reads it. Custom orbits extend it with their own fields. */
export interface Tle { name: string; l1: string; l2: string; satnum: string }

export interface LookAngles { azimuth: number; elevation: number; rangeSat: number }
export interface Geodetic { latitude: number; longitude: number; height: number }

/** What is a property of the central body (the Earth's half; the Moon's stays in public/core). */
export interface Body {
  id: string; name: string; symbol: string;
  Re: number; Rp: number; flattening: number; sgp4Re: number | null;
  mu: number; J2: number;
  spin(date: Date): number;
  toFixed(r: Vec3, theta: number): Vec3;
  toGeodetic(r: Vec3, theta: number): Geodetic;
  omega: number;
  siteFixed(site: Site): Vec3;
  lookAngles(site: Site, rFixed: Vec3): LookAngles;
  daySeconds: number;
  hasAtmosphere: boolean;
  reentryAltKm: number | null;
  defaultSite: Site;
  sunSyncBand: [number, number] | null;
  sunSyncDriftDegPerDay: number;
}

export interface State { r: Vec3; v: Vec3 }

/** A propagator bound to a body. `raw` is the satrec: SGP4 state nothing else models. */
export interface Track {
  kind: 'sgp4';
  body: Body;
  entry: Tle;
  raw: unknown;
  ok: boolean;
  at(ms: number): State | null;
  readonly lastError: number | null;
  readonly recoveredA: number | null;
}

/** The sub-satellite point and the look from the observer, at one instant. */
export interface Sample { t: Date; lat: number; lon: number; alt: number; el: number; az: number; rng: number }

/** The look from the observer, without the sub-point (a pass arc, a pass peak). */
export interface Look { el: number; az: number; rng: number; rr: number | null }

export interface Pass {
  aos: Date; los: Date; dur: number;
  maxEl: number; maxAt: Date; maxAz: number; minRng: number;
  aosAz: number; losAz: number;
  arc: Look[];
  clipA: boolean; clipL: boolean;
  t0ms: number; t1ms: number;
}

/** Orbital elements: the six from the TLE columns, then what compute() adds by measuring. */
export interface Elements {
  epoch: Date; inc: number; raan: number; ecc: number; argp: number; ma: number; n: number; a: number;
  period: number; perigeeAlt: number; apogeeAlt: number;
  satnum: string; cospar: string; rev: number; bstar: number; ndot: number;
  aNaive?: number; aSource?: 'sgp4';
  periodMeasured?: boolean; periodShown?: number; periodKind?: 'nodal' | 'keplerian';
  periodWhy?: 'equatorial' | 'nonodes' | null; deepSpace?: boolean; planeUnclear?: boolean;
  altMeasured?: boolean; rMin?: number; rMax?: number; surfMin?: number; surfMax?: number;
  oscAMin?: number; oscAMax?: number;
}

export interface Reentry { minAlt: number; groundAt: number | null }

/** compute()'s result: exactly these fifteen keys, in the old page and the gate. */
export interface Analysis {
  entry: Tle; track: Track; satrec: unknown; E: Elements;
  start: Date; end: Date; pts: Sample[]; passes: Pass[];
  totalS: number; meanAlt: number; lambda: number; step: number; hours: number; drawStride: number;
  reentry: Reentry | null;
}

export interface EngineEnv { satellite: Satellite; BODY: Body; OBS: Site; MASK: number }

/** The analysis engine for one (body, observer, mask). Replace it when the observer moves. */
export interface Engine {
  compute(entry: Tle, t0ms: number, hours: number): Analysis;
  elements(l1: string, l2: string): Elements;
  stepFor(hours: number): number;
  passStepFor(hours: number): number;
  sample(track: Track, start: Date, k: number, step: number): Sample | null;
  sampleMs(track: Track, ms: number): Sample | null;
  elevationAt(track: Track, ms: number): number;
  stateAt(track: Track, ms: number): Look | null;
  rangeRateMs(track: Track, ms: number): number | null;
  dopplerHz(freqHz: number | null, rrKms: number | null): number | null;
  findPasses(track: Track, t0: number, t1: number, stepS: number): Pass[];
  C_KMS: number;
  MU: number; RE: number; RAD: number; DEG: number;
  REENTRY_KM: number; SGP4_MU: number;
  sgp4Why(code: number | null | undefined): string;
  BODY: Body; OBS: Site; MASK: number;
}
