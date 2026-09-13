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
(function(global){
'use strict';

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

function predict(P){
  if(!P || P.length < 25) return {verdict:'thin', n: P ? P.length : 0};
  const span = (P[P.length-1].t - P[0].t)/DAYMS;
  if(span < 45) return {verdict:'thin', n:P.length, span};
  const hNow = P[P.length-1].sma, tNow = P[P.length-1].t;
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
function parsePlot(txt){
  const m = txt.match(/var plotData = "([^"]*)"/);
  if(!m) return null;
  const rows = m[1].split('|'); rows.shift();          // header line
  const P = [];
  for(const r of rows){
    const f = r.split(',');
    if(f.length < 6) continue;
    const t = Date.parse(f[0] + 'Z'), sma = parseFloat(f[4]);
    if(isFinite(t) && isFinite(sma) && sma > 80 && sma < 60000)
      P.push({t, sma, ecc: parseFloat(f[5])});
  }
  P.sort((a,b)=>a.t-b.t);
  return P.length ? P : null;
}

const HIST_TTL = 12*3600*1000;

/* Measured: this endpoint takes about 35 SECONDS to answer — CelesTrak rebuilds
   the run of element sets from its archive on every call. Three consequences,
   all of them design constraints rather than details:
     - the timeout has to be generous, or every request is killed in flight;
     - concurrent calls for the same object must share one request, or a couple
       of clicks queue several half-minute fetches;
     - it must never fire on its own for every spacecraft a user clicks through.
   Hence cached() below, and a button in the page for the uncached case. */
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
  if(hit) return hit;
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
    if(!r.ok) return null;
    const P = parsePlot(await r.text());
    if(P){
      /* Keep the cache small — some objects carry 3700 points and localStorage
         is a per-origin budget. Thin the old end, keep the recent end intact,
         since that is what the fit actually uses. */
      const keep = P.length > 700
        ? P.filter((_,i) => i % Math.ceil(P.length/500) === 0 || i >= P.length-250)
        : P;
      try { localStorage.setItem(key, JSON.stringify({at:Date.now(), P:keep})); } catch(e){}
    }
    return P;
  } catch(e){ clearTimeout(bail); return null; }
}

global.Lifetime = {rho, integrate, marchT, calibrate, fitTrend, predict, parsePlot,
                   history, cached, boosted, RE, MU, FLOOR};
})(typeof window !== 'undefined' ? window : globalThis);
