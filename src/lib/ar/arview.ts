// @ts-nocheck - moved verbatim; see the note below
/* arview.js — the sky drawn over a phone's camera, where the phone points.
 *
 * The console says when a pass happens and where to look ("68° NE"). Outdoors,
 * that still leaves a reader turning a compass bearing into a direction in
 * the sky. This view does it for them: the rear camera's picture, with the
 * spacecraft, its pass, the horizon, the 5° mask and the Sun drawn over it,
 * following the phone's motion sensors.
 *
 * It is the DOM half. The geometry is earth/skyar.js, the declination
 * earth/wmm.js, and everything about the spacecraft comes from the page through
 * a provider, so nothing here knows how a pass is found. At load it defines
 * ARView and nothing else; it touches the DOM only once init() is called.
 *
 * Four things decide how it asks, and each was a bug waiting to happen:
 *
 * - The order of the two requests. On an iPhone the motion permission can only
 *   be asked for while the tap's user-gesture token is current, and it is gone
 *   after an await on anything that settles in a later task - getUserMedia
 *   among them. So open() makes the motion request FIRST and the camera
 *   request SECOND, in the same task as the click, and only then waits for
 *   either. Starting the camera inside the tap has a second use: in WebKit it
 *   is what lets a camera declined earlier be asked for again.
 * - requestPermission() existing does not mean iOS. Chrome 152 has it too, and
 *   answers "granted" there. Nothing here sniffs the browser; each event is
 *   classified by what it carries.
 * - North is magnetic on every platform, and on iOS the orientation's own zero
 *   is arbitrary (see compassFusion in skyar.js). The World Magnetic Model
 *   turns magnetic into true north at the observer.
 * - A still phone is silent. Chrome sends an orientation event only when an
 *   angle changes by 0.1°, and since Chrome 153 it suspends them while the
 *   page is hidden, covered or out of focus - possibly under a permission
 *   prompt. So there is a timeout for the FIRST reading, armed once the prompts
 *   have been answered, and no alarm for silence after that: the last pose is
 *   held.
 *
 * The camera's picture is never read, drawn into the canvas or sent anywhere:
 * it is a <video> element under a transparent canvas. The one thing this file
 * keeps is the lens setting, in localStorage; Use my location goes through the
 * page's own path, which saves the observer.
 */
/* ---- Moved from legacy/earth/arview.js (main@4eadd7a), lines 42-1065.
 * The wrapper is the only change: the old file was an IIFE over `global` that attached `ARView`; this is a factory over an object that
 * gives it what it reached for as globals (SkyAR, WMM, and the window's own members) and that returns it. It still creates no DOM and
 * touches none until init() and open(): the Node suite loads it with no document. The one added line is the late-bound WMM below, which
 * stands in for the bare global the old code read (CHANGED: it was `WMM.field(...)` against a script-tag global).
 *
 * Added since the move, each at a line marked "CHANGED (radar)": the radar (src/lib/ar/radar.ts), a polar plot of the whole sky in the
 * corner of the view, with the spacecraft, its pass and the phone's aim as a blue crosshair. It reads the pose and the pass this file is
 * already drawing, and changes nothing the old code did, except that the off-screen pointer and the words kept on the screen (the
 * spacecraft's name, the pointer's guidance) keep off the radar's box.
 */
import { drawRadar, radarSize } from './radar';

export function makeARView(global) {
const WMM = { field: (...a) => global.WMM.field(...a), decimalYear: (...a) => global.WMM.decimalYear(...a) };

/* ---- what it says ------------------------------------------------------------
 * One status line, in the page's voice. Every sentence names what happened and
 * what is still being drawn, the way the console's other notes do. */
const MSG = {
  ask:        'Asking for the camera and the motion sensors…',
  insecure:   p => 'The AR view needs a secure page, and this one was opened over ' + p + '// — browsers give ' +
                   'the camera and the motion sensors only to https pages and local files. Open ' +
                   'https://sattrackslop.vercel.app on this phone.',
  noOri:      'This browser gives pages no motion sensors, so the view cannot follow the phone.',
  oriDenied:  'Motion and orientation access was declined, so the view cannot follow the phone. On an iPhone, ' +
              'Safari asks again only once it has been closed and reopened; elsewhere, allow motion sensors in ' +
              'this site’s settings. Then tap Try again.',
  oriTap:     'The browser wants a tap of its own before it asks about the motion sensors — tap Allow motion sensors.',
  oriError:   n => 'The browser would not ask for motion access (' + n + ') — close this and tap AR again.',
  noSensor:   'This device reports no motion sensor, so the view cannot follow it — the AR view needs a phone ' +
              'or a tablet.',
  noReading:  'No reading from the motion sensors in 3 s. This device may have none, or the browser is holding ' +
              'them back — check this site’s motion-sensor setting.',
  tilt:       'This device reports its tilt but not which way it faces, so the view cannot follow it round.',

  camDenied:  'Camera access was declined — the sky is drawn on black instead. Allow the camera for this site ' +
              'and tap Try again.',
  camNone:    'No camera on the back of this device — the sky is drawn on black instead.',
  camBusy:    'The camera is in use by another app — the sky is drawn on black instead. Close that app and tap ' +
              'Try again.',
  camFront:   'The only camera offered faces you, and the sky drawn here is the one behind the phone — so it is ' +
              'drawn on black instead.',
  camApi:     'This browser gives pages no camera — the sky is drawn on black instead.',
  camOther:   n => 'The camera did not start (' + n + ') — the sky is drawn on black instead. Tap Try again.',
  camPlay:    'The camera picture would not play — the sky is drawn on black instead.',
  camEnded:   'The camera stopped while the page was away — the sky is drawn on black instead. Tap Try again.',

  finding:      'Finding north — tip the phone towards flat for a moment.',
  findingAgain: 'Finding north again after the pause — tip the phone towards flat for a moment.',
  uncal:      'The compass is not calibrated — move the phone through a slow figure of eight, away from metal.',
  poor:       a => 'The compass says it is good only to ±' + a + '° — a slow figure of eight away from metal ' +
                   'usually brings that down.',
  rel:        'No compass reading — the view turns with the phone but is not tied to north. Drag sideways to put ' +
              'the drawn Sun on the real one.',
  absCame:    'The compass came in — north is the compass’s now, and the hand turn is cleared.',
  pole:       'This close to the magnetic pole a compass is no guide to north — drag the sky onto something whose ' +
              'bearing you know.',

  elsewhere:  (name, zone) => 'The sky is drawn from ' + name + ', and this phone keeps ' + zone + ' — if you are ' +
              'not there, every direction here is wrong. Use my location moves the observer to this phone.',
  hereAsk:    'Asking this device where it is…',
  hereOk:     acc => 'Sky set from this device' + (acc ? ', accurate to about ' + Math.round(acc) + ' m.' : '.'),
  hereFail:   (why, name) => why + ' — the sky is still drawn from ' + name + '.',

  hint:       'Drag sideways to line the sky up, pinch to fit the lens.'
};
/* Which message wins the one line: a failure over a camera problem over the
   answer to Use my location, and so on down to the gesture hint. */
const SLOTS = ['fatal', 'camera', 'here', 'elsewhere', 'compass', 'phase', 'hint'];

const LENS = { def: 68, min: 45, max: 80, key: 'gt.arlens' };
const RADAR_KEY = 'gt.arradar';       // CHANGED (radar): '0' once the reader has hidden the radar; shown otherwise
const FIRST_READING_MS = 3000;       // armed once both prompts have been answered
const REL_GRACE_MS = 600;            // Chrome's relative stream starts before its absolute one
const MINUS = '−';

/* ---- state -------------------------------------------------------------------- */
let S = null, P = null;              // SkyAR, and the page's provider
let root = null, opener = null, E = {};
let ctx = null, dpr = 1, W = 0, H = 0, cx = 0, cy = 0, F = 1;
let state = 'closed', reason = null, gen = 0;
let motionOK = false, camState = 'off', camStream = null;
let absR = null, relR = null, absSeen = false, iosSeen = false, nullSeen = false, tiltOnly = false;
let firstRelAt = null, source = null, lastIosAcc = null, foundAgain = false;
let fusion = null, smooth = null, cam = null, view = null, theta = 0;
let trim = 0, fov = LENS.def, fovSet = false;
let decl = { ok: false, D: 0, zone: 'ok', expired: false }, declKey = '';
let follow = false, hinted = false, firstRunning = false;
let raf = 0, lastTs = 0, frames = 0, readTimer = 0, firstTimer = 0, hintTimer = 0;
let wake = null, pushed = false, inerted = [], listening = false;
let slots = {}, compassNote = null, siteSeen = '';
let pal = {}, safe = { left: 0, top: 0, right: 0, bottom: 0 }, keepOut = [];
let ptrs = new Map(), pinch = null, pinched = false;
let probeDraw = {};
let radarCtx = null, radarOn = true, radarBox = null, radarSeen = null;   // CHANGED (radar): see radar.ts
const radarCache = { make: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, layers: {}, last: null };
const tickCache = new WeakMap();

const now = () => performance.now();
const $ = id => document.getElementById(id);
const setText = (e, t) => { if(e && e.textContent !== t) e.textContent = t; };
const signed = (v, dp) => (v < 0 ? MINUS : '+') + Math.abs(v).toFixed(dp);
const named = n => { const e = new Error(n); e.name = n; return e; };

/* ---- init ------------------------------------------------------------------------ */
const IDS = ['video', 'sky', 'site', 'pos', 'here', 'close', 'status', 'view', 'north', 'decl', 'clock',
             'target', 'pass', 'live', 'retry', 'alignbtn', 'align', 'left', 'right', 'trim0', 'lensv', 'fov', 'fov0',
             'radar', 'radarbtn'];                // CHANGED (radar): the two added ids
function init(o){
  try {
    S = global.SkyAR; P = o && o.provider; root = o && o.root; opener = o && o.opener;
    if(!S || !P || !root) return false;
    for(const k of IDS){ E[k] = $('ar-' + k); if(!E[k]) return false; }
    ctx = E.sky.getContext('2d');
    if(!ctx) return false;
    radarCtx = E.radar.getContext('2d');             // CHANGED (radar)
    if(!radarCtx) return false;
    fusion = S.compassFusion(); smooth = S.smoother();
    E.close.addEventListener('click', () => close());
    E.retry.addEventListener('click', retry);
    E.live.addEventListener('click', () => { P.goLive(); follow = true; readout(); });
    E.here.addEventListener('click', useHere);
    E.alignbtn.addEventListener('click', () => {
      const open = E.align.hidden;
      E.align.hidden = !open; E.alignbtn.setAttribute('aria-expanded', String(open)); measure();
    });
    E.left.addEventListener('click', () => { trim += 1; handUsed(); });
    E.right.addEventListener('click', () => { trim -= 1; handUsed(); });
    E.trim0.addEventListener('click', () => { trim = 0; });
    E.fov.addEventListener('input', () => setLens(+E.fov.value));
    E.fov0.addEventListener('click', () => setLens(LENS.def));
    E.radarbtn.addEventListener('click', () => setRadar(!radarOn));     // CHANGED (radar)
    E.sky.addEventListener('pointerdown', pDown);
    E.sky.addEventListener('pointermove', pMove);
    E.sky.addEventListener('pointerup', pUp);
    E.sky.addEventListener('pointercancel', pUp);
    root.addEventListener('keydown', e => { if(e.key === 'Escape'){ e.preventDefault(); close(); } });
    // iOS zooms the page under a two-finger pinch unless told otherwise
    root.addEventListener('gesturestart', e => e.preventDefault());
    return true;
  } catch(e){ return false; }
}

/* ---- opening: both requests inside the tap ---------------------------------------- */
function open(){
  if(state !== 'closed') return;                 // a double tap
  gen++; const g = gen;
  motionOK = false; camState = 'off'; reason = null;   // before the requests, which set them
  const secure = global.isSecureContext === true;
  const DOE = global.DeviceOrientationEvent;
  const why = !secure ? 'insecure' : typeof DOE !== 'function' ? 'no-orientation' : null;

  // 1. motion, first, while the tap is still the current gesture
  let motion = null, camera = null;
  if(!why){
    motion = askMotion(DOE);
    // 2. the camera, second, in the same task - so still inside the gesture
    camera = askCamera();
    // 3. listeners before the answer: once it is granted, they start receiving
    addOri();
  }
  show();
  if(why){ fail(why); return; }
  setState('asking');
  say('phase', MSG.ask, 'info');
  settle(g, motion, camera);
}
function askMotion(DOE){
  if(typeof DOE.requestPermission !== 'function') return Promise.resolve('granted');
  try { return Promise.resolve(DOE.requestPermission(true)); }
  catch(e){ return Promise.reject(e); }
}
function askCamera(){
  const md = navigator.mediaDevices;
  if(!(md && typeof md.getUserMedia === 'function')){ camState = 'unavailable'; return Promise.reject(named('NoApi')); }
  camState = 'asking';
  try {
    return md.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } } });
  } catch(e){ return Promise.reject(e); }
}
function settle(g, motion, camera){
  const m = motion ? motion.then(ans => {
    if(g !== gen) return;
    if(ans === 'granted') motionOK = true;
    else fail('motion-denied');
  }, err => {
    if(g !== gen) return;
    if(err && err.name === 'NotAllowedError') fail('motion-tap');
    else fail('motion-error', (err && err.name) || 'Error');
  }) : Promise.resolve();
  const c = camera ? camera.then(stream => takeStream(g, stream),
                                 err => { if(g === gen) camFailed(err && err.name); }) : Promise.resolve();
  Promise.all([m, c]).then(() => {
    if(g !== gen || state === 'failed' || state === 'closed' || !motionOK) return;
    if(!source && (state === 'asking' || state === 'waiting')){
      setState('waiting');
      clearTimeout(firstTimer);
      firstTimer = setTimeout(() => {
        if(g !== gen || source || state === 'failed' || state === 'closed') return;
        fail(tiltOnly ? 'tilt' : nullSeen ? 'no-sensor' : 'no-reading');
      }, FIRST_READING_MS);
    }
  });
}

/* ---- the camera ---------------------------------------------------------------------- */
function stopStream(st){
  if(st) try { st.getTracks().forEach(t => t.stop()); } catch(e){}
}
function takeStream(g, stream){
  // an answer that arrives after Close, or after the view failed, never leaves the light on
  if(g !== gen || state === 'closed' || state === 'failed'){
    stopStream(stream);
    if(g === gen) camState = 'off';                    // so Try again asks for it again
    return;
  }
  const tr = stream.getVideoTracks()[0];
  const fm = tr && tr.getSettings ? tr.getSettings().facingMode : undefined;
  if(fm === 'user'){ stopStream(stream); camState = 'front'; say('camera', MSG.camFront, 'warn'); retryShown(); return; }
  if(camStream && camStream !== stream) stopStream(camStream);
  camStream = stream;
  if(tr) tr.addEventListener('ended', () => {
    if(g !== gen || camStream !== stream) return;
    if(document.visibilityState === 'visible'){ camState = 'ended'; say('camera', MSG.camEnded, 'warn'); retryShown(); }
  });
  E.video.srcObject = stream;
  const p = E.video.play();
  (p && p.then ? p : Promise.resolve()).then(() => {
    if(g !== gen) return;
    camState = 'live'; say('camera', null); retryShown();
  }, () => { if(g === gen){ camState = 'play'; say('camera', MSG.camPlay, 'warn'); } });
}
function camFailed(name){
  const k = S.cameraFailure(name);
  camState = k;
  say('camera', k === 'declined' ? MSG.camDenied : k === 'none' ? MSG.camNone : k === 'busy' ? MSG.camBusy
              : k === 'unavailable' ? MSG.camApi : MSG.camOther(name || 'Error'), 'warn');
  retryShown();
}
function restartCamera(){
  const g = gen;
  camState = 'restarting';
  askCamera().then(st => takeStream(g, st), () => {
    if(g !== gen) return;
    camState = 'ended'; say('camera', MSG.camEnded, 'warn'); retryShown();
  });
}

/* ---- Try again, in a gesture of its own ------------------------------------------------ */
function retryShown(){
  const motionRetry = state === 'failed' && (reason === 'motion-denied' || reason === 'motion-tap');
  const camRetry = state !== 'failed' && ['declined', 'busy', 'other', 'ended'].includes(camState);
  E.retry.hidden = !(motionRetry || camRetry);
  setText(E.retry, reason === 'motion-tap' && motionRetry ? 'Allow motion sensors' : 'Try again');
}
function retry(){
  if(state === 'closed') return;
  const g = gen, DOE = global.DeviceOrientationEvent;
  let motion = null, camera = null;
  const onMotion = state === 'failed' && (reason === 'motion-denied' || reason === 'motion-tap');
  // the same order as open(), and again nothing before either call
  if(onMotion && typeof DOE === 'function') motion = askMotion(DOE);
  if(camState !== 'live' && camState !== 'asking') camera = askCamera();
  if(onMotion){
    say('fatal', null); reason = null;
    addOri(); setState('asking'); say('phase', MSG.ask, 'info');
    settle(g, motion, camera);
  } else if(camera){
    say('camera', null);
    camera.then(st => takeStream(g, st), err => { if(g === gen) camFailed(err && err.name); });
  }
  retryShown();
}

/* ---- the motion sensors ------------------------------------------------------------------- */
function onAbs(e){
  if(e.alpha == null || e.beta == null){ nullSeen = true; return; }
  absR = { a: e.alpha, b: e.beta, g: e.gamma == null ? 0 : e.gamma, t: now() };
  absSeen = true;
}
function onRel(e){
  if(e.beta == null){ nullSeen = true; return; }         // Chrome desktop's one all-null event
  if(e.alpha == null){ tiltOnly = true; return; }
  const r = { a: e.alpha, b: e.beta, g: e.gamma == null ? 0 : e.gamma, t: now() };
  if(typeof e.webkitCompassHeading === 'number'){
    relR = r; iosSeen = true; lastIosAcc = e.webkitCompassAccuracy;
    fusion.feed({ alpha: r.a, beta: r.b, gamma: r.g, heading: e.webkitCompassHeading,
                  accuracy: e.webkitCompassAccuracy, t: r.t });
    return;
  }
  if(e.absolute === true){ absR = r; absSeen = true; return; }   // Firefox before 110
  relR = r;
  if(firstRelAt === null) firstRelAt = r.t;
}
function addOri(){
  if(listening) return;
  global.addEventListener('deviceorientationabsolute', onAbs);
  global.addEventListener('deviceorientation', onRel);
  listening = true;
}
function removeOri(){
  global.removeEventListener('deviceorientationabsolute', onAbs);
  global.removeEventListener('deviceorientation', onRel);
  listening = false;
}
/* The absolute source is sticky once seen. A relative one is used only after a
   grace period, so the view does not flash to Chrome's relative zero before
   its absolute stream starts. */
function pickSource(t){
  const s = absSeen ? 'abs' : iosSeen ? 'ios' : (relR && t - firstRelAt >= REL_GRACE_MS) ? 'rel' : null;
  if(s !== source){
    if(source === 'rel' && s === 'abs'){ trim = 0; compassNote = { text: MSG.absCame, until: Date.now() + 6000 }; }
    source = s;
    smooth.reset();
    return true;
  }
  return false;
}
/* Every correction is a turn about the vertical, so each is a subtraction
   from alpha: alpha grows counter-clockwise and azimuth clockwise, so taking
   the declination D (east-positive) off alpha adds it to the azimuth. */
const declApplied = () => (decl.ok && decl.zone !== 'blackout') ? decl.D : 0;
function targetPose(){
  let r, alpha;
  if(source === 'abs'){ r = absR; alpha = r.a - declApplied() - trim; }
  else if(source === 'ios'){
    r = relR;
    const off = fusion.offset;
    alpha = off === null ? r.a - trim : r.a - off - declApplied() - trim;
  } else { r = relR; alpha = r.a - trim; }
  const B = S.frame(alpha, r.b, r.g);
  return { B, cam: null };
}
function screenTheta(B){
  let th = S.screenAngle(typeof global.orientation === 'number' ? global.orientation : undefined,
                         global.screen && screen.orientation ? screen.orientation.angle : undefined);
  const wide = global.innerWidth > global.innerHeight;
  if(wide !== (th % 180 === 90)){
    const gth = S.gravityAngle(B);
    if(gth !== null && (gth % 180 === 90) === wide) th = gth;
  }
  return th;
}

/* ---- the declination -------------------------------------------------------------------------
 * Taken at the wall clock, never at sim time: it corrects the compass in the
 * reader's hand now. Recomputed when the observer moves or the UTC day turns. */
function declNow(){
  const o = P.site(), day = new Date().toISOString().slice(0, 10);
  const key = o.lat + ',' + o.lon + ',' + (o.altKm || 0) + ',' + day;
  if(key === declKey) return;
  declKey = key;
  if(!global.WMM){ decl = { ok: false, D: 0, zone: 'ok', expired: false }; return; }
  try {
    const f = WMM.field(o.lat, o.lon, o.altKm || 0, WMM.decimalYear(Date.now()));
    decl = { ok: isFinite(f.D), D: f.D, zone: f.zone, expired: f.expired };
  } catch(e){ decl = { ok: false, D: 0, zone: 'ok', expired: false }; }
}

/* ---- showing and closing ---------------------------------------------------------------------- */
function show(){
  root.hidden = false; root.dataset.state = '';
  document.documentElement.classList.add('ar-open');
  inerted = [];
  for(const el of document.body.children){
    if(el === root || el.tagName === 'SCRIPT' || el.inert) continue;
    el.inert = true; inerted.push(el);
  }
  P.onOpen && P.onOpen();
  try { history.pushState({ ar: 1 }, ''); pushed = true; } catch(e){ pushed = false; }
  global.addEventListener('popstate', onPop);
  global.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVis);
  const cs = getComputedStyle(root), tok = (n, d) => cs.getPropertyValue(n).trim() || d;
  pal = { ink: tok('--ar-ink', '#EAF2F6'), ink2: tok('--ar-ink2', '#AFC3CE'), halo: tok('--ar-halo', '#05090C'),
          grid: tok('--ar-grid', 'rgba(234,242,246,.30)'), horizon: tok('--ar-horizon', 'rgba(234,242,246,.85)'),
          mask: tok('--ar-mask', '#F29CBB'), pass: tok('--ar-pass', '#E8BC5A'), craft: tok('--ar-craft', '#55D1E7'),
          sun: tok('--ar-sun', '#FFE7A8'), warn: tok('--ar-warn', '#D69A5C'),
          aim: tok('--ar-aim', '#3D8BFF') };     // CHANGED (radar): the phone's crosshair
  let stored = null;
  try { stored = parseFloat(localStorage.getItem(LENS.key)); } catch(e){}
  fov = isFinite(stored) ? S.clamp(LENS.min, LENS.max, stored) : LENS.def;
  fovSet = fov !== LENS.def;
  E.fov.value = String(fov);
  let hidden = null;                                  // CHANGED (radar): the reader's choice from the last time
  try { hidden = localStorage.getItem(RADAR_KEY); } catch(e){}
  radarOn = hidden !== '0'; radarBox = null; radarSeen = null; radarCache.last = null; radarUp = 0;
  E.radarbtn.setAttribute('aria-pressed', String(radarOn));
  E.radar.hidden = true;
  trim = 0; fusion.reset(); smooth.reset(); cam = view = null;
  absR = relR = null; absSeen = iosSeen = nullSeen = tiltOnly = false; firstRelAt = null; source = null;
  hinted = false; firstRunning = false; foundAgain = false;
  slots = {}; compassNote = null; siteSeen = ''; probeDraw = {};
  E.here.disabled = false;                             // a request from the last opening may not have answered
  E.align.hidden = true; E.alignbtn.setAttribute('aria-expanded', 'false');
  E.retry.hidden = true; E.live.hidden = true;
  declKey = ''; declNow();
  follow = P.live() && P.running();
  frames = 0; lastTs = 0;
  raf = requestAnimationFrame(loop);
  readTimer = setInterval(readout, 250);
  checkElsewhere();
  readout();
  E.close.focus();
  requestWake();
}
function requestWake(){
  try {
    if(navigator.wakeLock && navigator.wakeLock.request)
      navigator.wakeLock.request('screen').then(l => { if(state !== 'closed') wake = l; else l.release(); }, () => {});
  } catch(e){}
}
function close(){
  if(state === 'closed') return;
  gen++;
  cancelAnimationFrame(raf); raf = 0;
  clearInterval(readTimer); clearTimeout(firstTimer); clearTimeout(hintTimer);
  removeOri();
  global.removeEventListener('popstate', onPop);
  global.removeEventListener('pagehide', onHide);
  document.removeEventListener('visibilitychange', onVis);
  stopStream(camStream); camStream = null;
  try { E.video.pause(); } catch(e){}
  E.video.srcObject = null;
  if(wake){ try { wake.release(); } catch(e){} wake = null; }
  root.hidden = true; root.dataset.state = '';
  document.documentElement.classList.remove('ar-open');
  for(const el of inerted) el.inert = false;
  inerted = [];
  P.onClose && P.onClose();
  if(pushed && history.state && history.state.ar){ pushed = false; try { history.back(); } catch(e){} }
  pushed = false;
  fusion.reset(); smooth.reset(); trim = 0; ptrs.clear(); pinch = null; pinched = false;
  radarBox = null; radarSeen = null;                   // CHANGED (radar)
  state = 'closed'; camState = 'off';
  if(opener) opener.focus();
}
function onPop(){ pushed = false; close(); }
function onHide(){ close(); }
function onVis(){
  if(state === 'closed') return;
  if(document.visibilityState === 'hidden'){ cancelAnimationFrame(raf); raf = 0; return; }
  try { const p = E.video.play(); if(p && p.catch) p.catch(() => {}); } catch(e){}
  if(camStream && camStream.getVideoTracks().some(t => t.readyState === 'ended')) restartCamera();
  requestWake();
  // Core Motion re-zeros alpha when its updates restart, which a trip away can do
  if(source === 'ios'){ fusion.reset(); foundAgain = true; }
  smooth.reset();
  if(follow) P.goLive();
  if(!raf){ lastTs = 0; raf = requestAnimationFrame(loop); }
}
function setState(s){ state = s; if(root) root.dataset.state = s; }
function fail(key, extra){
  setState('failed'); reason = key;
  clearTimeout(firstTimer);
  stopStream(camStream); camStream = null; E.video.srcObject = null;
  // the camera is stopped, whatever it was: Try again decides by this whether to ask again
  camState = 'off';
  removeOri();
  say('phase', null); say('hint', null);
  say('fatal', key === 'insecure' ? MSG.insecure(location.protocol)
             : key === 'no-orientation' ? MSG.noOri
             : key === 'motion-denied' ? MSG.oriDenied
             : key === 'motion-tap' ? MSG.oriTap
             : key === 'motion-error' ? MSG.oriError(extra)
             : key === 'no-sensor' ? MSG.noSensor
             : key === 'tilt' ? MSG.tilt : MSG.noReading, 'warn');
  if(ctx){ ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, E.sky.width, E.sky.height); }
  cam = view = null;
  radarBox = null; radarSeen = null; E.radar.hidden = true;     // CHANGED (radar): nothing to point with
  retryShown();
}

/* ---- the one status line ------------------------------------------------------------------------- */
function say(slot, text, kind, ms){
  slots[slot] = text ? { text, kind: kind || 'warn', until: ms ? Date.now() + ms : 0 } : null;
  paintStatus();
}
function paintStatus(){
  const t = Date.now();
  let top = null;
  for(const k of SLOTS){ const s = slots[k]; if(s && (!s.until || s.until > t)){ top = s; break; } }
  setText(E.status, top ? top.text : '');
  const cls = 'ar-status' + (top && top.kind === 'info' ? ' info' : '');
  if(E.status.className !== cls) E.status.className = cls;
}
function compassMessage(){
  const t = Date.now();
  if(compassNote && compassNote.until > t) return { text: compassNote.text, kind: 'info' };
  if(state !== 'running' && state !== 'finding') return null;
  if(source !== 'rel' && decl.ok && decl.zone === 'blackout') return { text: MSG.pole, kind: 'warn' };
  if(source === 'ios'){
    const n = now();
    if(fusion.uncalSince !== null && n - fusion.uncalSince >= 3000) return { text: MSG.uncal, kind: 'warn' };
    if(fusion.badAccSince !== null && n - fusion.badAccSince >= 5000)
      return { text: MSG.poor(Math.round(lastIosAcc)), kind: 'warn' };
    if(fusion.offset === null) return { text: foundAgain ? MSG.findingAgain : MSG.finding, kind: 'info' };
  }
  if(source === 'rel') return { text: MSG.rel, kind: 'warn' };
  return null;
}
/* Whether the phone looks to be somewhere other than the observer. Checked
   against the observer itself whenever it changes, not after a request: a Use
   my location answer can arrive after the view has been closed and opened
   again, and moves the observer all the same. */
const siteKeyOf = o => o.lat + ',' + o.lon + ',' + o.name;
function checkElsewhere(){
  siteSeen = siteKeyOf(P.site());
  const dev = -new Date().getTimezoneOffset()/60, site = P.fmt.tz(Date.now());
  if(Math.abs(dev - site) >= 1){
    const a = Math.abs(dev), z = 'UTC' + (dev < 0 ? MINUS : '+') + (a % 1 ? a.toFixed(1) : a);
    say('elsewhere', MSG.elsewhere(P.site().name, z), 'warn');
  } else say('elsewhere', null);
}
function useHere(){
  if(state === 'closed') return;
  say('here', MSG.hereAsk, 'info');
  E.here.disabled = true;
  const g = gen;
  P.here().then(site => {
    if(g !== gen) return;
    declNow(); checkElsewhere();
    say('here', MSG.hereOk(site && site.accuracyM), 'info', 5000);
  }, err => {
    if(g !== gen) return;
    say('here', MSG.hereFail(String((err && err.message) || 'this device could not report a location'),
                             P.site().name), 'warn', 8000);
  }).then(() => { E.here.disabled = false; });
}

/* ---- gestures: one finger turns the sky, two fit the lens -------------------------------------------- */
function handUsed(){
  if(!hinted){ hinted = true; say('hint', null); }
}
function setLens(v){
  fov = S.clamp(LENS.min, LENS.max, Math.round(v*2)/2);
  fovSet = fov !== LENS.def;
  if(+E.fov.value !== fov) E.fov.value = String(fov);
  try { localStorage.setItem(LENS.key, String(fov)); } catch(e){}
  handUsed();
}
function pDown(e){
  try { E.sky.setPointerCapture(e.pointerId); } catch(_){}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if(ptrs.size === 2){
    const [a, b] = [...ptrs.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, fov0: fov };
    pinched = true;
  }
}
function pMove(e){
  const p = ptrs.get(e.pointerId);
  if(!p) return;
  const dx = e.clientX - p.x;
  p.x = e.clientX; p.y = e.clientY;
  if(ptrs.size >= 2 && pinch){
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    setLens(2*Math.atan(Math.tan(pinch.fov0*S.RAD/2)*pinch.d0/d)*S.DEG);
    return;
  }
  if(pinched || !dx) return;
  // the drawn sky follows the finger; turning about the vertical moves a point at
  // elevation el by cos(el) as much across the screen, hence the division
  const el = view ? view.el : 0;
  trim -= (dx/F)*S.DEG/Math.max(Math.cos(el*S.RAD), 0.3);
  handUsed();
}
function pUp(e){
  ptrs.delete(e.pointerId);
  if(ptrs.size < 2) pinch = null;
  if(ptrs.size === 0) pinched = false;
}

/* ---- the frame ------------------------------------------------------------------------------------------ */
function measure(){
  const r = E.sky.getBoundingClientRect();
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  const d = Math.min(global.devicePixelRatio || 1, 2);
  const bw = Math.round(W*d), bh = Math.round(H*d);
  if(E.sky.width !== bw || E.sky.height !== bh || d !== dpr){ E.sky.width = bw; E.sky.height = bh; dpr = d; }
  cx = W/2; cy = H/2;
  const top = root.querySelector('.ar-top').getBoundingClientRect();
  const read = root.querySelector('.ar-read').getBoundingClientRect();
  let t = top.bottom;
  if(E.status.textContent){ const s = E.status.getBoundingClientRect(); if(s.height) t = Math.max(t, s.bottom); }
  /* Held sideways, the readout is a column in the lower left rather than a band
     across the foot: the sky runs on to the bottom edge, and labels keep out of
     the readout's own box instead. */
  const beside = read.width < W*0.75;
  safe = { left: 16, top: t + 8, right: W - 16, bottom: (beside ? H : read.top) - 8 };
  const barsBottom = safe.top;            // CHANGED (radar): the bars' real foot, before the squeezed-view fallback below overwrites it
  if(safe.bottom - safe.top < 60){ safe.top = 16; safe.bottom = H - 16; }
  keepOut = beside ? [{ x: read.left, y: read.top, w: read.width, h: read.height }] : [];
  if(!E.align.hidden){                                 // sideways it is a panel of its own, on the right
    const al = E.align.getBoundingClientRect();
    if(al.width && al.left > read.right - 1) keepOut.push({ x: al.left, y: al.top, w: al.width, h: al.height });
  }
  layoutRadar(read, beside, barsBottom);
}
/* CHANGED (radar): where the radar sits and whether it is there. Above the readout at the right, whatever height the readout has
   (the Align panel makes it taller); held sideways, the foot of the screen at the right, which is where the Align panel is, so the
   radar gives way to it. It is also left out when there is no room between it and the bars, before there is a pose to show, and when
   the reader has hidden it. The box it takes is kept clear of by the labels and by the off-screen pointer. */
let radarCss = '', radarUp = 0;
function layoutRadar(read, beside, barsBottom){
  const s = radarSize(W, H);
  /* `up` is the height of the radar's bottom edge above the foot of the view. In portrait it follows the readout's top: a readout that
     grows lifts it at once, so it never covers the text; one that shrinks by a line or two (the pointer's words leaving the Target row,
     a pass text wrapping another way) does not let it drop, since it would bob under the reader's eye just as they bring the crosshair
     onto the spacecraft. A fall of more than 40 px (the Align panel closing) is followed. */
  const want = Math.round(H - read.top + 8);
  let up = 12;
  if(!beside){
    up = radarUp - want > 40 ? want : Math.max(want, radarUp);
    if(H - up - s < barsBottom) up = want;                      // a height held for steadiness must not cost it its room
  }
  radarUp = beside ? 0 : up;
  const show = !!cam && radarOn && state !== 'failed' && state !== 'closed'
            && !(beside && !E.align.hidden) && H - up - s >= barsBottom;
  if(E.radar.hidden === show) E.radar.hidden = !show;
  if(!show){ radarBox = null; return; }
  const css = s + 'px ' + (beside ? 'calc(env(safe-area-inset-bottom) + 12px)' : up + 'px');
  if(css !== radarCss){
    radarCss = css;
    E.radar.style.width = E.radar.style.height = s + 'px';
    E.radar.style.bottom = beside ? 'calc(env(safe-area-inset-bottom) + 12px)' : up + 'px';
  }
  const r = E.radar.getBoundingClientRect();
  radarBox = { x: r.left, y: r.top, w: r.width, h: r.height };
  keepOut.push(radarBox);
}
function setRadar(on){
  radarOn = on;
  try { localStorage.setItem(RADAR_KEY, on ? '1' : '0'); } catch(e){}
  E.radarbtn.setAttribute('aria-pressed', String(on));
  measure();
}
/* The radar's own frame: the pose and the pass this file has just drawn, handed to radar.ts as they are. An iPhone still finding
   north has an azimuth that means nothing, so it has no crosshair, as the main view draws no meridians then. */
function drawRadarFrame(){
  radarSeen = null;
  if(!radarBox) return;
  const s = radarSize(W, H), bw = Math.round(s*dpr);
  if(E.radar.width !== bw || E.radar.height !== bw){ E.radar.width = bw; E.radar.height = bw; }
  const ms = P.now(), st = P.target() ? P.at(ms) : null, p = P.pass(ms);
  const finding = source === 'ios' && fusion.offset === null;
  radarSeen = drawRadar(radarCtx, {
    size: s, dpr, mask: P.mask, ms,
    pass: p && p.arc && p.arc.length > 1 ? p : null,
    craft: st ? { az: st.az, el: st.el } : null,
    aim: view && !finding ? { az: view.az, el: view.el } : null
  }, pal, radarCache);
}
/* The off-screen pointer sits on the edge of the safe rectangle; where that is under the radar it slides along the edge to the nearer
   side of it, so that it is never hidden and still points the way. */
function awayFromRadar(e){
  const b = radarBox, m = 8;
  if(!b || e.x < b.x - m || e.x > b.x + b.w + m || e.y < b.y - m || e.y > b.y + b.h + m) return e;
  const out = [];
  if(Math.abs(e.x - safe.right) < 1 || Math.abs(e.x - safe.left) < 1){
    out.push({ x: e.x, y: b.y - m }, { x: e.x, y: b.y + b.h + m });
  }
  if(Math.abs(e.y - safe.bottom) < 1 || Math.abs(e.y - safe.top) < 1){
    out.push({ x: b.x - m, y: e.y }, { x: b.x + b.w + m, y: e.y });
  }
  const ok = out.filter(q => q.x >= safe.left && q.x <= safe.right && q.y >= safe.top && q.y <= safe.bottom);
  if(!ok.length) return e;
  ok.sort((p, q) => Math.hypot(p.x - e.x, p.y - e.y) - Math.hypot(q.x - e.x, q.y - e.y));
  return ok[0];
}
function loop(ts){
  raf = requestAnimationFrame(loop);
  const t = now(), dt = lastTs ? Math.min((t - lastTs)/1000, 0.5) : 0;
  lastTs = t; frames++;
  if(state === 'failed' || state === 'closed') return;
  measure();
  const v = E.video;
  F = S.focal(W, H, camState === 'live' ? v.videoWidth : 0, camState === 'live' ? v.videoHeight : 0, fov);
  // what the status line and the readout say changes with the source and the
  // state, so those are said at once rather than at the next quarter-second tick
  let changed = pickSource(t);
  if(source){
    if(state === 'asking' || state === 'waiting'){ clearTimeout(firstTimer); }
    const tp = targetPose(), th = screenTheta(tp.B);
    const target = S.camera(tp.B, th);
    if(th !== theta){ theta = th; smooth.snap(target); } else smooth.step(target, dt);
    cam = { fwd: smooth.fwd, right: smooth.right, up: smooth.up };
    view = S.azEl(cam.fwd);
    const finding = source === 'ios' && fusion.offset === null;
    const next = finding ? 'finding' : 'running';
    if(state !== next){
      setState(next);
      changed = true;
      say('phase', null);
      if(next === 'running'){
        foundAgain = false;
        if(!firstRunning){
          firstRunning = true;
          if(!hinted){ say('hint', MSG.hint, 'info'); hintTimer = setTimeout(() => say('hint', null), 8000); }
        }
      }
    }
  }
  draw();
  drawRadarFrame();                                    // CHANGED (radar)
  if(changed) readout();
}

/* ---- drawing -------------------------------------------------------------------------------------------- */
const RINGS = [15, 30, 45, 60, 75];
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const FONT = w => w + ' ' + (w === 600 ? '12px' : '11px') + ' "IBM Plex Mono", ui-monospace, monospace';
const PJ = v => S.project(cam, v, F, cx, cy);
const onScreen = p => p.front && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
const inSafe = p => p.front && p.x >= safe.left && p.x <= safe.right && p.y >= safe.top && p.y <= safe.bottom;

function strokeSky(fn, n, style, width, dash){
  // a polyline over the sky, broken wherever a sample falls behind the camera
  ctx.beginPath();
  let pen = false, any = false;
  for(let i = 0; i <= n; i++){
    const p = PJ(fn(i));
    if(!p.front){ pen = false; continue; }
    if(pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    pen = true;
    if(onScreen(p)) any = true;
  }
  ctx.setLineDash(dash || []);
  ctx.lineWidth = width + 3; ctx.strokeStyle = 'rgba(5,9,12,.55)'; ctx.stroke();
  ctx.lineWidth = width; ctx.strokeStyle = style; ctx.stroke();
  ctx.setLineDash([]);
  return any;
}
function draw(){
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const drawn = { ground: false, rings: false, meridians: false, horizon: false, mask: false, compass: false,
                  sun: false, pass: false, craft: false, pointer: false };
  probeDraw = { drawn, marker: null, aim: null, pointer: null, sun: null, pass: null };
  if(!cam) return;
  const finding = source === 'ios' && fusion.offset === null;
  const labels = [];
  const label = (text, x, y, o) => labels.push(Object.assign({ text, x, y, pri: 9, color: pal.ink, w: 500 }, o));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 1. the ground, below the horizon
  const g = S.groundPolygon(cam, F, cx, cy, W, H);
  if(g.length > 2){
    ctx.beginPath(); ctx.moveTo(g[0][0], g[0][1]);
    for(let i = 1; i < g.length; i++) ctx.lineTo(g[i][0], g[i][1]);
    ctx.closePath(); ctx.fillStyle = 'rgba(5,9,12,.30)'; ctx.fill();
    drawn.ground = true;
  }
  // 2. elevation rings, labelled where the view is looking
  for(const el of RINGS){
    ctx.beginPath();
    let pen = false;
    for(let az = 0; az <= 360; az += 2){
      const p = PJ(S.enu(az, el));
      if(!p.front){ pen = false; continue; }
      if(pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.lineWidth = 1; ctx.strokeStyle = pal.grid; ctx.stroke();
    const q = PJ(S.enu(view.az, el));
    if(inSafe(q)){ label(el + '°', q.x - 6, q.y, { pri: 7, color: pal.ink2, align: 'right' }); drawn.rings = true; }
  }
  // 3. meridians every 30°, and the zenith
  if(!finding){
    for(let az = 0; az < 360; az += 30){
      ctx.beginPath(); let pen = false;
      for(let el = 0; el <= 80; el += 2){
        const p = PJ(S.enu(az, el));
        if(!p.front){ pen = false; continue; }
        if(pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        pen = true;
        if(onScreen(p)) drawn.meridians = true;
      }
      ctx.lineWidth = 1; ctx.strokeStyle = pal.grid; ctx.stroke();
    }
  }
  const z = PJ([0, 0, 1]);
  if(onScreen(z)){
    ctx.beginPath(); ctx.moveTo(z.x - 5, z.y); ctx.lineTo(z.x + 5, z.y); ctx.moveTo(z.x, z.y - 5); ctx.lineTo(z.x, z.y + 5);
    ctx.lineWidth = 1.5; ctx.strokeStyle = pal.ink2; ctx.stroke();
    if(inSafe(z)) label('zenith', z.x, z.y, { pri: 8, color: pal.ink2 });
  }
  // 4. the horizon, with a tick every 10°
  drawn.horizon = strokeSky(i => S.enu(i*2, 0), 180, pal.horizon, 1.5);
  for(let az = 0; az < 360; az += 10){
    const a = PJ(S.enu(az, 0)), b = PJ(S.enu(az, 0.6));
    if(!onScreen(a) || !b.front) continue;
    const dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy) || 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + dx/m*6, a.y + dy/m*6);
    ctx.lineWidth = 1.5; ctx.strokeStyle = pal.horizon; ctx.stroke();
  }
  // 5. the 5° mask: the page's elevation cut, in the globe key's pink
  const mask = P.mask;
  drawn.mask = strokeSky(i => S.enu(i*2, mask), 180, pal.mask, 1.6, [6, 4]);
  { const q = PJ(S.enu(view.az + 12, mask)); if(inSafe(q)) label(mask + '° mask', q.x, q.y, { pri: 8, color: pal.mask }); }

  if(finding){ reticle(); placeLabels(labels); return; }

  // 6. compass points, just under the horizon
  for(let i = 0; i < 8; i++){
    const q = PJ(S.enu(i*45, -3));
    if(inSafe(q)){ label(POINTS[i], q.x, q.y, { pri: 5, w: 600, align: 'center', fixed: true }); drawn.compass = true; }
  }
  const ms = P.now();
  // 7. the Sun
  const sun = P.sun(ms);
  if(sun){
    const q = PJ(S.enu(sun.az, sun.el));
    probeDraw.sun = { x: q.x, y: q.y, on: onScreen(q), az: sun.az, el: sun.el };
    if(onScreen(q)){
      const r = Math.max(7, F*Math.tan(0.2665*S.RAD));
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 2*Math.PI);
      if(sun.el >= 0){ ctx.fillStyle = pal.sun; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = pal.halo; ctx.stroke(); }
      else { ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = pal.sun; ctx.stroke(); ctx.setLineDash([]); }
      label(sun.el >= 0 ? 'Sun' : 'Sun, below the horizon', q.x + r, q.y, { pri: 4, color: pal.sun });
      drawn.sun = true;
    }
  }
  // 8. the pass: the current one, or the next
  const p = P.pass(ms);
  if(p && p.arc && p.arc.length > 1){
    drawn.pass = drawPass(p, ms, label);
  }
  // 9. the spacecraft
  const tgt = P.target(), st = tgt ? P.at(ms) : null;
  if(st){
    const q = PJ(S.enu(st.az, st.el));
    probeDraw.marker = { x: q.x, y: q.y, on: onScreen(q), az: st.az, el: st.el };
    if(onScreen(q)){
      const col = st.el >= mask ? pal.pass : pal.craft;
      ctx.beginPath(); ctx.arc(q.x, q.y, 10, 0, 2*Math.PI);
      if(st.el < 0) ctx.setLineDash([3, 3]);
      ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(5,9,12,.55)'; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); ctx.setLineDash([]);
      if(st.el >= 0){ ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, 2*Math.PI); ctx.fillStyle = col; ctx.fill(); }
      ctx.beginPath();
      for(const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ ctx.moveTo(q.x + ux*13, q.y + uy*13); ctx.lineTo(q.x + ux*18, q.y + uy*18); }
      ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
      const second = Math.abs(st.el).toFixed(1) + '° ' + (st.el >= 0 ? 'up' : 'below') + ' · ' +
                     Math.round(st.rng).toLocaleString('en-US') + ' km';
      label(tgt.name, q.x, q.y, { pri: 1, w: 600, color: col, lines: [second], keep: true, gap: 22 });
      drawn.craft = true;
    }
    // 11. the pointer, when the thing to find is off the screen
    const aim = aimAt(st, p, ms);
    probeDraw.aim = aim ? aim.kind : null;
    if(aim){
      const a = PJ(S.enu(aim.az, aim.el));
      if(!inSafe(a)) drawn.pointer = drawPointer(a, aim, tgt.name, ms, label);
    }
  }
  reticle();
  placeLabels(labels);
}
function reticle(){
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy); ctx.lineTo(cx - 4, cy); ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy - 4); ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, cy + 10);
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(234,242,246,.55)'; ctx.stroke();
}
/* The thing to point at: the spacecraft while it is up, or when no pass is
   coming; while it is still to rise, the place on the horizon where it will. */
function aimAt(st, p, ms){
  if(st.el >= 0 || !p || !(p.t0ms > ms)) return { kind: 'sat', az: st.az, el: st.el };
  return { kind: 'aos', az: p.arc[0].az, el: p.arc[0].el, at: p.t0ms };
}
function passTicks(p){
  let c = tickCache.get(p);
  if(!c){
    const t = S.ticks(p.t0ms, p.t1ms, P.fmt.tz(p.t0ms));
    c = t.map(ms => ({ ms, s: P.at(ms) })).filter(k => k.s);
    tickCache.set(p, c);
  }
  return c;
}
function drawPass(p, ms, label){
  const arc = p.arc, n = arc.length - 1, cur = ms >= p.t0ms && ms <= p.t1ms;
  const tAt = i => p.t0ms + (p.t1ms - p.t0ms)*i/n;
  let any = false;
  const seg = (from, to, alpha) => {
    ctx.beginPath(); let pen = false;
    for(let i = from; i <= to; i++){
      const q = PJ(S.enu(arc[i].az, arc[i].el));
      if(!q.front){ pen = false; continue; }
      if(pen) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      pen = true; if(onScreen(q)) any = true;
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(5,9,12,.55)'; ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = pal.pass; ctx.stroke();
    ctx.globalAlpha = 1;
  };
  // on a pass under way, the stretch already flown is drawn faint
  const k = cur ? Math.max(0, Math.min(n, Math.floor((ms - p.t0ms)/(p.t1ms - p.t0ms)*n))) : 0;
  if(k > 0) seg(0, k, 0.45);
  seg(k, n, 1);
  // which way it travels
  const i0 = Math.round(n*0.4), a = PJ(S.enu(arc[i0].az, arc[i0].el)), b = PJ(S.enu(arc[i0 + 1].az, arc[i0 + 1].el));
  if(onScreen(a) && b.front){
    const dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy) || 1, ux = dx/m, uy = dy/m;
    ctx.beginPath();
    ctx.moveTo(a.x - ux*7 - uy*6, a.y - uy*7 + ux*6); ctx.lineTo(a.x, a.y); ctx.lineTo(a.x - ux*7 + uy*6, a.y - uy*7 - ux*6);
    ctx.lineWidth = 2.5; ctx.strokeStyle = pal.halo; ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = pal.ink; ctx.stroke();
  }
  // time ticks, on the observer's clock
  const ticks = passTicks(p);
  for(const tk of ticks){
    const q = PJ(S.enu(tk.s.az, tk.s.el));
    if(!onScreen(q)) continue;
    const r = PJ(S.enu(tk.s.az + 0.5, tk.s.el)), dx = r.x - q.x, dy = r.y - q.y;
    // perpendicular to the arc, taken from the next sample along it
    const j = Math.min(n, Math.max(1, Math.round((tk.ms - p.t0ms)/(p.t1ms - p.t0ms)*n)));
    const s2 = PJ(S.enu(arc[j].az, arc[j].el)), s1 = PJ(S.enu(arc[j - 1].az, arc[j - 1].el));
    let tx = s2.x - s1.x, ty = s2.y - s1.y, m = Math.hypot(tx, ty);
    if(!(m > 0)){ tx = dx; ty = dy; m = Math.hypot(tx, ty) || 1; }
    const nx = -ty/m, ny = tx/m;
    ctx.beginPath(); ctx.moveTo(q.x - nx*6, q.y - ny*6); ctx.lineTo(q.x + nx*6, q.y + ny*6);
    ctx.lineWidth = 2; ctx.strokeStyle = pal.pass; ctx.stroke();
    label(P.fmt.hm(tk.ms), q.x + nx*8, q.y + ny*8, { pri: 6, color: pal.pass });
  }
  // the ends and the top
  const end = (s, text, pri) => { const q = PJ(S.enu(s.az, s.el)); if(inSafe(q)) label(text, q.x, q.y, { pri, color: pal.pass }); };
  end(arc[0], 'AOS ' + P.fmt.hm(p.t0ms) + (p.clipA ? ' *' : ''), 3);
  end(arc[n], 'LOS ' + P.fmt.hm(p.t1ms) + (p.clipL ? ' *' : ''), 3);
  const mx = PJ(S.enu(p.maxAz, p.maxEl));
  if(onScreen(mx)){
    ctx.beginPath(); ctx.arc(mx.x, mx.y, 5, 0, 2*Math.PI);
    ctx.fillStyle = pal.pass; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = pal.halo; ctx.stroke();
    if(inSafe(mx)) label('max ' + Math.round(p.maxEl) + '° ' + P.fmt.hm(p.maxAt.getTime()), mx.x, mx.y, { pri: 3, color: pal.pass });
  }
  probeDraw.pass = { t0ms: p.t0ms, t1ms: p.t1ms, ticks: ticks.length };
  return any;
}
function drawPointer(a, aim, name, ms, label){
  // the screen direction towards it: along the projection when it is in front,
  // otherwise along its offset in the view's own axes
  let dx, dy;
  if(a.front){ dx = a.x - cx; dy = a.y - cy; }
  else if(Math.hypot(a.xc, a.yc) > 1e-6){ dx = a.xc; dy = -a.yc; }
  else { dx = S.wrap180(aim.az - view.az) >= 0 ? 1 : -1; dy = 0; }
  const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
  const e = awayFromRadar(S.edgePoint(cx, cy, dx, dy, safe));      // CHANGED (radar): it was S.edgePoint(...) alone
  const col = aim.kind === 'aos' ? pal.pass : pal.craft;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x - dx*14 - dy*8, e.y - dy*14 + dx*8);
  ctx.lineTo(e.x - dx*14 + dy*8, e.y - dy*14 - dx*8);
  ctx.closePath();
  ctx.lineWidth = 3; ctx.strokeStyle = pal.halo; ctx.stroke(); ctx.fillStyle = col; ctx.fill();
  const how = S.steer(view, aim, P.fmt.compass);
  const text = aim.kind === 'aos'
    ? name + ' rises here at ' + P.fmt.hm(aim.at) + ', in ' + P.fmt.hhmmss(aim.at - ms)
    : name;
  label(text, e.x - dx*22, e.y - dy*22, { pri: 0, w: 600, color: col, lines: how ? [how] : [], keep: true,
                                          pointer: true, align: 'center' });
  probeDraw.pointer = { x: e.x, y: e.y, text: how, title: text };
  return true;
}
/* Labels are placed greedily in priority order, each trying the right, the
   left, above and below its anchor, and dropped if it would still overlap one
   already placed. The spacecraft and the pointer are never dropped. Every one
   stays inside the safe rectangle clear of the two bars. */
function placeLabels(list){
  list.sort((a, b) => a.pri - b.pri);
  const boxes = keepOut.slice();
  const hit = r => boxes.some(b => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y);
  const fits = r => r.x >= safe.left && r.x + r.w <= safe.right && r.y >= safe.top && r.y + r.h <= safe.bottom;
  for(const L of list){
    const lines = [L.text].concat(L.lines || []);
    ctx.font = FONT(L.w);
    const main = ctx.measureText(L.text).width;
    ctx.font = FONT(500);
    const w = Math.max(main, ...lines.slice(1).map(s => ctx.measureText(s).width)) + 4;
    const lh = 15, h = lines.length*lh;
    const gap = L.gap || 10;
    const cands = L.pointer || L.align === 'center'
      ? [{ x: L.x - w/2, y: L.y - h/2 }, { x: L.x - w/2, y: L.y + 4 }, { x: L.x - w/2, y: L.y - h - 4 }]
      : L.align === 'right'
        ? [{ x: L.x - w, y: L.y - h/2 }, { x: L.x + 6, y: L.y - h/2 }]
        : [{ x: L.x + gap, y: L.y - h/2 }, { x: L.x - gap - w, y: L.y - h/2 },
           { x: L.x - w/2, y: L.y - gap - h }, { x: L.x - w/2, y: L.y + gap }];
    let at = null;
    for(const c of cands){ const r = { x: c.x, y: c.y, w, h }; if(fits(r) && !hit(r)){ at = r; break; } }
    if(!at && L.keep){
      const c = cands[0];
      at = { x: S.clamp(safe.left, Math.max(safe.left, safe.right - w), c.x),
             y: S.clamp(safe.top, Math.max(safe.top, safe.bottom - h), c.y), w, h };
      /* CHANGED (radar): a label kept on the screen because nothing else fits (the spacecraft's name, the pointer's words) is not kept
         over the radar: along the same row to its left, else above it. Nothing else is moved, so with the radar hidden this is the old
         code. */
      const rb = radarBox;
      if(rb && at.x < rb.x + rb.w && at.x + at.w > rb.x && at.y < rb.y + rb.h && at.y + at.h > rb.y){
        const left = { x: rb.x - 4 - w, y: at.y, w, h }, above = { x: at.x, y: rb.y - 4 - h, w, h };
        if(fits(left) && !hit(left)) at = left; else if(fits(above) && !hit(above)) at = above;
      }
    }
    if(!at) continue;
    boxes.push(at);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = 3.5; ctx.strokeStyle = pal.halo;
    lines.forEach((s, i) => {
      ctx.font = FONT(i === 0 ? L.w : 500);
      const y = at.y + lh*i + lh/2;
      ctx.strokeText(s, at.x + 2, y);
      ctx.fillStyle = i === 0 ? L.color : pal.ink;
      ctx.fillText(s, at.x + 2, y);
    });
  }
}

/* ---- the readout, four times a second ------------------------------------------------------------------ */
function readout(){
  if(state === 'closed') return;
  declNow();
  if(siteKeyOf(P.site()) !== siteSeen) checkElsewhere();
  // opened live, the view stays live: a hidden or prompt-covered clock comes back
  // late, because the transport caps a frame at a quarter of a second
  if(follow && P.running() && Math.abs(P.now() - Date.now()) > 1000) P.goLive();
  const ms = P.now(), f = P.fmt, o = P.site();
  setText(E.site, o.name);
  setText(E.pos, f.lat(o.lat) + ' ' + f.lon(o.lon));
  const finding = source === 'ios' && fusion.offset === null;
  const lensTxt = 'lens ' + (fov % 1 ? fov.toFixed(1) : fov) + '°, ' + (fovSet ? 'set by hand' : 'assumed');
  let vt = '—';
  if(view){
    if(Math.abs(view.el) > 85) vt = '— · straight ' + (view.el > 0 ? 'up' : 'down');
    else vt = (finding ? '— (finding north)' : Math.round(view.az) % 360 + '° ' + f.compass(view.az)) + ' · ' +
              Math.round(Math.abs(view.el)) + '° ' + (view.el >= 0 ? 'up' : 'down');
    vt += ' · ' + lensTxt;
  }
  setText(E.view, vt);
  setText(E.north, northText());
  setText(E.decl, declText());
  const live = P.live(), running = P.running();
  if(live){
    setText(E.clock, 'live · ' + f.local(ms) + ' ' + f.zone(ms) + ' · ' + f.whenZ(ms).slice(6));
  } else {
    const d = ms - Date.now();
    setText(E.clock, 'sim time · the sky at ' + f.whenZ(ms) + ', ' + f.mmss(Math.abs(d)/1000) + ' ' +
                     (d > 0 ? 'ahead' : 'behind') + ' — not the sky above you now' + (running ? '' : ' · paused'));
  }
  E.live.hidden = live && running;
  root.toggleAttribute('data-sim', !live);             // a sideways phone shows the clock only then
  setText(E.target, targetText(ms));
  setText(E.pass, passText(ms));
  const L = S.viewOf(F, W, H);
  setText(E.lensv, 'Lens ' + fov.toFixed(1) + '° across the long side (≈' + Math.round(S.lensMm(fov)) + ' mm) · view ' +
                   L.h.toFixed(1) + '° × ' + L.v.toFixed(1) + '°');
  const cm = compassMessage();
  slots.compass = cm ? { text: cm.text, kind: cm.kind, until: 0 } : null;
  paintStatus();
}
function northText(){
  let t;
  if(!source) t = state === 'failed' ? '—' : 'waiting for the motion sensors';
  else if(source === 'abs') t = 'the compass, magnetic · accuracy not reported';
  else if(source === 'rel') t = 'a guess — this device reports no compass';
  else {
    const n = now(), uncal = fusion.uncalSince !== null && n - fusion.uncalSince >= 3000;
    if(fusion.offset === null) t = uncal ? 'the compass is not calibrated' : 'finding it — tip the phone towards flat';
    else {
      const age = (n - fusion.at)/1000;
      t = 'the compass, magnetic · ±' + Math.round(fusion.accuracy) + '° · bearing taken ' +
          (age < 3 ? 'just now' : P.fmt.mmss(age) + ' ago') + (uncal ? ' · the compass is not calibrated now' : '');
    }
  }
  if(trim && Math.abs(trim) >= 0.05) t += ' · turned ' + signed(trim, 1) + '° by hand';
  return t;
}
function declText(){
  if(!decl.ok) return 'not applied — the magnetic model did not load';
  const d = Math.abs(decl.D).toFixed(1) + '° ' + (decl.D < 0 ? 'W' : 'E');
  if(source === 'rel') return d + ', not applied — no magnetic north to correct';
  if(decl.zone === 'blackout') return 'none that means anything this near the magnetic pole';
  return d + ', applied' + (decl.zone === 'caution' ? ' · less certain this near the magnetic pole' : '') +
         (decl.expired ? ' · past the model’s 2030 end' : '');
}
function targetText(ms){
  const t = P.target();
  if(!t) return '—';
  const s = P.at(ms), f = P.fmt;
  if(!s) return t.name + ' · no position at this instant';
  let x = t.name + ' · ' + (s.el >= 0 ? s.el.toFixed(1) + '° up' : Math.abs(s.el).toFixed(1) + '° below the horizon') +
          ' · ' + Math.round(s.az) % 360 + '° ' + f.compass(s.az) +
          (s.el >= 0 ? ' · ' + Math.round(s.rng).toLocaleString('en-US') + ' km' : '');
  if(s.el >= 0 && s.el < P.mask) x += ' · under the ' + P.mask + '° mask';
  if(probeDraw.pointer && probeDraw.pointer.text) x += ' · ' + probeDraw.pointer.text;
  if(t.reentry) x += ' · SGP4 takes it below the entry interface — these passes will not happen';
  return x;
}
function passText(ms){
  const f = P.fmt;
  if(!P.inWindow(ms)) return 'the clock is outside the analysis window — no pass is drawn';
  const p = P.pass(ms);
  if(!p) return 'nothing clears the ' + P.mask + '° mask in this window or the 48 h after it';
  if(ms >= p.t0ms && ms <= p.t1ms){
    if(p.clipL) return 'in view · still up at the window’s end, ' + f.whenZ(p.t1ms).slice(6) + ' *';
    return 'in view · sets ' + f.whenLocal(p.t1ms) + ' (' + f.whenZ(p.t1ms).slice(6) + ') · max ' +
           p.maxEl.toFixed(1) + '° at ' + f.hm(p.maxAt.getTime());
  }
  return 'next rises in the ' + f.compass(p.arc[0].az) + ' at ' + f.whenLocal(p.t0ms) + ' (' +
         f.whenZ(p.t0ms).slice(6) + '), in ' + f.hhmmss(p.t0ms - ms) + ' · max ' + p.maxEl.toFixed(1) + '°' +
         (p.t0ms > P.windowEnd() ? ' · after this window' : '');
}

/* ---- the test surface ------------------------------------------------------------------------------------------
 * Read by the checks and by nothing in the page. project() is the function the
 * drawing uses, on the pose the drawing used. */
function project(az, el){
  if(!cam) return null;
  const q = PJ(S.enu(az, el));
  return { x: q.x, y: q.y, on: onScreen(q), front: q.front };
}
const ARView = {
  init, open, close, project,
  get isOpen(){ return state !== 'closed'; },
  get state(){ return state; },
  get probe(){
    return Object.assign({
      state, reason, message: E.status ? E.status.textContent : '', camera: camState, source,
      settled: fusion ? fusion.offset !== null : false, offset: fusion ? fusion.offset : null,
      decl: decl.ok ? decl.D : null, declZone: decl.zone, trim, fov, theta, F, W, H, cx, cy,
      safe: Object.assign({}, safe), lag: smooth ? smooth.lag : null, ms: P ? P.now() : null, follow,
      view: view ? { az: view.az, el: view.el } : null, frames, stream: camStream, listening,
      radar: { on: radarOn, box: radarBox ? Object.assign({}, radarBox) : null, draw: radarSeen }     // CHANGED (radar)
    }, probeDraw);
  }
};

return ARView;
}
