import { describe, expect, it } from 'vitest';
import { Lunar, moonState, type MoonState } from '../../src/lib/core/moon';

/* moonState() (src/lib/core/moon.ts, CHANGES-FROM-LEGACY.md, L75): the Moon the realistic sky draws, held to numbers that come from
   outside this repository. Meeus's worked examples first, then instants the whole world agrees on (new and full Moons, eclipses),
   then what must hold at every instant from 1990 to 2050. tests/lib/moon-equivalence.test.ts holds the port to the classic files. */

const DEG = Math.PI / 180, RAD = 180 / Math.PI;
type V = readonly number[];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V, k: number): number[] => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: V, b: V): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** the angle between two directions, degrees */
const angle = (a: V, b: V) => Math.atan2(len(cross(a, b)), dot(a, b)) * RAD;
/** a - b, degrees, folded into -180..180 */
const dAng = (a: number, b: number) => ((a - b) % 360 + 540) % 360 - 180;

/** The position angle of a direction v across the disc of a body seen from the Earth's centre at r: from the disc's north point
 *  (towards +Z, the pole of the frame) through east (the way right ascension grows), 0..360. */
function positionAngle(r: V, v: V): number {
  const u = scale(r, 1 / len(r));
  const e0 = cross([0, 0, 1], u), east = scale(e0, 1 / len(e0));
  const north = cross(u, east);
  return ((Math.atan2(dot(v, east), dot(v, north)) * RAD) % 360 + 360) % 360;
}

/** Where selenographic (lat, lon) lies from the Moon's centre, by the recipe MoonState.primeEci gives. */
function toward(s: MoonState, p: { lat: number; lon: number }): number[] {
  const east = cross(s.poleEci, s.primeEci), cl = Math.cos(p.lat * DEG);
  return [0, 1, 2].map(i => cl * Math.cos(p.lon * DEG) * s.primeEci[i] + cl * Math.sin(p.lon * DEG) * east[i] + Math.sin(p.lat * DEG) * s.poleEci[i]);
}

/* Meeus, "Astronomical Algorithms", 2nd ed. (1998), carries one instant through chapters 47, 48 and 53: 1992 April 12 at 0h TD,
   JDE 2448724.5. moonState() takes a UTC Date and lunar.js adds its own Delta T to it (58.5 s then), so the Date is that instant less
   lunar.js's Delta T, found by iterating. A whole millisecond is 1.2e-8 days, in which the Moon moves 1.5e-7 degrees. */
function utcForJDE(jde: number): Date {
  let jd = jde;
  for (let k = 0; k < 3; k++) jd = jde - (Lunar.toJDE(jd) - jd);
  return new Date(Math.round((jd - 2440587.5) * 86_400_000));
}
const MEEUS = utcForJDE(2448724.5);
const MEEUS_T = -0.077221081451;          // his T for that JDE

describe("Meeus's worked examples, 1992 April 12 at 0h TD", () => {
  it('the ELP-2000/82B series gives example 47.a to his last digit', () => {
    const m = Lunar.moonEcliptic(MEEUS_T) as Record<string, number>;
    const want: Record<string, number> = { Lp: 134.290182, D: 113.842304, M: 97.643514, Mp: 5.150833, F: 219.889721, lon: 133.162655, lat: -3.229126 };
    for (const [k, v] of Object.entries(want)) expect(Math.abs(m[k] - v), k).toBeLessThan(1e-6);
    expect(Math.abs(m.dist - 368409.7)).toBeLessThan(0.05);
  });

  it('moonState() puts the Moon where 47.a does, in the mean equator and equinox of the date', () => {
    const s = moonState(MEEUS);
    const [x, y, z] = s.eci;
    expect(Math.abs(s.distanceKm - 368409.7)).toBeLessThan(0.05);
    expect(Math.abs(len(s.eci) - s.distanceKm)).toBeLessThan(1e-6);
    /* turned back to the ecliptic by the mean obliquity of the date (Meeus 22.2), eci is his geometric longitude and latitude */
    const T = MEEUS_T, eps0 = (23 + 26 / 60 + (21.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T * T * T) / 3600) * DEG;
    const lon = Math.atan2(y * Math.cos(eps0) + z * Math.sin(eps0), x) * RAD;
    const lat = Math.asin((z * Math.cos(eps0) - y * Math.sin(eps0)) / s.distanceKm) * RAD;
    expect(Math.abs(lon - 133.162655)).toBeLessThan(2e-6);
    expect(Math.abs(lat + 3.229126)).toBeLessThan(2e-6);
    /* and its right ascension and declination are his apparent ones less the nutation (0.0046 degrees in longitude) */
    expect(Math.abs(Math.atan2(y, x) * RAD - 134.688470)).toBeLessThan(0.01);
    expect(Math.abs(Math.asin(z / s.distanceKm) * RAD - 13.768368)).toBeLessThan(0.01);
  });

  it('the lit share, the phase angle and the bright limb are example 48.a', () => {
    const s = moonState(MEEUS);
    /* Meeus works from apparent places, the Sun's 20.5 arcsec of aberration among them, and moonState from geometric ones: that
       moves the phase angle by 0.006 degrees and the lit share by 0.0001 */
    expect(Math.abs(s.illuminated - 0.6786)).toBeLessThan(2e-4);
    expect(Math.abs(s.phaseAngle - 69.0756)).toBeLessThan(0.01);
    expect(Math.abs(s.brightLimbAngle - 285.0)).toBeLessThan(0.1);
  });

  it("the libration, the Sun's place on the Moon and the axis are examples 53.a and 53.b", () => {
    const s = moonState(MEEUS), m = Lunar.moon(MEEUS);
    /* lunar.js's own selenographic code is Meeus's optical libration (53.1), to his last digit */
    expect(Math.abs(m.libLon + 1.206)).toBeLessThan(1e-3);
    expect(Math.abs(m.libLat - 4.194)).toBeLessThan(1e-3);
    /* moonState's come from the IAU axes, which carry the physical libration as well: his totals (optical and physical, l = -1.23,
       b = +4.20; the Sun's l0 = 67.89, b0 = +1.46) to the 0.05 degrees two models of the Moon's turning differ by */
    expect(Math.abs(s.subEarth.lon + 1.23)).toBeLessThan(0.05);
    expect(Math.abs(s.subEarth.lat - 4.20)).toBeLessThan(0.05);
    expect(Math.abs(s.subSolar.lon - 67.89)).toBeLessThan(0.05);
    expect(Math.abs(s.subSolar.lat - 1.46)).toBeLessThan(0.05);
    /* the position angle of the Moon's axis on the sky, P = 15.08 (53.a), from poleEci */
    expect(Math.abs(positionAngle(s.eci, s.poleEci) - 15.08)).toBeLessThan(0.05);
  });
});

describe('instants the world agrees on', () => {
  /* Published instants of new and full Moon are of apparent longitudes, to the minute (0.004 degrees of elongation); lunar.js's
     longitudes are geometric, 0.006 degrees apart by the Sun's aberration, and its Sun (Meeus ch. 25) is good to 0.01 degrees. */
  it('the elongation in longitude is 0 at a known new Moon and 180 at a known full Moon, to 0.025 degrees', () => {
    const cases: [string, Date, number][] = [
      ['new Moon, 1977 Feb 18 3h37m42s TD (Meeus, example 49.a)', utcForJDE(2443192.65118), 0],
      ['new Moon, 2017 Aug 21 18:30 UTC', new Date(Date.UTC(2017, 7, 21, 18, 30)), 0],
      ['new Moon, 2024 Apr 8 18:21 UTC', new Date(Date.UTC(2024, 3, 8, 18, 21)), 0],
      ['full Moon, 2022 Nov 8 11:02 UTC', new Date(Date.UTC(2022, 10, 8, 11, 2)), 180],
      ['full Moon, 2025 Mar 14 06:55 UTC', new Date(Date.UTC(2025, 2, 14, 6, 55)), 180]
    ];
    for (const [what, d, want] of cases) {
      expect(Math.abs(dAng(Lunar.moon(d).phase * 360, want)), what).toBeLessThan(0.025);
      /* and the phase angle is within the Moon's distance from the ecliptic, at most 5.3 degrees, of 180 at new and of 0 at full */
      const s = moonState(d);
      expect(want === 0 ? 180 - s.phaseAngle : s.phaseAngle, what).toBeLessThan(5.4);
      expect(want === 0 ? s.illuminated : 1 - s.illuminated, what).toBeLessThan(0.003);
    }
  });

  /* At greatest eclipse the shadow's axis passes gamma Earth radii from the Earth's centre (NASA's tables: 0.44 and 0.34 for the two
     solar eclipses, 0.26 and 0.35 for the two lunar ones), a few tenths of a degree seen from the Moon's distance. */
  it('the Moon is all but new at the greatest point of a total solar eclipse, and all but full at a total lunar one', () => {
    for (const t of [Date.UTC(2017, 7, 21, 18, 25, 32), Date.UTC(2024, 3, 8, 18, 17, 16)]) {
      const s = moonState(new Date(t));
      expect(s.phaseAngle, new Date(t).toISOString()).toBeGreaterThan(179.3);
      expect(s.illuminated).toBeLessThan(5e-5);
    }
    for (const t of [Date.UTC(2022, 10, 8, 10, 59, 11), Date.UTC(2025, 2, 14, 6, 58, 43)]) {
      const s = moonState(new Date(t));
      expect(s.phaseAngle, new Date(t).toISOString()).toBeLessThan(0.7);
      expect(s.illuminated).toBeGreaterThan(1 - 5e-5);
    }
  });
});

describe('at 600 instants from 1990 to 2050', () => {
  const N = 600, t0 = Date.UTC(1990, 0, 1), t1 = Date.UTC(2050, 0, 1);
  const AT = Array.from({ length: N }, (_, i) => new Date(t0 + Math.floor((t1 - t0) * i / N) + (i * 7_919_993) % 86_400_000));
  const ALL = AT.map(d => ({ d, s: moonState(d), m: Lunar.moon(d), sun: Lunar.sun(d) }));

  it('the distance is the length of eci, between the extremes of perigee and apogee', () => {
    for (const { s } of ALL) {
      expect(Math.abs(len(s.eci) - s.distanceKm) / s.distanceKm).toBeLessThan(1e-12);
      expect(s.distanceKm).toBeGreaterThan(356_000);
      expect(s.distanceKm).toBeLessThan(407_000);
    }
  });

  it('the lit share is (1 + cos phaseAngle) / 2, and the phase angle is the angle Sun-Moon-Earth at the Moon', () => {
    for (const { s, sun } of ALL) {
      expect(Math.abs(s.illuminated - (1 + Math.cos(s.phaseAngle * DEG)) / 2)).toBeLessThan(1e-12);
      expect(Math.abs(angle(sub([sun.x, sun.y, sun.z], s.eci), scale(s.eci, -1)) - s.phaseAngle)).toBeLessThan(1e-9);
    }
  });

  it("the bright limb is the Sun's direction across the disc: west while the Moon waxes, east while it wanes", () => {
    let n = 0;
    for (const { s, m, sun } of ALL) {
      if (m.elongation < 5 || m.elongation > 175) continue;     // at new and full there is no limb to speak of
      expect(Math.abs(dAng(s.brightLimbAngle, positionAngle(s.eci, sub([sun.x, sun.y, sun.z], s.eci))))).toBeLessThan(1e-6);
      if (m.elongation > 20 && m.elongation < 160) {
        expect(s.brightLimbAngle > 180, m.waxing ? 'waxing' : 'waning').toBe(m.waxing);
        n++;
      }
    }
    expect(n).toBeGreaterThan(400);
  });

  it('poleEci and primeEci are unit vectors at right angles, and with east = pole x prime they make a right-handed frame', () => {
    for (const { s } of ALL) {
      expect(Math.abs(len(s.poleEci) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(len(s.primeEci) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(dot(s.poleEci, s.primeEci))).toBeLessThan(1e-12);
      /* the sphere's local axes in the scene's (x, z, -y): primeEci, poleEci and -east, a rotation (determinant +1) */
      const S = (v: V) => [v[0], v[2], -v[1]];
      const east = cross(s.poleEci, s.primeEci);
      expect(Math.abs(dot(S(s.primeEci), cross(S(s.poleEci), S(scale(east, -1)))) - 1)).toBeLessThan(1e-12);
    }
  });

  it('a map laid by primeEci and poleEci has subEarth under the Earth and subSolar under the Sun, as far apart as the phase angle', () => {
    for (const { s, sun } of ALL) {
      expect(angle(toward(s, s.subEarth), scale(s.eci, -1))).toBeLessThan(1e-9);
      expect(angle(toward(s, s.subSolar), sub([sun.x, sun.y, sun.z], s.eci))).toBeLessThan(1e-9);
      expect(Math.abs(angle(toward(s, s.subEarth), toward(s, s.subSolar)) - s.phaseAngle)).toBeLessThan(1e-9);
    }
  });

  it("the librations are Meeus's optical ones (lunar.js) to 0.1 degrees, and keep within their known bounds", () => {
    for (const { s, m } of ALL) {
      expect(Math.abs(dAng(s.subEarth.lon, m.libLon))).toBeLessThan(0.1);
      expect(Math.abs(s.subEarth.lat - m.libLat)).toBeLessThan(0.1);
      expect(Math.abs(dAng(s.subSolar.lon, m.subsolarLon))).toBeLessThan(0.1);
      expect(Math.abs(s.subSolar.lat - m.subsolarLat)).toBeLessThan(0.1);
      /* the Earth wanders 6.9 degrees north and south of the Moon's equator and 8.1 east and west of its prime meridian, the Sun
         1.6 north and south */
      expect(Math.abs(s.subEarth.lat)).toBeLessThan(7);
      expect(Math.abs(s.subEarth.lon)).toBeLessThan(8.3);
      expect(Math.abs(s.subSolar.lat)).toBeLessThan(1.65);
      /* so the prime meridian at the equator is never far from the middle of the near side */
      expect(angle(s.primeEci, scale(s.eci, -1))).toBeLessThan(11);
    }
  });

  it("the Moon's equator keeps 1.54 degrees from the ecliptic of the date (Cassini's second law)", () => {
    for (const { s, m } of ALL) {
      const e = m.eps * DEG, a = angle(s.poleEci, [0, -Math.sin(e), Math.cos(e)]);
      expect(a).toBeGreaterThan(1.45);
      expect(a).toBeLessThan(1.65);
    }
  });
});
