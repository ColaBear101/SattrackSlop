// @ts-nocheck - verbatim; the typed surface is Optics in ../types.ts
/* Is the spacecraft lit, is the ground dark, and is it bright enough to see?
 *
 * Moved VERBATIM from legacy/index.html (main@4eadd7a), lines 9301-9525: sunlitState, the standard-magnitude
 * tables and stdMagOf, estMagnitude, viewGeometry, opticalAt and passOptical, with their comments. What the page's
 * closure supplied is the arguments of makeOptics():
 *   eng   the analysis engine (fix, RE, OBS) - the observer is a value, so a new observer is a new Optics
 *   sun   makeSun(): sunEci and sunElevation
 *   cat   the catalogue as the page holds it:
 *           embedded   every entry as embedded (the snapshot), to pair docked vehicles with their station
 *           current(n) the entry numbered n as it stands now, with a live refresh's set if it has one
 * Two things differ from the original and nothing else: the station tables read the catalogue through `cat`
 * instead of the page's CAT, and the docked pairing is keyed by NORAD number (an entry is an immutable value, so
 * the old Map keyed by the object a refresh updated in place would never be found again).
 */
export function makeOptics(eng, sun, cat) {
  const { fix, RE, OBS } = eng;
  const { sunEci, sunElevation } = sun;
  /* ---- is the spacecraft lit, and is the ground dark? -----------------------
   * A pass in this program has meant RADIO visibility: geometry above a 5 deg
   * mask, day or night. Seeing one with the eye needs two more things to be true
   * at the same time, and they pull in opposite directions - the spacecraft has to
   * be in sunlight while the observer is not. That is why satellites are watched
   * in the hour after dusk and before dawn, and why most radio passes are not
   * watchable at all.
   *
   * The shadow is a CONE, not a cylinder. The Sun is not a point: at 696,000 km
   * radius and 1.496e8 km away it subtends about half a degree, so Earth's shadow
   * tapers to nothing at 1.4e6 km and is surrounded by a penumbra that widens with
   * distance. A cylinder is the usual shortcut and it is wrong in the direction
   * that matters - it reports umbra where there is only partial shading.
   *
   * Umbra and penumbra are reported separately rather than collapsed: at LEO the
   * penumbra crossing takes only seconds, but it is a real state and a satellite
   * in it is dimmed rather than dark.                                          */
  const SUN_RADIUS_KM = 696000;
  function sunlitState(rEci, date){
    const S = sunEci(date);
    const sx = S.x, sy = S.y, sz = S.z;
    const along = rEci.x*sx + rEci.y*sy + rEci.z*sz;      // + is toward the Sun
    if(along >= 0) return 'sun';                          // in front of the Earth
    const behind = -along;                                // distance down the shadow axis
    const px = rEci.x - along*sx, py = rEci.y - along*sy, pz = rEci.z - along*sz;
    const off = Math.hypot(px, py, pz);                   // distance off that axis
    /* Half-angles of the two cones. The umbra converges (Sun bigger than Earth),
       the penumbra diverges; both are tiny, so tan == the ratio to well past the
       precision of anything else here. */
    const tanU = (SUN_RADIUS_KM - RE)/S.distKm;
    const tanP = (SUN_RADIUS_KM + RE)/S.distKm;
    if(off < RE - behind*tanU) return 'umbra';
    if(off < RE + behind*tanP) return 'penumbra';
    return 'sun';
  }
  /* Civil twilight. Below -6 deg the sky is dark enough that a sunlit satellite
     reads against it; the often-quoted -18 deg is astronomical twilight, which is
     what a telescope wants, not an eye looking for a moving point. */
  const DARK_SUN_EL = -6;

  /* ---- and is it bright enough? --------------------------------------------
   * Lit against a dark sky is geometry, and geometry is not enough. It said
   * "naked eye: yes" for CLUSTER II-FM8 at 124,000 km and INTELSAT 36 at 37,000.
   * An object fades by 5 log10(range) magnitudes - ten between 1,000 km and
   * 100,000 km - and from GEO range it would take something brighter than the
   * Chinese space station to reach the eye's +6.
   *
   * So the verdict carries an estimated magnitude, in the usual convention: a
   * STANDARD magnitude is what the object would show at 1,000 km with the Sun 90
   * deg away as seen from it (half its face lit), and the estimate scales that by
   * range and by the phase function of a diffusely reflecting sphere,
   *   F(phase) = (pi - phase) cos(phase) + sin(phase),
   * normalised to 1 at 90 deg: pi (1.24 mag brighter) face-on to the Sun, falling
   * to nothing as the object comes between observer and Sun.
   *
   * The standard magnitude is the weak term. A TLE carries no size, and this
   * catalogue carries nothing else, so an object gets 5.0 - an intact satellite
   * a few metres across - unless it is one of the few whose figure is published
   * and watched enough to be worth looking up. The assumption is printed beside
   * the estimate, because it is often wrong by several magnitudes: a CubeSat is
   * that much fainter, a binocular object at best, and a large platform that much
   * brighter. What the estimate does get right is the range and phase
   * dependence, which is what separates a LEO pass at dusk from a GEO slot at
   * midnight. +6 is the eye's limit under a genuinely dark sky; from a city, or
   * in twilight, it is two or three magnitudes brighter, so "yes" is the best
   * case and the number is printed beside it for a reader to hold against their
   * own sky.                                                                   */
  const STD_MAG = 5.0;
  const NAKED_EYE_MAG = 6;
  /* The looked-up few: Heavens-Above's published "intrinsic brightness", which
     is quoted in exactly this convention (1,000 km, 50% illuminated), read
     2026-09. Keyed by the NORAD number Heavens-Above lists each under. Without
     them the uniform 5.0 called the ISS too faint on a low pass at 1,800 km,
     where it is still around magnitude 0. */
  const STD_MAG_KNOWN = {
    '25544': -1.8,                               // ISS (ZARYA)
    '20580':  2.2,                               // HST
    '48274':  0.0                                // CSS (TIANHE-1)
  };
  /* A station is not one catalogue entry. Every module and every visiting
     vehicle keeps its own NORAD number, and while it is attached 18 SDS
     publishes it on the station's own element set: in this catalogue ISS
     (NAUKA), POISK, CREW DRAGON 12, CYGNUS NG-24 and PROGRESS-MS 34 fly the ISS
     set, and CSS (WENTIAN), CSS (MENGTIAN), SHENZHOU-23 and TIANZHOU-10 fly
     Tianhe's. In the sky each group is one object, so each member takes the
     station's figure. Looked up by number, all but the two CSS modules listed
     beside Tianhe got 5.0, and ISS (NAUKA) - the entry a search for "ISS"
     loads - read "too faint", mag 6.2, on the pass where ISS (ZARYA) read "yes"
     at -0.5.

     So the figure goes by element set. The same set is the same epoch and the
     same six elements, each to within one in its last printed digit: the copies
     are not byte-identical (POISK and the three vehicles carry the ISS
     eccentricity as 0004952, against ZARYA's 0004953), and the revolution count,
     like the number, is each object's own bookkeeping.

     The test is made twice: on the sets as they stand, and on the embedded
     snapshot, where every set was fetched together. The second is what survives
     a live refresh, which replaces the set of the entry on screen and no other:
     CREW DRAGON 12 refreshed to this week's set no longer matches the ISS's
     snapshot copy - not because it has left, but because the two sets are of
     different days. The price is that a vehicle which has undocked since the
     snapshot still takes the station's figure. Telling a departure from a
     refresh would take a current copy of the station's set as well, and the
     page fetches only the entry on screen; the source printed beside the
     estimate names the station, so the assumption is at least in view. */
  const tleDigits = (l, i, j) => +l.substring(i, j).replace('.', '');  // in units of the last digit
  function sameElementSet(a, b){
    if(!a.l1 || !b.l1 || a.l1.substring(18, 32) !== b.l1.substring(18, 32)) return false;  // epoch
    // inclination, RAAN, eccentricity, argument of perigee, mean anomaly, mean motion
    return [[8, 16], [17, 25], [26, 33], [34, 42], [43, 51], [52, 63]]
      .every(([i, j]) => Math.abs(tleDigits(a.l2, i, j) - tleDigits(b.l2, i, j)) <= 1);
  }
  /* The stations whose published figure other entries take. Read from the catalogue source each time they are
     needed, so a live refresh of the station's own set is seen ("the sets as they stand"); the pairing made on the
     embedded snapshot, where every set was fetched together, is made once, here, and keyed by number: the
     catalogue's entries are immutable values now, not objects a refresh updates in place. */
  const HOST_IDS = Object.keys(STD_MAG_KNOWN);
  const hostsNow = () => HOST_IDS.map(id => cat.current(id)).filter(Boolean);
  const embeddedHosts = HOST_IDS.map(id => cat.embedded.find(c => c.satnum === id)).filter(Boolean);
  const DOCKED_AT_SNAPSHOT = new Map();
  for(const c of cat.embedded){
    if(Object.prototype.hasOwnProperty.call(STD_MAG_KNOWN, c.satnum)) continue;
    const h = embeddedHosts.find(h => sameElementSet(c, h));
    if(h) DOCKED_AT_SNAPSHOT.set(c.satnum, h);
  }
  /* `via` names the station whose figure a docked entry has taken, or is null. */
  function stdMagOf(track){
    const e = track.entry || {};
    /* Before the lookups below, all of which match on the element set or the number. A
       planned orbit that happens to equal the ISS's set - a preset, a what-if - would
       otherwise take the ISS's published -1.8 and say it was docked to it. */
    if(e.custom) return { mag: Number.isFinite(e.stdMag) ? e.stdMag : STD_MAG, known: false, via: null };
    if(Object.prototype.hasOwnProperty.call(STD_MAG_KNOWN, e.satnum))
      return { mag: STD_MAG_KNOWN[e.satnum], known: true, via: null };
    const h = hostsNow().find(h => sameElementSet(e, h)) || DOCKED_AT_SNAPSHOT.get(e.satnum);
    return h ? { mag: STD_MAG_KNOWN[h.satnum], known: true, via: h.name }
             : { mag: STD_MAG, known: false, via: null };
  }
  function estMagnitude(rngKm, phase, stdMag){
    const f = (Math.PI - phase)*Math.cos(phase) + Math.sin(phase);
    // f reaches 0 only with the unlit face turned squarely to the observer
    return f > 0 ? stdMag + 5*Math.log10(rngKm/1000) - 2.5*Math.log10(f) : Infinity;
  }
  /* Range and phase angle - the angle at the spacecraft between the observer and
     the Sun. Taken in the body-fixed frame, where the site is a constant vector:
     the Sun goes through the same rotation as the spacecraft (a rotation is
     linear, so its position rotates like any other), and the range is then the
     same subtraction ecfToLookAngles does. The Sun is placed at its own distance
     rather than at infinity: it costs nothing, and at the 124,000 km this
     catalogue reaches the difference is already 0.05 deg. */
  function viewGeometry(track, s){
    const b = track.body;
    if(!b.siteFixed) return null;                  // a body with no surface sites
    const rf = b.toFixed(s.r, s.theta), sf = b.siteFixed(OBS);
    const S = sunEci(s.t), k = S.distKm;
    const sun = b.toFixed({ x: S.x*k, y: S.y*k, z: S.z*k }, s.theta);
    const ox = sf.x - rf.x, oy = sf.y - rf.y, oz = sf.z - rf.z;   // to the observer
    const qx = sun.x - rf.x, qy = sun.y - rf.y, qz = sun.z - rf.z; // to the Sun
    const rng = Math.hypot(ox, oy, oz);
    const c = (ox*qx + oy*qy + oz*qz)/(rng*Math.hypot(qx, qy, qz));
    return { rng, phase: Math.acos(Math.max(-1, Math.min(1, c))) };
  }
  /* `visible` is the naked-eye test in full: fully sunlit, dark sky, and bright
     enough. Penumbra is left out of it deliberately - the object is dimmed there
     by an amount this does not model, so its estimate is only a ceiling - and is
     reported on its own instead. The magnitude is given wherever any sunlight
     reaches the spacecraft, penumbra included, undimmed. */
  function opticalAt(track, ms){
    const s = fix(track, ms);
    if(!s) return null;
    const lit = sunlitState(s.r, s.t);
    const sunEl = sunElevation(OBS, s.t);
    const dark = sunEl < DARK_SUN_EL;
    const g = lit === 'umbra' ? null : viewGeometry(track, s);
    const mag = g ? estMagnitude(g.rng, g.phase, stdMagOf(track).mag) : null;
    return { lit, sunEl, dark, rng: g ? g.rng : null, phase: g ? g.phase : null, mag,
             visible: lit === 'sun' && dark && mag !== null && mag <= NAKED_EYE_MAG };
  }
  /* Scan the pass rather than testing one instant: a pass can begin in shadow and
     climb into sunlight, which is exactly the terminator-crossing case worth
     catching. 60 samples puts the resolution near 7 s on a typical LEO pass.

     The verdict, `eye`, is one of four, in this order:
       'yes'            fully sunlit against a dark sky at +6 or brighter
       'penumbra only'  bright enough only while partly shadowed, by an amount
                        not modelled - so possibly, and not promised
       'too faint'      lit against a dark sky, and fainter than +6 throughout
       'radio only'     never lit while the site is dark
     `peak` is the brightest estimate behind it: among the fully sunlit samples
     for a yes, otherwise the brightest lit-against-dark sample of either kind;
     `std` is the standard magnitude it was scaled from, and where that came from. */
  function passOptical(track, p){
    const t0 = p.aos.getTime(), t1 = p.los.getTime();
    let lit = 0, dark = 0, both = 0, geo = 0, pen = 0, n = 0, first = null, last = null;
    let bestSun = null, bestPen = null;
    for(let k = 0; k <= 60; k++){
      const ms = t0 + (t1-t0)*k/60;
      const o = opticalAt(track, ms);
      if(!o) continue;
      n++;
      if(o.lit !== 'umbra') lit++;
      if(o.dark) dark++;
      if(o.dark && o.lit !== 'umbra'){
        const pn = o.lit === 'penumbra';
        if(pn) pen++; else geo++;
        const best = pn ? bestPen : bestSun;
        if(Number.isFinite(o.mag) && (!best || o.mag < best.mag)){
          const b = { mag: o.mag, rng: o.rng, phase: o.phase, ms, pen: pn };
          if(pn) bestPen = b; else bestSun = b;
        }
      }
      if(o.visible){ both++; if(first === null) first = ms; last = ms; }
    }
    if(!n) return null;
    const mid = opticalAt(track, (t0+t1)/2);
    const eye = both ? 'yes'
      : bestPen && bestPen.mag <= NAKED_EYE_MAG ? 'penumbra only'
      : geo || pen ? 'too faint'
      : 'radio only';
    const peak = both ? bestSun
      : bestSun && bestPen ? (bestPen.mag < bestSun.mag ? bestPen : bestSun)
      : bestSun || bestPen;
    return { n, lit, dark, both, geo, pen, first, last, eye, peak, std: stdMagOf(track),
             frac: both/n, penFrac: pen/n,
             sunEl: mid ? mid.sunEl : null, litAtMid: mid ? mid.lit : null };
  }

  return { sunlitState, stdMagOf, estMagnitude, viewGeometry, opticalAt, passOptical, sameElementSet,
           STD_MAG, NAKED_EYE_MAG, DARK_SUN_EL, SUN_RADIUS_KM, STD_MAG_KNOWN };
}
