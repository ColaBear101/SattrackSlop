// @ts-nocheck - moved verbatim; see the note below
/* PORTED VERBATIM from legacy/earth/lifetime.js (main@4eadd7a), lines 35-376 of that file.
 * The only changes: the IIFE wrapper and 'use strict' are gone (an ES module is already strict and scoped),
 * the export is `export const Lifetime` instead of `global.Lifetime = `.
 * Arithmetic, order and comments are untouched; the Node suites that guard this module run against both the
 * old file and the bundle of this one (verification/lib/harness.js, GT_TARGET).
 * One later move (M3): readPlot, parsePlot, SMA_MIN and SMA_MAX (old lines 287-316) now live in shared/plot.ts, imported below, so the API and the browser share one parser.
 */
import { parsePlot, readPlot, SMA_MIN, SMA_MAX } from '../../../shared/plot';

/* lifetime.js — orbital decay and remaining-life estimate from an SMA history.
 *
 * CelesTrak publishes, per object, the run of mean elements taken from every
 * element set it has held: graph-orbit-data.php?CATNR=<id>. The "SMA" column is
 * the mean altitude a - Re in km. That history IS the decay curve, so the job
 * is to work out where it is heading.
 *
 * The method, and why it is this and not a trend line:
 *
 *   A straight line through the observed drop always over-estimates the
 *   remaining life, because decay accelerates: the object falls into denser
 *   air, so it falls faster. For a near-circular orbit
 *
 *       da/dt = -rho(h) * B * sqrt(mu*a),     B = Cd*A/m
 *
 *   The SHAPE of rho(h) comes from the standard piecewise-exponential
 *   atmosphere; the AMPLITUDE and the unknown ballistic coefficient are
 *   calibrated from the object's own recent history. Only the RATIO
 *   rho(h)/rho(h_now) is taken from the model, and that ratio is far better
 *   known than absolute density — which is just as well, since density at
 *   400 km swings by an order of magnitude over a solar cycle.
 *
 *   Note this makes the absolute density scale IRRELEVANT: multiply rho by k
 *   and the calibration divides B by k, leaving the forecast unchanged. Any
 *   "uncertainty band" built by scaling density is therefore exactly zero wide.
 *   The real uncertainty is in the SHAPE of rho(h) and in future solar activity,
 *   which is why the band below comes from backtesting, not from a guess.
 *
 * Validated against objects that actually re-entered, with dates from the
 * CelesTrak SATCAT: history truncated at a fixed lead time, prediction compared
 * with what really happened. See README for the error table.
 */

const RE = 6378.137, MU = 398600.4418, DAY = 86400, DAYMS = 86400000;

/* US Standard 1976 + CIRA-72 piecewise exponential (Vallado Table 8-4):
   base altitude km, density kg/m^3, scale height km */
const ATM = [[0,1.225,7.249],[25,3.899e-2,6.349],[30,1.774e-2,6.682],[40,3.972e-3,7.554],
  [50,1.057e-3,8.382],[60,3.206e-4,7.714],[70,8.770e-5,6.549],[80,1.905e-5,5.799],
  [90,3.396e-6,5.382],[100,5.297e-7,5.877],[110,9.661e-8,7.263],[120,2.438e-8,9.473],
  [130,8.484e-9,12.636],[140,3.845e-9,16.149],[150,2.070e-9,22.523],[180,5.464e-10,29.740],
  [200,2.789e-10,37.105],[250,7.248e-11,45.546],[300,2.418e-11,53.628],[350,9.518e-12,53.298],
  [400,3.725e-12,58.515],[450,1.585e-12,60.828],[500,6.967e-13,63.822],[600,1.454e-13,71.835],
  [700,3.614e-14,88.667],[800,1.170e-14,124.64],[900,5.245e-15,181.05],[1000,3.019e-15,268.00]];

function rho(h){
  if(h > 1000) h = 1000; if(h < 0) h = 0;
  let i = 0; while(i < ATM.length-1 && ATM[i+1][0] <= h) i++;
  return ATM[i][1] * Math.exp(-(h - ATM[i][0]) / ATM[i][2]);
}
const FLOOR = 120;   // km. Below this, re-entry is hours away, not days, so the
                     // exact threshold barely moves the answer: 100 km and
                     // 150 km differ by 0.16 d on a 170 d forecast.

/* Time to fall from a0 to the floor, marching in ALTITUDE rather than time.
   Time-stepping is stiff — the last 40 km go by at hundreds of km/day, and a
   fixed step overshoots the surface — while altitude-marching is
   unconditionally stable and lands exactly on the floor. */
function integrate(a0, B, floorKm, sample){
  const dh = 0.05;
  let a = a0, t = 0, guard = 0, mark = a0 - RE;
  const track = sample ? [{t:0, h:a0-RE}] : null;
  while(a - RE > floorKm){
    const step = Math.min(dh, a - RE - floorKm);
    /* Stop once the gap is under the ULP of a (~1e-12 km at LEO radius):
       a -= step would be absorbed and the loop would never terminate. */
    if(step < 1e-6 || ++guard > 2e7) break;
    const am = a - step/2;
    const r = rho(am - RE) * B * Math.sqrt(MU*am) * DAY;     // km/day, positive
    if(!(r > 0) || !isFinite(r)) return {days:null, track};
    t += step / r; a -= step;
    if(t > 40000) return {days:null, track};
    if(track && mark - (a-RE) >= 4){ mark = a - RE; track.push({t, h:mark}); }
  }
  if(track) track.push({t, h:a-RE});
  return {days:t, track};
}

/* Same, with a log-linear density trend standing in for the solar cycle:
   rho_eff(h,t) = rho(h)*exp(g*t). g < 0 is a thinning atmosphere. This one needs
   real time steps, so the step is capped to a small altitude change to stay
   stable through the endgame. */
function marchT(a0, B, g, floorKm, tMax, sample){
  let a = a0, t = 0, n = 0;
  const track = sample ? [{t:0, h:a0-RE}] : null;
  const rate = (x, tt) => rho(x-RE) * Math.exp(g*tt) * B * Math.sqrt(MU*x) * DAY;
  while(t < tMax && a - RE > floorKm){
    const r0 = rate(a, t);
    if(!(r0 > 0) || !isFinite(r0)) return {days:null, track, a};
    const dt = Math.min(1, 0.5/r0, tMax - t);
    if(dt <= 1e-9 || ++n > 2e6) break;
    const k1 = rate(a, t),
          k2 = rate(a - dt*k1/2, t + dt/2),
          k3 = rate(a - dt*k2/2, t + dt/2),
          k4 = rate(a - dt*k3,   t + dt);
    a -= dt/6*(k1 + 2*k2 + 2*k3 + k4); t += dt;
    if(track && track[track.length-1].h - (a-RE) >= 4) track.push({t, h:a-RE});
  }
  if(track) track.push({t, h:a-RE});
  return {days: (a - RE <= floorKm) ? t : null, track, a};
}

const med = arr => { const s = arr.slice().sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };

/* Calibrate B so the model reproduces the observed drop over the window EXACTLY.
   Time is inversely proportional to B, so one integration at B = 1 and a divide
   does it — no linearisation, and the window's own curvature is respected. The
   older trick of pinning a straight-line rate to the window's MEAN altitude is
   fine while the curve is flat and wrong once it steepens, which is exactly when
   the answer matters: on the validation set it cut the 30-day-out mean error
   from 108 d to 3 d. */
function calibrate(P, winDays){
  const tEnd = P[P.length-1].t;
  const W = P.filter(p => p.t >= tEnd - winDays*DAYMS);
  if(W.length < 8) return null;
  const k = Math.max(2, Math.floor(W.length/5));
  const h1 = med(W.slice(0,k).map(p=>p.sma)), h2 = med(W.slice(-k).map(p=>p.sma));
  const t1 = med(W.slice(0,k).map(p=>p.t)),  t2 = med(W.slice(-k).map(p=>p.t));
  const dt = (t2-t1)/DAYMS;
  if(!(dt > 5) || !(h1 - h2 > 0)) return null;
  const unit = integrate(RE+h1, 1, h2, false);
  if(unit.days === null) return null;
  return {B: unit.days/dt, rate: -(h1-h2)/dt, h1, h2, dt};
}

/* Two-parameter fit — ballistic coefficient B and a density trend g. Far from
   re-entry the solar cycle is the dominant error, and reading it off the
   object's own record beats assuming the atmosphere stands still: across the
   validation set this moved the 180-day-out median error from -53 d to -9 d. */
function fitTrend(P, winDays){
  const tEnd = P[P.length-1].t;
  const W = P.filter(p => p.t >= tEnd - winDays*DAYMS);
  if(W.length < 30) return null;
  const t0 = W[0].t, obs = W.map(p => ({x:(p.t-t0)/DAYMS, h:p.sma}));
  const T = obs[obs.length-1].x;
  if(T < 60) return null;
  const k = Math.max(3, Math.floor(W.length/8));
  const h1 = med(W.slice(0,k).map(p=>p.sma)), h2 = med(W.slice(-k).map(p=>p.sma));
  if(!(h1 - h2 > 1)) return null;
  const solveB = g => {                     // B reproducing the window's drop
    let lo = 1e-6, hi = 1e6;
    for(let i=0;i<50;i++){
      const mid = Math.sqrt(lo*hi);
      const r = marchT(RE+h1, mid, g, -1e9, T, false);
      if(h1 - (r.a - RE) > h1 - h2) hi = mid; else lo = mid;
    }
    return Math.sqrt(lo*hi);
  };
  let best = null;
  for(let g = -0.008; g <= 0.00401; g += 0.0004){
    const B = solveB(g);
    const r = marchT(RE+h1, B, g, -1e9, T, true);
    if(!r.track || r.track.length < 3) continue;
    let ss = 0, i = 0;
    for(const o of obs){
      while(i > 0 && r.track[i].t > o.x) i--;
      while(i < r.track.length-1 && r.track[i].t < o.x) i++;
      ss += (r.track[i].h - o.h)*(r.track[i].h - o.h);
    }
    if(!best || ss < best.ss) best = {g, B, ss, T, n: obs.length};
  }
  if(best) best.rms = Math.sqrt(best.ss/obs.length);
  return best;
}

/* Did somebody raise this orbit? A boosted object is not drag-limited and a
   re-entry date for it is fiction — PROGRESS-MS 33 climbed 271 -> 420 km before
   its deorbit burn. Look for a sustained rise, not single-point TLE scatter. */
function boosted(P){
  let worst = 0;
  for(let i=0;i<P.length;i++)
    for(let j=i+1;j<P.length && P[j].t - P[i].t < 12*DAYMS; j++)
      if(P[j].sma - P[i].sma > worst) worst = P[j].sma - P[i].sma;
  return worst;
}

/* How eccentric an orbit the model above will speak for. It applies drag at the
   MEAN altitude, which is where a near-circular orbit spends its time. An
   eccentric one loses its energy near perigee instead, a*e below the mean: at
   e = 0.02 that is about 135 km down in low orbit, two to three scale heights,
   where the air is ten to twenty times denser. The calibration would then fit
   the right drop to the wrong height, and the endgame would run on air the
   object never meets.

   How such an orbit comes down depends on how far out it reaches, and neither
   way is modelled here: an eccentric history is refused rather than forecast.
   This was not being checked: eccentricity was read with every row and never
   used, and ION SCV-016 (e 0.057, perigee 303 km, mean altitude 711 km) got a
   circular-orbit date. Every near-circular case is untouched - KNACKSAT-2 sits
   at e 0.0008.

   The test is the median over the 45 days calibrate() looks at first, so one
   bad element set cannot flip the verdict either way. It is returned as
   eccMed, since the page has to quote the number it refused on: the latest
   set of an orbit rounding out can already be under the cap. Rows with no
   eccentricity are left out; a history with none at all is taken as circular,
   as it always was.

   With a low apogee, drag is what shapes the orbit: it comes down apogee
   first, perigee holding nearly still until the orbit is close to circular,
   and forecasting that means integrating on perigee height. ION SCV-016, OV3-3
   and SLS DEB, apogees 1,100 to 2,800 km, each kept perigee within 3 km over
   their last 180 days while apogee fell by 30 to 250 km. With a high apogee
   that is not so. The Moon and the Sun pull on the orbit harder the larger it
   is, while the J2 precession of perigee that averages their pull away slows,
   so the swing they give perigee grows about as the sixth power of the
   semi-major axis - CLUSTER II-FM8's fell 1,340 km in its last 180 days, to
   below the surface - and it is usually they that bring a dead high orbit
   down, by lowering perigee into the air. HA_DRAG is the apogee where the
   page stops saying the first and says the second. Below 5,000 km the swing
   is a few km or less, except near the critical inclination of 63.4 degrees,
   where perigee stands still and their pull accumulates; the page's wording
   for the high side claims only that they move perigee as well, which holds
   anywhere above it.

   The perigee reported is the latest, not that median: the Moon and the Sun
   walk a high eccentric perigee by hundreds of kilometres in a few weeks -
   CLUSTER II-FM8's 45-day median put it 46 km up, its last element set
   143 km underground. So it is the middle of the last five sets, by perigee
   height, with that set's eccentricity and apogee beside it.               */
const ECC_MAX = 0.02, HA_DRAG = 5000;
function eccNow(P, winDays){
  const tEnd = P[P.length-1].t;
  const e = P.filter(p => p.t >= tEnd - winDays*DAYMS && isFinite(p.ecc)).map(p => p.ecc);
  return e.length ? med(e) : null;
}
function perigeeNow(P){
  const s = P.filter(p => isFinite(p.ecc)).slice(-5).map(p => {
    const a = RE + p.sma;
    return {ecc:p.ecc, hp:a*(1-p.ecc) - RE, ha:a*(1+p.ecc) - RE};
  }).sort((x,y) => x.hp - y.hp);
  return s[Math.floor(s.length/2)];
}

function predict(P){
  if(!P || P.length < 25) return {verdict:'thin', n: P ? P.length : 0};
  const span = (P[P.length-1].t - P[0].t)/DAYMS;
  if(span < 45) return {verdict:'thin', n:P.length, span};
  const hNow = P[P.length-1].sma, tNow = P[P.length-1].t;
  const ecc = eccNow(P, 45);
  /* Ahead of the boost and decay tests, which read the mean altitude as if it
     were the height drag acts at. rate is left out: a mean-altitude slope is
     not a decay rate for this orbit, and the page would print it as one. */
  if(ecc !== null && ecc > ECC_MAX){
    const pg = perigeeNow(P);
    return {verdict:'eccentric', hNow, tNow, span, n:P.length, rate:null,
            ecc:pg.ecc, eccMed:ecc, hp:pg.hp, ha:pg.ha};
  }
  const rise = boosted(P);
  const c45 = calibrate(P, 45) || calibrate(P, 90);
  const rate = c45 ? c45.rate : 0;

  if(!c45 || rate > -0.002)
    return {verdict: rise > 3 ? 'maneuvered' : 'stable',
            hNow, tNow, span, n:P.length, rate, rise};

  const simple = integrate(RE+hNow, c45.B, FLOOR, true);
  let trend = null, tf = null;
  if(span >= 150){
    tf = fitTrend(P, Math.min(220, span));
    if(tf){
      const r = marchT(RE+hNow, tf.B*Math.exp(tf.g*tf.T), tf.g, FLOOR, 6000, true);
      if(r.days !== null) trend = {days:r.days, track:r.track};
    }
  }
  /* Headline the trend model when there is enough history to fit it: it was
     measurably better at the horizons where a forecast is genuinely uncertain.
     Close in, the two converge anyway. */
  const primary = trend || (simple.days !== null ? simple : null);
  return {verdict: primary ? 'decaying' : 'slow',
          hNow, tNow, span, n:P.length, rate, rise,
          simple: simple.days, simpleTrack: simple.track,
          trend: trend ? trend.days : null, trendTrack: trend ? trend.track : null,
          g: tf ? tf.g : null, rms: tf ? tf.rms : null,
          days: primary ? primary.days : null,
          track: primary ? primary.track : null};
}

/* ---- data ---------------------------------------------------------------- */
/* SMA_MIN, SMA_MAX, readPlot and parsePlot - the reading of CelesTrak's history page, with the comments
   that explain the bounds - now live in shared/plot.ts, so the API server and this module read the page
   with one implementation. They are the same code, imported here; `Lifetime` exposes them as before. */

const HIST_TTL = 12*3600*1000;

/* Measured: this endpoint can take over a MINUTE to answer — CelesTrak rebuilds
   the run of element sets from its archive on every call. It was about 35 s
   when first timed; on 25 Sep 2026 the ISS and KNACKSAT-2 took 25 s and more
   than 90 s, and two days later 24 s and 2 s. Three
   consequences, all of them design constraints rather than details:
     - the timeout has to be generous, or slow requests are killed in flight;
     - concurrent calls for the same object must share one request, or a couple
       of clicks queue several minute-long fetches;
     - it must never fire on its own for every spacecraft a user clicks through.
   Hence cached() below, and a button in the page for the uncached case.

   history() answers {P, why}: P the run of element sets, or null with why
   saying which way there is none - 'timeout' (no answer inside 75 s),
   'unreachable' (the request itself failed: offline, blocked, refused),
   'http' (an error status, in status), 'unreadable' (an answer with no history
   in it that this can find), 'empty' (a history with no rows) or 'outside'
   (rows, every one outside SMA_MIN..SMA_MAX, counted in rows). It used to
   answer P or null, and the page said "no history, or it could not be reached"
   for all six. */
function cached(satnum){
  try {
    const c = JSON.parse(localStorage.getItem('hist:'+satnum) || 'null');
    if(c && c.P && c.P.length && (Date.now()-c.at) < HIST_TTL) return c.P;
  } catch(e){}
  return null;
}
const inflight = {};
async function history(satnum){
  const hit = cached(satnum);
  if(hit) return {P:hit, why:null};
  if(inflight[satnum]) return inflight[satnum];       // share one request
  const p = fetchHistory(satnum).finally(()=>{ delete inflight[satnum]; });
  inflight[satnum] = p;
  return p;
}
async function fetchHistory(satnum){
  const key = 'hist:'+satnum;
  const ctl = new AbortController();
  const bail = setTimeout(()=>ctl.abort(), 75000);
  try {
    const r = await fetch('https://celestrak.org/NORAD/elements/graph-orbit-data.php?CATNR='
                          + satnum, {signal: ctl.signal});
    clearTimeout(bail);
    if(!r.ok) return {P:null, why:'http', status:r.status};
    const got = readPlot(await r.text()), P = got.P;
    if(!P) return {P:null, why: !got.found ? 'unreadable' : got.rows ? 'outside' : 'empty',
                   rows:got.rows};
    /* Keep the cache small — some objects carry 3700 points and localStorage
       is a per-origin budget. Thin the old end, keep the recent end intact,
       since that is what the fit actually uses. */
    const keep = P.length > 700
      ? P.filter((_,i) => i % Math.ceil(P.length/500) === 0 || i >= P.length-250)
      : P;
    try { localStorage.setItem(key, JSON.stringify({at:Date.now(), P:keep})); } catch(e){}
    return {P, why:null};
  } catch(e){
    clearTimeout(bail);
    return {P:null, why: ctl.signal.aborted ? 'timeout' : 'unreachable'};
  }
}

export const Lifetime = {rho, integrate, marchT, calibrate, fitTrend, predict, parsePlot, readPlot,
                   history, cached, boosted, RE, MU, FLOOR, ECC_MAX, HA_DRAG, SMA_MIN, SMA_MAX};
