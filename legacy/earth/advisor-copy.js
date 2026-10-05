/* advisor-copy.js — what the Professor says, when it says it, and how a figure is written.
 *
 * The Professor is two layers with one contract between them. advisor.js works
 * the numbers out of a set of mean elements and hands over a flat dictionary
 * `c`: {h_mean: 700.0, period: 98.8, sso_inc: 98.21, life_mid: 4380, ...}. This
 * file holds the 87 situations that can be said about an orbit, each as ONE
 * record {id, group, sev, flags, term, when(c), title, body, basis, fix[]}, and
 * the code that decides which of them fire for a given `c` and writes them out.
 * The dictionary is the only thing the two files share, which is why a new
 * sentence never needs new maths unless it needs a new key, and why a new
 * kernel stays invisible until some record reads its key.
 *
 * Why the words are kept apart from the maths:
 *
 *   - The label is ONE constant (ADVISOR_LABEL). No title, body or fix label
 *     ever names the speaker, says "I" or "we", or contains the label, so
 *     renaming the panel to "Advisor's notes" or "Tutor", or translating it,
 *     is one line and the sentences stay true.
 *   - There is no logic in a template. A plural, or a choice between two
 *     wordings, is a separate placeholder ({passes:txt}, {plonger}) or a separate
 *     record, never an `if` inside a string. `when(c)` is the single place where
 *     a record's situation is written down, and it reads only `c`.
 *   - Every record is checked as data (verification/advisor-copy-checks.js): the
 *     voice rules below, the keys a template reads, the keys a fix writes.
 *
 * Placeholders are {key} or {key:format}. A placeholder renders as one bold
 * figure, value and unit together ("700 km", "+0.986°/day"), so a reader learns
 * that bold means "worked out from your elements, or from this page's own
 * run". The two exceptions are the plain-text formats: `txt` (a name, a
 * direction, a date: words, never bold) and `b` (an already-written figure such
 * as "32 to 36 min", bold). Nothing else is ever bold. render() throws
 * Error('unresolved {key}') for a key that is missing, undefined, NaN or
 * infinite (format `life` alone accepts Infinity: "more than a century"), so a
 * sentence can never reach the screen with a hole in it; advise() turns that
 * throw into "this item is dropped" and, with opts.strict, lets it through so a
 * test sees it.
 *
 * Voice (a patient lecturer in office hours): name the orbit, say why in one
 * sentence of mechanism, use the student's own numbers, say what to do. Titles
 * are at most 48 characters and bodies at most 70 words with no sentence over 32;
 * none of "wrong", "mistake", "obviously", "simply", "just", "clearly",
 * "trivial", "bad", "perfect", "optimal", "guarantee", "careless" appears; no
 * contractions, exclamation marks or emoji. Certainty has a fixed ladder because
 * the author of this console is allergic to overclaiming: "is" = computed here
 * from these numbers; "about" / "roughly" = closed form, rounded; "usually" /
 * "often" = convention; "between X and Y" = a range, always for a lifetime
 * (which is never a date); "this page does not model" = a stated limit.
 * {site} and {site_lat} are the observer, never a literal city.
 *
 * Pure data and formatters: no DOM, no storage, no network, no clock. It loads
 * in Node with no other module present (Planner and Advisor are not needed at
 * load time), so the catalogue can be linted without a browser.
 */
(function(global){
'use strict';

/* The single constant. Read by the panel heading, its region name, the spoken
   summary and the basis tooltip in plannerui.js, and by nothing in this file:
   no sentence below refers to the speaker. */
const ADVISOR_LABEL = 'Professor’s notes';

const FOOTER = 'Closed-form estimates from mean elements: SGP4 for gravity’s bulges, a fixed drag and a cylindrical shadow. Nothing here knows about thrusters, sunlight pushing on the satellite, or what the Sun does next year. Good for learning, sizing and comparing orbits; for a real mission use a mission-analysis tool such as GMAT.';

/* The five groups of advisory items, in the order they are listed. The
   `input` group is not here: those records are the messages under a field
   (and, when the form cannot be flown, the whole list), raised by Planner and
   the page rather than by a `when`. A title may carry a placeholder
   ({site}); the panel renders it with render(title, c). */
const GROUPS = [
  { id: 'type',    title: 'What kind of orbit is this?' },
  { id: 'survive', title: 'Will it survive?' },
  { id: 'sun',     title: 'Sun and eclipse' },
  { id: 'ground',  title: 'Ground track and {site}' },
  { id: 'caveat',  title: 'Caveats' }
];

/* Severity: the word is what is read out and what stays when colour does not,
   the glyph name picks a shape (circle, triangle, square) so the scale reads in
   greyscale too, and the rank orders a group (Fix this first, Good last).
   Notes and Goods are never counted as "to check". */
const SEV = {
  good:  { word: 'Good',       glyph: 'check',    rank: 0 },
  info:  { word: 'Note',       glyph: 'circle',   rank: 1 },
  warn:  { word: 'Check',      glyph: 'triangle', rank: 2 },
  bad:   { word: 'Problem',    glyph: 'square',   rank: 3 },
  error: { word: 'Fix this',   glyph: 'square',   rank: 4 }
};

/* ---------------------------------------------------------------- the vocabulary of the conditions
   Every `when` is written in these, against the dictionary `c`. They are exported
   (AdvisorCopy.helpers) so the panel can ask the same questions the catalogue does. */

/* How far a track reaches from the equator: i and 180 - i are mirror images. */
const fold = i => i > 90 ? 180 - i : i;
/* "Low Earth orbit" here is an apogee up to 2,000 km, the usual definition. */
const isLEO = c => c.ha <= 2000;
const nearCirc = c => c.e < 0.002;
/* Sun-synchronous is a statement about the node rate SGP4 itself will apply, not
   about an inclination read off a table: the plane must turn within 0.01 deg/day
   of the Sun's mean rate (an LTAN slide under 0.04 min a day, 15 min a year), and
   the perigee must be below 6,000 km where the J2 term can still do it. */
const sunsync = c => c.sso_inc !== null && Math.abs(c.node - c.sso_rate) <= 0.01 && c.hp < 6000;
/* Within 2 degrees of the sun-synchronous inclination for this size and shape, but
   not close enough to hold the Sun: the local time slides. */
const ssoNear = c => !sunsync(c) && c.sso_inc !== null && c.e < 0.05 && c.hp < 6000 && c.inc > 90 && Math.abs(c.inc - c.sso_inc) <= 2;
/* The period is one sidereal day to within a relative tolerance. */
const sidLike = (c, tol) => Math.abs(c.period - c.sidereal)/c.sidereal <= tol;
const GEO_TOL = 0.0002;                        // 0.29 min: drift under 0.07 deg/day, which station-keeping holds
/* Deliberately loose: e under 0.01 and a tilt under 1 degree let a real
   station-kept satellite wander 1.15 degrees east and west and 1 degree north and
   south, and 30 of the 366 geostationary satellites in the catalogue are tilted 0.3
   to 0.7 degrees (THAICOM 4: 0.465). Tightening it would have taken "Geostationary
   orbit" away from real stationary satellites, so kind.geo states the excursions
   instead of claiming the satellite stands still. */
const isGeo = c => sidLike(c, GEO_TOL) && c.e < 0.01 && c.fold_inc < 1;
/* Close to the geostationary radius and nearly equatorial, but not on the sidereal
   period: a satellite that is creeping along the equator. */
const geoDrift = c => c.e < 0.05 && c.fold_inc < 1 && c.geo_a*0.93 < c.a && c.a < c.geo_a*1.07 && !sidLike(c, GEO_TOL);
/* The International Space Station's orbit, at any height it might be released to
   or from: 51.64 degrees, 300 to 470 km, nearly circular. */
const issLike = c => Math.abs(c.inc - 51.64) <= 0.6 && c.h_mean >= 300 && c.h_mean <= 470 && c.e < 0.01;
/* Distance between two local times of day, on the clock's circle (hours). */
const clockDist = (h, t) => { const d = Math.abs(((h - t) % 24 + 24) % 24); return Math.min(d, 24 - d); };
const dawnDusk = c => sunsync(c) && (clockDist(c.ltan, 6) <= 1.5 || clockDist(c.ltan, 18) <= 1.5);
const noonMid = c => sunsync(c) && (clockDist(c.ltan, 12) <= 1 || clockDist(c.ltan, 0) <= 1);

/* ---------------------------------------------------------------- formats
   One function per `:format`. Each takes the raw number (or string, for txt and b)
   and returns the text with its unit, so the bold figure is value and unit together.
   Rounding is the page's own: a degree sign against its number, a true minus,
   thousands separators. */
const grp = (x, dp) => {
  const s = Math.abs(x).toFixed(dp), p = s.split('.');
  // A negative that rounds to zero is "0", not "−0": β can be −0.3° and the
  // format is deg0.
  return (x < 0 && Number(s) !== 0 ? '−' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (p[1] ? '.' + p[1] : '');
};
/* A lifetime in days, as a figure a student can hold: it is never a date and never
   more precise than the model. Infinity (and null) is "beyond the 100-year cap";
   the model's own cap is 40,000 days, so anything past 36,500 reads as a century. */
const life = d => {
  if(d === null || d > 36500) return 'more than a century';
  if(d < 1) return 'under a day';
  if(d < 14){ const n = Math.round(d); return n + (n === 1 ? ' day' : ' days'); }
  if(d < 90) return Math.round(d/7) + ' weeks';
  if(d < 730) return Math.round(d/30.44) + ' months';
  const y = d/365.25; return (y < 10 ? y.toFixed(1) : Math.round(y)) + ' years';
};
const FMT = {
  km: v => grp(v, 0) + ' km', km1: v => grp(v, 1) + ' km', km2: v => grp(v, 2) + ' km',
  kms: v => v.toFixed(2) + ' km/s',
  deg0: v => grp(v, 0) + '°', deg1: v => grp(v, 1) + '°', deg2: v => grp(v, 2) + '°', deg3: v => grp(v, 3) + '°',
  deglat: v => Math.abs(v).toFixed(v === Math.round(v) ? 0 : 2) + '°' + (v < 0 ? 'S' : 'N'),
  deglon: v => { const w = ((v + 540) % 360) - 180; return Math.abs(w).toFixed(1) + '°' + (w < 0 ? 'W' : 'E'); },
  min0: v => grp(v, 0) + ' min', min1: v => grp(v, 1) + ' min', min2: v => grp(v, 2) + ' min',
  // Rounded to whole minutes first: rounding only the minutes part turned 119.7 into "1 h 60 min".
  dur: v => { if(v < 60) return grp(v, 1) + ' min'; const m = Math.round(v); return Math.floor(m/60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; },
  hm: v => { const m = Math.round(v); return Math.floor(m/60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; },
  rev2: v => v.toFixed(2) + ' rev/day',
  ltan: v => { const m = Math.round(((v % 24) + 24) % 24*60) % 1440; return String(Math.floor(m/60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); },
  ddeg: v => (Math.abs(v) < 0.0005 ? '' : (v >= 0 ? '+' : '−')) + Math.abs(v).toFixed(3) + '°/day',
  mday: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' min a day',
  life: life,
  pct0: v => v.toFixed(0) + '%',
  num0: v => grp(v, 0), num1: v => grp(v, 1), num2: v => grp(v, 2), num3: v => grp(v, 3),
  days1: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' days', hours1: v => Math.abs(v).toFixed(1) + ' h',
  dayn: v => { const x = Math.abs(v); return Math.abs(x - 1) < 0.005 ? '1 day' : (Math.abs(x - Math.round(x)) < 0.005 ? String(Math.round(x)) : x.toFixed(2)) + ' days'; },
  am: v => v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + ' m²/kg',
  sci: v => v.toExponential(2) + ' 1/ER',
  e4: v => v.toFixed(4), b: v => String(v), txt: v => String(v)
};

/* ---------------------------------------------------------------- the catalogue
   One record per situation. `when(c)` documents and decides the condition under
   which the Professor says it, against the dictionary built by advisor.js:

     id      dotted, stable: tests, the panel's keyed DOM and the README quote it
     group   one of GROUPS, or 'input' (messages under a field; no `when`)
     sev     'good' | 'info' | 'warn' | 'bad' | 'error', or a function of c that
             returns one when the severity depends on a number (sgp4.retro,
             kind.heo.drift)
     flags   draftOnly: talks about what was typed, so the read-only host (a
             catalogue spacecraft) skips it; trackedOnly: only on the read-only
             host with a history-fitted forecast; needs: 'measured': reads the
             page's own pass finder, so it can only fire once a trial run has
             filled n, total_min, best_el, alt_min ... (until then those keys are
             undefined and its `when` is false)
     term    the id of a glossary entry in the page (#t-...), linked from the item
     basis   one line naming the model behind the number, when there is one
     fix     buttons: {label, set, focus, when?}; `set` keys are the planner
             form's keys (hp ha a e period inc raan ltan argp ma epoch am name)
             and a value '{key}' reads that key of the dictionary; `focus` is the
             field that takes the cursor. A fix is never applied by the Professor:
             the panel writes the fields, and the globe changes only on Add.

   Fix guard: a fix is offered only when every {key} its label and payload read is
   defined and finite in c (a fix that needs fix_h is simply absent where no
   circular orbit has a two-year life) and its own `when` passes. The item is never
   dropped for the want of a fix.

   The order of this array is part of the contract. Inside the `type` group it is
   the order in which they are listed, and the first one that fires names the orbit
   in the verdict line. */
const ITEMS = [

/* ------------------------------------------------------------ what kind of orbit is this
   Order matters here: the first item of this group that fires names the orbit in the
   verdict line, so the specific families come before the general ones. */
/* isGeo is deliberately loose (see the helpers): a station-kept satellite wanders up to
   1.15 degrees east and west (2e radians with e under 0.01) and up to 1 degree north and
   south, so the body states those excursions (ew_amp, fold_inc) instead of saying the
   satellite stands still. */
{ id: 'kind.geo', group: 'type', sev: 'good', flags: {}, term: 't-geo',
  when: c => isGeo(c),
  title: 'Geostationary orbit',
  body: 'A period of {period:min1}, one sidereal day, over the equator ({inc:deg2}) holds the ' +
        'satellite above one longitude: {geo_lon:deglon}. From the ground it moves by no more than ' +
        '{ew_amp:deg2} east and west and {fold_inc:deg2} north and south, so a dish can be fixed in ' +
        'place. It takes {geo_alt:km} of altitude for that period; lower and it drifts east, higher ' +
        'and it drifts west.',
  basis: 'Kepler’s third law' },
/* The figure-eight is only true with a tilt of at least 1 degree. A circular orbit with
   less tilt is kind.geo (or kind.geo.drift); an eccentric one with no tilt is kind.gso.ecc
   just below. */
{ id: 'kind.gso', group: 'type', sev: 'info', flags: {}, term: 't-geo',
  when: c => sidLike(c, 0.004) && !isGeo(c) && !(c.e >= 0.2 && Math.abs(fold(c.inc) - 63.4) < 4) && c.fold_inc >= 1,
  title: 'Geosynchronous, not stationary',
  body: 'The period is one sidereal day ({period:min1}), so the ground track closes on itself every ' +
        'day. But the tilt of {inc:deg2} means the satellite does not hold still: it traces a ' +
        'figure-eight about {eight_lat:deg1} north and south of the equator, and ground antennas ' +
        'must follow it.',
  basis: 'geometry of an inclined circle' },
/* An eccentric orbit with a sidereal-day period runs fast at perigee and slow at apogee, so
   from the ground it swings east and west by 2e radians (the equation of the centre): 5.7
   degrees at e = 0.05. A tilted eccentric orbit gets this item and kind.gso both. */
{ id: 'kind.gso.ecc', group: 'type', sev: 'info', flags: {},
  when: c => sidLike(c, 0.004) && !isGeo(c) && !(c.e >= 0.2 && Math.abs(fold(c.inc) - 63.4) < 4) && c.e >= 0.01,
  title: 'Geosynchronous, swinging east and west',
  body: 'The period is one sidereal day ({period:min1}), so the ground track closes on itself every ' +
        'day. But with e = {e:e4} the satellite speeds up at perigee and slows at apogee. From the ' +
        'ground it swings up to {ew_amp:deg1} east and west of its mean longitude, and antennas must ' +
        'follow it.',
  basis: 'equation of the centre: the longitude swing is 2e radians' },
/* Within 7 % of the geostationary radius, nearly equatorial and off the sidereal period by
   more than 0.0002 (0.29 min): a satellite creeping along the equator. The fix sets the
   Kepler period; SGP4 still leaves 0.01 to 0.03 deg/day of drift at exactly that period, so
   it is the first step, not the last. */
{ id: 'kind.geo.drift', group: 'type', sev: 'warn', flags: {}, term: 't-geo',
  when: c => c.e < 0.05 && c.fold_inc < 1 && c.geo_a*0.93 < c.a && c.a < c.geo_a*1.07 && !sidLike(c, GEO_TOL),
  title: 'Near-geostationary, but drifting',
  body: 'The period is {period:min1}, {dperiod_abs:min1} {plonger} than a sidereal day, so the ' +
        'satellite creeps {drift_abs:deg2} a day {drift_dir} along the equator instead of staying ' +
        'over one place. A station-kept satellite holds its period within seconds of {sidereal:min2}.',
  fix: [
    { label: 'Set the period to {sidereal:min2} (geostationary)', set: { period: '{sidereal}' }, focus: 'period' } ] },
/* A sidereal-day orbit with e of 0.2 or more near the critical tilt. The 0.006 tolerance on
   the period is looser than GEO_TOL because nobody station-keeps a Tundra orbit to the
   second. */
{ id: 'kind.tundra', group: 'type', sev: 'info', flags: {}, term: 't-crit',
  when: c => sidLike(c, 0.006) && c.e >= 0.2 && Math.abs(fold(c.inc) - 63.4) < 4,
  title: 'Tundra-type orbit',
  body: 'One sidereal day, e = {e:e4} and a tilt of {inc:deg1}: the ground track is a figure-eight ' +
        'that dwells high over one hemisphere. It spends {hi_dwell_pct:pct0} of each day above the ' +
        'orbit’s mean height of {h_mean:km}. That gives steady coverage of high latitudes, which a ' +
        'geostationary satellite sees only at a low angle.',
  basis: 'Kepler’s equation (time above the mean radius is 1/2 + e/π)' },
/* Half a sidereal day give or take (600 to 780 min covers the J2 and lunisolar shifts),
   highly eccentric, within 3 degrees of the critical inclination, 63.4 or 116.6 (hence
   fold). */
{ id: 'kind.molniya', group: 'type', sev: 'good', flags: {}, term: 't-crit',
  when: c => c.e >= 0.6 && c.period >= 600 && c.period <= 780 && Math.abs(fold(c.inc) - 63.4) < 3,
  title: 'Molniya-type orbit',
  body: 'A period of {period:hm}, e = {e:e4} and a tilt of {inc:deg1}. At the critical inclination ' +
        'the perigee stops circling ({argp_rate:ddeg}), so apogee stays parked over {apo_lat:deglat} ' +
        'and the satellite lingers there for {hi_dwell_pct:pct0} of each orbit. That is how the ' +
        'Soviet Union got hours of high-latitude coverage without a geostationary slot, where a ' +
        'geostationary satellite sits low in the sky.',
  basis: 'J2 apsidal rate is zero at 63.4° and 116.6°' },
/* Any orbit with e of 0.25 or more that is neither a Molniya- nor a Tundra-like one. The
   two exclusions repeat the tests of kind.molniya and kind.tundra, inclination included.
   Without the inclination in the Molniya one, an orbit with a Molniya period and
   eccentricity at 55 degrees, or an ordinary 250 by 35,786 km transfer orbit (period 632
   min), was neither Molniya-type nor highly elliptical, and the verdict line had no name
   for it. */
{ id: 'kind.heo', group: 'type', sev: 'info', flags: {},
  when: c => c.e >= 0.25 && !(c.e >= 0.6 && c.period >= 600 && c.period <= 780 && Math.abs(fold(c.inc) - 63.4) < 3) && !(sidLike(c, 0.006) && Math.abs(fold(c.inc) - 63.4) < 4),
  title: 'Highly elliptical orbit',
  body: 'Altitude runs from {hp:km} to {ha:km} over a {period:hm} orbit. The satellite moves fastest ' +
        'at perigee ({vp:kms}) and slowest at apogee ({va:kms}), so it spends {hi_dwell_pct:pct0} of ' +
        'each orbit above the mean height of {h_mean:km}.',
  basis: 'vis-viva' },
/* The Earth’s bulge turns the perigee at a rate proportional to (4 − 5 sin² i), which
   vanishes at the critical inclination. Above 0.0055 deg/day (2 degrees a year) apogee does
   not stay where the student parked it. Check when the period looks like a Molniya or a
   Tundra orbit, the families that depend on it; Note otherwise (a transfer orbit does not
   care). argp_q_days is a quarter turn, 90 / |argp_rate|. The Molniya and Tundra presets
   stay silent (0.0029 and −0.0008 deg/day with the lunisolar terms); a Molniya at 55
   degrees does not (0.111). */
{ id: 'kind.heo.drift', group: 'type', sev: c => ((c.period >= 600 && c.period <= 780) || sidLike(c, 0.006)) ? 'warn' : 'info', flags: { draftOnly: true }, term: 't-crit',
  when: c => c.e >= 0.25 && Math.abs(c.argp_rate) > 0.0055,
  title: 'Perigee drifts, so apogee will not stay put',
  body: 'At {inc:deg1} the Earth’s bulge turns the perigee {argp_rate:ddeg}: a quarter turn in about ' +
        '{argp_q_days:life}. A Molniya-type orbit keeps its apogee over one latitude only at the ' +
        'critical inclination, {inc_crit:deg1}. Elsewhere the high point wanders towards the other ' +
        'hemisphere, and the slow, high part of the orbit goes with it.',
  basis: 'J2 apsidal rate is proportional to (4 − 5 sin² i)',
  fix: [
    { label: 'Set i to {inc_crit:deg1} (critical inclination)', set: { inc: '{inc_crit}' }, focus: 'inc' } ] },
/* sunsync() is the node rate SGP4 will apply, not a table lookup. e under 0.05 keeps the
   words honest: "the same local time every day" is a statement about the node crossing of a
   nearly circular orbit. */
{ id: 'kind.sso', group: 'type', sev: 'good', flags: {}, term: 't-sso',
  when: c => sunsync(c) && c.e < 0.05,
  title: 'Sun-synchronous orbit',
  body: 'The Earth’s equatorial bulge turns this orbit’s plane at {node:ddeg}, matching the Sun’s ' +
        'apparent drift of {sso_rate:ddeg}. The plane therefore keeps the same angle to the Sun all ' +
        'year, and the satellite crosses the equator at the same local solar time every day: ' +
        '{ltan:ltan} northbound. That steady lighting is why Earth-observation satellites use it.',
  basis: 'J2 node rate, from SGP4’s own constants' },
/* Retrograde and within 2 degrees of the sun-synchronous inclination for this height and
   shape, but not holding the Sun: the crossing time slides. The fix is the SGP4-root
   inclination, which holds the node within 0.01 deg/day of the Sun. */
{ id: 'kind.sso.near', group: 'type', sev: 'warn', flags: {}, term: 't-sso',
  when: c => ssoNear(c),
  title: 'Close to sun-synchronous, not quite',
  body: 'At {h_mean:km} the sun-synchronous inclination is {sso_inc:deg2}; this orbit is at ' +
        '{inc:deg2}. The plane turns {node:ddeg} against the Sun’s {sso_rate:ddeg}, so the crossing ' +
        'time slides {ltan_drift_abs:min1} a day {ltan_dir:txt}, about {ltan_drift_year:hours1} over ' +
        'a year.',
  fix: [
    { label: 'Set i to {sso_inc:deg2} (sun-synchronous at this altitude)', set: { inc: '{sso_inc}' }, focus: 'inc' } ] },
/* The J2 node rate falls with altitude. Above about 5,980 km (at e = 0) no inclination,
   retrograde or not, can match the Sun, which is exactly when sso_inc is null. A tilt near
   100 degrees up there is told why it cannot be sun-synchronous. */
{ id: 'kind.sso.unreachable', group: 'type', sev: 'info', flags: {}, term: 't-sso',
  when: c => c.inc > 96 && c.inc < 104 && c.sso_inc === null,
  title: 'Too high to be sun-synchronous',
  body: 'The plane’s J2 drift falls with altitude, and above about {sso_amax_alt:km} it can no ' +
        'longer match the Sun even when retrograde. At {h_mean:km} this orbit’s plane turns ' +
        '{node:ddeg}, not {sso_rate:ddeg}.' },
/* issLike covers any release height of the station’s orbit (51.64 degrees, 300 to 470 km,
   nearly circular). Before it, kind.leo.circ excluded the tilt at every height, so a
   circular orbit at 51.6 degrees outside that band matched no kind item at all. */
{ id: 'kind.iss', group: 'type', sev: 'info', flags: {},
  when: c => issLike(c),
  title: 'ISS-like orbit',
  body: 'A tilt of {inc:deg2} at about {h_mean:km} is the International Space Station’s orbit. The ' +
        'tilt was chosen largely so that rockets from Baikonur (46°N) could reach it, and it carries ' +
        'the ground track to {fold_inc:deg1} north and south, over most of the people on Earth. ' +
        'Anything released from the station shares it, as KNACKSAT-2 did.' },
/* Half a sidereal day to within 2 minutes. At 15 minutes the ground track slid up to 7.5
   degrees a day (839 km at the equator), which is not a repeat; at 2 it slides about 1
   degree a day, and the body quotes the figure (gnss_slide) instead of promising an exact
   return. */
{ id: 'kind.gnss', group: 'type', sev: 'info', flags: {},
  when: c => Math.abs(c.period - c.sidereal/2) <= 2 && c.e < 0.05,
  title: 'Navigation-constellation orbit',
  body: 'A period of {period:hm} is half a sidereal day. The satellite makes two orbits while the ' +
        'Earth turns once, so its ground track comes back to the same place every day, to within ' +
        '{gnss_slide:deg2} of longitude. GPS flies here, at about 55°, for that repeating pattern. ' +
        'From {h_mean:km} a satellite sees {foot_pct:pct0} of the Earth at once, against ' +
        '{foot_pct_500:pct0} from 500 km.',
  basis: 'Kepler’s third law' },
/* Everything between LEO and the geostationary ring that is not a navigation orbit; the
   same 2 minute tolerance, so the two never overlap or leave a gap. */
{ id: 'kind.meo', group: 'type', sev: 'info', flags: {},
  when: c => !isLEO(c) && c.ha < 34000 && c.e < 0.25 && !(Math.abs(c.period - c.sidereal/2) <= 2 && c.e < 0.05),
  title: 'Medium Earth orbit',
  body: 'At {h_mean:km} the orbit sits between the thick air of low orbit and the geostationary ' +
        'ring: {period:hm} per orbit at {v:kms}. A satellite here sees {foot_pct:pct0} of the Earth ' +
        'at once, against {foot_pct_500:pct0} from 500 km, but it crosses the radiation belts.' },
/* Closes the hole above 34,000 km: a circular orbit at 38,000 km that is not near a
   sidereal day matched no kind item. Near a sidereal day it is kind.gso / kind.geo.drift
   instead. The body says "near or beyond the ring" because the foot_pct figure holds for
   either. */
{ id: 'kind.high', group: 'type', sev: 'info', flags: {},
  when: c => c.ha >= 34000 && c.e < 0.25 && !sidLike(c, 0.004) && !geoDrift(c),
  title: 'Beyond the geostationary ring',
  body: 'At {h_mean:km} the orbit is near or beyond the geostationary ring ({geo_alt:km}), with a ' +
        'period of {period:hm}. A satellite here sees {foot_pct:pct0} of the Earth at once. The Moon ' +
        'and the Sun pull on an orbit this high far more than on a low one, and SGP4 can follow that ' +
        'only approximately.' },
/* issLike replaces the bare 51.64 test. The body names the Keplerian period and quotes the
   nodal one (period_nodal), because the Elements section times the orbit from node to node
   and a reader would otherwise find two different periods and no explanation. It no longer
   says the air always brings the orbit down, which is false above 1,000 km. */
{ id: 'kind.leo.circ', group: 'type', sev: 'info', flags: {},
  when: c => isLEO(c) && c.e < 0.01 && !sunsync(c) && !ssoNear(c) && !issLike(c) && fold(c.inc) >= 5 && Math.abs(c.inc - 90) > 3,
  title: 'Circular low Earth orbit',
  body: 'At {h_mean:km} the satellite circles the Earth in {period:min1}, {revs:rev2}, at {v:kms}. ' +
        'That is the Keplerian period; the Elements section times it from node to node and shows ' +
        '{period_nodal:min1}. Low orbits are where most satellites live: close enough for small ' +
        'antennas and sharp pictures. Below about 1,000 km the thin air eventually brings them down; ' +
        'above that it does not.' },
{ id: 'kind.leo.ecc', group: 'type', sev: 'info', flags: {},
  when: c => isLEO(c) && c.e >= 0.01 && c.e < 0.25,
  title: 'Elliptical low orbit',
  body: 'Altitude runs from {hp:km} to {ha:km}. The satellite moves fastest at perigee ({vp:kms}) ' +
        'and slowest at apogee ({va:kms}), so each {period:min1} orbit spends more time high than ' +
        'low. Drag bites at perigee, so the perigee height, not the average, sets how long it lasts.' },
/* Within 3 degrees of 90 and not already described by kind.sso. */
{ id: 'kind.polar', group: 'type', sev: 'info', flags: {},
  when: c => isLEO(c) && Math.abs(c.inc - 90) <= 3 && !sunsync(c),
  title: 'Polar orbit',
  body: 'At {inc:deg2} the track climbs to {fold_inc:deg1} latitude, so as the Earth turns beneath ' +
        'it the satellite eventually flies over every place, and the poles come into view on every ' +
        'orbit. No lower-inclination orbit can do that.' },
{ id: 'kind.equatorial', group: 'type', sev: 'info', flags: {},
  when: c => isLEO(c) && fold(c.inc) < 5,
  title: 'Equatorial low orbit',
  body: 'The plane lies in (or near) the equator, so the track never climbs above {fold_inc:deg1} ' +
        'latitude. It retraces the same strip every orbit: good for ground stations near the ' +
        'equator, no use anywhere else.' },
/* A circular orbit gains nothing from the critical inclination, and a Molniya (e of 0.6 or
   more) has kind.molniya, so this item is for the middle. */
{ id: 'kind.critical', group: 'type', sev: 'info', flags: {}, term: 't-crit',
  when: c => (Math.abs(fold(c.inc) - 63.435) <= 0.3) && c.e < 0.25 && !(c.e >= 0.6),
  title: 'Critical inclination',
  body: 'Near {inc:deg2} the Earth’s bulge stops turning the orbit’s perigee ({argp_rate:ddeg}). ' +
        'Elliptical orbits want that, because it keeps apogee parked over one place. For a ' +
        'near-circular orbit the perigee is not defined anyway, so it gains you nothing.',
  basis: 'J2 apsidal rate is proportional to (4 − 5 sin² i)' },
/* Above 93 degrees, outside the band of kind.polar: a 90.5 degree orbit is polar, not
   "against the Earth’s spin". */
{ id: 'kind.retro', group: 'type', sev: 'info', flags: {},
  when: c => c.inc > 93 && !sunsync(c) && !ssoNear(c),
  title: 'Retrograde orbit',
  body: 'At {inc:deg1} the satellite moves against the Earth’s spin. Launching this way gives up the ' +
        'free speed the spinning Earth hands a prograde rocket, up to about 0.46 km/s at the ' +
        'equator. It is rare outside sun-synchronous orbits for that reason.' },

/* ------------------------------------------------------------ will it survive
   Lifetime is a duration after the epoch, never a date. Every figure comes from one
   physical decay model (a x3 / x1 / x1/3 drag band, so "a factor of 3 either way" is
   literally true); the globe’s own SGP4 run is a different thing and the Decay section says
   how they differ. */
/* Only on the read-only host, for a spacecraft with a history-fitted forecast. That
   forecast beats any assumed drag and must not be contradicted here. */
{ id: 'life.tracked', group: 'survive', sev: 'info', flags: { trackedOnly: true },
  when: c => c.tracked && c.hp >= c.entry,
  title: 'Lifetime: see Orbital decay',
  body: 'For a tracked spacecraft the forecast under Orbital decay is fitted to its own history of ' +
        'element sets, which beats any assumed drag. The notes here leave lifetime to it.' },
/* entry is 120 km, the floor of the decay model. The fix raises perigee only (fix_hp), so
   an eccentric orbit keeps its apogee. */
{ id: 'life.reentry', group: 'survive', sev: 'bad', flags: { draftOnly: true }, term: 't-reentry',
  when: c => c.hp < c.entry,
  title: 'Below the re-entry line',
  body: 'Perigee is {hp:km}, under the {entry:km} entry interface. Air this thick brings an orbit ' +
        'down within a revolution or two, so the satellite re-enters almost at once. The console can ' +
        'still draw it, and will say so, but no pass it lists will happen.',
  fix: [
    { label: 'Raise perigee to {fix_hp:km}', set: { hp: '{fix_hp}' }, focus: 'hp' } ] },
/* The fix is a circular height, so it is offered only for a circular orbit: raising "the
   orbit" to a circle would change an eccentric one’s shape. It is absent where no circular
   orbit has a two-year life (an area-to-mass ratio above about 5), and the item stays. */
{ id: 'life.days', group: 'survive', sev: 'bad', flags: { draftOnly: true },
  when: c => c.life_mid !== undefined && c.life_mid < 30,
  title: 'Comes down within weeks',
  body: 'At {h_mean:km}, with an area-to-mass ratio of {am:am}, the model puts re-entry ' +
        '{life_lo:life} to {life_hi:life} away. The range allows the drag, air density and your ' +
        'area-to-mass guess together, to be off by a factor of {uncert:num0} either way. The orbit ' +
        'is sound geometrically; the air is what limits it.',
  basis: 'piecewise-exponential atmosphere, da/dt = −ρB√(μa)',
  fix: [
    { label: 'Raise the orbit to {fix_h:km} (about {fix_life:life})', set: { hp: '{fix_h}', ha: '{fix_h}' }, focus: 'hp', when: c => c.e < 0.002 } ] },
/* Same fix guard as life.days: a circular height, so only for a circular orbit, and absent
   when fix_h does not exist. */
{ id: 'life.short', group: 'survive', sev: 'warn', flags: { draftOnly: true },
  when: c => c.life_mid !== undefined && c.life_mid >= 30 && c.life_mid < 730,
  title: 'Short-lived without thrust',
  body: 'At {h_mean:km} and {am:am} the model gives about {life_mid:life}, anywhere from ' +
        '{life_lo:life} to {life_hi:life} once the Sun’s changing output is allowed for. A mission ' +
        'that must work for years needs a higher orbit or thrusters to hold its height.',
  basis: 'piecewise-exponential atmosphere, da/dt = −ρB√(μa)',
  fix: [
    { label: 'Raise the orbit to {fix_h:km} (about {fix_life:life})', set: { hp: '{fix_h}', ha: '{fix_h}' }, focus: 'hp', when: c => c.e < 0.002 } ] },
/* A range, never a date: the three runs are drag x3, x1 and x1/3, so the Sun and the
   area-over-mass guess are both inside the band. */
{ id: 'life.range', group: 'survive', sev: 'info', flags: { draftOnly: true },
  when: c => c.life_mid !== undefined && c.life_mid >= 730 && c.life_hi <= 25*365.25,
  title: 'Lifetime of about {life_mid:life}',
  body: 'Between {life_lo:life} and {life_hi:life} at {h_mean:km} for {am:am}. This forecasts the ' +
        'atmosphere, not your satellite: it assumes a standard density profile and a fixed ' +
        'area-to-mass ratio, and the Sun alone moves the answer by a factor of several. Read it as ' +
        'an order of magnitude.',
  basis: 'piecewise-exponential atmosphere, da/dt = −ρB√(μa)' },
/* The body is true whether or not the middle estimate meets the 25 years, because it quotes
   only the range and says what the slow end means. The two "Lower" fixes are offered only
   when they actually lower the orbit by more than 5 km: the mid-case 25-year height at a
   typical satellite is 590 km, so between 526 km (where this item starts) and 590 km a
   button that said "Lower" would have raised the orbit. */
{ id: 'life.long', group: 'survive', sev: 'warn', flags: { draftOnly: true },
  when: c => c.life_mid !== undefined && c.life_mid >= 730 && c.life_hi > 25*365.25 && c.life_lo <= 36500,
  title: 'May outlive the 25-year guideline',
  body: 'The model gives {life_lo:life} to {life_hi:life} at {h_mean:km}. Debris-mitigation ' +
        'guidelines ask for re-entry within 25 years of the end of a mission, and some regulators ' +
        'now ask for 5. If the slow end of that range is the real one, this orbit misses the 25 ' +
        'years: it needs a deorbit plan (a burn, a drag sail) or a lower start.',
  basis: 'piecewise-exponential atmosphere, da/dt = −ρB√(μa)',
  fix: [
    { label: 'Lower the orbit to {fix_h25:km} (about 25 years)', set: { hp: '{fix_h25}', ha: '{fix_h25}' }, focus: 'hp', when: c => c.e < 0.002 && c.fix_h25 < c.h_mean - 5 },
    { label: 'Lower it to {fix_h5:km} (about 5 years)', set: { hp: '{fix_h5}', ha: '{fix_h5}' }, focus: 'hp', when: c => c.e < 0.002 && c.fix_h5 < c.h_mean - 5 } ] },
/* Either the model says the slow end outlives a century, or (second clause) the perigee is
   above 1,000 km where the model does not apply. A sail above 1,000 km (area over mass
   above 0.05) is not "too weak"; !(undefined > 0.05) keeps the clause firing for catalogue
   geostationary satellites, whose am is unknown. */
{ id: 'life.permanent', group: 'survive', sev: 'info', flags: {},
  when: c => (c.life_mid !== undefined && c.am > 0 && c.life_lo > 36500) || (c.e < 0.02 && c.hp > 1000 && !(c.am > 0.05)),
  title: 'Above the air',
  body: 'At {h_mean:km} drag is too weak to bring the orbit down in a century. It stays up until ' +
        'something else moves it, which also means a dead satellite here stays up as debris.' },
/* The decay model covers e up to 0.3 with an apogee below 5,000 km, so this item only
   speaks where it has no figure (life_mid is undefined). The sentence says what the model
   covers instead of "near-circular only", which stopped being true. */
{ id: 'life.ecc', group: 'survive', sev: 'info', flags: { draftOnly: true },
  when: c => c.e >= 0.02 && c.hp >= c.entry && c.hp < 1000 && c.life_mid === undefined,
  title: 'No lifetime estimate for an elliptical orbit',
  body: 'This page’s decay model covers orbits that stay below 5,000 km with e up to 0.3, so it ' +
        'offers no estimate for this one. Drag acts at perigee ({hp:km}) and lowers the apogee first ' +
        'while perigee holds. For an orbit that reaches {ha:km}, the Moon and the Sun also move the ' +
        'perigee, by amounts this page does not model.' },
/* A perigee above 1,000 km: drag plays no part and the Moon and Sun do the work, which this
   page does not model. */
{ id: 'life.ecc.high', group: 'survive', sev: 'info', flags: {},
  when: c => c.e >= 0.02 && c.hp >= 1000,
  title: 'Perigee is above the air',
  body: 'At {hp:km} drag plays no part. The Moon and the Sun move an orbit this high, slowly walking ' +
        'the perigee up or down over months and years. This page does not model them, so it offers ' +
        'no lifetime.' },
/* The fix raises perigee only (fix_hp, always below the apogee for an eccentric orbit), so
   "leaves the apogee where it is" stays true. */
{ id: 'life.ecc.low', group: 'survive', sev: 'warn', flags: { draftOnly: true },
  when: c => c.e >= 0.02 && c.hp >= c.entry && c.hp < 300,
  title: 'Perigee is skimming the air',
  body: 'At {hp:km} every pass through perigee costs energy, so expect apogee to shrink steadily and ' +
        'the orbit to round out and decay. Raising perigee is the cheapest fix: it leaves the apogee ' +
        'where it is.',
  fix: [
    { label: 'Raise perigee to {fix_hp:km}', set: { hp: '{fix_hp}' }, focus: 'hp' } ] },
/* No percentage of time in the anomaly is printed: a crude box gave 10 to 18 %, which is
   not a figure worth putting in bold. */
{ id: 'rad.saa', group: 'survive', sev: 'info', flags: {}, term: 't-saa',
  when: c => c.ha < 1500 && fold(c.inc) >= 15 && c.hp >= c.entry,
  title: 'Crosses the South Atlantic Anomaly',
  body: 'Below about 1,000 km, tilted orbits clip the South Atlantic Anomaly, a dent in the magnetic ' +
        'field over South America where trapped protons reach low altitude. Expect several passes ' +
        'through it a day and more bit-flips in electronics while inside. A short mission shrugs it ' +
        'off; a long one designs for it.' },
{ id: 'rad.inner', group: 'survive', sev: 'warn', flags: {}, term: 't-belts',
  when: c => c.hp < 6000 && c.ha > 1000 && c.e < 0.25 && c.h_mean >= 1000,
  title: 'Inside the inner radiation belt',
  body: 'Between about 1,000 and 6,000 km the orbit passes through the inner Van Allen belt, where ' +
        'trapped protons wear out solar cells and upset electronics far faster than at 500 km. ' +
        'Expect shielding, radiation-hardened parts, or a choice to stay out: most missions avoid ' +
        'this band.' },
{ id: 'rad.outer', group: 'survive', sev: 'info', flags: {}, term: 't-belts',
  when: c => c.h_mean >= 13000 && c.h_mean < 60000 && c.e < 0.25 && !isGeo(c),
  title: 'In the outer radiation belt',
  body: 'From about 13,000 km outwards the orbit runs through the outer belt, whose energetic ' +
        'electrons charge and damage surfaces, most fiercely in storms and most densely around ' +
        '15,000 to 25,000 km. GPS satellites live here and are built for it.' },
{ id: 'rad.geo', group: 'survive', sev: 'info', flags: {}, term: 't-belts',
  when: c => isGeo(c),
  title: 'On the edge of the electron belt',
  body: 'Geostationary altitude is the outer fringe of the electron belt. It is quiet most days, and ' +
        'solar storms can multiply the electron flux within hours. Satellites here carry shielding ' +
        'and are built to ride out charging.' },
{ id: 'rad.cross', group: 'survive', sev: 'warn', flags: {}, term: 't-belts',
  when: c => c.e >= 0.25 && c.hp < 6000 && c.ha > 13000,
  title: 'Crosses both radiation belts',
  body: 'With perigee at {hp:km} and apogee at {ha:km}, each {period:hm} orbit sweeps through the ' +
        'inner and outer belts twice. The satellite spends most of its time above them, but the ' +
        'crossings add up to a real dose. Molniya satellites accept this and are built for it.' },

/* ------------------------------------------------------------ sun and eclipse
   Everything here needs e under 0.05 except the geostationary item: the shadow arithmetic
   is a cylinder and a year of beta angles, and it is not offered for a more eccentric
   orbit. */
/* The three fixes set the local time of the node. They work in either node lens:
   Planner.patchForm converts LTAN to a RAAN for the epoch. */
{ id: 'sun.ltan', group: 'sun', sev: 'info', flags: {}, term: 't-ltan',
  when: c => sunsync(c) && c.e < 0.05 && !dawnDusk(c),
  title: 'Crosses the equator at {ltan:ltan}',
  body: 'Northbound at {ltan:ltan} local solar time, southbound at {ltdn:ltan}: a daytime pass near ' +
        '{ltan_day:ltan} and a night pass near {ltan_night:ltan}. Earth-imaging missions often ' +
        'choose a daytime pass near 10:30, when the Sun is high enough to light the ground and cloud ' +
        'has not yet built up.',
  fix: [
    { label: 'Set the node for LTAN 10:30', set: { ltan: 10.5 }, focus: 'raan' },
    { label: 'Set the node for LTAN 13:30', set: { ltan: 13.5 }, focus: 'raan' },
    { label: 'Set the node for LTAN 06:00 (dawn–dusk)', set: { ltan: 6 }, focus: 'raan' } ] },
{ id: 'sun.dawndusk', group: 'sun', sev: 'good', flags: {}, term: 't-beta',
  when: c => dawnDusk(c) && c.e < 0.05 && c.free_days < 365,
  title: 'Dawn–dusk: almost always in sunlight',
  body: 'With the node at {ltan:ltan} the orbit rides the day–night boundary, so the Sun stays ' +
        'nearly square to the plane (β never below {beta_min_abs:deg0}). There is no eclipse at all ' +
        'on {free_days:num0} days of the year, and at most {ecl_max_min:min0} on the rest. Solar ' +
        'panels get almost constant power, which suits small satellites and radar.',
  basis: 'beta angle from the Sun’s position over one year',
  fix: [
    { label: 'Set the node for LTAN 10:30 (mid-morning imaging)', set: { ltan: 10.5 }, focus: 'raan' } ] },
{ id: 'sun.noon', group: 'sun', sev: 'info', flags: {}, term: 't-beta',
  when: c => noonMid(c) && c.e < 0.05,
  title: 'Noon–midnight: eclipse every orbit',
  body: 'The plane points at the Sun, so β stays between {beta_min:deg0} and {beta_max:deg0} all ' +
        'year and the satellite loses {ecl_txt:b} of every {period:min1} orbit to Earth’s shadow. ' +
        'Batteries work hardest here: about {cycles:num0} cycles a year.',
  basis: 'beta angle from the Sun’s position over one year' },
{ id: 'sun.ecl', group: 'sun', sev: 'info', flags: {}, term: 't-beta',
  when: c => c.e < 0.05 && c.free_days === 0 && !noonMid(c) && !isGeo(c),
  title: 'Eclipse on every orbit, up to {ecl_max_min:min0}',
  body: 'Over the next year β runs from {beta_min:deg0} to {beta_max:deg0} and never gets beyond ' +
        '{beta_crit:deg0}, the angle at which Earth’s shadow would miss this orbit. So every ' +
        '{period:min1} orbit spends {ecl_txt:b} in shadow. Each one is a battery discharge and a ' +
        'thermal swing: about {cycles:num0} a year.',
  basis: 'cylindrical shadow; beta angle from the Sun’s position over one year' },
{ id: 'sun.ecl.season', group: 'sun', sev: 'info', flags: {}, term: 't-beta',
  when: c => c.e < 0.05 && c.free_days > 0 && c.free_days < 365 && !dawnDusk(c) && !isGeo(c),
  title: 'Eclipse-free for {free_days:num0} days a year',
  body: 'Over the next year β runs from {beta_min:deg0} to {beta_max:deg0}. Whenever it is beyond ' +
        '{beta_crit:deg0} the shadow misses the orbit: that is {free_days:num0} days in 365. The ' +
        'rest of the time the satellite loses up to {ecl_max_min:min0} of each {period:min1} orbit, ' +
        '{ecl_max_pct:pct0} at worst, and about {cycles:num0} shadows a year.',
  basis: 'cylindrical shadow; beta angle from the Sun’s position over one year' },
{ id: 'sun.free', group: 'sun', sev: 'good', flags: {}, term: 't-beta',
  when: c => c.e < 0.05 && c.free_days !== undefined && c.free_days >= 365,
  title: 'No eclipse in the next year',
  body: 'Over the next year β runs from {beta_min:deg0} to {beta_max:deg0} and stays beyond ' +
        '{beta_crit:deg0}, the angle at which Earth’s shadow misses this orbit. The satellite is ' +
        'never in eclipse and needs no battery to ride through one.' },
{ id: 'sun.geo', group: 'sun', sev: 'info', flags: {}, term: 't-beta',
  when: c => isGeo(c),
  title: 'Two eclipse seasons a year',
  body: 'Around each equinox, for about {geo_season_days:num0} days, the satellite crosses Earth’s ' +
        'shadow once a day. At the equinox itself it is in shadow for up to about ' +
        '{geo_ecl_max:min0}: the dark core, with the fringe adding a few minutes more. The rest of ' +
        'the year it is in full sun. Batteries are sized for those two seasons, not for every day.' },

/* ------------------------------------------------------------ ground track and the observer
   Items flagged M read the page’s own pass finder through a trial compute(), so they cannot
   disagree with the pass table. The observer is always {site}, never a literal city. */
/* One window is a sample, and the body says so. The condition hides a single pass that
   fills the whole window (a geostationary satellite). */
{ id: 'gt.count', group: 'ground', sev: 'info', flags: { draftOnly: true, needs: 'measured' },
  when: c => c.n !== undefined && c.n > 0 && c.hp >= c.entry && !(c.n === 1 && c.total_min >= c.hours*60 - 1),
  title: '{n:num0} {passes:txt} above {mask:deg0} in {hours:num0} h',
  body: '{site} sees the satellite for {total_min:dur} in all during the {hours:num0} h from ' +
        '{start:txt}: the longest pass lasts {longest_min:dur} and the best climbs to ' +
        '{best_el:deg0}. One window is a sample — as the Earth turns under the plane, other days ' +
        'differ.',
  basis: 'this page’s own pass finder, run on your elements' },
{ id: 'gt.none', group: 'ground', sev: 'warn', flags: { needs: 'measured' },
  when: c => c.n === 0 && c.reach >= c.site_lat_abs && c.period < 1000 && !isGeo(c),
  title: 'No pass above {mask:deg0} in this window',
  body: 'The orbit can reach {site}’s latitude, but in these {hours:num0} h its track missed the ' +
        'site: each revolution the Earth turns {shift_deg:deg1} beneath the plane. A longer window, ' +
        'a different node or a different phase will differ.' },
{ id: 'gt.never', group: 'ground', sev: 'bad', flags: {},
  when: c => c.reach < c.site_lat_abs,
  title: '{site} is out of reach',
  body: '{site} is at {site_lat:deglat}. With i = {inc:deg1} the track reaches {fold_inc:deg1}, and ' +
        'from {h_mean:km} a satellite sees {lambda:deg1} beyond that above {mask:deg0}: {reach:deg1} ' +
        'in all. That stops short of {site}, so the satellite never rises there.',
  fix: [
    { label: 'Set i to {inc_need:deg1} so {site} is inside the footprint', set: { inc: '{inc_need}' }, focus: 'inc' } ] },
{ id: 'gt.barely', group: 'ground', sev: 'warn', flags: {},
  when: c => c.reach >= c.site_lat_abs && c.el_best < 25 && c.fold_inc < c.site_lat_abs,
  title: 'Only low passes from {site}',
  body: 'At best the track runs {offtrack:deg1} from {site}, so no pass can climb higher than about ' +
        '{el_best:deg0}. Low passes are short and have the most air, hills and buildings in the way.',
  fix: [
    { label: 'Set i to {site_lat_round:deg0} so the track turns round over {site}', set: { inc: '{site_lat_round}' }, focus: 'inc' } ] },
{ id: 'gt.overhead', group: 'ground', sev: 'info', flags: { needs: 'measured' },
  when: c => c.best_el !== undefined && c.best_el < 60 && c.fold_inc >= c.site_lat_abs && c.h_mean < 2000 && !(c.fold_inc - c.site_lat_abs <= 6 && c.fold_inc >= 5),
  title: 'Higher passes are possible on other days',
  body: 'The best pass in this window climbs to {best_el:deg0}, but the track reaches ' +
        '{fold_inc:deg1}, beyond {site}’s {site_lat:deglat}, so on other days a pass goes straight ' +
        'overhead. The Earth turns {shift_deg:deg1} under the plane each revolution, so {site} is ' +
        'only under the track now and then. Try the 7 d span.' },
/* A lower tilt can give more minutes of access but only at low angles; measured for a site
   at 13.75 N, an equatorial orbit gives 14 passes and 97 min at best 12 degrees and a tilt
   of 14 gives 9 passes and 77 min at best 89, so the body claims higher and more overhead
   passes, not more passes. */
{ id: 'gt.matched', group: 'ground', sev: 'good', flags: {},
  when: c => c.fold_inc >= c.site_lat_abs && c.fold_inc - c.site_lat_abs <= 6 && c.fold_inc >= 5 && c.h_mean < 2000,
  title: 'The track turns round near {site}',
  body: 'The orbit reaches {fold_inc:deg1}, a little beyond {site}’s {site_lat:deglat}. A satellite ' +
        'lingers near the latitude where its track turns round, so {site} sees higher passes, and ' +
        'more of them near overhead, than from a tilt far from its latitude. A lower tilt can give ' +
        'more minutes, but only at low angles.',
  basis: 'time spent per degree of latitude is greatest near the orbit’s inclination' },
/* "Barely moves": a station-kept satellite wanders about a degree. */
{ id: 'gt.geo.up', group: 'ground', sev: 'good', flags: {},
  when: c => isGeo(c) && c.geo_vis,
  title: 'Always {el_geo:deg0} above {site}',
  body: 'Parked at {geo_lon:deglon}, the satellite stands {el_geo:deg0} above {site}’s horizon and ' +
        'barely moves, so the pass is continuous. It needs to lie between {vis_lo:deglon} and ' +
        '{vis_hi:deglon} for {site} to see it above {mask:deg0}.' },
{ id: 'gt.geo.down', group: 'ground', sev: 'bad', flags: {},
  when: c => isGeo(c) && !c.geo_vis,
  title: 'Below {site}’s horizon',
  body: 'Parked at {geo_lon:deglon}, the satellite is below {site}’s {mask:deg0} mask and never ' +
        'rises. {site} sees a geostationary satellite only between {vis_lo:deglon} and ' +
        '{vis_hi:deglon}.',
  fix: [
    { label: 'Move it over {site}’s longitude ({site_lon:deglon})', set: { ma: '{ma_site}' }, focus: 'ma' } ] },
{ id: 'gt.rgt', group: 'ground', sev: 'good', flags: {},
  when: c => c.K !== undefined && c.e < 0.05 && c.h_mean < 2000,
  title: 'Ground track repeats every {rgt_days:dayn}',
  body: '{K:num0} revolutions fit almost exactly into {rgt_days:dayn}, so the ground track retraces ' +
        'itself every {rgt_days:dayn}, to within {rgt_off:km} at the equator. Neighbouring tracks ' +
        'lie {rgt_gap:km} apart there. Mapping and imaging missions want this: the same scene, again ' +
        'and again.',
  basis: 'J2 node and perigee rates, Earth’s rotation relative to the plane' },
{ id: 'gt.rgt.near', group: 'ground', sev: 'info', flags: {},
  when: c => c.near_K !== undefined && c.K === undefined && c.e < 0.05 && c.h_mean < 2000,
  title: 'Close to a repeating ground track',
  body: 'At {h_mean:km} the track is {near_dh:km} from a {near_K:num0}-revolution, {near_D:num0}-day ' +
        'repeat. At {near_h:km1} it repeats exactly.',
  fix: [
    { label: 'Set the altitude to {near_h:km1} for a {near_K:num0}/{near_D:num0} repeat', set: { hp: '{near_h}', ha: '{near_h}' }, focus: 'hp' } ] },
{ id: 'gt.drift', group: 'ground', sev: 'info', flags: {},
  when: c => c.K === undefined && c.e < 0.05 && c.h_mean < 2000 && c.h_mean > 0,
  title: 'The track shifts {shift_deg:deg1} west each orbit',
  body: 'While the satellite circles once ({period:min1}) the Earth turns that far beneath it, ' +
        '{shift_km:km} at the equator, so each track lies west of the last. No exact repeat closes ' +
        'within {rgt_days_max:num0} days at this altitude.' },
{ id: 'gt.sso.clock', group: 'ground', sev: 'info', flags: {},
  when: c => sunsync(c) && c.e < 0.05 && c.fold_inc < 90 + 0 && c.h_mean < 2000 && c.reach >= c.site_lat_abs,
  title: 'Passes from {site} cluster by the clock',
  body: 'The local solar time is fixed, so the daytime pass over {site} comes around ' +
        '{lt_pass_day:ltan} solar time, {pass_day_clock:ltan} on {site}’s clock, give or take ' +
        '{pass_spread_h:hours1}. The night pass falls about twelve hours from that.',
  basis: 'argument of latitude of the site, LTAN, site longitude' },

/* ------------------------------------------------------------ caveats
   */
/* Flagged M: the heights are from the page’s own SGP4 run over one revolution, so the
   numbers cannot disagree with the globe. */
{ id: 'cav.mean', group: 'caveat', sev: 'info', flags: { draftOnly: true, needs: 'measured' }, term: 't-mean',
  when: c => c.alt_min !== undefined && c.e < 0.02,
  title: 'Nearly circular is not a constant height',
  body: 'You typed {h_mean:km}, measured from the equator’s radius. On the globe the height above ' +
        'the ground runs from {alt_min:km1} to {alt_max:km1}. Two things widen it. The Earth is ' +
        '{surf_swing:km1} flatter at the highest latitude the track reaches. And SGP4 reads your ' +
        'numbers as mean elements, as in a TLE, and adds back wobbles of {r_swing:km1} in orbit ' +
        'radius.',
  basis: 'this page’s SGP4 run over one revolution' },
{ id: 'cav.epoch.off', group: 'caveat', sev: 'info', flags: { draftOnly: true },
  when: c => c.epoch_off !== undefined && Math.abs(c.epoch_off) >= 1 && Math.abs(c.epoch_off) < 3,
  title: 'The window opens {epoch_off_abs:dayn} {epoch_dir:txt} the epoch',
  body: 'Mean anomaly M = {ma:deg2} says where the satellite is at the epoch, {epoch_utc:txt}. The ' +
        'console’s window opens at {window_start:txt}, so it shows where your orbit puts the ' +
        'satellite then, not where you drew it. Press Epoch on the window bar to jump back.' },
/* The fix key is `epoch`, a form key; the value is the window start in milliseconds. */
{ id: 'cav.epoch.far', group: 'caveat', sev: 'warn', flags: { draftOnly: true },
  when: c => c.epoch_off !== undefined && Math.abs(c.epoch_off) >= 3,
  title: 'The window opens {epoch_off_abs:dayn} {epoch_dir:txt} the epoch',
  body: 'The epoch is {epoch_utc:txt}. SGP4 carries the orbit that far exactly as its model says, ' +
        'but the satellite’s phase and any drag error compound with time. The position you drew ' +
        'belongs to the epoch; set the epoch to when you want the satellite there.',
  fix: [
    { label: 'Set the epoch to the window start', set: { epoch: '{window_ms}' }, focus: 'epoch' } ] },
{ id: 'cav.circ.angles', group: 'caveat', sev: 'info', flags: {}, term: 't-angles',
  when: c => c.e < 0.002 && Math.abs(c.argp) > 1e-9,
  title: 'Perigee barely exists on a circle',
  body: 'At e = {e:e4} the point of closest approach is poorly defined: a change in ω can be undone ' +
        'by a change in M. Only their sum, the argument of latitude u = {u:deg2}, says where the ' +
        'satellite is. The Elements section shows ω and M all the same; do not read a meaning into ' +
        'the split.',
  fix: [
    { label: 'Put it all in M: ω = 0, M = {u:deg2}', set: { argp: 0, ma: '{u}' }, focus: 'ma' } ] },
{ id: 'cav.eq.angles', group: 'caveat', sev: 'info', flags: {}, term: 't-angles',
  when: c => fold(c.inc) < 0.5 && c.h_mean > 1000,
  title: 'Nearly equatorial: the node is not a place',
  body: 'With i = {inc:deg3} the orbit crosses the equator at a shallow angle, so Ω is hard to pin ' +
        'down. In deep space the Moon and Sun shift it by as much as the tilt itself. The dependable ' +
        'phase is the true longitude Ω + ω + M = {lon_sum:deg2}.' },
{ id: 'cav.highorbit', group: 'caveat', sev: 'warn', flags: {},
  when: c => c.ha > 100000,
  title: 'Out towards the Moon',
  body: 'An apogee of {ha:km} is {ha_moon_pct:pct0} of the way to the Moon. Beyond about 100,000 km ' +
        'the Moon’s pull is no small correction, and SGP4, which treats it as one, is no longer a ' +
        'trustworthy model. Believe the orbit’s shape, not its timing.' },
/* The area-to-mass ratio is the input; B* (matched so SGP4 decays at the rate this page’s
   model gives at the typed height) is derived from it. */
{ id: 'cav.drag.assumed', group: 'caveat', sev: 'info', flags: { draftOnly: true }, term: 't-bstar',
  when: c => c.e < 0.25 && c.life_mid !== undefined && c.h_mean < 1500 && c.hp >= c.entry,
  title: 'The drag is your guess',
  body: 'An area-to-mass ratio of {am:am} with Cd = {cd:num1} gives B* = {bstar:sci}. A real ' +
        'satellite’s B* is fitted to tracking and soaks up whatever the model misses; this one is an ' +
        'input. Double the area-to-mass ratio and the lifetime roughly halves.' },
{ id: 'cav.am.sail', group: 'caveat', sev: 'info', flags: { draftOnly: true }, term: 't-bstar',
  when: c => c.am > 0.05 && c.e < 0.25,
  title: 'That is a sail or a balloon',
  body: 'An area-to-mass ratio of {am:am} is several times a CubeSat’s 0.009. Only solar sails, ' +
        'balloons and very light foil structures are this big, and the air takes them down far ' +
        'faster than a compact satellite at the same height.' },
{ id: 'cav.am.zero', group: 'caveat', sev: 'info', flags: { draftOnly: true }, term: 't-bstar',
  when: c => c.am === 0,
  title: 'No drag at all',
  body: 'With an area-to-mass ratio of 0 the orbit never decays, which no real satellite manages ' +
        'below about 1,000 km. The lifetime notes are off, because there is nothing for them to work ' +
        'on.' },
/* Near 180 degrees SGP4 divides by 1 + cos i. The error is the amplitude of that singular
   term turned into an along-track distance, and it does not depend on the altitude: about
   860 km at e = 0.01, i = 179.99. Note under 10 km, Check to 100 km, and above 100 km the
   planner raises it as a blocking error. retro_lead is "about" for a near-Earth orbit and
   "on the order of" for a deep-space one, where the Sun and the Moon make the measurement
   murky. */
{ id: 'sgp4.retro', group: 'caveat', sev: c => c.retro_err < 10 ? 'info' : c.retro_err <= 100 ? 'warn' : 'error', flags: { draftOnly: true },
  when: c => c.off180 > 0 && c.off180 <= 30 && c.e > 0 && c.retro_err >= 1,
  title: 'SGP4 loses accuracy this close to 180°',
  body: 'The SGP4 formulas divide by the distance of the tilt from 180°, which here is ' +
        '{off180:deg3}. With e = {e:e4} that can put the satellite {retro_lead:txt} {retro_err:km} ' +
        'from where the mirror-image orbit places it. An inclination of exactly 180° or an ' +
        'eccentricity of 0 avoids it.',
  basis: 'SGP4 mirror test: the error grows as e / (180° − i) and does not depend on the altitude',
  fix: [
    { label: 'Set i to 180° exactly', set: { inc: 180 }, focus: 'inc' },
    { label: 'Set e to 0', set: { e: 0 }, focus: 'e' } ] },
/* Textbook frozen orbits are written for osculating elements (e = −(J3 / 2J2)(Re / a) sin i
   with ω of 90 or 270). SGP4 takes mean elements, in which that offset is already removed,
   so in these elements the frozen orbit is e = 0. Fires near the offset (within 30 %) with
   ω within 15 degrees of 90 or 270. */
{ id: 'cav.frozen', group: 'caveat', sev: 'info', flags: { draftOnly: true },
  when: c => c.inc >= 80 && c.inc <= 120 && c.hp < 1500 && c.e > 0 && Math.abs(c.e - c.e_f) <= 0.3 * c.e_f && Math.abs(Math.sin(c.argp * Math.PI / 180)) >= 0.966,
  title: 'A textbook frozen orbit is e = 0 here',
  body: 'Frozen-orbit tables give e = {e_f:e4} with ω = 90° or 270°, an offset that keeps the ' +
        'eccentricity from drifting. It is written for osculating elements. SGP4 takes mean elements ' +
        'with that offset already removed, so typing it again makes the eccentricity swing instead ' +
        'of holding steady. In these elements the frozen orbit is e = 0.',
  basis: 'J3 offset e = −(J3 / 2J2)(Re / a) sin i, checked by an SGP4 run over 180 days',
  fix: [
    { label: 'Set e to 0', set: { e: 0 }, focus: 'e' } ] },
/* SGP4 switches to its deep-space form (the Moon, the Sun and resonance terms) at a 225
   minute period, a = 12,254 km. Flagged for both hosts. */
{ id: 'cav.deep', group: 'caveat', sev: 'info', flags: {},
  when: c => c.period >= 225,
  title: 'Past 225 minutes, SGP4 changes model',
  body: 'A period of {period:hm} is beyond 225 minutes, about {deep_alt:km} high on a circular ' +
        'orbit. From there SGP4 switches to its deep-space form. That adds the pull of the Moon and ' +
        'the Sun and, near 1 and 2 revolutions a day, a resonance with the shape of the Earth. The ' +
        'rates in these notes include those terms.',
  basis: 'SGP4 deep-space initialisation' },

/* ------------------------------------------------------------ input problems
   Not raised by a `when`: Planner and the page raise them, and the panel renders them with
   renderInput(code, params) under the field they are about. Each is flagged draftOnly
   because it talks about what was typed. */
{ id: 'err.missing', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Type a number for {field:txt}',
  body: '{field:txt} is empty, and the orbit cannot be worked out without it.' },
{ id: 'err.notnum', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: '{field:txt} is not a number',
  body: '“{raw:txt}” is not a number. Use digits and a decimal point, for example 97.4.' },
{ id: 'err.inc.range', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Inclination runs from 0° to 180°',
  body: '{inc:deg2} is outside that range. Tilts above 90° are retrograde; 97.4° and 82.6° are ' +
        'mirror images, tilted the same way off the pole and flown in opposite directions.' },
{ id: 'err.ecc.neg', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Eccentricity cannot be negative',
  body: 'e = {e:e4}. Zero is a circle; larger values stretch it.' },
{ id: 'err.ecc.parabola', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'e = 1 is a parabola',
  body: 'At e = 1 the path never closes: the satellite arrives once, swings past the Earth and ' +
        'leaves. There is no period and no ground track. A closed orbit needs e below 1.' },
{ id: 'err.ecc.hyper', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'e above 1 is a hyperbola',
  body: 'At e = {e:e4} the satellite has more than escape speed: it swings past the Earth once and ' +
        'leaves. There is no period and no ground track. A closed orbit needs e below 1.' },
/* The fix is always offered: the planner passes fix_hp = 200. */
{ id: 'err.perigee.surface', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Perigee is inside the Earth',
  body: 'a(1 − e) = {rp:km1} is under the Earth’s radius of 6,378.1 km, so the orbit would end ' +
        'underground.',
  fix: [
    { label: 'Set perigee to {fix_hp:km}', set: { hp: '{fix_hp}' }, focus: 'hp' } ] },
{ id: 'err.apo.lt.peri', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Apogee is below perigee',
  body: 'Apogee ({ha:km}) is the high point and perigee ({hp:km}) the low one. They look swapped.',
  fix: [
    { label: 'Swap them', set: { hp: '{ha}', ha: '{hp}' }, focus: 'hp' } ] },
{ id: 'err.a.range', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Beyond the Moon',
  body: 'a = {a:km} is past {a_max:km}, about the Moon’s distance. SGP4 describes orbits around the ' +
        'Earth; nothing out there is an Earth orbit.' },
{ id: 'err.am.range', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Area ÷ mass runs from 0 to 10 m²/kg',
  body: '{am:am} is outside that. Real satellites sit between about 0.001 and 0.03; a solar sail or ' +
        'a balloon can reach 1 or more.' },
/* The TLE’s own year runs 1957 to 2056; the planner accepts 2000 to 2056, and the text says
   both. */
{ id: 'err.epoch.range', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Epoch outside 2000 to 2056',
  body: 'The orbit is written as a TLE for SGP4, whose two-digit year spans 1957 to 2056; this ' +
        'planner accepts 2000 to 2056. {epoch_utc:txt} is outside that.' },
{ id: 'err.angle.wrap', group: 'input', sev: 'info', flags: { draftOnly: true },
  title: '{raw:txt}° is taken as {wrapped:deg2}',
  body: 'Angles run 0° to 360°, so the extra turns are dropped.' },
{ id: 'err.name.empty', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Give it a name',
  body: 'A name of 1 to 24 characters, so it can be found in the search list.' },
{ id: 'err.name.taken', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: '{name:txt} is already a name',
  body: '{name:txt} belongs to a spacecraft already in the list, and two with the same name are easy ' +
        'to confuse.',
  fix: [
    { label: 'Rename it to {name_free:txt}', set: { name: '{name_free}' }, focus: 'name' } ] },
/* {code} is the numeric SGP4 error (the planner error’s `sgp4` member; renderInput renames
   it, because the error’s own `code` is the item id). */
{ id: 'err.sgp4', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'SGP4 cannot fly this orbit',
  body: 'SGP4 refused it with error {code:num0}: {why:txt}. {hint:txt}' },
{ id: 'err.cap', group: 'input', sev: 'warn', flags: { draftOnly: true },
  title: 'The saved list is full',
  body: '{cap:num0} orbits are saved. Delete one to keep another. This orbit still works for this ' +
        'visit; it will not be remembered.' },
{ id: 'err.storage', group: 'input', sev: 'warn', flags: { draftOnly: true },
  title: 'This browser will not remember orbits',
  body: 'Saving needs browser storage, which is blocked or unavailable here (a private window, for ' +
        'example). The orbit works for this visit only.' },
/* A note, not an error: the name was tidied by Planner.cleanName and the field shows what
   will be saved. */
{ id: 'err.name.cleaned', group: 'input', sev: 'info', flags: { draftOnly: true },
  title: 'Will be saved as “{cleaned:txt}”',
  body: 'The name was tidied: control and direction characters, and a leading = + − @ | \' or ", are ' +
        'removed. Names are also cut to 24 characters. Both keep the name safe in a spreadsheet and ' +
        'in a calendar file.' },
/* B* above 0.1 puts a 500 km orbit down in days and runs SGP4’s drag series out of range.
   am_max is the largest ratio that keeps B* at 0.1, to two significant digits and never
   below 0.001, so the fix never sets the ratio to zero. */
{ id: 'err.bstar.range', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Too much drag for SGP4 at this height',
  body: 'At {h_mean:km} an area-to-mass ratio of {am:am} gives B* = {bstar:sci}. SGP4 expands drag ' +
        'in a short series that fails above {bstar_max:sci}: the orbit would be down within days, ' +
        'and the model could not follow it.',
  fix: [
    { label: 'Set the area-to-mass ratio to {am_max:am}', set: { am: '{am_max}' }, focus: 'am' } ] },
/* Raised by Planner.fromForm when the local time cannot be read as hh:mm or as hours from 0
   to 24. */
{ id: 'err.ltan.range', group: 'input', sev: 'error', flags: { draftOnly: true },
  title: 'Local time runs from 00:00 to 24:00',
  body: '“{raw:txt}” is not a time of day. Give hours and minutes as 10:30, or hours as a decimal ' +
        'such as 10.5.' }
];

/* ---------------------------------------------------------------- writing a sentence */

const TOKEN = /\{([a-z_A-Z0-9]+)(?::([a-z0-9]+))?\}/g;

const finite = v => typeof v === 'number' && isFinite(v);

/* The one error a missing figure raises. The message is exactly `unresolved {key}`;
   the key and the template ride along as properties so a test (or a log) can say
   which sentence had the hole without the message growing. `unresolved` marks it as
   "a figure the dictionary does not have", which advise() treats as an expected
   absence for a fix and as a defect for a title or a body. */
function unresolvedError(key, tpl){
  const e = new Error('unresolved {' + key + '}');
  e.unresolved = true; e.key = key; e.template = tpl;
  return e;
}

/* One placeholder to text. A number format takes a finite number and nothing
   else: a numeric string, NaN, Infinity, null, undefined or a missing key is an
   unresolved figure, not a sentence reading "NaN km". `txt` and `b` take a string
   or a finite number (a typed name is text and is passed through whole: it is
   inserted once and never scanned again for placeholders). `life` also takes
   Infinity and null, because "beyond the cap" is a lifetime. */
function figure(key, f, c, tpl){
  const fmt = f || 'txt';
  if(!Object.prototype.hasOwnProperty.call(FMT, fmt)) throw new Error('unknown format {' + key + ':' + fmt + '}');
  const v = (c !== null && c !== undefined) ? c[key] : undefined;
  if(fmt === 'txt' || fmt === 'b'){
    if(typeof v === 'string' || finite(v)) return FMT[fmt](v);
  } else if(fmt === 'life'){
    if(v === null || v === Infinity || finite(v)) return FMT.life(v);
  } else if(finite(v)){
    return FMT[fmt](v);
  }
  throw unresolvedError(key, tpl);
}

/* A template to parts: [{t:'text'} | {n:'700 km'}]. `n` is a bold figure. Adjacent
   text is merged and empty pieces are dropped, so the panel builds the fewest nodes.
   `keys`, when given, collects the dictionary keys the template read. */
function scan(tpl, c, keys){
  if(typeof tpl !== 'string') throw new TypeError('template must be a string');
  const out = [];
  const add = p => {
    if(p.t !== undefined){
      if(p.t === '') return;
      const last = out[out.length - 1];
      if(last && last.t !== undefined){ last.t += p.t; return; }
    } else if(p.n === '') return;
    out.push(p);
  };
  const re = new RegExp(TOKEN.source, 'g');
  let at = 0, m;
  while((m = re.exec(tpl)) !== null){
    add({ t: tpl.slice(at, m.index) });
    const text = figure(m[1], m[2], c, tpl);
    if(keys) keys.push(m[1]);
    add(m[2] === undefined || m[2] === 'txt' ? { t: text } : { n: text });
    at = m.index + m[0].length;
  }
  add({ t: tpl.slice(at) });
  return out;
}
const plain = ps => ps.map(p => p.t !== undefined ? p.t : p.n).join('');

function render(tpl, c){ return plain(scan(tpl, c, null)); }
function parts(tpl, c){ return scan(tpl, c, null); }

/* A fix's payload value: a number is itself; '{key}' is that key of the
   dictionary, as the raw number or string (not the formatted text), because it goes
   into a form field. Anything else is a defect in the catalogue. */
const PAYLOAD = /^\{([a-z_A-Z0-9]+)\}$/;
function payload(v, c, keys){
  if(typeof v === 'number'){
    if(finite(v)) return v;
    throw new Error('fix payload is not finite');
  }
  if(typeof v === 'string'){
    const m = PAYLOAD.exec(v);
    if(!m) throw new Error('fix payload "' + v + '" is neither a number nor a {key}');
    const r = (c !== null && c !== undefined) ? c[m[1]] : undefined;
    if(finite(r) || (typeof r === 'string' && r !== '')){ keys.push(m[1]); return r; }
    throw unresolvedError(m[1], v);
  }
  throw new Error('fix payload must be a number or a "{key}"');
}

/* ---------------------------------------------------------------- an item, written out */

function severityOf(item, c){
  const s = typeof item.sev === 'function' ? item.sev(c) : item.sev;
  if(!Object.prototype.hasOwnProperty.call(SEV, s)) throw new Error('unknown severity ' + s + ' on ' + item.id);
  return s;
}

/* RenderedItem: the item with every placeholder resolved. `values` is the part of
   the dictionary this item read (title, body, kept fix labels and payloads), which
   is what lets a test prove an item never reads a key nobody supplies.

   opts.strict   rethrow what would otherwise drop a fix
   opts.noFixes  the read-only host never offers fixes
   opts.dropped  where to note the fixes left out, as {id, label, why}

   A fix is left out, never the item, when its `when` is false (a designed
   absence), when a key its label or payload reads is not in the dictionary (the
   fix guard: no two-year orbit exists to raise to) or, outside strict mode, when
   it throws for any other reason. Under strict a fix that throws for any reason
   other than a missing figure is a defect and is rethrown. */
function renderItem(item, c, opts){
  const o = opts || {};
  const keys = [];
  const sev = severityOf(item, c);
  const title = scan(item.title, c, keys);
  const body = scan(item.body, c, keys);
  const fixes = [];
  const list = o.noFixes ? [] : (item.fix || []);
  for(let i = 0; i < list.length; i++){
    const fx = list[i];
    const fk = [];
    try {
      if(typeof fx.when === 'function' && !fx.when(c)) continue;
      const label = scan(fx.label, c, fk);
      const set = {};
      Object.keys(fx.set).forEach(k => { set[k] = payload(fx.set[k], c, fk); });
      fixes.push({ label: label, labelText: plain(label), set: set, focus: fx.focus });
      Array.prototype.push.apply(keys, fk);
    } catch(e){
      const missing = !!(e && e.unresolved);
      if(o.strict && !missing) throw e;
      if(o.dropped) o.dropped.fixes.push({ id: item.id, label: fx.label, why: e && e.message });
    }
  }
  const values = {};
  keys.forEach(k => { if(!Object.prototype.hasOwnProperty.call(values, k)) values[k] = c[k]; });
  return {
    id: item.id, group: item.group, sev: sev, word: SEV[sev].word,
    title: title, body: body, titleText: plain(title), bodyText: plain(body),
    basis: item.basis || null, term: item.term || null,
    fixes: fixes, values: values
  };
}

/* The labels the planner gives its fields. renderInput accepts either the label
   or the form key in `field` ('inc' reads "Inclination"), because a planner error
   carries the key and the sentence wants the words. This is a copy of
   Planner.FIELD_LABEL (this file cannot depend on Planner at load time), and the checks
   compare the two whenever both are loaded. */
const FIELD_LABEL = {
  hp: 'Mean perigee altitude', ha: 'Mean apogee altitude', a: 'Semi-major axis', e: 'Eccentricity',
  period: 'Keplerian period', inc: 'Inclination', raan: 'Node (RAAN)', ltan: 'Node (LTAN)',
  argp: 'Argument of perigee', ma: 'Mean anomaly', epoch: 'Epoch', am: 'Area over mass', name: 'Name'
};

/* An input item (err.*, sgp4.retro, err.angle.wrap) rendered from the params of the
   error that raised it: the params ARE the context, so a function `sev` sees
   retro_err. Throws when a placeholder has no param, and the panel then shows the
   error's plain `msg` instead. Two members of a planner error are renamed for the
   sentence: the numeric SGP4 code (`sgp4`) is the {code} of err.sgp4, because the
   error's own `code` member is the item id, and a form key in `field` becomes its
   label. The caller's object is never changed.

   sgp4.retro needs one more word than the planner's error carries (off180, retro_err,
   e, inc): whether the distance is "about" 857 km (a near-Earth orbit, where the figure was
   measured against SGP4 itself) or "on the order of" it (a deep-space orbit, where the Sun
   and the Moon spoil the measurement). The error does not say how big the orbit is, so
   when retro_lead is absent the sentence takes the cautious wording. */
function renderInput(code, params){
  let item = null;
  for(let i = 0; i < ITEMS.length; i++) if(ITEMS[i].id === code){ item = ITEMS[i]; break; }
  if(!item) throw new Error('unknown item ' + code);
  const ctx = Object.assign({}, params);
  if(finite(ctx.sgp4) && !finite(ctx.code)) ctx.code = ctx.sgp4;
  if(typeof ctx.field === 'string' && Object.prototype.hasOwnProperty.call(FIELD_LABEL, ctx.field)) ctx.field = FIELD_LABEL[ctx.field];
  if(code === 'sgp4.retro' && ctx.retro_lead === undefined) ctx.retro_lead = 'on the order of';
  return renderItem(item, ctx, { strict: false });
}

/* ---------------------------------------------------------------- the whole pass */

const NO_DROPS = () => ({ items: [], fixes: [] });

/* Which items fire for the dictionary `c`, written out, ordered, counted.

   opts.host    'draft' (default): the planner's own list; 'readonly': a catalogue
                spacecraft, which drops the items flagged draftOnly and offers no fixes
   opts.strict  rethrow a throwing `when`, or a title or body that cannot be
                written (tests run strict, the page does not)
   opts.items   a catalogue to run instead of ITEMS (tests)

   Order: groups in GROUPS order. Inside `type`, catalogue order (the first item
   that fires names the orbit). Inside every other group, Fix this, Problem, Check,
   Note, Good, then catalogue order. No clock and no randomness: the same dictionary
   gives the same list.

   `dropped` says what was left out and why, for tests: items whose `when` or text
   threw (always empty when nothing is wrong), and fixes left out for a missing
   figure. A firing item is never dropped for the want of a fix. */
function advise(c, opts){
  const o = opts || {};
  const strict = !!o.strict;
  const host = o.host === 'readonly' ? 'readonly' : 'draft';
  const list = o.items || ITEMS;
  const dropped = NO_DROPS();
  const found = [];
  for(let i = 0; i < list.length; i++){
    const it = list[i];
    if(typeof it.when !== 'function') continue;
    const fl = it.flags || {};
    if(host === 'readonly' && fl.draftOnly) continue;
    if(fl.trackedOnly && host !== 'readonly') continue;
    try {
      if(!it.when(c)) continue;
      found.push({ r: renderItem(it, c, { strict: strict, noFixes: host === 'readonly', dropped: dropped }), at: i });
    } catch(e){
      if(strict) throw e;
      dropped.items.push({ id: it.id, why: e && e.message });
    }
  }
  const gi = {};
  GROUPS.forEach((g, i) => { gi[g.id] = i; });
  const rank = r => SEV[r.sev].rank;
  found.sort((a, b) => {
    const ga = gi[a.r.group] === undefined ? GROUPS.length : gi[a.r.group];
    const gb = gi[b.r.group] === undefined ? GROUPS.length : gi[b.r.group];
    if(ga !== gb) return ga - gb;
    if(a.r.group !== 'type' && rank(a.r) !== rank(b.r)) return rank(b.r) - rank(a.r);
    return a.at - b.at;
  });
  const items = found.map(f => f.r);
  const counts = { error: 0, bad: 0, warn: 0, info: 0, good: 0 };
  items.forEach(r => { counts[r.sev]++; });
  const worst = counts.bad + counts.error > 0 ? 'bad' : counts.warn > 0 ? 'warn' : counts.good > 0 ? 'good' : 'info';
  return { items: items, counts: counts, worst: worst, verdict: verdictOf(c, items, strict), dropped: dropped };
}

/* The verdict line: the name of the orbit (the first `type` item that fires), its
   height or its two heights, and its period. The page fills in `sub`. When the
   figures are not in the dictionary the line is just the name. */
function verdictOf(c, items, strict){
  const kind = items.find(r => r.group === 'type');
  const head = [{ t: kind ? kind.titleText : 'Orbit' }];
  try {
    const need = k => { if(!finite(c[k])) throw unresolvedError(k, 'verdict'); return c[k]; };
    const height = c.e < 0.01 ? FMT.km(need('h_mean')) : FMT.km(need('hp')) + ' × ' + FMT.km(need('ha'));
    const per = need('period');
    head.push({ t: ' · ' }, { n: height }, { t: ' · ' }, { n: per < 180 ? FMT.min1(per) : FMT.hm(per) });
  } catch(e){
    if(strict) throw e;
  }
  return { head: head, sub: null };
}

global.AdvisorCopy = {
  ADVISOR_LABEL: ADVISOR_LABEL, FOOTER: FOOTER, GROUPS: GROUPS, SEV: SEV, FMT: FMT, TOKEN: TOKEN, ITEMS: ITEMS,
  helpers: { fold: fold, isLEO: isLEO, nearCirc: nearCirc, sunsync: sunsync, ssoNear: ssoNear, sidLike: sidLike, GEO_TOL: GEO_TOL,
             isGeo: isGeo, geoDrift: geoDrift, issLike: issLike, clockDist: clockDist, dawnDusk: dawnDusk, noonMid: noonMid },
  render: render, parts: parts, renderItem: renderItem, renderInput: renderInput, advise: advise
};

})(typeof window !== 'undefined' ? window : globalThis);
