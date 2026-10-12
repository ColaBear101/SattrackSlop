// Propagation + Bangkok access, shared by the node check and the page.
// `satellite` = satellite.js UMD global (or require()d in node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./satellite.min.js'));
  else root.GT = factory(root.satellite);
}(typeof self !== 'undefined' ? self : this, function (satellite) {
  const DEG = 180 / Math.PI, RAD = Math.PI / 180;

  const BANGKOK = { lat: 13.75, lon: 100.52, altKm: 0.0 };
  const MASK_DEG = 5;

  // Elevation of the satellite above the observer's local horizon, degrees.
  function lookAngles(satrec, date, obs) {
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position) return null;
    const gmst = satellite.gstime(date);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const la = satellite.ecfToLookAngles(
      { longitude: obs.lon * RAD, latitude: obs.lat * RAD, height: obs.altKm }, ecf);
    return { el: la.elevation * DEG, az: la.azimuth * DEG, range: la.rangeSat };
  }

  function subpoint(satrec, date) {
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position) return null;
    const gd = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
    let lon = gd.longitude * DEG;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return { lat: gd.latitude * DEG, lon, altKm: gd.height };
  }

  // Ground track over `hours` from `start`, sampled every `stepS` seconds.
  function groundTrack(satrec, start, hours, stepS, obs, mask) {
    const pts = [];
    const n = Math.round(hours * 3600 / stepS);
    for (let k = 0; k <= n; k++) {
      const t = new Date(start.getTime() + k * stepS * 1000);
      const sp = subpoint(satrec, t);
      if (!sp) continue;
      const la = obs ? lookAngles(satrec, t, obs) : null;
      pts.push({ t, lat: sp.lat, lon: sp.lon, altKm: sp.altKm,
                 el: la ? la.el : null, az: la ? la.az : null, range: la ? la.range : null,
                 vis: la ? la.el >= mask : false });
    }
    return pts;
  }

  // Access windows above `mask` deg. Coarse scan + bisection on the horizon crossing.
  function findPasses(satrec, start, hours, obs, mask, coarseS) {
    coarseS = coarseS || 10;
    const f = (ms) => {
      const la = lookAngles(satrec, new Date(ms), obs);
      return la ? la.el - mask : -90;
    };
    const t0 = start.getTime(), t1 = t0 + hours * 3600 * 1000, step = coarseS * 1000;
    // bisect to 1 ms on a bracketed sign change
    const bisect = (lo, hi) => {
      let flo = f(lo);
      for (let i = 0; i < 40 && hi - lo > 1; i++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; } else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const passes = [];
    let prevT = t0, prevF = f(t0), open = prevF >= 0 ? t0 : null; // already up at epoch?
    for (let t = t0 + step; t <= t1; t += step) {
      const cur = f(t);
      if (prevF < 0 && cur >= 0) open = bisect(prevT, t);
      else if (prevF >= 0 && cur < 0 && open !== null) {
        passes.push(makePass(satrec, open, bisect(prevT, t), obs, t0, t1));
        open = null;
      }
      prevT = t; prevF = cur;
    }
    if (open !== null) passes.push(makePass(satrec, open, t1, obs, t0, t1, true)); // clipped by window end
    return passes;
  }

  function makePass(satrec, aosMs, losMs, obs, t0, t1, clipped) {
    // golden-section-free max: sample the window densely, then refine around the best
    let best = { el: -90, ms: aosMs };
    const n = 120;
    for (let i = 0; i <= n; i++) {
      const ms = aosMs + (losMs - aosMs) * i / n;
      const la = lookAngles(satrec, new Date(ms), obs);
      if (la && la.el > best.el) best = { el: la.el, ms, az: la.az, range: la.range };
    }
    const w = (losMs - aosMs) / n;
    for (let i = 0; i < 30; i++) {   // ternary refine
      const a = best.ms - w / (i + 2), b = best.ms + w / (i + 2);
      const la = lookAngles(satrec, new Date(a), obs), lb = lookAngles(satrec, new Date(b), obs);
      if (la && la.el > best.el) best = { el: la.el, ms: a, az: la.az, range: la.range };
      if (lb && lb.el > best.el) best = { el: lb.el, ms: b, az: lb.az, range: lb.range };
    }
    const aosLA = lookAngles(satrec, new Date(aosMs), obs);
    const losLA = lookAngles(satrec, new Date(losMs), obs);
    return {
      aos: new Date(aosMs), los: new Date(losMs), durationS: (losMs - aosMs) / 1000,
      maxEl: best.el, maxElAt: new Date(best.ms), maxElAz: best.az, minRange: best.range,
      aosAz: aosLA ? aosLA.az : null, losAz: losLA ? losLA.az : null,
      startFrac: (aosMs - t0) / (t1 - t0), endFrac: (losMs - t0) / (t1 - t0),
      clipped: !!clipped
    };
  }

  return { BANGKOK, MASK_DEG, lookAngles, subpoint, groundTrack, findPasses, DEG, RAD };
}));
