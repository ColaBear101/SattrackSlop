/*
 * The Professor's words, checked as data: earth/advisor-copy.js.
 *
 * The Professor says 87 things about an orbit, each one a record of conditions,
 * a title, a body and perhaps a button. None of it can be tested by looking at
 * the page, because the page only shows the few records that fire for the orbit
 * on screen. So this file takes the catalogue apart, and checks what a reader
 * would only meet by accident:
 *
 *  - the shape: exactly 87 records, 67 advisory and 20 input, unique ids, in the
 *    order the verdict line depends on, each with the group, severity, flags,
 *    glossary term and buttons the design table gives it. A removed or reordered
 *    record, a Check that became a Problem, a button that lost its payload fails
 *    here by name;
 *  - the contract with advisor.js: every {placeholder} in every title, body and
 *    button, every key a `when` or a button reads, and every '{key}' a button
 *    writes names a key of the context dictionary (KEYS below, the list advisor.js
 *    is built against), uses a format that exists, and a bold figure is only ever
 *    a number worked out from the elements. A template that asks for a key nobody
 *    supplies renders as an error on the screen; here it fails before that;
 *  - the voice: titles at most 48 characters, bodies at most 70 words, no sentence
 *    over 32 words, none of the banned words, no contraction, no exclamation mark,
 *    no emoji, and nothing that names the speaker or says "I" or "we". It is
 *    checked three ways: on the templates at the worst case of every placeholder
 *    (a lifetime or a clock time is four words, "more than a century"), on every
 *    item rendered against a dictionary that supplies every key, and on every item
 *    that fires for orbits of each kind (SSO, GEO, Molniya, decaying, deep space...);
 *  - the machinery: the formats, the throw on a figure that is missing or not a
 *    finite number (a sentence must never read "NaN km"), the parts that become
 *    bold figures, what a button does when its key is undefined (it is absent; the
 *    item is not), what happens when a `when`, a title or a button throws, the
 *    order, the counts, the verdict, the severity that depends on a number, and
 *    that the same dictionary gives the same list;
 *  - the module is what it claims to be: pure data and formatters, loading in Node
 *    (and in a context with no Planner, no Advisor and no window) with nothing
 *    else present, and the speaker named in exactly one place.
 *
 * What this file does not do is run the real kernels: it builds its dictionaries
 * with a small closed-form generator written here (first-order J2, a table for
 * the atmosphere), which is plausible, not exact. The half that needs the real
 * advisor.js (every item firing in a real scenario, the eleven presets, seeded
 * forms) is verify-advisor.js, which calls run() with `extra.context` to put the
 * real dictionary in place of the generated one:
 *
 *     run(chk, { context: (form, env) => Advisor.context(Planner.fromForm(form).el, env) })
 *
 * Run alone:  node verification/advisor-copy-checks.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MODULE_PATH = path.join(__dirname, '..', 'earth', 'advisor-copy.js');
require(MODULE_PATH);

/* ---------------------------------------------------------------- what the design table says
   id -> 'group severity flags term buttons'. Flags: D draft only, T tracked only, M needs the
   page's own pass finder (a letter pair is both), - none. Buttons: the form keys each button
   writes, one group per button, ';' between buttons. Severity 'fn' is a function of the numbers.
   This is the design's own table typed again (nothing here is read from the module), in the
   order the module must list them in. */
const EXPECT = {
  'kind.geo': 'type good - t-geo -',
  'kind.gso': 'type info - t-geo -',
  'kind.gso.ecc': 'type info - - -',
  'kind.geo.drift': 'type warn - t-geo period',
  'kind.tundra': 'type info - t-crit -',
  'kind.molniya': 'type good - t-crit -',
  'kind.heo': 'type info - - -',
  'kind.heo.drift': 'type fn D t-crit inc',
  'kind.sso': 'type good - t-sso -',
  'kind.sso.near': 'type warn - t-sso inc',
  'kind.sso.unreachable': 'type info - t-sso -',
  'kind.iss': 'type info - - -',
  'kind.gnss': 'type info - - -',
  'kind.meo': 'type info - - -',
  'kind.high': 'type info - - -',
  'kind.leo.circ': 'type info - - -',
  'kind.leo.ecc': 'type info - - -',
  'kind.polar': 'type info - - -',
  'kind.equatorial': 'type info - - -',
  'kind.critical': 'type info - t-crit -',
  'kind.retro': 'type info - - -',
  'life.tracked': 'survive info T - -',
  'life.reentry': 'survive bad D t-reentry hp',
  'life.days': 'survive bad D - hp,ha',
  'life.short': 'survive warn D - hp,ha',
  'life.range': 'survive info D - -',
  'life.long': 'survive warn D - hp,ha;hp,ha',
  'life.permanent': 'survive info - - -',
  'life.ecc': 'survive info D - -',
  'life.ecc.high': 'survive info - - -',
  'life.ecc.low': 'survive warn D - hp',
  'rad.saa': 'survive info - t-saa -',
  'rad.inner': 'survive warn - t-belts -',
  'rad.outer': 'survive info - t-belts -',
  'rad.geo': 'survive info - t-belts -',
  'rad.cross': 'survive warn - t-belts -',
  'sun.ltan': 'sun info - t-ltan ltan;ltan;ltan',
  'sun.dawndusk': 'sun good - t-beta ltan',
  'sun.noon': 'sun info - t-beta -',
  'sun.ecl': 'sun info - t-beta -',
  'sun.ecl.season': 'sun info - t-beta -',
  'sun.free': 'sun good - t-beta -',
  'sun.geo': 'sun info - t-beta -',
  'gt.count': 'ground info DM - -',
  'gt.none': 'ground warn M - -',
  'gt.never': 'ground bad - - inc',
  'gt.barely': 'ground warn - - inc',
  'gt.overhead': 'ground info M - -',
  'gt.matched': 'ground good - - -',
  'gt.geo.up': 'ground good - - -',
  'gt.geo.down': 'ground bad - - ma',
  'gt.rgt': 'ground good - - -',
  'gt.rgt.near': 'ground info - - hp,ha',
  'gt.drift': 'ground info - - -',
  'gt.sso.clock': 'ground info - - -',
  'cav.mean': 'caveat info DM t-mean -',
  'cav.epoch.off': 'caveat info D - -',
  'cav.epoch.far': 'caveat warn D - epoch',
  'cav.circ.angles': 'caveat info - t-angles argp,ma',
  'cav.eq.angles': 'caveat info - t-angles -',
  'cav.highorbit': 'caveat warn - - -',
  'cav.drag.assumed': 'caveat info D t-bstar -',
  'cav.am.sail': 'caveat info D t-bstar -',
  'cav.am.zero': 'caveat info D t-bstar -',
  'sgp4.retro': 'caveat fn D - inc;e',
  'cav.frozen': 'caveat info D - e',
  'cav.deep': 'caveat info - - -',
  'err.missing': 'input error D - -',
  'err.notnum': 'input error D - -',
  'err.inc.range': 'input error D - -',
  'err.ecc.neg': 'input error D - -',
  'err.ecc.parabola': 'input error D - -',
  'err.ecc.hyper': 'input error D - -',
  'err.perigee.surface': 'input error D - hp',
  'err.apo.lt.peri': 'input error D - hp,ha',
  'err.a.range': 'input error D - -',
  'err.am.range': 'input error D - -',
  'err.epoch.range': 'input error D - -',
  'err.angle.wrap': 'input info D - -',
  'err.name.empty': 'input error D - -',
  'err.name.taken': 'input error D - name',
  'err.sgp4': 'input error D - -',
  'err.cap': 'input warn D - -',
  'err.storage': 'input warn D - -',
  'err.name.cleaned': 'input info D - -',
  'err.bstar.range': 'input error D - am',
  'err.ltan.range': 'input error D - -'
};
/* The planner form's keys (a fix writes these), the glossary entries the page has
   (seven new in the planner, four that were already there) and the dictionary of numbers. */
const FORM_KEYS = ['shape', 'nodeMode', 'name', 'hp', 'ha', 'a', 'e', 'period', 'inc', 'raan', 'ltan', 'argp', 'ma', 'epoch', 'am'];
const TERMS = ['t-sso', 't-ltan', 't-beta', 't-geo', 't-crit', 't-belts', 't-saa', 't-bstar', 't-mean', 't-angles', 't-reentry'];
const KEYS = {};
const addKeys = (kind, list) => list.split(/\s+/).filter(Boolean).forEach(k => { KEYS[k] = kind; });
// n: a finite number; t: text; b: a boolean; nn: a number, or null when there is none (the sun-synchronous inclination)
addKeys('n', 'a e inc raan argp ma am bstar cd hp ha rp h_mean period period_nodal revs v vp va foot_pct foot_pct_500 ' +
  'ha_moon_pct hi_dwell_pct apo_lat u lon_sum fold_inc off180 node argp_rate sso_rate sso_amax_alt ltan ltdn ltan_day ' +
  'ltan_night ltan_drift ltan_drift_abs ltan_drift_year beta_min beta_max beta_min_abs beta_crit free_days ecl_max_min ' +
  'ecl_max_pct cycles sidereal drift drift_abs dperiod_abs geo_a geo_alt geo_lon el_geo vis_lo vis_hi ma_site geo_ecl_max ' +
  'geo_season_days eight_lat ew_amp gnss_slide Q shift_deg shift_km K D rgt_days rgt_off rgt_gap rgt_days_max near_K near_D ' +
  'near_h near_dh lambda reach offtrack el_best inc_need site_lat site_lon site_lat_abs site_lat_round mask lt_pass_day ' +
  'pass_day_clock pass_spread_h uncert entry life_lo life_mid life_hi fix_h fix_life fix_hp fix_h25 fix_h5 am_max bstar_max ' +
  'retro_err e_f deep_alt argp_q_days inc_crit epoch_off epoch_off_abs hours window_ms n total_min longest_min best_el ' +
  'alt_min alt_max surf_swing r_swing swing wrapped code cap a_max');
addKeys('t', 'name site ltan_dir drift_dir plonger ecl_txt retro_lead epoch_utc epoch_dir start window_start passes field raw ' +
  'why hint name_free cleaned');
addKeys('b', 'geo_vis tracked');
addKeys('nn', 'sso_inc');

/* ---------------------------------------------------------------- the voice */
const BANNED = ['wrong', 'mistake', 'mistakes', 'obviously', 'simply', 'just', 'clearly', 'trivial', 'bad', 'perfect', 'optimal',
  'guarantee', 'guarantees', 'guaranteed', 'careless'];
const BANNED_RE = new RegExp('\\b(' + BANNED.join('|') + ')\\b', 'i');
const CONTRACTION_RE = /\b[A-Za-z]+n['’]t\b|['’](re|ve|ll|d|m)\b|\b(it|that|there|let|what|here|who)['’]s\b/i;
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}☀-➿⬀-⯿️]/u;
const words = s => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = s => s.replace(/([.!?:;])\s+/g, '$1\n').split('\n');
const LIMITS = { title: 48, body: 70, sentence: 32 };

/* The problems with one piece of text. `kind` is 'title', 'body' or 'label'. */
function voiceProblems(text, kind) {
  const p = [];
  if (kind === 'title' && text.length > LIMITS.title) p.push('title ' + text.length + ' characters');
  if (kind === 'body') {
    if (words(text) > LIMITS.body) p.push('body ' + words(text) + ' words');
    sentences(text).forEach(s => { if (words(s) > LIMITS.sentence) p.push('sentence of ' + words(s) + ' words'); });
  }
  const b = BANNED_RE.exec(text); if (b) p.push('banned word "' + b[1] + '"');
  if (/Professor/i.test(text)) p.push('names the speaker');
  if (/\bI\b/.test(text) || /\bwe\b/i.test(text)) p.push('says "I" or "we"');
  const c = CONTRACTION_RE.exec(text); if (c) p.push('contraction "' + c[0] + '"');
  if (/!/.test(text)) p.push('exclamation mark');
  if (EMOJI_RE.test(text)) p.push('emoji');
  if (/NaN|undefined|Infinity|\bnull\b|[{}]/.test(text)) p.push('unresolved text');
  return p;
}

/* ---------------------------------------------------------------- a dictionary, plausibly
   The real one is advisor.js (kernels measured against SGP4). This is the smallest thing that
   fills every key of KEYS with a believable number from a set of mean elements: first-order J2
   rates, a cylindrical shadow, a table for the atmosphere that follows the reference lifetimes of
   the decay model, and the page's own formulas for the footprint, the repeat and the geostationary
   look angle. It is wrong in the third digit and right in kind, which is all the catalogue's
   conditions and templates can tell the difference between. */
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const RE = 6378.137, RE72 = 6378.135, MU = 398600.8, J2 = 0.001082616, J3 = -0.00000253881;
const SID_MIN = 1436.0682, SUN_RATE = 360 / 365.2421897, WE = 360.98564736629, MASK = 5;
const GEO_A = Math.cbrt(MU * Math.pow(SID_MIN * 60 / (2 * Math.PI), 2));
const EPOCH = Date.UTC(2026, 9, 1, 12, 0, 0);
const BKK = { name: 'Bangkok', lat: 13.75, lon: 100.52, altKm: 0.002, tz: 7 };
const wrap360 = x => ((x % 360) + 360) % 360;
const wrap180 = x => ((x % 360) + 540) % 360 - 180;
const clamp1 = x => Math.max(-1, Math.min(1, x));
const jd = ms => ms / 86400000 + 2440587.5;
const gmstDeg = ms => wrap360(280.46061837 + 360.98564736629 * (jd(ms) - 2451545.0));
const sunRa = ms => wrap360(280.46061837 + 0.98564736629 * (jd(ms) - 2451545.0));
const periodOf = a => 2 * Math.PI * Math.sqrt(a * a * a / MU) / 60;
const aOfPeriod = min => Math.cbrt(MU * Math.pow(min * 60 / (2 * Math.PI), 2));
const isoZ = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z').replace('T', ' ');

function ratesOf(a, e, inc) {
  const p = a * (1 - e * e), n = 360 * 1440 / periodOf(a);               // deg/day
  const f = 1.5 * J2 * Math.pow(RE72 / p, 2) * n;
  const c = Math.cos(inc * D2R);
  return { n: n, node: -f * c, argp: 0.5 * f * (5 * c * c - 1), f: f };
}
// mean-case lifetime of a circular orbit at the given height, days (the decay model's reference values for a typical satellite)
const LIFE_PTS = [[200, 3], [250, 11], [300, 41], [350, 122], [400, 325], [450, 840], [500, 1972], [550, 4380], [600, 9860], [650, 21550]]
  .map(p => [p[0], Math.log(p[1])]);
function lifeCirc(h, am) {
  if (am <= 0) return Infinity;
  const P = LIFE_PTS; let i = 0;
  while (i < P.length - 2 && h > P[i + 1][0]) i++;
  const s = (P[i + 1][1] - P[i][1]) / (P[i + 1][0] - P[i][0]);
  return Math.exp(P[i][1] + s * (h - P[i][0])) * 0.0043 / am;
}
const capDays = d => d > 40000 ? Infinity : d;
function heightForLife(am, days) {                                    // bisection on altitude, 150 to 1,000 km
  let lo = 150, hi = 1000;
  if (lifeCirc(lo, am) > days || lifeCirc(hi, am) < days) return undefined;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (lifeCirc(m, am) > days) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

/* The context for a planner form (hp/ha or a/e, inc, raan or ltan, argp, ma, am) seen from an
   observer. env: {site, window:{startMs,hours}, measured:{...}, tracked, lazy:{reads}}. Keys the real
   dictionary leaves undefined in some situations (lifetime outside the model, sun keys for e >= 0.05,
   the repeat, the measured pass keys) are left undefined here under the same rules. */
function syntheticContext(form, env) {
  env = env || {};
  const site = env.site || BKK;
  const epoch = typeof form.epoch === 'number' ? form.epoch : EPOCH;
  let a, e;
  if (form.a !== undefined) { a = form.a; e = form.e || 0; }
  else {
    const rp = RE + form.hp, ra = RE + (form.ha === undefined ? form.hp : form.ha);
    a = (rp + ra) / 2; e = (ra - rp) / (ra + rp);
  }
  const inc = form.inc, argp = form.argp || 0, ma = form.ma || 0;
  const raan = form.nodeMode === 'ltan' ? wrap360(sunRa(epoch) + (form.ltan - 12) * 15) : (form.raan || 0);
  const am = form.am === undefined ? 0.0043 : form.am;
  const c = { name: form.name || 'My orbit', a: a, e: e, inc: inc, raan: raan, argp: argp, ma: ma, am: am };
  c.mask = MASK; c.entry = 120; c.uncert = 3; c.cd = 2.2; c.cap = 12; c.a_max = 400000;
  const ap = { rp: a * (1 - e), ra: a * (1 + e) };
  c.rp = ap.rp; c.hp = ap.rp - RE; c.ha = ap.ra - RE; c.h_mean = a - RE;
  c.period = periodOf(a); c.revs = 1440 / c.period;
  c.v = Math.sqrt(MU / a); c.vp = Math.sqrt(MU * (1 + e) / (a * (1 - e))); c.va = Math.sqrt(MU * (1 - e) / (a * (1 + e)));
  c.fold_inc = inc > 90 ? 180 - inc : inc; c.off180 = 180 - inc;
  const r = ratesOf(a, e, inc);
  c.node = r.node; c.argp_rate = r.argp; c.sso_rate = SUN_RATE; c.sso_amax_alt = 5981.7;
  c.period_nodal = 360 / (r.n + r.argp) * 1440;                              // min, from the along-orbit rate
  const cosI = -SUN_RATE / r.f;
  c.sso_inc = cosI >= -1 ? Math.acos(cosI) * R2D : null;
  c.sidereal = SID_MIN; c.geo_a = GEO_A; c.geo_alt = GEO_A - RE;
  c.ltan = (((12 + (raan - sunRa(epoch)) / 15) % 24) + 24) % 24;
  c.ltdn = (c.ltan + 12) % 24; c.ltan_day = (c.ltan >= 6 && c.ltan < 18) ? c.ltan : (c.ltan + 12) % 24; c.ltan_night = (c.ltan_day + 12) % 24;
  const drift = (c.node - SUN_RATE) * 4;
  c.ltan_drift = drift; c.ltan_drift_abs = Math.abs(drift); c.ltan_drift_year = drift * 365 / 60; c.ltan_dir = drift < 0 ? 'earlier' : 'later';
  c.drift = r.n + r.argp + r.node - WE; c.drift_abs = Math.abs(c.drift); c.drift_dir = c.drift > 0 ? 'east' : 'west';
  c.plonger = c.period > SID_MIN ? 'longer' : 'shorter'; c.dperiod_abs = Math.abs(c.period - SID_MIN);
  c.gnss_slide = Math.abs(360 * (2 * c.period - SID_MIN) / SID_MIN);
  c.ew_amp = 2 * e * R2D; c.eight_lat = c.fold_inc;
  c.foot_pct = (1 - RE / (RE + Math.max(c.h_mean, 1))) / 2 * 100; c.foot_pct_500 = (1 - RE / (RE + 500)) / 2 * 100;
  c.hi_dwell_pct = (0.5 + e / Math.PI) * 100; c.ha_moon_pct = c.ha / 384400 * 100;
  c.apo_lat = Math.asin(Math.sin(inc * D2R) * Math.sin((argp + 180) * D2R)) * R2D;
  c.u = wrap360(argp + ma); c.lon_sum = wrap360(raan + argp + ma);
  c.epoch_utc = isoZ(epoch);
  /* the site */
  c.site = site.name; c.site_lat = site.lat; c.site_lon = site.lon; c.site_lat_abs = Math.abs(site.lat); c.site_lat_round = Math.round(Math.abs(site.lat));
  const hm = Math.max(c.h_mean, 1);
  c.lambda = Math.acos(clamp1(RE * Math.cos(MASK * D2R) / (RE + hm))) * R2D - MASK;
  c.reach = Math.min(90, c.fold_inc + c.lambda);
  c.offtrack = Math.max(0, c.site_lat_abs - c.fold_inc);
  const psi = c.offtrack * D2R, rr = RE / (RE + hm);
  c.el_best = c.offtrack <= 0 ? 90 : Math.max(-90, Math.atan((Math.cos(psi) - rr) / Math.sin(psi)) * R2D);
  c.inc_need = Math.min(90, Math.ceil(Math.max(0, c.site_lat_abs - c.lambda) * 2) / 2 + 0.5);
  /* geostationary look angle, the page's own formula */
  const gm = gmstDeg(epoch);
  c.geo_lon = wrap180(raan + argp + ma - gm);
  {
    const lam = Math.acos(RE * Math.cos(MASK * D2R) / (RE + c.geo_alt)) * R2D - MASK;
    const cosPsi = Math.cos(site.lat * D2R) * Math.cos(wrap180(site.lon - c.geo_lon) * D2R);
    const psiG = Math.max(1e-9, Math.acos(clamp1(cosPsi))), rG = RE / (RE + c.geo_alt);
    c.el_geo = Math.atan((Math.cos(psiG) - rG) / Math.sin(psiG)) * R2D;
    const dmax = Math.acos(Math.min(1, Math.cos(lam * D2R) / Math.cos(site.lat * D2R))) * R2D;
    c.vis_lo = site.lon - dmax; c.vis_hi = site.lon + dmax; c.geo_vis = c.el_geo >= MASK;
    c.ma_site = wrap360(site.lon + gm - raan - argp);
    const b0 = Math.asin(RE / GEO_A) * R2D;
    c.geo_ecl_max = 2 * b0 / 360 * SID_MIN; c.geo_season_days = 2 * Math.asin(Math.sin(b0 * D2R) / Math.sin(23.4393 * D2R)) * R2D / 360 * 365.2422;
  }
  /* the sun: a year of beta angles and a cylindrical shadow (circular formula, below e = 0.05 only) */
  if (e < 0.05) {
    let bmin = 99, bmax = -99, babs = 99, free = 0, fmax = 0, fminPos = 1;
    const s = RE / a, bstar = Math.asin(s);
    for (let d = 0; d < 365; d++) {
      const t = epoch + d * 864e5, days = jd(t) - 2451545.0;
      const L = wrap360(280.460 + 0.9856474 * days), g = wrap360(357.528 + 0.9856003 * days) * D2R;
      const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R, eps = 23.4393 * D2R;
      const S = [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
      const O = (raan + r.node * d) * D2R, i = inc * D2R;
      const N = [Math.sin(i) * Math.sin(O), -Math.sin(i) * Math.cos(O), Math.cos(i)];
      const beta = Math.asin(clamp1(S[0] * N[0] + S[1] * N[1] + S[2] * N[2]));
      const f = Math.abs(beta) < bstar ? Math.acos(clamp1(Math.sqrt(1 - s * s) / Math.cos(beta))) / Math.PI : 0;
      bmin = Math.min(bmin, beta * R2D); bmax = Math.max(bmax, beta * R2D); babs = Math.min(babs, Math.abs(beta) * R2D);
      if (f === 0) free++; else { fmax = Math.max(fmax, f); fminPos = Math.min(fminPos, f); }
    }
    c.beta_min = bmin; c.beta_max = bmax; c.beta_min_abs = babs; c.beta_crit = bstar * R2D; c.free_days = free;
    c.ecl_max_min = fmax * c.period; c.ecl_max_pct = fmax * 100; c.cycles = c.revs * (365 - free);
    const lo = Math.round((free === 365 ? 0 : fminPos) * c.period), hi = Math.round(fmax * c.period);
    c.ecl_txt = free === 365 ? '0 min' : lo === hi ? hi + ' min' : lo + ' to ' + hi + ' min';
  }
  /* the repeat: K revolutions in D days */
  const Qof = (aa) => { const rt = ratesOf(aa, e, inc); return (rt.n + rt.argp) / (WE - rt.node); };
  c.Q = Qof(a); c.shift_deg = 360 / c.Q; c.shift_km = c.shift_deg * 111.32; c.rgt_days_max = 16;
  const hit = (Q) => { for (let D = 1; D <= 16; D++) { const K = Math.round(Q * D); if (K < 1) continue; const ph = Math.abs(Q * D - K); if (ph * D <= 0.05) return { K: K, D: D, ph: ph }; } return null; };
  const ex = hit(c.Q);
  if (ex && e < 0.05) {
    c.K = ex.K; c.D = ex.D; c.rgt_days = ex.D * 360 / (WE - r.node); c.rgt_off = 360 * ex.ph / c.Q * 111.32; c.rgt_gap = 40075 / ex.K;
  }
  const lazy = {};
  lazy.near = () => {
    if (ex || e >= 0.05 || c.h_mean >= 2000) return null;
    let best = null;
    for (let D = 1; D <= 3; D++) {
      const K = Math.round(c.Q * D); if (K < 1) continue;
      let lo = RE + 160, hi = RE + 2500;
      for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (Qof(m) > K / D) lo = m; else hi = m; }
      const h = (lo + hi) / 2 - RE, dh = Math.abs(h - c.h_mean);
      if (dh <= 10 && (!best || dh < best.dh - 2)) best = { K: K, D: D, h: h, dh: dh };
    }
    return best;
  };
  /* the sun-synchronous pass clock */
  const sLat = Math.min(1, Math.sin(Math.abs(site.lat) * D2R) / Math.max(1e-9, Math.sin(inc * D2R)));
  const u = Math.asin(sLat);
  c.lt_pass_day = c.ltan_day + Math.atan2(Math.cos(inc * D2R) * Math.sin(u), Math.cos(u)) * R2D / 15;
  c.pass_spread_h = c.lambda / 15; c.pass_day_clock = c.lt_pass_day + ((site.tz || 0) - site.lon / 15);
  /* drag, the lifetime and the fixes (kernel ranges as in the decay model) */
  const bstarUnit = Math.exp(Math.log(0.0506) + (Math.log(0.0055) - Math.log(0.0506)) * (Math.max(360, Math.min(700, c.h_mean)) - 360) / 340);
  c.bstar = 2.2 * am * bstarUnit; c.bstar_max = 0.1;
  const amMax = 0.1 / (2.2 * bstarUnit); c.am_max = Math.max(0.001, Number(amMax.toPrecision(2)));
  if (am !== null && c.hp >= 120 && c.period < 225 && c.hp <= 1000) {
    const circ = e < 0.002, ecc = e >= 0.002 && e <= 0.3 && c.ha <= 5000;
    if (circ || ecc) {
      const raw = circ ? lifeCirc(c.h_mean, am) : lifeCirc(c.hp + 0.3 * (c.ha - c.hp), am);
      c.life_mid = capDays(raw); c.life_lo = capDays(raw / 3); c.life_hi = capDays(raw * 3);
    }
  }
  const memo = {};
  const lazyKey = (key, fn) => {
    Object.defineProperty(c, key, {
      enumerable: true, configurable: true,
      get() { if (env.lazy) env.lazy.reads[key] = (env.lazy.reads[key] || 0) + 1; if (!(key in memo)) memo[key] = fn(); return memo[key]; }
    });
  };
  const up10 = h => h === undefined ? undefined : Math.ceil(h / 10) * 10, down10 = h => h === undefined ? undefined : Math.floor(h / 10) * 10;
  lazyKey('fix_h', () => up10(heightForLife(am, 2 * 365.25)));
  lazyKey('fix_life', () => c.fix_h === undefined ? undefined : lifeCirc(c.fix_h, am));
  lazyKey('fix_h25', () => down10(heightForLife(am, 25 * 365.25)));
  lazyKey('fix_h5', () => down10(heightForLife(am, 5 * 365.25)));
  lazyKey('fix_hp', () => e < 0.002 ? c.fix_h : (c.ha - 20 >= 150 ? Math.min(500, c.ha - 20) : undefined));
  lazyKey('near_K', () => { const n = lazy.near(); return n ? n.K : undefined; });
  lazyKey('near_D', () => { const n = lazy.near(); return n ? n.D : undefined; });
  lazyKey('near_h', () => { const n = lazy.near(); return n ? n.h : undefined; });
  lazyKey('near_dh', () => { const n = lazy.near(); return n ? n.dh : undefined; });
  /* the other new keys */
  const e1 = Math.round(e * 1e7) / 1e7, i1 = Math.round(inc * 1e4) / 1e4;
  c.retro_err = (e1 <= 0 || i1 >= 180 || i1 < 150 || Math.abs(1 + Math.cos(i1 * D2R)) < 1.5e-12) ? 0
    : Math.min(2 * a, RE72 * e1 / (1 - e1 * e1) * 0.25 * 2.345069720011528e-3 * Math.sin(i1 * D2R) * Math.abs(3 + 5 * Math.cos(i1 * D2R)) / (1 + Math.cos(i1 * D2R)));
  c.retro_lead = c.period >= 225 ? 'on the order of' : 'about';
  c.e_f = -(J3 / (2 * J2)) * (RE72 / a) * Math.sin(inc * D2R);
  c.deep_alt = aOfPeriod(225) - RE; c.inc_crit = inc > 90 ? 116.6 : 63.4;
  c.argp_q_days = r.argp === 0 ? 0 : 90 / Math.abs(r.argp);
  c.tracked = !!env.tracked;
  if (env.window) {
    c.epoch_off = (env.window.startMs - epoch) / 864e5; c.epoch_off_abs = Math.abs(c.epoch_off); c.epoch_dir = c.epoch_off >= 0 ? 'after' : 'before';
    c.hours = env.window.hours; c.start = isoZ(env.window.startMs).slice(0, 16) + 'Z'; c.window_start = c.start; c.window_ms = env.window.startMs;
  }
  if (env.measured) {
    const M = env.measured;
    c.n = M.n; c.passes = M.n === 1 ? 'pass' : 'passes'; c.total_min = M.totalS / 60; c.longest_min = M.longestS / 60; c.best_el = M.bestEl;
    c.alt_min = M.altMin; c.alt_max = M.altMax; c.swing = M.altMax - M.altMin; c.surf_swing = M.surfSwing; c.r_swing = M.rSwing;
  }
  return c;
}

/* A dictionary that supplies every key of KEYS, with the situation that lets every button of every item
   show (a circular orbit, a "Lower" height well below the orbit) and the worst case of the figures that
   set the length of a sentence: a lifetime past the cap reads "more than a century". The message keys
   (what an input problem says about itself) are filled with typical params. */
function fullContext() {
  const c = syntheticContext({ hp: 700, ha: 700, inc: 98.2130, nodeMode: 'ltan', ltan: 10.5, argp: 0, ma: 0, am: 0.0043 },
    { window: { startMs: EPOCH + 2 * 864e5, hours: 24 }, tracked: true,
      measured: { n: 3, totalS: 30.8 * 60, longestS: 11 * 60, bestEl: 73, altMin: 686, altMax: 713, surfSwing: 21.3, rSwing: 14.2 } });
  const full = {};
  Object.keys(c).forEach(k => { full[k] = c[k]; });                               // reads every lazy getter once
  Object.assign(full, {
    fix_h: 450, fix_life: 840, fix_h25: 590, fix_h5: 490, fix_hp: 450,
    K: 233, D: 16, rgt_days: 16.1, rgt_off: 5.7, rgt_gap: 172, near_K: 233, near_D: 16, near_h: 699.6, near_dh: 0.4,
    life_lo: 1000, life_mid: 2000, life_hi: Infinity, argp_q_days: 16363, am_max: 0.94,
    field: 'Inclination', raw: '97,4x', wrapped: 10, code: 4, why: 'semi-latus rectum below zero', hint: 'Raise perigee or lower e.',
    name: 'ISS (ZARYA)', name_free: 'ISS (ZARYA) (mine)', cleaned: 'HYPERLINK("x") ok', rp: 6300.55, retro_err: 857.1, tracked: true
  });
  return full;
}

/* ---------------------------------------------------------------- orbits to run the catalogue against
   Each scenario is an orbit in the planner's own vocabulary (the form: hp ha inc raan argp ma am, or
   a e, with ltan for a node given as a local time), what to say about it, and the ids that must (and
   must not) fire. The expectations are the design's intent for that orbit, not whatever the code does. */
const geoOver = (extra, dLon) => {
  const base = Object.assign({ hp: 35786.045, ha: 35786.045, inc: 0, raan: 0, argp: 0, ma: 0 }, extra || {});
  base.ma = wrap360(syntheticContext(base, {}).ma_site + (dLon || 0));          // parked over the observer, or dLon east of it
  return base;
};
const STAT = { n: 3, totalS: 30.8 * 60, longestS: 11 * 60, bestEl: 73, altMin: 686, altMax: 713, surfSwing: 21.3, rSwing: 14.2 };
const WIN0 = { startMs: EPOCH, hours: 24 };
const SCENARIOS = [
  { name: 'circular LEO at 500 km', form: { hp: 500, ha: 500, inc: 51.6, raan: 100 },
    fire: ['kind.leo.circ', 'rad.saa', 'life.range', 'cav.drag.assumed'], not: ['kind.iss', 'kind.sso', 'kind.retro', 'kind.high', 'cav.deep'] },
  { name: 'ISS-like at 420 km', form: { hp: 420, ha: 420, inc: 51.64, raan: 0, am: 0.0012 },
    fire: ['kind.iss', 'rad.saa'], not: ['kind.leo.circ'] },
  { name: 'circular 51.6 degrees at 250 km (not the station)', form: { hp: 250, ha: 250, inc: 51.6 }, fire: ['kind.leo.circ'], not: ['kind.iss'] },
  { name: 'circular 51.6 degrees at 800 km (not the station)', form: { hp: 800, ha: 800, inc: 51.6 }, fire: ['kind.leo.circ'], not: ['kind.iss'] },
  { name: 'sun-synchronous 700 km, LTAN 10:30', form: { hp: 700, ha: 700, inc: 98.2130, nodeMode: 'ltan', ltan: 10.5 },
    fire: ['kind.sso', 'sun.ltan', 'gt.sso.clock', 'life.long', 'rad.saa'], not: ['kind.retro', 'kind.sso.near', 'sun.dawndusk'],
    buttons: { 'life.long': ['Lower the orbit to 590 km (about 25 years)', 'Lower it to 490 km (about 5 years)'],
               'sun.ltan': ['Set the node for LTAN 10:30', 'Set the node for LTAN 13:30', 'Set the node for LTAN 06:00 (dawn–dusk)'] } },
  { name: 'circular 550 km: the 25-year height is above it, so only the 5-year button', form: { hp: 550, ha: 550, inc: 51.6 },
    fire: ['life.long'], not: ['life.range'], buttons: { 'life.long': ['Lower it to 490 km (about 5 years)'] } },
  { name: 'sun-synchronous 500 km, LTAN 10:30 (CubeSat)', form: { hp: 500, ha: 500, inc: 97.4260, nodeMode: 'ltan', ltan: 10.5, am: 0.009 },
    fire: ['kind.sso', 'sun.ltan'], not: ['kind.sso.near'] },
  { name: 'dawn-dusk sun-synchronous 700 km', form: { hp: 700, ha: 700, inc: 98.2130, nodeMode: 'ltan', ltan: 6 },
    fire: ['kind.sso', 'sun.dawndusk'], not: ['sun.ltan'] },
  { name: 'noon-midnight sun-synchronous 700 km', form: { hp: 700, ha: 700, inc: 98.2130, nodeMode: 'ltan', ltan: 12 },
    fire: ['kind.sso', 'sun.noon', 'sun.ltan'], not: ['sun.dawndusk'] },
  { name: 'dawn-dusk sun-synchronous 2,000 km: no eclipse all year', form: { hp: 2000, ha: 2000, inc: 104.9182, nodeMode: 'ltan', ltan: 6 },
    fire: ['sun.free', 'rad.inner'], not: ['sun.ecl', 'sun.ecl.season', 'sun.noon'] },
  { name: 'close to sun-synchronous (97.0 degrees at 500 km)', form: { hp: 500, ha: 500, inc: 97.0 },
    fire: ['kind.sso.near'], not: ['kind.sso', 'kind.retro'] },
  { name: '98 degrees at 8,000 km: too high to be sun-synchronous', form: { hp: 8000, ha: 8000, inc: 98 },
    fire: ['kind.sso.unreachable', 'kind.retro'], not: ['kind.sso', 'kind.sso.near'] },
  { name: 'geostationary over the observer', form: geoOver(),
    fire: ['kind.geo', 'rad.geo', 'sun.geo', 'gt.geo.up', 'life.permanent', 'cav.deep', 'cav.eq.angles'], not: ['kind.gso', 'kind.gso.ecc', 'kind.geo.drift', 'kind.high', 'gt.geo.down'] },
  { name: 'geostationary on the far side of the Earth', form: geoOver(null, 180), fire: ['kind.geo', 'gt.geo.down'], not: ['gt.geo.up'] },
  { name: 'geosynchronous, tilted 5 degrees', form: { a: GEO_A, e: 0, inc: 5 }, fire: ['kind.gso'], not: ['kind.geo', 'kind.gso.ecc'] },
  { name: 'geosynchronous, e 0.05, no tilt', form: { a: GEO_A, e: 0.05, inc: 0 }, fire: ['kind.gso.ecc'], not: ['kind.gso', 'kind.geo', 'kind.geo.drift'] },
  { name: 'near-geostationary, 100 km low', form: { hp: 35686, ha: 35686, inc: 0.1 }, fire: ['kind.geo.drift'], not: ['kind.geo', 'kind.gso', 'kind.gso.ecc'] },
  { name: 'Molniya (63.4 degrees, 270)', form: { a: 26554.137, e: 0.74, inc: 63.4, argp: 270 },
    fire: ['kind.molniya', 'rad.cross', 'life.ecc', 'cav.deep'], not: ['kind.heo', 'kind.heo.drift', 'kind.critical'] },
  { name: 'Tundra (63.4 degrees, 270)', form: { a: GEO_A, e: 0.27, inc: 63.4, argp: 270 },
    fire: ['kind.tundra', 'life.ecc.high'], not: ['kind.heo', 'kind.heo.drift', 'kind.gso', 'kind.gso.ecc'] },
  { name: 'Molniya-like at 55 degrees', form: { a: 26554.137, e: 0.74, inc: 55, argp: 270 },
    fire: ['kind.heo', 'kind.heo.drift'], not: ['kind.molniya'] },
  { name: 'transfer orbit, 250 by 35,786 km at 7 degrees', form: { hp: 250, ha: 35786, inc: 7 }, fire: ['kind.heo', 'kind.heo.drift'], not: ['kind.molniya'] },
  { name: '53,622 by 233,622 km', form: { hp: 53622, ha: 233622, inc: 30 }, fire: ['kind.heo', 'cav.highorbit', 'cav.deep'], not: ['kind.molniya'] },
  { name: 'period 716.9 min: half a sidereal day to within 2 minutes', form: { hp: aOfPeriod(716.9) - RE, ha: aOfPeriod(716.9) - RE, inc: 55 }, fire: ['kind.gnss'], not: ['kind.meo'] },
  { name: 'period 725 min: too far from half a sidereal day', form: { hp: aOfPeriod(725) - RE, ha: aOfPeriod(725) - RE, inc: 55 }, fire: ['kind.meo'], not: ['kind.gnss'] },
  { name: 'GPS-like at 20,182 km', form: { hp: 20182, ha: 20182, inc: 55 }, fire: ['kind.gnss', 'rad.outer', 'cav.deep', 'life.permanent'], not: ['kind.meo'] },
  { name: 'medium Earth orbit, 3,000 km', form: { hp: 3000, ha: 3000, inc: 50 }, fire: ['kind.meo', 'rad.inner'], not: ['kind.gnss', 'kind.leo.circ'] },
  { name: 'circular 38,000 km, beyond the geostationary ring', form: { hp: 38000, ha: 38000, inc: 10 }, fire: ['kind.high', 'cav.deep'], not: ['kind.meo', 'kind.gso'] },
  { name: 'elliptical low orbit, 300 by 2,000 km', form: { hp: 300, ha: 2000, inc: 60, am: 0.0043 }, fire: ['kind.leo.ecc'], not: ['kind.leo.circ'] },
  { name: 'polar, 90.5 degrees (not retrograde)', form: { hp: 591, ha: 591, inc: 90.5 }, fire: ['kind.polar'], not: ['kind.retro'] },
  { name: 'retrograde, 93.5 degrees', form: { hp: 591, ha: 591, inc: 93.5 }, fire: ['kind.retro'], not: ['kind.polar'] },
  { name: 'equatorial low orbit', form: { hp: 600, ha: 600, inc: 2 }, fire: ['kind.equatorial'], not: ['kind.leo.circ'] },
  { name: 'critical inclination, low and circular', form: { hp: 800, ha: 800, inc: 63.4 }, fire: ['kind.critical'], not: ['kind.molniya'] },
  { name: 'decaying: 200 km', form: { hp: 200, ha: 200, inc: 51.6 }, fire: ['life.days', 'rad.saa'], not: ['life.short', 'life.reentry'],
    buttons: { 'life.days': ['Raise the orbit to 450 km (about 2.3 years)'] } },
  { name: 'short-lived: 330 km', form: { hp: 330, ha: 330, inc: 51.6 }, fire: ['life.short'], not: ['life.days', 'life.range'] },
  { name: 'below the re-entry line: perigee 90 km', form: { hp: 90, ha: 90, inc: 51.6 }, fire: ['life.reentry'], not: ['life.days', 'life.short', 'rad.saa'] },
  /* life.long is not asserted here: it was the synthetic generator's guess (it prices an eccentric orbit as a circular one at
     hp + 0.3 (ha - hp) = 740 km), and the real eccentric model puts this orbit at about 1.0 years (life.short). The scenario is
     about life.ecc.low; verify-advisor.js asserts the real lifetime class. */
  { name: 'perigee skimming the air, 200 by 2,000 km', form: { hp: 200, ha: 2000, inc: 60 }, fire: ['life.ecc.low'], not: ['life.ecc'] },
  { name: 'elliptical with no modelled life, 400 by 9,000 km', form: { hp: 400, ha: 9000, inc: 60 }, fire: ['life.ecc'], not: ['life.ecc.low', 'life.ecc.high'] },
  { name: 'tracked spacecraft on the read-only host', form: { hp: 500, ha: 500, inc: 51.6 }, env: { tracked: true }, host: 'readonly',
    fire: ['life.tracked', 'kind.leo.circ'], not: ['life.range', 'cav.drag.assumed'] },
  { name: 'zero drag', form: { hp: 500, ha: 500, inc: 51.6, am: 0 }, fire: ['cav.am.zero'], not: ['life.range', 'life.permanent', 'life.short'] },
  { name: 'a sail, 0.5 m2/kg at 400 km', form: { hp: 400, ha: 400, inc: 51.6, am: 0.5 }, fire: ['cav.am.sail', 'life.days'], not: ['cav.am.zero'] },
  { name: 'SGP4 near 180 degrees', form: { a: 7000, e: 0.01, inc: 179.99 }, fire: ['sgp4.retro', 'kind.retro'], not: ['kind.polar'] },
  { name: 'a textbook frozen orbit', form: { a: 7078.137, e: 0.001046, inc: 98.2, argp: 90 }, fire: ['cav.frozen'], not: ['kind.sso.near'] },
  { name: 'argument of perigee on a circle', form: { hp: 500, ha: 500, inc: 51.6, argp: 40, ma: 20 }, fire: ['cav.circ.angles'], not: ['cav.frozen'] },
  { name: 'the window two days after the epoch', form: { hp: 500, ha: 500, inc: 51.6 }, env: { window: { startMs: EPOCH + 2 * 864e5, hours: 24 } },
    fire: ['cav.epoch.off'], not: ['cav.epoch.far'] },
  { name: 'the window ten days after the epoch', form: { hp: 500, ha: 500, inc: 51.6 }, env: { window: { startMs: EPOCH + 10 * 864e5, hours: 24 } },
    fire: ['cav.epoch.far'], not: ['cav.epoch.off'] },
  { name: 'out of reach of a 60 degree observer', form: { hp: 500, ha: 500, inc: 28.5 }, site: { name: 'Tromso', lat: 69.65, lon: 18.96, tz: 1 }, fire: ['gt.never'], not: ['gt.barely', 'gt.matched'] },
  { name: 'only low passes from Bangkok (400 km, equatorial)', form: { hp: 400, ha: 400, inc: 0 }, fire: ['gt.barely'], not: ['gt.never', 'gt.matched'] },
  { name: 'a tilt that turns round near Bangkok (550 km, 18 degrees)', form: { hp: 550, ha: 550, inc: 18 }, fire: ['gt.matched'], not: ['gt.never', 'gt.barely'] },
  { name: 'passes counted: 3 in 24 h', form: { hp: 500, ha: 500, inc: 51.6 }, env: { window: WIN0, measured: Object.assign({}, STAT, { bestEl: 40 }) },
    fire: ['gt.count', 'gt.overhead', 'cav.mean'], not: ['gt.none'] },
  { name: 'no pass in the window', form: { hp: 500, ha: 500, inc: 51.6 }, env: { window: WIN0, measured: Object.assign({}, STAT, { n: 0, totalS: 0, longestS: 0, bestEl: 0 }) },
    fire: ['gt.none'], not: ['gt.count'] }
];

/* ---------------------------------------------------------------- the checks */
function run(chk, extra) {
  extra = extra || {};
  const AC = globalThis.AdvisorCopy;
  const real = typeof extra.context === 'function';
  const ctxOf = real ? extra.context : syntheticContext;
  const T = name => 'copy: ' + name;
  const ok = (name, cond, detail) => chk(T(name), !!cond, detail);
  const list = (name, problems, detail) => chk(T(name), problems.length === 0, problems.length ? problems.length + ' problem(s): ' + problems.slice(0, 3).join(' | ') : detail);
  const throwsWith = (fn, re) => { try { fn(); } catch (e) { return re.test(String(e && e.message)); } return false; };
  const adv = (c, o) => AC.advise(c, Object.assign({ strict: true }, o || {}));
  const ids = AC.ITEMS.map(i => i.id);
  const byId = {}; AC.ITEMS.forEach(i => { byId[i.id] = i; });

  /* ---- the shape of the catalogue */
  const advisory = AC.ITEMS.filter(i => i.group !== 'input'), input = AC.ITEMS.filter(i => i.group === 'input');
  ok('87 items', AC.ITEMS.length === 87, AC.ITEMS.length + ' items');
  ok('67 advisory and 20 input', advisory.length === 67 && input.length === 20, advisory.length + ' advisory, ' + input.length + ' input');
  list('ids are unique and written as dotted lower-case words', ids.filter((id, i) => ids.indexOf(id) !== i || !/^[a-z0-9]+(\.[a-z0-9]+)+$/.test(id)), ids.length + ' ids');
  const want = Object.keys(EXPECT);
  const orderProblems = [];
  want.forEach((id, i) => { if (ids[i] !== id) orderProblems.push('position ' + i + ' holds ' + ids[i] + ', the design has ' + id); });
  ids.filter(id => want.indexOf(id) < 0).forEach(id => orderProblems.push('unexpected ' + id));
  want.filter(id => ids.indexOf(id) < 0).forEach(id => orderProblems.push('missing ' + id));
  list('the 87 ids are the design table, in its order (the first type item that fires names the orbit)', orderProblems.slice(0, 4), '87 ids in order');
  const flagLetters = it => (it.flags && it.flags.draftOnly ? 'D' : '') + (it.flags && it.flags.trackedOnly ? 'T' : '') + (it.flags && it.flags.needs === 'measured' ? 'M' : '') || '-';
  const shape = [];
  AC.ITEMS.forEach(it => {
    const w = (EXPECT[it.id] || '').split(' ');
    const got = [it.group, typeof it.sev === 'function' ? 'fn' : it.sev, flagLetters(it), it.term || '-',
      (it.fix || []).map(f => Object.keys(f.set).join(',')).join(';') || '-'];
    for (let k = 0; k < 5; k++) if (got[k] !== w[k]) shape.push(it.id + ' ' + ['group', 'severity', 'flags', 'term', 'buttons'][k] + ' is ' + got[k] + ', the design has ' + w[k]);
  });
  list('every item has the design table\'s group, severity, flags, glossary term and button payload keys', shape, '87 rows agree');
  const recKeys = ['id', 'group', 'sev', 'flags', 'term', 'when', 'title', 'body', 'basis', 'fix'], flagKeys = ['draftOnly', 'trackedOnly', 'needs'];
  const rec = [];
  AC.ITEMS.forEach(it => {
    Object.keys(it).forEach(k => { if (recKeys.indexOf(k) < 0) rec.push(it.id + ' has stray field ' + k); });
    if (typeof it.title !== 'string' || typeof it.body !== 'string' || !it.title || !it.body) rec.push(it.id + ' title/body');
    if (!it.flags || typeof it.flags !== 'object') rec.push(it.id + ' flags'); else Object.keys(it.flags).forEach(k => { if (flagKeys.indexOf(k) < 0 || (k === 'needs' ? it.flags[k] !== 'measured' : it.flags[k] !== true)) rec.push(it.id + ' flag ' + k); });
    if (it.group === 'input' ? it.when !== undefined : typeof it.when !== 'function') rec.push(it.id + ' when');
    if (it.basis !== undefined && (typeof it.basis !== 'string' || !it.basis)) rec.push(it.id + ' basis');
    (it.fix || []).forEach((f, k) => {
      if (typeof f.label !== 'string' || !f.set || typeof f.set !== 'object' || typeof f.focus !== 'string') rec.push(it.id + ' fix ' + k + ' shape');
      Object.keys(f).forEach(x => { if (['label', 'set', 'focus', 'when'].indexOf(x) < 0) rec.push(it.id + ' fix ' + k + ' stray ' + x); });
      if (f.when !== undefined && typeof f.when !== 'function') rec.push(it.id + ' fix ' + k + ' when');
    });
  });
  list('records carry only the documented fields; advisory items have a `when`, input items none', rec, '87 records');
  ok('five groups, in order, with the design\'s titles', JSON.stringify(AC.GROUPS) === JSON.stringify([
    { id: 'type', title: 'What kind of orbit is this?' }, { id: 'survive', title: 'Will it survive?' }, { id: 'sun', title: 'Sun and eclipse' },
    { id: 'ground', title: 'Ground track and {site}' }, { id: 'caveat', title: 'Caveats' }]));
  ok('severity words, glyphs and ranks', JSON.stringify(AC.SEV) === JSON.stringify({
    good: { word: 'Good', glyph: 'check', rank: 0 }, info: { word: 'Note', glyph: 'circle', rank: 1 }, warn: { word: 'Check', glyph: 'triangle', rank: 2 },
    bad: { word: 'Problem', glyph: 'square', rank: 3 }, error: { word: 'Fix this', glyph: 'square', rank: 4 } }));
  ok('ADVISOR_LABEL is the one constant', AC.ADVISOR_LABEL === 'Professor’s notes' && typeof AC.FOOTER === 'string' && /GMAT\.$/.test(AC.FOOTER));
  ok('helpers are exported for the panel', ['fold', 'isLEO', 'nearCirc', 'sunsync', 'ssoNear', 'sidLike', 'isGeo', 'geoDrift', 'issLike', 'clockDist', 'dawnDusk', 'noonMid']
    .every(k => typeof AC.helpers[k] === 'function'));

  /* ---- the contract with the dictionary */
  const tokenRe = () => new RegExp(AC.TOKEN.source, 'g');
  const tokensOf = tpl => { const out = []; let m; const re = tokenRe(); while ((m = re.exec(tpl)) !== null) out.push({ key: m[1], fmt: m[2] }); return out; };
  const texts = [];                         // every template: {where, tpl}
  AC.ITEMS.forEach(it => {
    texts.push({ where: it.id + ' title', tpl: it.title }, { where: it.id + ' body', tpl: it.body });
    (it.fix || []).forEach((f, k) => texts.push({ where: it.id + ' button ' + k, tpl: f.label }));
  });
  AC.GROUPS.forEach(g => texts.push({ where: 'group ' + g.id, tpl: g.title }));
  const ph = [];
  const seenKeys = {};
  texts.forEach(t => {
    tokensOf(t.tpl).forEach(tk => {
      seenKeys[tk.key] = true;
      if (!KEYS[tk.key]) ph.push(t.where + ' reads {' + tk.key + '}, which is not a dictionary key');
      if (tk.fmt && !Object.prototype.hasOwnProperty.call(AC.FMT, tk.fmt)) ph.push(t.where + ' uses unknown format ' + tk.fmt);
      const kind = KEYS[tk.key], f = tk.fmt || 'txt';
      if (kind) {
        if (f === 'txt' && kind !== 't') ph.push(t.where + ' {' + tk.key + '} is plain text but the key is a ' + kind);
        else if (f === 'b' && tk.key !== 'ecl_txt') ph.push(t.where + ' {' + tk.key + ':b} is bold text; only ecl_txt is a worked-out figure written as text');
        else if (f !== 'txt' && f !== 'b' && kind !== 'n' && kind !== 'nn') ph.push(t.where + ' {' + tk.key + ':' + f + '} is a bold figure over a ' + kind + ' key');
      }
    });
    const rest = t.tpl.replace(tokenRe(), '');
    if (/[{}]/.test(rest)) ph.push(t.where + ' has a stray brace');
  });
  list('every {placeholder} is a dictionary key with a format that exists; a bold figure is always a number', ph, Object.keys(seenKeys).length + ' keys read by the templates');
  const pay = [];
  AC.ITEMS.forEach(it => (it.fix || []).forEach((f, k) => {
    Object.keys(f.set).forEach(key => {
      const v = f.set[key];
      if (FORM_KEYS.indexOf(key) < 0) pay.push(it.id + ' button ' + k + ' writes ' + key + ', which is not a form key');
      if (typeof v === 'number') { if (!isFinite(v)) pay.push(it.id + ' button ' + k + ' ' + key + ' not finite'); }
      else if (typeof v === 'string') {
        const m = /^\{([a-z_A-Z0-9]+)\}$/.exec(v);
        if (!m) pay.push(it.id + ' button ' + k + ' ' + key + ' = ' + v);
        else if (!KEYS[m[1]]) pay.push(it.id + ' button ' + k + ' reads {' + m[1] + '}, not a dictionary key');
        else if ((key === 'name' ? KEYS[m[1]] !== 't' : KEYS[m[1]] !== 'n' && KEYS[m[1]] !== 'nn')) pay.push(it.id + ' button ' + k + ' puts a ' + KEYS[m[1]] + ' key into ' + key);
      } else pay.push(it.id + ' button ' + k + ' ' + key + ' type');
    });
    if (FORM_KEYS.indexOf(f.focus) < 0) pay.push(it.id + ' button ' + k + ' focuses ' + f.focus);
    if (!/^(Set|Raise|Lower|Swap|Move|Put|Rename)\b/.test(f.label)) pay.push(it.id + ' button ' + k + ' does not start with a verb: ' + f.label);
  }));
  list('every button writes form keys, reads dictionary keys and starts with a verb', pay, advisory.concat(input).reduce((n, i) => n + (i.fix || []).length, 0) + ' buttons');
  const src = [];
  const fnSrc = (where, fn) => { const m = fn.toString().match(/\bc\.[A-Za-z_][A-Za-z_0-9]*/g) || []; m.forEach(x => { const k = x.slice(2); if (!KEYS[k]) src.push(where + ' reads c.' + k); }); };
  AC.ITEMS.forEach(it => {
    if (typeof it.when === 'function') fnSrc(it.id + ' when', it.when);
    if (typeof it.sev === 'function') fnSrc(it.id + ' sev', it.sev);
    (it.fix || []).forEach((f, k) => { if (f.when) fnSrc(it.id + ' button ' + k + ' when', f.when); });
  });
  Object.keys(AC.helpers).forEach(k => { if (typeof AC.helpers[k] === 'function') fnSrc('helper ' + k, AC.helpers[k]); });
  list('every key a `when`, a severity function, a button condition or a helper reads is a dictionary key', src, 'static scan of the function sources');
  const tdoc = [];
  AC.ITEMS.forEach(it => { if (it.term && TERMS.indexOf(it.term) < 0) tdoc.push(it.id + ' links ' + it.term); });
  list('every glossary term is one the page has (' + TERMS.length + ' ids)', tdoc, AC.ITEMS.filter(i => i.term).length + ' items link a term');
  const usedTerms = {}; AC.ITEMS.forEach(it => { if (it.term) usedTerms[it.term] = true; });
  ok('every glossary id the design names is linked by some item', TERMS.every(t => usedTerms[t]), Object.keys(usedTerms).sort().join(' '));

  /* ---- the voice, on the templates at the worst case of every placeholder */
  /* The widest figure each format can write, and the widest text each plain-text key carries. A format that
     writes no space (a degree, a clock time, a count) is one word; a figure with a unit is two; a lifetime past the
     cap, a clock-style duration and a range like "32 to 36 min" are four. A lifetime that the item's own condition
     bounds (life.short fires only for a mid-case life under two years) is written at its bound, because "more than a
     century" three times in a body that can never have it would only test an impossible orbit. */
  const WORST_FMT = { km: '35,786 km', km1: '35,786.0 km', km2: '35,786.00 km', kms: '12.34 km/s', deg0: '360°', deg1: '360.0°', deg2: '360.00°', deg3: '360.000°',
    deglat: '13.75°N', deglon: '100.5°E', min0: '1,436 min', min1: '1,436.1 min', min2: '1,436.07 min', dur: '12 h 00 min', hm: '23 h 56 min', rev2: '15.20 rev/day',
    ltan: '10:30', ddeg: '+0.986°/day', mday: '−0.3 min a day', life: 'more than a century', pct0: '100%', num0: '1,234', num1: '1,234.5', num2: '1,234.56',
    num3: '1,234.568', days1: '+12.3 days', hours1: '12.3 h', dayn: '16 days', am: '0.0043 m²/kg', sci: '3.71e-4 1/ER', e4: '0.0011', b: '32 to 36 min', txt: 'Kuala Lumpur' };
  const WORST_KEY = { passes: 'passes', start: '2026-10-01 12:00Z', epoch_utc: '2026-10-01 12:00:00Z', window_start: '2026-10-01 12:00Z', epoch_dir: 'before', ltan_dir: 'later', name: 'ISS (ZARYA)', cleaned: 'Kuala Lumpur Orbit One', name_free: 'Kuala Lumpur Orbit (mine)', raw: '97.4 degrees', field: 'Mean perigee altitude', why: 'semi-latus rectum below zero', hint: 'Raise perigee or lower e.', retro_lead: 'on the order of', drift_dir: 'east', plonger: 'shorter' };
  const LIFE_BOUND = {
    'life.days': { life_lo: '13 weeks', life_mid: '13 weeks', life_hi: '13 weeks' },
    'life.short': { life_lo: '24 months', life_mid: '24 months', life_hi: '24 months' },
    'life.range': { life_lo: '25 years', life_mid: '25 years', life_hi: '25 years' },
    'life.long': { life_lo: '100 years' },
    'kind.heo.drift': { argp_q_days: '45 years' }
  };
  const worst = (tpl, id) => tpl.replace(tokenRe(), (m, k, f) => {
    if ((f === undefined || f === 'txt') && WORST_KEY[k] !== undefined) return WORST_KEY[k];
    if (f === 'life') { if (LIFE_BOUND[id] && LIFE_BOUND[id][k]) return LIFE_BOUND[id][k]; if (k === 'fix_life') return '2.3 years'; }
    return WORST_FMT[f || 'txt'];
  });
  const stat = [];
  let maxWords = 0, maxTitle = 0, maxWordsId = '';
  AC.ITEMS.forEach(it => {
    const t = worst(it.title, it.id), b = worst(it.body, it.id);
    voiceProblems(t, 'title').forEach(p => stat.push(it.id + ' title: ' + p));
    voiceProblems(b, 'body').forEach(p => stat.push(it.id + ' body: ' + p));
    (it.fix || []).forEach(f => voiceProblems(worst(f.label, it.id), 'label').forEach(p => stat.push(it.id + ' button: ' + p)));
    if (it.basis) voiceProblems(it.basis, 'label').forEach(p => stat.push(it.id + ' basis: ' + p));
    if (words(b) > maxWords) { maxWords = words(b); maxWordsId = it.id; }
    maxTitle = Math.max(maxTitle, t.length);
  });
  voiceProblems(AC.FOOTER, 'label').forEach(p => stat.push('FOOTER: ' + p));
  AC.GROUPS.forEach(g => voiceProblems(worst(g.title, 'group'), 'label').forEach(p => stat.push('group ' + g.id + ': ' + p)));
  list('widest figure of every placeholder: titles <= 48 characters, bodies <= 70 words, sentences <= 32, no banned word, speaker, contraction or emoji', stat,
    'longest body ' + maxWords + ' words (' + maxWordsId + '), longest title ' + maxTitle + ' characters');

  /* ---- the formats */
  const F = AC.FMT;
  const fmtCases = [
    ['km', 6878.137, '6,878 km'], ['km', 35786.045, '35,786 km'], ['km', 999.5, '1,000 km'], ['km', 0.4, '0 km'], ['km1', 6878.137, '6,878.1 km'], ['km2', 6878.137, '6,878.14 km'],
    ['kms', 7.4, '7.40 km/s'], ['deg0', 13.75, '14°'], ['deg1', 97.426, '97.4°'], ['deg2', 97.426, '97.43°'], ['deg3', 0.0123, '0.012°'], ['deg2', -5.5, '−5.50°'],
    ['deglat', 13.75, '13.75°N'], ['deglat', 14, '14°N'], ['deglat', -33.9, '33.90°S'], ['deglon', 100.52, '100.5°E'], ['deglon', -77.04, '77.0°W'], ['deglon', 190, '170.0°W'],
    ['min0', 94.6163, '95 min'], ['min1', 94.6163, '94.6 min'], ['min2', 94.6163, '94.62 min'],
    ['dur', 32.1, '32.1 min'], ['dur', 60, '1 h 00 min'], ['dur', 434.4, '7 h 14 min'], ['hm', 716.9, '11 h 57 min'], ['hm', 1436.07, '23 h 56 min'], ['hm', 0.4, '0 h 00 min'],
    ['rev2', 15.2, '15.20 rev/day'], ['ltan', 10.5, '10:30'], ['ltan', 6, '06:00'], ['ltan', 12, '12:00'], ['ltan', 23.999, '00:00'], ['ltan', -1.5, '22:30'],
    ['ddeg', 0.98565, '+0.986°/day'], ['ddeg', -4.9492, '−4.949°/day'], ['ddeg', 0.0001, '0.000°/day'], ['mday', -0.34, '−0.3 min a day'], ['mday', 0.04, '+0.0 min a day'],
    ['pct0', 37.78, '38%'], ['num0', 1234567.8, '1,234,568'], ['num1', 1234.56, '1,234.6'], ['num2', 0.125, '0.13'], ['num3', 1.0006, '1.001'], ['num0', -1234.4, '−1,234'],
    ['days1', 3.26, '+3.3 days'], ['days1', -2.04, '−2.0 days'], ['hours1', 1.44, '1.4 h'],
    ['dayn', 1, '1 day'], ['dayn', 3.94, '3.94 days'], ['dayn', 16, '16 days'], ['dayn', 16.003, '16 days'], ['dayn', 0.99, '0.99 days'],
    ['am', 0.0043, '0.0043 m²/kg'], ['am', 0.01, '0.01 m²/kg'], ['am', 10, '10 m²/kg'], ['am', 0.0165, '0.0165 m²/kg'], ['sci', 0.000371, '3.71e-4 1/ER'], ['sci', 0.1, '1.00e-1 1/ER'],
    ['e4', 0.00112, '0.0011'], ['txt', 'abc', 'abc'], ['txt', 42, '42'], ['b', '32 to 36 min', '32 to 36 min'],
    ['life', null, 'more than a century'], ['life', Infinity, 'more than a century'], ['life', 36501, 'more than a century'], ['life', 36500, '100 years'],
    ['life', 0.5, 'under a day'], ['life', 1, '1 day'], ['life', 1.4, '1 day'], ['life', 1.5, '2 days'], ['life', 5, '5 days'], ['life', 13.4, '13 days'], ['life', 13.6, '14 days'],
    ['life', 14, '2 weeks'], ['life', 60, '9 weeks'], ['life', 89, '13 weeks'], ['life', 90, '3 months'], ['life', 143, '5 months'], ['life', 729, '24 months'],
    ['life', 730, '2.0 years'], ['life', 1721, '4.7 years'], ['life', 4383, '12 years']
  ];
  const fp = [];
  fmtCases.forEach(c => { const got = F[c[0]](c[1]); if (got !== c[2]) fp.push(c[0] + '(' + c[1] + ') = "' + got + '", expected "' + c[2] + '"'); });
  list('formats write the figures the design shows (' + fmtCases.length + ' cases, worked by hand)', fp, fmtCases.length + ' cases');
  const fnames = Object.keys(F);
  ok('the thirty-odd formats are all there', ['km', 'km1', 'km2', 'kms', 'deg0', 'deg1', 'deg2', 'deg3', 'deglat', 'deglon', 'min0', 'min1', 'min2', 'dur', 'hm', 'rev2', 'ltan', 'ddeg', 'mday', 'life', 'pct0', 'num0', 'num1', 'num2', 'num3', 'days1', 'hours1', 'dayn', 'am', 'sci', 'e4', 'b', 'txt'].every(k => typeof F[k] === 'function'),
    fnames.length + ' formats');
  const edges = [['km', -0.3, '0 km'], ['deg0', -0.3, '0°'], ['min0', -0.3, '0 min'], ['num0', -0.3, '0'], ['dur', 119.7, '2 h 00 min'], ['life', 1.2, '1 day']];
  list('no "−0", no "1 h 60 min", no "1 days"', edges.filter(c => F[c[0]](c[1]) !== c[2]).map(c => c[0] + '(' + c[1] + ') = ' + F[c[0]](c[1])), 'three formatter edge cases');
  // every format on a coarse grid of finite numbers never writes NaN, undefined, Infinity or an empty string
  const grid = [0, 1e-7, 0.0043, 0.5, 1, 13.75, 59.99, 90, 98.213, 359.9, 1440, 35786.045, 400000, -0.0001, -7, -1234.5];
  const gp = [];
  fnames.forEach(k => { if (k === 'b' || k === 'txt') return; grid.forEach(v => { const s = F[k](v); if (typeof s !== 'string' || s === '' || /NaN|undefined|Infinity|null/.test(s)) gp.push(k + '(' + v + ') = ' + s); }); });
  list('no format ever writes NaN, undefined, Infinity or an empty string for a finite number', gp, fnames.length + ' formats x ' + grid.length + ' numbers');

  /* ---- render and parts */
  const R = AC.render, P = AC.parts;
  const c0 = { a: 6878.137, n: 3, s: 'Bangkok', life: Infinity };
  ok('render fills {key} and {key:format}', R('{a:km} at {n:num0} for {s}', c0) === '6,878 km at 3 for Bangkok');
  ok('render of a template with no placeholder is the template', R('Plain words.', {}) === 'Plain words.' && R('', {}) === '');
  ok('a repeated placeholder is filled each time', R('{n:num0}, {n:num0}', c0) === '3, 3');
  ok('a value is inserted once and never scanned again for placeholders', R('{s:txt}', { s: '{a:km}', a: 1 }) === '{a:km}');
  const E = fn => { try { fn(); return null; } catch (e) { return e; } };
  const bad = [undefined, null, NaN, Infinity, -Infinity, '12', true, {}, []];
  const badOut = [];
  bad.forEach(v => { const e = E(() => R('{x:km}', { x: v })); if (!e || e.message !== 'unresolved {x}' || e.unresolved !== true || e.key !== 'x') badOut.push(String(v)); });
  const e0 = E(() => R('{x:km}', {})); if (!e0 || e0.message !== 'unresolved {x}') badOut.push('missing key');
  list('a numeric format throws Error("unresolved {k}") for a missing, undefined, null, NaN, infinite, string or boolean value', badOut, bad.length + 1 + ' kinds of bad value');
  const lifeOk = [Infinity, null, 0.5, 4000].every(v => !E(() => R('{x:life}', { x: v })));
  const lifeBad = [undefined, NaN, -Infinity, '5', true].every(v => { const e = E(() => R('{x:life}', { x: v })); return e && e.message === 'unresolved {x}'; });
  ok('format life alone accepts Infinity and null; undefined, NaN and strings still throw', lifeOk && lifeBad);
  const txtBad = [undefined, null, NaN, Infinity, true, {}].every(v => { const e = E(() => R('{x}', { x: v })); return e && e.message === 'unresolved {x}'; });
  ok('plain text takes a string or a finite number and nothing else', txtBad && R('{x}', { x: 'a' }) === 'a' && R('{x:b}', { x: 5 }) === '5' && R('{x:txt}', { x: 0 }) === '0');
  ok('an unknown format is a catalogue defect, not an unresolved figure', throwsWith(() => R('{x:zz}', { x: 1 }), /unknown format/) && !(E(() => R('{x:zz}', { x: 1 })).unresolved));
  ok('a template that is not a string throws a TypeError', E(() => R(5, {})) instanceof TypeError);
  ok('a null dictionary is unresolved, not a TypeError', throwsWith(() => R('{x}', null), /^unresolved \{x\}$/));
  const pp = P('At {a:km} over {s}, {n:num0} times, {life:life}: {k:b}.', { a: 100, s: 'Bangkok', n: 2, life: 5, k: '4 min' });
  ok('parts: text and bold figures, text for txt, bold for b, adjacent text merged', JSON.stringify(pp) === JSON.stringify([{ t: 'At ' }, { n: '100 km' }, { t: ' over Bangkok, ' }, { n: '2' }, { t: ' times, ' }, { n: '5 days' }, { t: ': ' }, { n: '4 min' }, { t: '.' }]), JSON.stringify(pp));
  ok('parts: an empty template has no parts and a lone placeholder is one', P('', {}).length === 0 && JSON.stringify(P('{a:km}', { a: 1 })) === '[{"n":"1 km"}]');
  const partsVsRender = [];
  texts.forEach(t => { try { const fc = fullContext(); const r1 = R(t.tpl, fc), r2 = P(t.tpl, fc).map(p => p.t !== undefined ? p.t : p.n).join(''); if (r1 !== r2) partsVsRender.push(t.where); } catch (e) { partsVsRender.push(t.where + ' ' + e.message); } });
  list('parts joined equals render, for every template', partsVsRender, texts.length + ' templates');
  ok('TOKEN is the placeholder pattern: {key} and {key:format}', AC.TOKEN.global && 'a {x} b {y:km}'.match(AC.TOKEN).length === 2);

  /* ---- one item written out */
  const full = fullContext();
  const RI = AC.renderItem;
  const keyHoles = Object.keys(KEYS).filter(k => full[k] === undefined);
  const kindBad = Object.keys(KEYS).filter(k => {
    const v = full[k], kd = KEYS[k];
    return v !== undefined && !(kd === 'n' ? typeof v === 'number' && (isFinite(v) || (v === Infinity && /^life_(lo|mid|hi)$/.test(k))) : kd === 't' ? typeof v === 'string' : kd === 'b' ? typeof v === 'boolean' : (v === null || (typeof v === 'number' && isFinite(v))));
  });
  ok('the generated "everything" dictionary supplies every key, each of the right kind', keyHoles.length === 0 && kindBad.length === 0,
    keyHoles.length ? 'missing ' + keyHoles.join(' ') : kindBad.length ? 'wrong kind ' + kindBad.join(' ') : Object.keys(KEYS).length + ' keys');
  const rsn = RI(byId['kind.sso.near'], full);
  ok('renderItem returns exactly the documented fields', Object.keys(rsn).sort().join(',') === 'basis,body,bodyText,fixes,group,id,sev,term,title,titleText,values,word', Object.keys(rsn).sort().join(','));
  ok('renderItem: word, term, basis, plain text and values',
    rsn.id === 'kind.sso.near' && rsn.group === 'type' && rsn.sev === 'warn' && rsn.word === 'Check' && rsn.term === 't-sso' && rsn.basis === null &&
    rsn.titleText === 'Close to sun-synchronous, not quite' && rsn.title.length === 1 &&
    rsn.bodyText === rsn.body.map(p => p.t !== undefined ? p.t : p.n).join('') &&
    Object.keys(rsn.values).sort().join(',') === 'h_mean,inc,ltan_dir,ltan_drift_abs,ltan_drift_year,node,sso_inc,sso_rate' && rsn.values.sso_inc === full.sso_inc);
  const fx0 = rsn.fixes[0];
  ok('renderItem: a button carries its label as parts, its text, the raw value to write and where the cursor goes',
    rsn.fixes.length === 1 && Array.isArray(fx0.label) && fx0.labelText === 'Set i to ' + F.deg2(full.sso_inc) + ' (sun-synchronous at this altitude)' &&
    typeof fx0.set.inc === 'number' && fx0.set.inc === full.sso_inc && fx0.focus === 'inc' && Object.keys(fx0).sort().join() === 'focus,label,labelText,set');
  ok('renderItem: an item with no basis or term says null', RI(byId['kind.iss'], full).basis === null && RI(byId['kind.iss'], full).term === null && RI(byId['kind.sso'], full).basis === 'J2 node rate, from SGP4’s own constants');
  ok('renderItem: a button that writes text writes the text (the free name)', RI(byId['err.name.taken'], full).fixes[0].set.name === 'ISS (ZARYA) (mine)' && RI(byId['err.name.taken'], full).fixes[0].labelText === 'Rename it to ISS (ZARYA) (mine)');
  const forced = [], forcedVoice = [];
  AC.ITEMS.forEach(it => {
    let r;
    try { r = RI(it, full, { strict: true }); } catch (e) { forced.push(it.id + ': ' + e.message); return; }
    if (r.fixes.length !== (it.fix || []).length) forced.push(it.id + ' shows ' + r.fixes.length + ' of ' + (it.fix || []).length + ' buttons');
    const read = {};
    texts.filter(t => t.where.indexOf(it.id + ' ') === 0).forEach(t => tokensOf(t.tpl).forEach(tk => { read[tk.key] = true; }));
    (it.fix || []).forEach(f => Object.keys(f.set).forEach(k => { const m = /^\{(.+)\}$/.exec(String(f.set[k])); if (m) read[m[1]] = true; }));
    Object.keys(read).forEach(k => { if (!(k in r.values)) forced.push(it.id + ' values lacks ' + k); });
    Object.keys(r.values).forEach(k => { if (!read[k]) forced.push(it.id + ' values has the unread key ' + k); });
    voiceProblems(r.titleText, 'title').forEach(p => forcedVoice.push(it.id + ' title: ' + p));
    voiceProblems(r.bodyText, 'body').forEach(p => forcedVoice.push(it.id + ' body: ' + p));
    r.fixes.forEach(f => voiceProblems(f.labelText, 'label').forEach(p => forcedVoice.push(it.id + ' button: ' + p)));
  });
  list('every one of the 87 items renders, strict, with every button, against a dictionary that supplies every key; values is what it read', forced, '87 items, every button');
  list('every item rendered against that dictionary passes the voice rules (a lifetime past the cap is four words)', forcedVoice, '87 items');
  const retroSev = v => RI(byId['sgp4.retro'], Object.assign({}, full, { retro_err: v })).sev;
  ok('sgp4.retro: Note under 10 km, Check to 100 km, Fix this above it', retroSev(1) === 'info' && retroSev(9.99) === 'info' && retroSev(10) === 'warn' && retroSev(100) === 'warn' && retroSev(100.01) === 'error' && retroSev(857) === 'error' &&
    RI(byId['sgp4.retro'], Object.assign({}, full, { retro_err: 857 })).word === 'Fix this');
  const heoSev = p => RI(byId['kind.heo.drift'], Object.assign({}, full, { period: p })).sev;
  ok('kind.heo.drift: Check for a Molniya- or Tundra-like period, Note otherwise', heoSev(717) === 'warn' && heoSev(600) === 'warn' && heoSev(780) === 'warn' && heoSev(SID_MIN) === 'warn' && heoSev(1436.07 * 1.005) === 'warn' && heoSev(400) === 'info' && heoSev(1000) === 'info' && heoSev(599.9) === 'info');
  ok('a severity that is not on the scale is a defect, not a word', throwsWith(() => RI({ id: 'x', group: 'caveat', sev: 'loud', title: 'T', body: 'B' }, {}), /unknown severity loud/));

  /* ---- input items, from the params of the error that raised them */
  const INPUT_PARAMS = {
    'err.missing': { field: 'inc' }, 'err.notnum': { field: 'ma', raw: '9x' }, 'err.inc.range': { inc: 181 }, 'err.ecc.neg': { e: -0.1 }, 'err.ecc.parabola': {}, 'err.ecc.hyper': { e: 1.2 },
    'err.perigee.surface': { rp: 6300.6, fix_hp: 200 }, 'err.apo.lt.peri': { ha: 300, hp: 500 }, 'err.a.range': { a: 450000, a_max: 400000 }, 'err.am.range': { am: 12 },
    'err.epoch.range': { epoch_utc: '1999-12-31 23:59:59Z' }, 'err.angle.wrap': { raw: 370, wrapped: 10 }, 'err.name.empty': {},
    'err.name.taken': { name: 'ISS (ZARYA)', name_free: 'ISS (ZARYA) (mine)' }, 'err.sgp4': { sgp4: 4, why: 'semi-latus rectum below zero', hint: 'Raise perigee or lower e.' },
    'err.cap': { cap: 12 }, 'err.storage': {}, 'err.name.cleaned': { cleaned: 'HYPERLINK("x") ok' },
    'err.bstar.range': { h_mean: 300, am: 5, bstar: 0.5, bstar_max: 0.1, am_max: 0.94 }, 'err.ltan.range': { raw: '25:61' },
    'sgp4.retro': { off180: 0.01, e: 0.01, retro_lead: 'about', retro_err: 857.1, inc: 179.99 }
  };
  const inpProblems = [];
  input.concat([byId['sgp4.retro']]).forEach(it => {
    if (!INPUT_PARAMS[it.id]) { inpProblems.push(it.id + ' has no params in this test'); return; }
    try {
      const r = AC.renderInput(it.id, INPUT_PARAMS[it.id]);
      voiceProblems(r.titleText, 'title').concat(voiceProblems(r.bodyText, 'body')).forEach(p => inpProblems.push(it.id + ': ' + p));
      if (r.fixes.length !== (it.fix || []).length) inpProblems.push(it.id + ' buttons ' + r.fixes.length);
    } catch (e) { inpProblems.push(it.id + ': ' + e.message); }
  });
  list('renderInput writes all 21 input messages from their params, within the voice rules', inpProblems, '20 input items and sgp4.retro');
  const ri = (id, p) => AC.renderInput(id, p);
  const wantText = [
    ['err.missing', 'titleText', 'Type a number for Inclination'], ['err.missing', 'bodyText', 'Inclination is empty, and the orbit cannot be worked out without it.'],
    ['err.notnum', 'titleText', 'Mean anomaly is not a number'], ['err.notnum', 'bodyText', '“9x” is not a number. Use digits and a decimal point, for example 97.4.'],
    ['err.inc.range', 'titleText', 'Inclination runs from 0° to 180°'], ['err.ecc.neg', 'bodyText', 'e = -0.1000. Zero is a circle; larger values stretch it.'],
    ['err.perigee.surface', 'bodyText', 'a(1 − e) = 6,300.6 km is under the Earth’s radius of 6,378.1 km, so the orbit would end underground.'],
    ['err.apo.lt.peri', 'bodyText', 'Apogee (300 km) is the high point and perigee (500 km) the low one. They look swapped.'],
    ['err.a.range', 'bodyText', 'a = 450,000 km is past 400,000 km, about the Moon’s distance. SGP4 describes orbits around the Earth; nothing out there is an Earth orbit.'],
    ['err.epoch.range', 'titleText', 'Epoch outside 2000 to 2056'],
    ['err.epoch.range', 'bodyText', 'The orbit is written as a TLE for SGP4, whose two-digit year spans 1957 to 2056; this planner accepts 2000 to 2056. 1999-12-31 23:59:59Z is outside that.'],
    ['err.angle.wrap', 'titleText', '370° is taken as 10.00°'], ['err.name.taken', 'titleText', 'ISS (ZARYA) is already a name'],
    ['err.sgp4', 'bodyText', 'SGP4 refused it with error 4: semi-latus rectum below zero. Raise perigee or lower e.'],
    ['err.cap', 'titleText', 'The saved list is full'], ['err.name.cleaned', 'titleText', 'Will be saved as “HYPERLINK("x") ok”'],
    ['err.bstar.range', 'titleText', 'Too much drag for SGP4 at this height'],
    ['err.bstar.range', 'bodyText', 'At 300 km an area-to-mass ratio of 5 m²/kg gives B* = 5.00e-1 1/ER. SGP4 expands drag in a short series that fails above 1.00e-1 1/ER: the orbit would be down within days, and the model could not follow it.'],
    ['err.ltan.range', 'titleText', 'Local time runs from 00:00 to 24:00'],
    ['err.ltan.range', 'bodyText', '“25:61” is not a time of day. Give hours and minutes as 10:30, or hours as a decimal such as 10.5.'],
    ['sgp4.retro', 'bodyText', 'The SGP4 formulas divide by the distance of the tilt from 180°, which here is 0.010°. With e = 0.0100 that can put the satellite about 857 km from where the mirror-image orbit places it. An inclination of exactly 180° or an eccentricity of 0 avoids it.']
  ];
  list('renderInput writes the messages word for word (' + wantText.length + ' strings worked by hand)', wantText.filter(w => ri(w[0], INPUT_PARAMS[w[0]])[w[1]] !== w[2]).map(w => w[0] + ' ' + w[1] + ': ' + ri(w[0], INPUT_PARAMS[w[0]])[w[1]]), wantText.length + ' strings');
  const fxs = [ri('err.perigee.surface', INPUT_PARAMS['err.perigee.surface']).fixes, ri('err.apo.lt.peri', INPUT_PARAMS['err.apo.lt.peri']).fixes, ri('err.bstar.range', INPUT_PARAMS['err.bstar.range']).fixes,
    ri('sgp4.retro', INPUT_PARAMS['sgp4.retro']).fixes];
  ok('renderInput buttons: Set perigee to 200 km, Swap them, the largest area-to-mass ratio, i to 180 or e to 0',
    fxs[0][0].labelText === 'Set perigee to 200 km' && JSON.stringify(fxs[0][0].set) === '{"hp":200}' && fxs[1][0].labelText === 'Swap them' && JSON.stringify(fxs[1][0].set) === '{"hp":300,"ha":500}' &&
    fxs[2][0].labelText === 'Set the area-to-mass ratio to 0.94 m²/kg' && JSON.stringify(fxs[2][0].set) === '{"am":0.94}' &&
    fxs[3].map(f => f.labelText + JSON.stringify(f.set)).join('|') === 'Set i to 180° exactly{"inc":180}|Set e to 0{"e":0}');
  const sgp4Err = Object.freeze({ field: '', code: 'err.sgp4', msg: 'SGP4 cannot start', sgp4: 6, why: 'decayed', hint: 'Raise perigee above the air, or lower the area-to-mass ratio.' });
  ok('renderInput takes the planner error as it is: its numeric `sgp4` is the {code}, not its `code` (the item id), and the object is not changed',
    ri('err.sgp4', sgp4Err).bodyText === 'SGP4 refused it with error 6: decayed. Raise perigee above the air, or lower the area-to-mass ratio.');
  ok('renderInput: a form key in `field` is written as its label, a label as itself',
    ri('err.missing', { field: 'hp' }).titleText === 'Type a number for Mean perigee altitude' && ri('err.missing', { field: 'raan' }).titleText === 'Type a number for Node (RAAN)' &&
    ri('err.missing', { field: 'Epoch' }).titleText === 'Type a number for Epoch' && ri('err.notnum', { field: 'argp', raw: 'x' }).titleText === 'Argument of perigee is not a number');
  ok('renderInput: a missing param throws "unresolved {k}", an unknown code throws, so the page falls back to the plain message',
    throwsWith(() => ri('err.notnum', { field: 'inc' }), /^unresolved \{raw\}$/) && throwsWith(() => ri('err.nothing', {}), /unknown item/) && throwsWith(() => ri('sgp4.retro', { e: 0.01 }), /^unresolved \{/));
  ok('renderInput: a text value is shown as typed, braces and all, and never expanded',
    ri('err.notnum', { field: 'inc', raw: '{inc:deg2}' }).bodyText.indexOf('“{inc:deg2}” is not a number') === 0);

  const retroNoLead = ri('sgp4.retro', { off180: 0.01, e: 0.01, retro_err: 857.1, inc: 179.99 });
  ok('renderInput: sgp4.retro from the planner\'s own params (no retro_lead) takes the cautious wording; with retro_lead it uses the caller\'s',
    retroNoLead.bodyText.indexOf('can put the satellite on the order of 857 km from') > 0 && retroNoLead.sev === 'error' &&
    ri('sgp4.retro', INPUT_PARAMS['sgp4.retro']).bodyText.indexOf('can put the satellite about 857 km from') > 0);

  /* ---- the field names the sentences use are the planner's, when the planner is loaded (verify-advisor.js loads it) */
  const PL = extra.Planner || globalThis.Planner;
  if (PL && PL.FIELD_LABEL) {
    const lbl = Object.keys(PL.FIELD_LABEL).filter(k => ri('err.missing', { field: k }).titleText !== 'Type a number for ' + PL.FIELD_LABEL[k]);
    list('renderInput names every field as Planner.FIELD_LABEL does (' + Object.keys(PL.FIELD_LABEL).length + ' fields)', lbl.map(k => k + ' reads "' + ri('err.missing', { field: k }).titleText + '"'), Object.keys(PL.FIELD_LABEL).length + ' fields');
  }

  /* ---- a pass over a whole dictionary */
  const mk = (id, over) => Object.assign({ id: id, group: 'caveat', sev: 'info', flags: {}, when: () => true, title: 'T ' + id, body: 'B ' + id }, over || {});
  const fxr = (label, set, o) => Object.assign({ label: label, set: set, focus: 'inc' }, o || {});
  const cc = { a: 5, k: 10, nm: 'ISS', e: 0, h_mean: 500, hp: 500, ha: 500, period: 94.6 };
  const r1 = AC.advise(cc, { items: [mk('ok.1'), mk('bad.when', { when: () => { throw new Error('boom'); } }), mk('ok.2')] });
  ok('a `when` that throws drops that item alone, and says so', r1.items.map(i => i.id).join() === 'ok.1,ok.2' && r1.dropped.items.length === 1 && r1.dropped.items[0].id === 'bad.when' && /boom/.test(r1.dropped.items[0].why));
  ok('strict mode rethrows a throwing `when`', throwsWith(() => AC.advise(cc, { strict: true, items: [mk('bad.when', { when: () => { throw new Error('boom'); } })] }), /boom/));
  const r2 = AC.advise(cc, { items: [mk('ok.1'), mk('bad.body', { body: 'B {nokey:km}' }), mk('bad.title', { title: '{nokey}' }), mk('ok.2')] });
  ok('an item whose title or body names a missing key is dropped alone; strict mode rethrows it', r2.items.map(i => i.id).join() === 'ok.1,ok.2' && r2.dropped.items.length === 2 &&
    throwsWith(() => AC.advise(cc, { strict: true, items: [mk('bad.body', { body: 'B {nokey:km}' })] }), /^unresolved \{nokey\}$/));
  const itemF = mk('fix.item', { fix: [
    fxr('Set A to {a:km}', { inc: '{a}' }),
    fxr('Set B to {nokey:km}', { inc: '{nokey}' }),
    fxr('Set C', { inc: 1 }, { when: () => false }),
    fxr('Set D', { inc: 2 }, { when: () => { throw new Error('fixboom'); } }),
    fxr('Set E to {k:km}', { e: '{k}' }),
    fxr('Rename to {nm}', { name: '{nm}' }) ] });
  const r3 = AC.advise(cc, { items: [itemF] });
  const lab = r3.items[0].fixes.map(f => f.labelText).join('|');
  ok('a button whose `when` is false, whose `when` throws or whose key is missing is dropped alone, never its item',
    r3.items.length === 1 && lab === 'Set A to 5 km|Set E to 10 km|Rename to ISS' && r3.dropped.items.length === 0 &&
    r3.dropped.fixes.map(f => f.label).join('|') === 'Set B to {nokey:km}|Set D' && JSON.stringify(r3.items[0].fixes.map(f => f.set)) === '[{"inc":5},{"e":10},{"name":"ISS"}]');
  ok('strict mode rethrows a button that throws, but a button whose key is merely missing is absent, never an error',
    throwsWith(() => AC.advise(cc, { strict: true, items: [itemF] }), /fixboom/) &&
    AC.advise(cc, { strict: true, items: [mk('f2', { fix: [fxr('Set B to {nokey:km}', { inc: '{nokey}' }), fxr('Set A to {a:km}', { inc: '{a}' })] })] }).items[0].fixes.length === 1);
  const r4 = AC.advise(cc, { items: [mk('f3', { fix: [fxr('Set X', { inc: 'abc' }), fxr('Set Y', { inc: 3 })] })] });
  ok('a payload that is neither a number nor a {key} is a defect: dropped alone, rethrown in strict mode',
    r4.items[0].fixes.length === 1 && r4.dropped.fixes.length === 1 && throwsWith(() => AC.advise(cc, { strict: true, items: [mk('f3', { fix: [fxr('Set X', { inc: 'abc' })] })] }), /neither a number nor a/));
  ok('an undefined dictionary key makes a button absent and leaves the item (the fix guard)', (() => {
    const r = AC.advise(Object.assign({}, cc, { fix_h: undefined }), { strict: true, items: [mk('f4', { fix: [fxr('Raise the orbit to {fix_h:km}', { hp: '{fix_h}' })] })] });
    return r.items.length === 1 && r.items[0].fixes.length === 0 && r.dropped.items.length === 0;
  })());
  const ordItems = [mk('t.1', { group: 'type', sev: 'good' }), mk('t.2', { group: 'type', sev: 'error' }), mk('s.1', { group: 'sun', sev: 'good' }), mk('s.2', { group: 'sun', sev: 'warn' }),
    mk('s.3', { group: 'sun', sev: 'bad' }), mk('s.4', { group: 'sun', sev: 'info' }), mk('s.5', { group: 'sun', sev: 'warn' }), mk('c.1', { group: 'caveat', sev: 'info' }),
    mk('g.1', { group: 'ground', sev: 'info' }), mk('v.1', { group: 'survive', sev: 'info' }), mk('s.6', { group: 'sun', sev: 'error' })];
  const ro = AC.advise(cc, { items: ordItems });
  ok('order: groups as listed; type in catalogue order; the rest Fix this, Problem, Check, Note, Good, then catalogue order',
    ro.items.map(i => i.id).join() === 't.1,t.2,v.1,s.6,s.3,s.2,s.5,s.4,s.1,g.1,c.1', ro.items.map(i => i.id).join());
  ok('counts are tallied by severity', JSON.stringify(ro.counts) === '{"error":2,"bad":1,"warn":2,"info":4,"good":2}', JSON.stringify(ro.counts));
  const wst = sevs => AC.advise(cc, { items: sevs.map((s, i) => mk('w' + i, { sev: s })) }).worst;
  ok('worst: bad or error colours it bad, else warn, else good, else info (nothing at all is info)',
    wst([]) === 'info' && wst(['info']) === 'info' && wst(['good']) === 'good' && wst(['info', 'good']) === 'good' && wst(['warn', 'good']) === 'warn' && wst(['bad', 'warn']) === 'bad' && wst(['error']) === 'bad');
  ok('a severity that is a function of the numbers is evaluated for the dictionary', AC.advise({ k: 10 }, { items: [mk('fn', { sev: c => c.k > 5 ? 'warn' : 'info' })] }).items[0].sev === 'warn' &&
    AC.advise({ k: 1 }, { items: [mk('fn', { sev: c => c.k > 5 ? 'warn' : 'info' })] }).items[0].sev === 'info');
  const hostItems = [mk('d.only', { flags: { draftOnly: true }, fix: [fxr('Set A to {a:km}', { inc: '{a}' })] }), mk('both', { fix: [fxr('Set A to {a:km}', { inc: '{a}' })] }), mk('tr.only', { flags: { trackedOnly: true } })];
  const hd = AC.advise(cc, { items: hostItems }), hr = AC.advise(cc, { items: hostItems, host: 'readonly' });
  ok('host: draft skips tracked-only items; readonly skips draft-only items and offers no buttons',
    hd.items.map(i => i.id).join() === 'd.only,both' && hd.items[0].fixes.length === 1 && hr.items.map(i => i.id).join() === 'both,tr.only' && hr.items.every(i => i.fixes.length === 0));
  const leo = syntheticContext({ hp: 500, ha: 500, inc: 51.6, raan: 100 }, { site: BKK });
  const rl = adv(leo);
  ok('verdict head: the name of the first type item, the height, the period; sub is left for the page',
    JSON.stringify(rl.verdict) === JSON.stringify({ head: [{ t: 'Circular low Earth orbit' }, { t: ' · ' }, { n: '500 km' }, { t: ' · ' }, { n: '94.6 min' }], sub: null }), JSON.stringify(rl.verdict.head));
  const mol = adv(syntheticContext({ a: 26554.137, e: 0.74, inc: 63.4, argp: 270 }, { site: BKK }));
  ok('verdict head: an eccentric orbit shows both heights, and a long period as hours and minutes', mol.verdict.head[0].t === 'Molniya-type orbit' && mol.verdict.head[2].n === '526 km × 39,826 km' && /^\d+ h \d\d min$/.test(mol.verdict.head[4].n), JSON.stringify(mol.verdict.head));
  ok('verdict head: with no type item it says Orbit; with no figures it is just the name, and strict mode says which figure is missing',
    JSON.stringify(AC.advise(cc, { items: [] }).verdict.head) === '[{"t":"Orbit"},{"t":" · "},{"n":"500 km"},{"t":" · "},{"n":"94.6 min"}]' &&
    JSON.stringify(AC.advise({ k: 1 }, { items: [] }).verdict.head) === '[{"t":"Orbit"}]' && throwsWith(() => AC.advise({ k: 1 }, { strict: true, items: [] }), /^unresolved \{hp\}$/));
  ok('advise drops nothing in a healthy run, and reports its dropped lists', rl.dropped && Array.isArray(rl.dropped.items) && Array.isArray(rl.dropped.fixes) && rl.dropped.items.length === 0);
  const frozen = Object.freeze(Object.assign({}, full));
  ok('advise and renderItem never write to the dictionary (a frozen one passes in strict mode)', (() => { try { adv(frozen); AC.ITEMS.forEach(it => RI(it, frozen, { strict: true })); return true; } catch (e) { return false; } })());
  ok('the same dictionary gives the same list, written the same (deterministic)',
    JSON.stringify(adv(full)) === JSON.stringify(adv(Object.assign({}, full))) && JSON.stringify(adv(leo)) === JSON.stringify(adv(syntheticContext({ hp: 500, ha: 500, inc: 51.6, raan: 100 }, { site: BKK }))));

  /* ---- the speaker is one constant */
  const sayAll = () => JSON.stringify([adv(full), adv(full, { host: 'readonly' }), AC.ITEMS.map(i => RI(i, full, { strict: true })), AC.GROUPS.map(g => R(g.title, full)), AC.FOOTER, AC.ITEMS.map(i => i.basis)]);
  const saved = AC.ADVISOR_LABEL, before = sayAll();
  let stubbed;
  try { AC.ADVISOR_LABEL = 'Zq Tutor'; stubbed = sayAll(); } finally { AC.ADVISOR_LABEL = saved; }
  ok('stub ADVISOR_LABEL to "Tutor": no sentence, button, group title, basis or footer changes (none reads it) and none contains the label',
    stubbed === before && before.indexOf('Zq Tutor') < 0 && before.indexOf(saved) < 0 && before.indexOf('Professor') < 0 && AC.ADVISOR_LABEL === saved);

  /* ---- orbits of every kind, through the real pass */
  const firedAll = {};
  const scn = [], scnVoice = [], dirs = [];
  const lintRendered = (tag, r, sink) => {
    voiceProblems(r.titleText, 'title').forEach(p => sink.push(tag + ' ' + r.id + ' title: ' + p));
    voiceProblems(r.bodyText, 'body').forEach(p => sink.push(tag + ' ' + r.id + ' body: ' + p));
    r.fixes.forEach(f => voiceProblems(f.labelText, 'label').forEach(p => sink.push(tag + ' ' + r.id + ' button: ' + p)));
    if (r.basis) voiceProblems(r.basis, 'label').forEach(p => sink.push(tag + ' ' + r.id + ' basis: ' + p));
  };
  const direction = (tag, c, r) => r.fixes.forEach(f => {
    const raise = /^Raise\b/.test(f.labelText), lower = /^Lower\b/.test(f.labelText);
    if ((raise || lower) && typeof f.set.hp === 'number') {
      if (raise && !(f.set.hp > c.hp + 5)) dirs.push(tag + ' ' + r.id + ': "' + f.labelText + '" does not raise perigee by more than 5 km (' + F.km(c.hp) + ' to ' + F.km(f.set.hp) + ')');
      if (lower && !(f.set.hp < c.hp - 5)) dirs.push(tag + ' ' + r.id + ': "' + f.labelText + '" does not lower perigee by more than 5 km (' + F.km(c.hp) + ' to ' + F.km(f.set.hp) + ')');
    }
  });
  SCENARIOS.forEach(s => {
    const env = Object.assign({ site: s.site || BKK }, s.env || {});
    let c, res;
    try { c = ctxOf(s.form, env); res = adv(c, { host: s.host }); } catch (e) { scn.push(s.name + ' threw ' + e.message); return; }
    const got = res.items.map(i => i.id);
    got.forEach(id => { firedAll[id] = true; });
    s.fire.forEach(id => { if (got.indexOf(id) < 0) scn.push(s.name + ': ' + id + ' did not fire (fired ' + got.join(' ') + ')'); });
    s.not.forEach(id => { if (got.indexOf(id) >= 0) scn.push(s.name + ': ' + id + ' fired'); });
    Object.keys(s.buttons || {}).forEach(id => {
      const it = res.items.find(x => x.id === id), labs = it ? it.fixes.map(f => f.labelText) : null;
      if (JSON.stringify(labs) !== JSON.stringify(s.buttons[id])) scn.push(s.name + ': ' + id + ' buttons are ' + JSON.stringify(labs) + ', expected ' + JSON.stringify(s.buttons[id]));
    });
    res.items.forEach(r => { lintRendered(s.name, r, scnVoice); direction(s.name, c, r); });
  });
  list('orbits of every kind: what must fire does, what must not does not (' + SCENARIOS.length + ' orbits)' + (real ? ', real dictionary' : ''), scn, SCENARIOS.length + ' orbits');
  list('every item that fires for those orbits passes the voice rules', scnVoice, Object.keys(firedAll).length + ' distinct items fired');
  list('a button that says Raise or Lower moves the perigee that way by more than 5 km', dirs, 'every Raise and Lower button of every fired item');

  /* ---- a button that needs a figure the dictionary computes only on demand */
  if (!real) {
    const reads = {}, lz = { reads: reads };
    adv(syntheticContext(SCENARIOS[0].form, { site: BKK, lazy: lz }));
    const quiet = ['fix_h', 'fix_life', 'fix_h25', 'fix_h5', 'fix_hp'].filter(k => reads[k]);
    const r2d = {}, lz2 = { reads: r2d };
    const sso = adv(syntheticContext(SCENARIOS[4].form, { site: BKK, lazy: lz2 }));
    ok('lifetime fixes are worked out only for an item that fires and reads them (none for a 500 km orbit; the two Lower heights, not the Raise height, for a sun-synchronous 700 km)',
      quiet.length === 0 && sso.items.some(i => i.id === 'life.long') && r2d.fix_h25 >= 1 && r2d.fix_h5 >= 1 && !r2d.fix_h && !r2d.fix_life, 'reads ' + JSON.stringify(r2d));
  }

  /* ---- the orbits the catalogue was scanned over: no hole in the "kind" items */
  const TILTS = [0, 0.1, 0.5, 2, 5, 28.5, 45, 51.6, 53, 63.4, 87, 90, 90.5, 92, 94, 97, 98, 110, 120, 150, 170, 179.99, 180];
  const SHAPES = [[200, 200], [250, 250], [300, 300], [400, 400], [470, 470], [480, 480], [550, 550], [800, 800], [1200, 1200], [1500, 1500], [2500, 2500], [5000, 5000], [8000, 8000], [12000, 12000],
    [20000, 20000], [26000, 26000], [30000, 30000], [34000, 34000], [35000, 35000], [36000, 36000], [38000, 38000], [45000, 45000], [60000, 60000], [100000, 100000], [300, 2000], [500, 8000],
    [1000, 12000], [500, 20000], [1000, 30000], [500, 50000], [35786, 35786], [35700, 35800], [34000, 38000], [35786 - 300, 35786 + 300],
    [526, 39826], [250, 35786], [24401.5, 47170.4]];     // the last three: Molniya, a transfer orbit and Tundra, at every tilt
  const holes = [], twice = [], gridVoice = [], gridThrew = [];
  let nGrid = 0, skipped = 0;
  TILTS.forEach((inc, ti) => SHAPES.forEach((hh, si) => {
    const variant = (ti + si) % 3;
    const form = { hp: hh[0], ha: hh[1], inc: inc, raan: (ti * 37 + si * 11) % 360, argp: variant === 1 ? 40 : 0, ma: (si * 53) % 360, am: variant === 2 ? (si % 2 ? 0 : 0.5) : 0.0043 };
    const env = { site: BKK };
    if (variant === 1) { env.window = { startMs: EPOCH + [0.5, 2, 6][si % 3] * 864e5, hours: 24 }; env.measured = si % 4 === 0 ? Object.assign({}, STAT, { n: 0, totalS: 0, longestS: 0, bestEl: 0 }) : STAT; }
    let res, c;
    try { c = ctxOf(form, env); } catch (e) { if (real) { skipped++; return; } gridThrew.push(JSON.stringify(hh) + ' i ' + inc + ': ' + e.message); return; }
    try { res = adv(c); } catch (e) { gridThrew.push(JSON.stringify(hh) + ' i ' + inc + ': ' + e.message); return; }
    nGrid++;
    const got = res.items.map(i => i.id);
    got.forEach(id => { firedAll[id] = true; });
    const kinds = got.filter(id => id.indexOf('kind.') === 0);
    if (kinds.length === 0) holes.push('hp ' + hh[0] + ' ha ' + hh[1] + ' i ' + inc);
    if (kinds.indexOf('kind.retro') >= 0 && kinds.indexOf('kind.polar') >= 0) twice.push('hp ' + hh[0] + ' i ' + inc);
    res.items.forEach(r => lintRendered('grid hp ' + hh[0] + ' ha ' + hh[1] + ' i ' + inc, r, gridVoice));
  }));
  list('no orbit of ' + TILTS.length + ' tilts x ' + SHAPES.length + ' shapes runs the catalogue into an error', gridThrew, nGrid + ' orbits' + (skipped ? ', ' + skipped + ' not buildable by the real context' : ''));
  list('every orbit has at least one "what kind of orbit" item', holes, nGrid + ' orbits');
  list('no orbit is both polar and retrograde', twice, nGrid + ' orbits');
  list('every item that fires over the grid passes the voice rules', gridVoice, nGrid + ' orbits');

  /* ---- seeded random orbits */
  const rng = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const rnd = rng(20260930);
  const U = (lo, hi) => lo + (hi - lo) * rnd(), LU = (lo, hi) => Math.exp(U(Math.log(lo), Math.log(hi))), pick = a => a[Math.floor(rnd() * a.length)];
  const SITES = [BKK, { name: 'Tromso', lat: 69.65, lon: 18.96, tz: 1 }, { name: 'Quito', lat: -0.18, lon: -78.5, tz: -5 }, { name: 'Hobart', lat: -42.88, lon: 147.33, tz: 10 }];
  const randVoice = [], randThrew = [], randDet = [];
  let nRand = 0;
  for (let k = 0; k < 400; k++) {
    const circ = rnd() < 0.4;
    let f;
    if (circ) { const h = LU(150, 60000); f = { hp: h, ha: h }; }
    else { const e = U(0.002, 0.85), rp = RE + LU(150, 20000); f = { a: rp / (1 - e), e: e }; }
    f.inc = rnd() < 0.3 ? pick([0, 0.3, 5, 28.5, 51.6, 63.4, 90, 97.4, 98.2, 116.6, 179.99, 180]) : U(0, 180);
    f.raan = U(0, 360); f.argp = U(0, 360); f.ma = U(0, 360);
    f.am = rnd() < 0.2 ? pick([0, 0.001, 0.0043, 0.05, 0.5, 5]) : LU(0.0005, 0.1);
    const env = { site: pick(SITES) };
    if (rnd() < 0.5) {
      env.window = { startMs: EPOCH + U(-5, 12) * 864e5, hours: pick([6, 24, 168]) };
      env.measured = { n: Math.floor(U(0, 12)), totalS: U(0, 7200), longestS: U(0, 900), bestEl: U(5, 90), altMin: U(100, 900), altMax: U(100, 900), surfSwing: U(0, 25), rSwing: U(0, 30) };
      env.measured.altMax = Math.max(env.measured.altMax, env.measured.altMin);
    }
    let c, res;
    try { c = ctxOf(f, env); } catch (e) { if (real) continue; randThrew.push('form ' + k + ': ' + e.message); continue; }
    try { res = adv(c); } catch (e) { randThrew.push('form ' + k + ' ' + JSON.stringify(f) + ': ' + e.message); continue; }
    nRand++;
    res.items.forEach(r => { firedAll[r.id] = true; lintRendered('random ' + k, r, randVoice); });
    if (k % 4 === 0 && JSON.stringify(res) !== JSON.stringify(adv(c))) randDet.push('form ' + k);
  }
  list('400 seeded random orbits never run the catalogue into an error', randThrew, nRand + ' orbits');
  list('every item that fires for them passes the voice rules, and the same dictionary gives the same list', randVoice.concat(randDet), nRand + ' orbits');
  const neverFired = advisory.map(i => i.id).filter(id => !firedAll[id]);
  list('every one of the 67 advisory items fired for at least one of those orbits (a condition that can never be true is a dead record)', neverFired.map(id => id + ' never fired'), Object.keys(firedAll).length + ' of 67 advisory items fired');

  /* ---- with the real dictionary, the keys the templates read are there */
  if (real) {
    const probe = ctxOf({ hp: 700, ha: 700, inc: 98.2130, nodeMode: 'ltan', ltan: 10.5, argp: 0, ma: 0, am: 0.0043 },
      { site: BKK, window: WIN0, measured: STAT, tracked: false });
    const message = 'field raw wrapped code why hint name_free cleaned cap a_max'.split(' ');
    const situational = 'fix_h fix_life fix_h25 fix_h5 fix_hp near_K near_D near_h near_dh K D rgt_days rgt_off rgt_gap'.split(' ');
    const missing = Object.keys(KEYS).filter(k => message.indexOf(k) < 0 && situational.indexOf(k) < 0 && probe[k] === undefined);
    list('the real dictionary supplies every key of the contract for a sun-synchronous orbit with a window and a trial run', missing.map(k => k + ' is undefined'), Object.keys(KEYS).length + ' keys');
  }

  /* ---- what this file is: data and formatters, loadable anywhere */
  const srcText = fs.readFileSync(MODULE_PATH, 'utf8');
  const code = srcText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const wrapperLine = "})(typeof window !== 'undefined' ? window : globalThis);";
  const forbidden = [];
  [[new RegExp('\\?' + '\\.[A-Za-z_$\\[(]'), 'optional chaining'], [new RegExp('\\?' + '\\?'), 'nullish coalescing'], [new RegExp('inner' + 'HTML'), 'inner' + 'HTML'], [/\bdocument\s*\./, 'document'], [/localStorage|sessionStorage|indexedDB/, 'storage'],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket/, 'network'], [/Date\.now|new Date|performance\.now/, 'the clock'], [/Math\.random/, 'randomness'], [/\brequire\s*\(|\bprocess\s*\.|\bimport\s*[({]/, 'a module'],
    [/\bconsole\s*\./, 'console'], [/\bsetTimeout|setInterval|requestAnimationFrame/, 'a timer']].forEach(p => { if (p[0].test(code.replace(wrapperLine, ''))) forbidden.push(p[1]); });
  if (/\bwindow\s*[.\[]|typeof window/.test(code.replace(wrapperLine, ''))) forbidden.push('window outside the wrapper');
  list('advisor-copy.js is pure: no optional chaining or nullish coalescing, no DOM, storage, network, clock, randomness, timer or module', forbidden, 'source scanned without comments');
  ok('advisor-copy.js is an IIFE over (window or globalThis), strict, like lifetime.js', /^\(function\(global\)\{\s*\n'use strict';/m.test(srcText) && srcText.replace(/\s+$/, '').endsWith(wrapperLine));
  const profLines = code.split('\n').filter(l => /Professor/.test(l));
  ok('"Professor" appears once outside comments: the definition of ADVISOR_LABEL', profLines.length === 1 && /ADVISOR_LABEL\s*=\s*'Professor’s notes'/.test(profLines[0]), profLines.length + ' line(s)');
  const bare = vm.createContext({});
  vm.runInContext(srcText, bare, { filename: 'advisor-copy.js' });
  ok('it loads in a context with no window, Planner, Advisor or Lifetime, and works there',
    bare.AdvisorCopy && bare.AdvisorCopy.ITEMS.length === 87 && typeof bare.Planner === 'undefined' && typeof bare.Advisor === 'undefined' && bare.AdvisorCopy.render('{a:km}', { a: 6878.137 }) === '6,878 km');
  const win = {}, withWin = vm.createContext({ window: win });
  vm.runInContext(srcText, withWin, { filename: 'advisor-copy.js' });
  ok('in a browser it attaches to window', win.AdvisorCopy && win.AdvisorCopy.ITEMS.length === 87 && typeof withWin.AdvisorCopy === 'undefined');

  return { items: AC.ITEMS.length, scenarios: SCENARIOS.length, grid: nGrid, random: nRand, fired: Object.keys(firedAll).length };
}

module.exports = { run: run, EXPECT: EXPECT, FORM_KEYS: FORM_KEYS, TERMS: TERMS, KEYS: KEYS, SCENARIOS: SCENARIOS, syntheticContext: syntheticContext, fullContext: fullContext, voiceProblems: voiceProblems };

if (require.main === module) {
  let fails = 0, passes = 0;
  const chk = (name, ok, detail) => {
    if (ok) passes++; else fails++;
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  };
  let summary = null;
  try { summary = run(chk); } catch (e) { fails++; console.log('  FAIL  the checks threw   ' + (e && e.stack || e)); }
  console.log('\n' + (summary ? summary.items + ' items, ' + summary.scenarios + ' scenarios, ' + summary.grid + ' grid orbits, ' + summary.random + ' random orbits; ' + passes + ' checks passed' : ''));
  console.log(fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS');
  process.exit(fails ? 1 : 0);
}
