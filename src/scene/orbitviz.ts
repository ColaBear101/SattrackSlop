// @ts-nocheck - verbatim; see the header
/* ============================================================================
   OrbitViz — the geometry behind the numbers, drawn in the frame it is defined
   in. Orbit3D shows where the spacecraft IS; this shows WHY: the inertial axes
   the elements are measured from, the plane they define, and the sky those axes
   actually point at. Everything here hangs off scene root, never off the Earth
   group, because every one of these quantities is inertial — the Earth turns
   under them and they must not turn with it.
   Coordinates match orbit3d.js exactly: ECI (x,y,z) -> scene (x, z, -y).
   No network at runtime: the star catalogue is embedded and the Sun, Moon and
   planets come from truncated analytic series.
   ========================================================================== */
/* ---- Moved from legacy/earth/orbitviz.js (main@4eadd7a), lines 13-1550: the sky layers: the inertial frame, the element geometry, the star field, the constellations and the planets.
 * Changes from the old file, marked CHANGED where they are made:
 *   1. the wrapper: the old file was an IIFE over `global` that attached `OrbitViz`; this is a factory over the same object
 *      (`global.THREE` and the few other globals it reaches for are handed in) that returns it;
 *   2. the star catalogue and the constellation figures (two long strings) are in sky-data.ts, moved byte for byte, and given to
 *      the layers by setSkyData() once they have been fetched; a layer asked for before then is an empty group that is built for
 *      real, in the same place, as the data arrives.
 * Nothing else is touched.
 */
export function makeOrbitViz(global) {

const RAD = Math.PI/180, DEG = 180/Math.PI, RE = 6378.137;
const R_SKY = 400;                               // far sphere radius, in Earth radii

/* Same palette as orbit3d.js so the two views read as one instrument, plus the
   few roles this view needs and that one does not. Space has no light mode. */
const SPACE = {
  track:'#17A3CC', contact:'#CE801A', observer:'#E2557E', ring:'#3A4E5A',
  ink:'#E8EFF2', ink2:'#AEBFC8', muted:'#8096A1',
  aries:'#F5C842',                               // the direction everything is measured from
  /* One hue per element, so no two quantities on the globe share a colour.
     Before this, theta, omega, the node and perigee were all the same orange,
     e a near-identical one, i the orbit's own blue, and v / vt two greens. */
  raan:'#F5C842',                                // = aries: the arc starts there
  inc:'#A98BFF', argp:'#FF9230', nu:'#FF4FA3',
  hvec:'#4FC3FF', evec:'#FF5555',
  vvec:'#4DF0A0', vtvec:'#2FD9D9', vnvec:'#E8F060',
  pole:'#9FD3E3', star:'#DCE7EE'
};

let THREE, sat, scene, U = 1/RE;
/* Borrowed from orbit3d at init; see the note in init(). */
let camRef = null, viewEl = null, occluder = null;

/* ---- the label layout ------------------------------------------------------
 * Every element label is registered here with a priority and the geometry that
 * selects it. Two jobs are done against that list, and they are kept apart on
 * purpose:
 *
 *   updateLive() decides where an ANCHOR is - that is physics, and it runs on
 *   simulated time at 8 Hz.
 *   layout() decides where the TEXT sits relative to its anchor - that is
 *   optics, and it runs on the camera. They must not share a clock: pause the
 *   playback and sim time stops while the camera keeps moving under the drag.
 *
 * The displacement is written to sprite.center, not to sprite.position. With
 * sizeAttenuation off, three.js computes the quad as
 * (position.xy - (center - 0.5)) * scale, so center is a pure screen-space
 * offset in units of the sprite's own size - two float writes, no extra objects,
 * and the anchor stays exactly where it means something.
 */
let TAGS = [], byKey = {}, PICKS = [], hotKey = null, wantKey = null, wantN = 0;
let layoutDirty = true, lastLayoutMs = 0, hotSinceMs = 0;
const lastCam = { x:NaN, y:NaN, z:NaN, qx:NaN, qy:NaN, qz:NaN, qw:NaN, fov:NaN, w:0, h:0 };
/* Candidate offsets from the anchor, in px, tried in order: three along the
   push direction, then two across it. The cross ones exist for the hovered
   label, which goes from about 40 px wide to several hundred and frequently
   cannot clear its neighbours by sliding along one axis alone. */
const CANDS = [[14,0], [30,0], [50,0], [26,24], [26,-24]];
const LPAD = 4, LMARGIN = 6;       // gap between labels, and from the frame edge
const KEEP = 2;                    // priority at or below this is never hidden

function clearTags(){ TAGS = []; byKey = {}; PICKS = []; hotKey = null; wantKey = null; }

function regTag(sp, o){
  const t = { key:o.key, prio:(o.prio === undefined ? 5 : o.prio), sprite:sp,
              lead:o.lead || null, cand:0, rect:{x:0,y:0,w:0,h:0}, vis:false };
  sp.userData.tag = t;
  TAGS.push(t); byKey[o.key] = t;
  return sp;
}
function regPick(obj, key){
  if(!obj) return obj;
  obj.userData.tagKey = key;
  PICKS.push(obj);
  return obj;
}

/* Is a point hidden behind the body? sprite depthTest handles the drawing, but
   an occluded label must also stop holding a slot that a visible one needs. */
function behindBody(p, eye, R){
  const d = new THREE.Vector3().subVectors(p, eye);
  const L = d.length(); if(!(L > 0)) return false;
  d.divideScalar(L);
  const f = eye.clone().negate(), tca = f.dot(d);
  if(tca <= 0) return false;
  return (f.lengthSq() - tca*tca) < R*R && tca < L;
}

function layout(){
  if(!camRef || !TAGS.length) return;
  const cv = viewEl ? viewEl() : null;
  const W = cv ? cv.clientWidth : 0, H = cv ? cv.clientHeight : 0;
  if(!(W > 0 && H > 0)) return;
  // with sizeAttenuation off, this is exactly the pixels per unit of sprite scale
  const k = H / (2*Math.tan(camRef.fov*RAD/2));
  const R = occluder ? occluder() : 0;
  const eye = camRef.position;
  const live = [];

  for(let i=0;i<TAGS.length;i++){
    const t = TAGS[i], sp = t.sprite;
    t.vis = false;
    /* Walk the PARENTS, never the sprite itself. layout() owns sprite.visible,
       so reading it back here would latch: the first pass that hid a label
       would make every later pass skip it, and it would never return.
       Whether the physics wants the label at all is a separate question, and
       updateLive answers it through userData.off. */
    if(sp.userData.off) continue;
    let on = true;
    for(let n = sp.parent; n; n = n.parent) if(!n.visible){ on = false; break; }
    if(!on) continue;
    /* matrixWorld is refreshed by the renderer, and this can run between an
       anchor move in updateLive and the next render - without this it lays out
       the previous tick's anchors. */
    sp.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3().setFromMatrixPosition(sp.matrixWorld);
    const pr = pos.clone().project(camRef);
    if(pr.z > 1) continue;                               // behind the camera
    if(Math.abs(pr.x) > 1.4 || Math.abs(pr.y) > 1.4) continue;
    if(R && behindBody(pos, eye, R)) continue;
    const form = sp.userData.form[sp.material.map === sp.userData.form.full.tex ? 'full' : 'short'];
    t.w = form.ink.w * k; t.h = form.ink.h * k;
    if(t.w > W - 2*LMARGIN) continue;                    // wider than the frame: hide, never pin
    t.cx = (pr.x*0.5 + 0.5)*W; t.cy = (-pr.y*0.5 + 0.5)*H;
    t.depth = pr.z;
    /* Push outward from the middle of the frame by default: this is a radial
       diagram, so away-from-centre is away-from-everything-else. */
    let lx = t.cx - W/2, ly = t.cy - H/2;
    const ln = Math.hypot(lx, ly) || 1;
    t.lx = lx/ln; t.ly = ly/ln;
    t.vis = true;
    live.push(t);
  }

  // hot first so the expanded label never loses, then priority, then near to far
  live.sort(function(a, b){
    return ((b.key === hotKey) - (a.key === hotKey)) || (a.prio - b.prio) || (a.depth - b.depth);
  });

  const placed = [];
  for(let i=0;i<live.length;i++){
    const t = live[i];
    let got = -1;
    for(let j=0;j<CANDS.length;j++){
      const c = (t.cand + j) % CANDS.length;             // try where it was: no dancing
      const r = clampRect(rectAt(t, c), W, H);
      let clash = false;
      for(let q=0;q<placed.length;q++) if(hits(placed[q], r)){ clash = true; break; }
      if(!clash){ t.cand = c; t.rect = r; got = c; break; }
    }
    if(got < 0){
      if(t.prio <= KEEP || t.key === hotKey){
        t.rect = clampRect(rectAt(t, t.cand), W, H);     // never hidden: overlap and be read
      } else { t.vis = false; continue; }
    }
    placed.push(t.rect);
    /* centre of the placed rect, expressed as an offset from the anchor, in
       units of the sprite's own size. y is inverted because screen y grows down
       and sprite space grows up. */
    t.sprite.center.set(0.5 - (t.rect.x + t.w/2 - t.cx)/t.w,
                        0.5 + (t.rect.y + t.h/2 - t.cy)/t.h);
  }
  for(let i=0;i<TAGS.length;i++) TAGS[i].sprite.visible = TAGS[i].vis;
}

/* The rect a label would occupy at candidate slot c: along the outward push,
   then across it. */
function rectAt(t, c){
  const a = CANDS[c][0], p = CANDS[c][1];
  return { x: t.cx + t.lx*a - t.ly*p - t.w/2,
           y: t.cy + t.ly*a + t.lx*p - t.h/2,
           w: t.w, h: t.h };
}
function hits(a, b){
  return !(a.x + a.w + LPAD <= b.x || b.x + b.w + LPAD <= a.x ||
           a.y + a.h + LPAD <= b.y || b.y + b.h + LPAD <= a.y);
}
function clampRect(r, W, H){
  if(r.x < LMARGIN) r.x = LMARGIN; else if(r.x + r.w > W - LMARGIN) r.x = W - LMARGIN - r.w;
  if(r.y < LMARGIN) r.y = LMARGIN; else if(r.y + r.h > H - LMARGIN) r.y = H - LMARGIN - r.h;
  return r;
}

/* Runs on the camera, capped at 30 Hz, and skipped entirely when nothing that
   affects the projection has moved - which is the common case while paused. */
function layoutIfStale(){
  if(!camRef || !TAGS.length) return;
  const now = (global.performance && performance.now) ? performance.now() : Date.now();
  if(now - lastLayoutMs < 33) return;
  const cv = viewEl ? viewEl() : null;
  const W = cv ? cv.clientWidth : 0, H = cv ? cv.clientHeight : 0;
  const p = camRef.position, q = camRef.quaternion;
  const moved = p.x !== lastCam.x || p.y !== lastCam.y || p.z !== lastCam.z ||
                q.x !== lastCam.qx || q.y !== lastCam.qy || q.z !== lastCam.qz ||
                q.w !== lastCam.qw || camRef.fov !== lastCam.fov ||
                W !== lastCam.w || H !== lastCam.h;
  if(!moved && !layoutDirty) return;
  lastCam.x = p.x; lastCam.y = p.y; lastCam.z = p.z;
  lastCam.qx = q.x; lastCam.qy = q.y; lastCam.qz = q.z; lastCam.qw = q.w;
  lastCam.fov = camRef.fov; lastCam.w = W; lastCam.h = H;
  layoutDirty = false; lastLayoutMs = now;
  layout();
}

/* ---- picking ---------------------------------------------------------------
 * orbit3d owns the pointer and the camera and hands in a camera-configured
 * raycaster; this decides what was hit and what it means. Three passes rather
 * than one distance-sorted intersect, so a big far cone cannot beat a small
 * near label.
 *
 * The sprite is the primary target on purpose: after the layout pass a label
 * frequently sits 30 px from its anchor, it is the largest and flattest thing
 * on offer, and it is what the pointer is genuinely aimed at. THREE.Sprite's
 * own raycast accounts for both sizeAttenuation and center, so it is hit where
 * it is actually drawn.
 *
 * Nothing is added to PICKS by accident, so there is no exclusion list - the
 * orbit-plane disc, which spans the frame and would swallow every hover, simply
 * never registers.
 */
/* labelsOnly: test the label rectangles and stop. Split out because a label is
   explicit UI drawn on top and should beat a catalogue point behind it, while
   the element GEOMETRY should not - see the caller. */
function pickKey(rc, ndc, labelsOnly){
  if(!PICKS.length || !camRef) return null;
  const cv = viewEl ? viewEl() : null;
  const H = cv ? cv.clientHeight : 0, W = cv ? cv.clientWidth : 0;

  /* Labels are hit-tested against the rectangles the layout pass already
     computed, not by raycasting the sprites.
     THREE.Sprite.raycast builds its quad from the world scale, but with
     sizeAttenuation off the DRAWN quad is that scale multiplied by the distance
     to the camera - so at four Earth radii the pick target is a quarter the
     size of the label a reader is aiming at, and hovering mostly missed. The
     rects are exact, already computed, and already account for the de-collision
     offset. */
  if(ndc && W > 0 && H > 0){
    const sx = (ndc.x*0.5 + 0.5)*W, sy = (-ndc.y*0.5 + 0.5)*H;
    let best = null;
    for(let i=0;i<TAGS.length;i++){
      const t = TAGS[i];
      if(!t.vis) continue;
      const r = t.rect;
      if(sx < r.x - 2 || sx > r.x + r.w + 2 || sy < r.y - 2 || sy > r.y + r.h + 2) continue;
      // the hot label is on top, then the higher priority one
      if(!best || (t.key === hotKey) || (best.key !== hotKey && t.prio < best.prio)) best = t;
    }
    if(best) return best.key;
  }
  if(labelsOnly) return null;
  if(H > 0 && rc.params && rc.params.Line){
    /* Line.threshold is a WORLD distance from the ray, and the default of 1 is
       one Earth radius here - it would hit every arc in the frame. Derived from
       the camera so it stays about 8 screen pixels however far the reader has
       zoomed. */
    const dist = camRef.position.length() || 1;
    rc.params.Line.threshold = 8 * 2*Math.tan(camRef.fov*RAD/2) * dist / H;
  }
  const meshes = [], lines = [];
  for(let i=0;i<PICKS.length;i++){
    const o = PICKS[i];
    if(o.isSprite) continue;                    // handled above, by rectangle
    let on = true;
    for(let n = o; n; n = n.parent) if(!n.visible){ on = false; break; }
    if(!on) continue;
    (o.isLine ? lines : meshes).push(o);
  }
  const R = occluder ? occluder() : 0;
  const passes = [meshes, lines];
  for(let p=0;p<passes.length;p++){
    if(!passes[p].length) continue;
    const hit = rc.intersectObjects(passes[p], false);
    for(let i=0;i<hit.length;i++){
      const k = hit[i].object.userData.tagKey;
      if(!k || !byKey[k]) continue;
      if(R && behindBody(hit[i].point, camRef.position, R)) continue;
      return k;
    }
  }
  return null;
}

/* Hysteresis, because an arc crossing would otherwise strobe:
     - a DIFFERENT key must win twice running before it takes over
     - once expanded, a label holds for 180 ms after the pointer leaves    */
function setHoverKey(k){
  const now = (global.performance && performance.now) ? performance.now() : Date.now();
  if(k === hotKey){ wantKey = k; wantN = 0; hotSinceMs = now; return; }
  if(k === null){
    if(hotKey !== null && now - hotSinceMs < 180) return;   // minimum dwell
    applyHot(null); wantKey = null; wantN = 0; return;
  }
  if(k === wantKey){ if(++wantN >= 2){ applyHot(k); hotSinceMs = now; } }
  else { wantKey = k; wantN = 1; }
}
function applyHot(k){
  if(k === hotKey) return;
  hotKey = k;
  for(let i=0;i<TAGS.length;i++){
    const t = TAGS[i];
    setForm(t.sprite, t.key === k);
    t.sprite.renderOrder = (t.key === k) ? 16 : (t.sprite.userData.baseOrder || 12);
  }
  layoutDirty = true;
}

/* Whether the sky's writing is on: the planet/Sun/Moon names, owned by the
   constellations switch. The discs themselves are not affected. */
let skyNames = false;
/* The central body, injected at init. RE and MU above stay as the Earth
   defaults so this file still loads standalone, but anything that gates on
   a radius or divides by mu must use these. */
let BODYRE = RE;
let root = null, sky = null, started = false;
let el = null;                                   // normalised elements of the current orbit
let simTime = new Date(), planetMs = null, precMs = null, dpr = 1;
let MU = 398600.4418;                          // km^3/s^2, for the SMA fallback
let satrecRef = null;                            // needed for the live state vector
let live = null, liveMs = null, nuShown = null, vShown = null;  // the parts that follow the spacecraft

/* The layer table is the single source of truth: layers() hands it to the UI,
   and show() builds a layer the first time it is switched on rather than at
   init, so a view nobody opens costs nothing. */
const LAYERS = [
  { key:'frame',          label:'Inertial frame (ECI + Aries)', on:false },
  { key:'elements',       label:'Orbital elements',             on:true  },
  { key:'stars',          label:'Star field (mag ≤ 5.5)',   on:false },
  /* This switch now carries the NAMES as well as the lines. The Sun, Moon and
     planets are always drawn - they are part of the sky, not an annotation - but
     their labels are text over the scene, which is the same kind of thing a
     constellation figure is. So one control owns the writing and the discs stay
     put underneath it. The label says so rather than leaving the reader to
     discover it. */
  { key:'constellations', label:'Constellation lines & names',  on:false },
  { key:'planets',        label:'Sun, Moon & planets',          on:true  }
];
const G = {};                                    // key -> THREE.Group, absent until built

/* ---- small helpers -------------------------------------------------------- */
const rev = a => a - Math.floor(a/360)*360;
const sin = a => Math.sin(a*RAD), cos = a => Math.cos(a*RAD);
/* A palette key or a colour. The live parts pass SPACE.hvec - a hex, not a key -
   and SPACE['#...'] is undefined, which THREE.Color turns into WHITE: every
   live arrow and head was being drawn white whatever the palette said. */
const C = n => new THREE.Color(SPACE[n] || n);
function eci(x, y, z){ return new THREE.Vector3(x, z, -y); }
function raDec(ra, dec, r){
  const cd = cos(dec);
  return eci(r*cd*cos(ra), r*cd*sin(ra), r*sin(dec));
}

/* Labels: r128 has no text, so these are canvas sprites.
   This module IS now handed the camera and the canvas, so the original reason
   for sprites over an HTML overlay - that it had neither - no longer holds. The
   reason that does hold is DEPTH: this layer annotates a 3D cage, half of which
   is behind the planet at any moment, and a DOM label cannot be occluded by the
   Earth. Half the old mess was far-side labels drawing over near-side ones.
   sizeAttenuation is off so a label is the same size on screen whether it sits
   at 1.1 Earth radii or out on the star sphere at 400. That also makes its
   on-screen size exactly scale * H / (2 tan(fov/2)) with no read-back, which is
   what the layout pass below is built on. */
/* One baked form of a label: its own canvas, its own texture, the sprite scale
   that shows it undistorted, and the size of the INK.

   The ink box is not the canvas box and the difference is not cosmetic: the
   canvas is padded by 42% of the type size on every side, so laying labels out
   by the canvas would push them ~40% further apart than a reader can see, and
   each one would drift off the geometry it belongs to. Both the layout pass and
   the check that verifies it measure the ink. */
function bakeForm(lines, colour, opt){
  const px = opt.px || 56, pad = Math.round(px*0.42), lh = Math.round(px*1.28);
  const cv = document.createElement('canvas');
  let g = cv.getContext('2d');
  const font = (opt.weight || 600)+' '+px+'px "IBM Plex Mono", ui-monospace, '+
    '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", "DejaVu Sans Mono", monospace';
  g.font = font;
  let w = 0;
  for(let i=0;i<lines.length;i++) w = Math.max(w, g.measureText(lines[i]).width);
  w = Math.ceil(w);
  cv.width  = w + pad*2;                         // resizing the canvas resets the context
  cv.height = lh*lines.length + pad*2;
  g = cv.getContext('2d');
  g.font = font; g.textBaseline = 'top'; g.textAlign = 'left';
  // a dark casing, not a box: text over a star field needs separation from
  // whatever is behind it without stamping a rectangle on the sky
  g.lineJoin = 'round'; g.miterLimit = 2;
  g.strokeStyle = 'rgba(3,8,11,0.97)'; g.lineWidth = Math.max(4, px*0.30);
  g.fillStyle = colour;
  for(let i=0;i<lines.length;i++){
    g.strokeText(lines[i], pad, pad + i*lh);
    g.fillText(lines[i], pad, pad + i*lh);
  }
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = t.magFilter = THREE.LinearFilter; // NPOT canvas: mipmaps fail under WebGL1
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if(THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  else if(THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
  // a fraction of viewport height at fov 42; 1.75x over the first pass, which
  // was sized for a screenshot rather than for reading. h covers the WHOLE
  // sprite, so a two-line label would otherwise set each line at half size.
  const hh = (opt.h || 0.020) * 1.75 * (lines.length > 1 ? 1 + 0.6*(lines.length-1) : 1);
  const scl = new THREE.Vector3(hh*cv.width/cv.height, hh, 1);
  return { tex:t, scl:scl,
           ink:{ w: scl.x * (w/cv.width), h: scl.y * (lh*lines.length/cv.height) } };
}

/* Swap a label between its short and full form. Texture to texture, so no
   shader recompile - only null <-> texture would cause one. */
function setForm(sp, wantFull){
  const f = sp.userData.form && sp.userData.form[wantFull ? 'full' : 'short'];
  if(!f || sp.material.map === f.tex) return;
  sp.material.map = f.tex;
  sp.scale.copy(f.scl);
}

/* An element label: a symbol at rest, the full sentence when hovered.
   Two textures baked up front rather than one repainted on demand, because a
   repainted label sized to its longest string keeps that width while showing
   one glyph - and the width is exactly what the layout and the clamping are
   computed from. */
function tagLabel(short, full, colour, opt){
  opt = opt || {};
  const S = bakeForm(Array.isArray(short) ? short : [short], colour, opt);
  const F = (full == null) ? S
          : bakeForm(Array.isArray(full) ? full : [full], colour, opt);
  /* No depth test, and that is a decision rather than an oversight.
     A sprite is a flat quad at its anchor's depth, so a label whose anchor sits
     near the limb has the far half of its quad eaten by the globe - an expanded
     "inclination i = 51.63" came out as "tation i = 51.63". The problem the
     depth test would have solved - far-side labels drawing over near-side ones -
     is solved better upstream: layout() culls anything genuinely behind the body
     analytically, by behindBody(), and drops it from the pass entirely instead
     of leaving an invisible label holding a slot. */
  const m = new THREE.SpriteMaterial({ map:S.tex, transparent:true, depthWrite:false,
    depthTest: !!opt.depthTest, sizeAttenuation:false,
    opacity: opt.opacity === undefined ? 1 : opt.opacity });
  const sp = new THREE.Sprite(m);
  sp.scale.copy(S.scl);
  sp.renderOrder = opt.order || 12;
  sp.userData.form = { short:S, full:F };
  sp.userData.baseOrder = sp.renderOrder;
  return opt.key ? regTag(sp, opt) : sp;
}

function makeLabel(text, colour, opt){
  opt = opt || {};
  const lines = Array.isArray(text) ? text : [text];
  const F = bakeForm(lines, colour, opt);
  const m = new THREE.SpriteMaterial({ map:F.tex, transparent:true, depthWrite:false,
    depthTest: opt.depthTest !== false, sizeAttenuation:false,
    opacity: opt.opacity === undefined ? 1 : opt.opacity });
  const s = new THREE.Sprite(m);
  s.scale.copy(F.scl);
  s.renderOrder = opt.order || 12;
  s.userData.form = { short:F, full:F };         // nothing to expand: one form
  return s;
}

/* A live element label. Its SHORT form is a fixed symbol and is baked once; its
   FULL form counts, so that one keeps its own canvas and is repainted in place.
   The full form's width is fixed from opt.sample rather than measured per
   repaint, so the rect the layout works from does not jitter as the digits
   change under it. */
function liveLabel(colour, opt){
  opt = opt || {};
  const px = 56, pad = 24, h = px + pad*2;
  const cv = document.createElement('canvas');
  // size to the longest string this label will ever hold, or it clips
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '600 '+px+'px "IBM Plex Mono", ui-monospace, monospace';
  const wInk = Math.ceil(probe.measureText(opt.sample || '000000000000000000000000').width);
  const w = wInk + pad*2;
  cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  if(THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  else if(THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
  const hh = (opt.h || 0.019) * 1.75;
  const fullScl = new THREE.Vector3(hh*w/h, hh, 1);
  const full = { tex:tex, scl:fullScl,
                 ink:{ w: fullScl.x*(wInk/w), h: fullScl.y*(px/h) } };
  const short = bakeForm([opt.short || '?'], colour, { h: opt.h || 0.019, px: px });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map:short.tex, transparent:true,
    depthWrite:false, depthTest: !!opt.depthTest, sizeAttenuation:false }));
  sp.scale.copy(short.scl);
  sp.renderOrder = opt.order || 14;
  sp.userData.form = { short:short, full:full };
  sp.userData.baseOrder = sp.renderOrder;
  sp.userData.paint = function(text){
    const g = cv.getContext('2d');
    g.clearRect(0,0,w,h);
    g.font = '600 '+px+'px "IBM Plex Mono", ui-monospace, "DejaVu Sans Mono", monospace';
    g.textBaseline = 'top'; g.textAlign = 'left';
    g.lineJoin = 'round'; g.miterLimit = 2;
    g.lineWidth = Math.max(4, px*0.30); g.strokeStyle = 'rgba(3,8,11,0.97)';
    g.strokeText(text, pad, pad); g.fillStyle = C(colour).getStyle();
    g.fillText(text, pad, pad);
    tex.needsUpdate = true;
    /* If the full form is the one on screen, the swap already happened and the
       scale is already right; nothing here changes the sprite's size, which is
       the point of the fixed width above. */
  };
  return opt.key ? regTag(sp, opt) : sp;
}

function lineFrom(pts, colour, opacity){
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(g, new THREE.LineBasicMaterial({
    color: C(colour), transparent:true, opacity: opacity }));
}
/* The same path as a tube. WebGL draws every Line 1 px wide whatever linewidth
   says, and at 1 px the element colours wash out to near-white against the
   globe. The Line stays underneath as the pick target (its 8 px threshold is
   kinder to a pointer than a 3 px tube); this is only what the eye reads. */
const TUBE_R = 0.007;                            // ~3 px across at the default zoom
function tubeGeo(pts){
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length*2), TUBE_R, 6, false);
}
function tubeFrom(pts, colour, opacity){
  return new THREE.Mesh(tubeGeo(pts), new THREE.MeshBasicMaterial({
    color: C(colour), transparent:true, opacity: opacity, depthWrite:false }));
}
/* An arc swept from u toward v about a common centre. u and v must be a unit
   pair spanning the plane the angle is defined in; building every element angle
   this way is what stops the drawing from disagreeing with the number. */
function arcPts(centre, u, v, radius, degs, n){
  const out = [];
  n = n || Math.max(8, Math.round(Math.abs(degs)/2));
  for(let k=0;k<=n;k++){
    const t = degs*k/n;
    out.push(new THREE.Vector3().copy(centre)
      .addScaledVector(u, radius*cos(t)).addScaledVector(v, radius*sin(t)));
  }
  return out;
}
function cone(pos, dir, size, colour, opacity){
  const m = new THREE.Mesh(new THREE.ConeGeometry(size*0.42, size, 10),
    new THREE.MeshBasicMaterial({ color:C(colour), transparent:true,
      opacity: opacity === undefined ? 1 : opacity }));
  m.position.copy(pos);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
  // orbit3d fades every tagged head out as the camera closes on it; the
  // opacity it fades FROM lives here, so write baseOpacity, not material.opacity
  m.userData.arrowHead = true;
  m.userData.baseOpacity = m.material.opacity;
  return m;
}
function dot(pos, size, colour, opacity){
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10),
    new THREE.MeshBasicMaterial({ color:C(colour), transparent:true,
      opacity: opacity === undefined ? 1 : opacity }));
  m.position.copy(pos);
  return m;
}
/* Soft round dab, shared by every point-like marker. Untextured points rasterise
   as hard squares — the same reason orbit3d.js builds one for its catalogue. */
let _disc = null;
function discTexture(){
  if(_disc) return _disc;
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S/2,S/2,0, S/2,S/2,S/2);
  gr.addColorStop(0,'rgba(255,255,255,1)');
  gr.addColorStop(.42,'rgba(255,255,255,.92)');
  gr.addColorStop(.72,'rgba(255,255,255,.30)');
  gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(S/2,S/2,S/2,0,7); g.fill();
  _disc = new THREE.CanvasTexture(c);
  _disc.minFilter = _disc.magFilter = THREE.LinearFilter;
  _disc.generateMipmaps = false;
  return _disc;
}

/* ---- layer 1: the inertial frame itself ----------------------------------- */
function buildFrame(){
  const g = new THREE.Group(), L = 2.2;
  const X = eci(1,0,0), Y = eci(0,1,0), Z = eci(0,0,1);

  // the three ECI axes; the negative halves are dimmed so the sign is never in doubt
  const axis = (v, colour, op) => {
    g.add(lineFrom([new THREE.Vector3(0,0,0), v.clone().multiplyScalar(L)], colour, op));
    g.add(lineFrom([new THREE.Vector3(0,0,0), v.clone().multiplyScalar(-L*0.9)], colour, op*0.35));
  };
  axis(X, 'aries', 0.95);
  axis(Y, 'muted', 0.55);
  axis(Z, 'pole',  0.75);
  g.add(cone(X.clone().multiplyScalar(L), X, 0.13, 'aries'));
  g.add(cone(Z.clone().multiplyScalar(L), Z, 0.10, 'pole'));

  // the whole point of the layer: this direction, and the fact that it never moves
  const ariesLbl = makeLabel(['♈︎ FIRST POINT OF ARIES',
                              'ECI +X · vernal equinox · RA 0h'],
                             SPACE.aries, { h:0.023, depthTest:false });
  ariesLbl.position.copy(X.clone().multiplyScalar(L+0.34)).add(new THREE.Vector3(0,0.14,0));
  g.add(ariesLbl);

  const ncp = makeLabel(['NORTH CELESTIAL POLE','ECI +Z · Dec +90°'], SPACE.pole,
                        { h:0.019, depthTest:false });
  ncp.position.copy(Z.clone().multiplyScalar(L+0.28));
  g.add(ncp);
  const scp = makeLabel('SOUTH CELESTIAL POLE', SPACE.muted,
                        { h:0.015, depthTest:false, opacity:0.7 });
  scp.position.copy(Z.clone().multiplyScalar(-L*0.9 - 0.20));
  g.add(scp);
  const yl = makeLabel('ECI +Y · RA 6h', SPACE.muted,
                       { h:0.015, depthTest:false, opacity:0.75 });
  yl.position.copy(Y.clone().multiplyScalar(L+0.18));
  g.add(yl);

  // the celestial equator: the plane RAAN is measured in
  g.add(lineFrom(arcPts(new THREE.Vector3(), X, Y, L, 360, 240), 'ring', 0.85));
  // a barely-there fill, so the orbit plane visibly cuts this one along the nodes
  const eqDisc = new THREE.Mesh(new THREE.RingGeometry(1.02, L, 96),
    new THREE.MeshBasicMaterial({ color:C('ring'), transparent:true, opacity:0.055,
      side:THREE.DoubleSide, depthWrite:false }));
  eqDisc.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  g.add(eqDisc);

  // RA ticks every 2 h, hour labels only at the quarters or the cage shouts
  for(let ra=0; ra<360; ra+=30){
    const d = eci(cos(ra), sin(ra), 0);
    const big = (ra % 90) === 0;
    g.add(lineFrom([d.clone().multiplyScalar(L*(big?0.955:0.975)),
                    d.clone().multiplyScalar(L)], 'ring', big?0.95:0.6));
    if(big && ra){
      const t = makeLabel((ra/15)+'h', SPACE.muted, { h:0.014, depthTest:false, opacity:0.8 });
      t.position.copy(d.clone().multiplyScalar(L+0.14));
      g.add(t);
    }
  }
  return g;
}

/* ---- layer 2: the elements, as geometry ----------------------------------- */
// One basis feeds every piece below, so the arcs and the ellipse cannot drift apart.
function basis(e){
  const n  = eci(cos(e.raan), sin(e.raan), 0);                        // node line, toward ascending
  const w  = eci(sin(e.inc)*sin(e.raan), -sin(e.inc)*cos(e.raan), cos(e.inc)); // orbit normal
  const v  = new THREE.Vector3().crossVectors(w, n);                  // in plane, 90 deg past node
  const eq = eci(-sin(e.raan), cos(e.raan), 0);                       // in equator, 90 deg past node
  const z  = eci(0,0,1);
  const p  = n.clone().multiplyScalar(cos(e.argp)).addScaledVector(v, sin(e.argp));
  return { n, w, v, eq, z, p, x: eci(1,0,0), y: eci(0,1,0) };
}
function radiusAt(e, nu){ return e.a*(1-e.ecc*e.ecc)/(1+e.ecc*cos(nu)); }

/* h, r and the velocity split are the parts that MOVE. They are computed from
   the live state vector rather than from the mean elements, so they follow the
   spacecraft exactly and carry the orbit's precession for free:
     h = r x v
   The eccentricity vector is the exception - it is drawn from the MEAN
   elements, for the reason given at the e arrow below.                        */
function buildLive(parent){
  const seg = 96;
  const mk = (colour) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2*3), 3));
    return new THREE.Line(geo, new THREE.LineBasicMaterial({
      color:C(colour), transparent:true, opacity:.95 }));
  };
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((seg+1)*3), 3));
  live = {
    seg,
    h: mk(SPACE.hvec), e: mk(SPACE.evec),
    hTip: cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.085, SPACE.hvec, .95),
    eTip: cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.075, SPACE.evec, .95),
    nu: new THREE.Line(arcGeo, new THREE.LineBasicMaterial({
          color:C('nu'), transparent:true, opacity:.95 })),
    // the arc runs outside the orbit, so a spoke ties its end to the spacecraft
    // and a head says which way the angle grows
    nuTube: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
          color:C('nu'), transparent:true, opacity:.95, depthWrite:false })),
    nuSpoke: mk(SPACE.nu),
    nuTip: cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.075, 'nu', .95),
    v:  mk(SPACE.vvec), vt: mk(SPACE.vtvec), vn: mk(SPACE.vnvec),
    vTip:  cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.075, SPACE.vvec, .95),
    vtTip: cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.060, SPACE.vtvec, .9),
    vnTip: cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.060, SPACE.vnvec, .9),
    /* short: what the arrow IS. full: what it currently measures, on hover.
       The values all live in the elements card below the globe as well; what
       cannot live there is which arrow is which, so that is what stays on
       screen. */
    vLbl:  liveLabel(SPACE.vvec,  {h:0.017, short:'v',  key:'v',  prio:5, sample:'v = 00.000 km/s'}),
    vtLbl: liveLabel(SPACE.vtvec, {h:0.015, short:'vt', key:'vt', prio:7, sample:'vt = 00.000 km/s (transverse)'}),
    vnLbl: liveLabel(SPACE.vnvec, {h:0.015, short:'vn', key:'vn', prio:7, sample:'vn = 00.000 km/s (radial)'}),
    hLbl: liveLabel(SPACE.hvec, {h:0.017, short:'h', key:'h', prio:2, sample:'h = 000000000 km2/s'}),
    eLbl: liveLabel(SPACE.evec, {h:0.017, short:'e', key:'e', prio:2, sample:'e = 0.0000000  (mean; perigee barely defined)'}),
    nuLbl: liveLabel(SPACE.nu, {h:0.018, short:'\u03b8', key:'nu', prio:1, sample:'\u03b8 = 000.00\u00b0 from mean perigee'})
  };
  live.nuSpoke.material.opacity = .5;
  [live.h, live.e, live.hTip, live.eTip, live.nu, live.nuTube, live.nuSpoke, live.nuTip,
   live.hLbl, live.eLbl, live.nuLbl,
   live.v, live.vt, live.vn, live.vTip, live.vtTip, live.vnTip,
   live.vLbl, live.vtLbl, live.vnLbl].forEach(o=>parent.add(o));
  /* Each arrow selects its own label. The label sprite is registered first
     because it is the primary target - see pickKey. */
  regPick(live.hLbl,'h');  regPick(live.h,'h');   regPick(live.hTip,'h');
  regPick(live.eLbl,'e');  regPick(live.e,'e');   regPick(live.eTip,'e');
  regPick(live.nuLbl,'nu'); regPick(live.nu,'nu'); regPick(live.nuTip,'nu');
  regPick(live.vLbl,'v');  regPick(live.v,'v');   regPick(live.vTip,'v');
  regPick(live.vtLbl,'vt'); regPick(live.vt,'vt'); regPick(live.vtTip,'vt');
  regPick(live.vnLbl,'vn'); regPick(live.vn,'vn'); regPick(live.vnTip,'vn');
  liveMs = null; nuShown = null;
}

/* A segment between two arbitrary points, with the head on the far end. */
function setSeg(line, tip, from, to){
  const a = line.geometry.attributes.position.array;
  a[0]=from.x; a[1]=from.y; a[2]=from.z; a[3]=to.x; a[4]=to.y; a[5]=to.z;
  line.geometry.attributes.position.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  if(tip){
    const d = to.clone().sub(from);
    if(d.lengthSq() < 1e-12){ tip.visible = false; return; }
    d.normalize();
    tip.position.copy(to).addScaledVector(d, -0.030);
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d);
  }
}

/* Set a two-point line from the origin, park the arrow head on its tip. */
function setRay(line, tip, vec, headBack){
  const a = line.geometry.attributes.position.array;
  a[0]=0; a[1]=0; a[2]=0; a[3]=vec.x; a[4]=vec.y; a[5]=vec.z;
  line.geometry.attributes.position.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  if(tip){
    const d = vec.clone().normalize();
    tip.position.copy(vec).addScaledVector(d, -(headBack||0.042));
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d);
  }
}

function updateLive(date){
  if(!live || !satrecRef || !sat) return false;
  const ms = date.getTime();
  if(liveMs !== null && Math.abs(ms - liveMs) < 120) return false;   // ~8 Hz is plenty
  liveMs = ms;
  let pv = null;
  try { pv = sat.propagate(satrecRef, date); } catch(e){ pv = null; }
  const vis = !!(pv && pv.position && pv.velocity && isFinite(pv.position.x));
  [live.h, live.e, live.hTip, live.eTip, live.nu, live.nuTube, live.nuSpoke, live.nuTip,
   live.v, live.vt, live.vn, live.vTip, live.vtTip, live.vnTip].forEach(o=>o.visible = vis);
  /* The labels go through userData.off, never sprite.visible. layout() owns
     visible, and writing true here at 8 Hz un-hid every label the layout had
     dropped for a collision until the next pass hid it again - the labels
     blinked at the physics rate. */
  [live.hLbl, live.eLbl, live.nuLbl,
   live.vLbl, live.vtLbl, live.vnLbl].forEach(o=>o.userData.off = !vis);
  if(!vis) return true;

  const R = [pv.position.x, pv.position.y, pv.position.z];
  const V = [pv.velocity.x, pv.velocity.y, pv.velocity.z];
  const rMag = Math.hypot(R[0],R[1],R[2]);
  const H = [R[1]*V[2]-R[2]*V[1], R[2]*V[0]-R[0]*V[2], R[0]*V[1]-R[1]*V[0]];
  const hMag = Math.hypot(H[0],H[1],H[2]);

  // scene vectors
  const rS = eci(R[0],R[1],R[2]).multiplyScalar(U);
  const hDir = eci(H[0],H[1],H[2]).normalize();
  /* The eccentricity vector, from the MEAN elements rather than from the state
     vector. The osculating form (v x h)/mu - r_hat is the textbook definition
     and is what this drew first, but as a DRAWN ARROW it misleads. Measured
     over one revolution: KNACKSAT-2's osculating |e| runs 0.000816 to 0.002108,
     a factor of 2.58, while its direction wanders 64.9 deg. LANDSAT 8 is worse
     and shows why - at e = 1.3e-4 the vector is mostly J2 short-period noise,
     |e| moves by a factor of 5.57 and the direction sweeps 178.8 deg, NEARLY ALL
     of 180, so
     the arrow would point anywhere at all. None of that is the orbit changing;
     it is exactly what the mean elements have already averaged out. The mean
     vector is what the elements card quotes and what the ellipse and the omega
     arc are built from, and it holds still long enough to read. */
  const eDir = (el && isFinite(el.ecc) && isFinite(el.argp)) ? basis(el).p : null;
  const rLen = rS.length();

  /* The radius vector is orbit3d's: it draws the same ray in TWO parts, R(+)
     from the centre to the surface in ink and the altitude from the surface to
     the spacecraft in the track colour, and that join is the whole point of it.
     A single white line over the top painted out the outer half and destroyed
     the distinction. rS is kept - the velocity trio is built on it. */
  setRay(live.h, live.hTip, hDir.clone().multiplyScalar(Math.max(1.55, rLen*1.12)));
  live.hLbl.position.copy(hDir).multiplyScalar(Math.max(1.55, rLen*1.12) + 0.16);

  /* The angle is measured from perigee, and on a near-circular orbit perigee is
     not a real place: at e = 1.3e-4 it sits about a kilometre below apogee.
     Taking the direction from the mean elements
     removes the frame-to-frame jitter the osculating vector had, but it cannot
     manufacture a perigee that the orbit does not really have - so the label
     still says when the number is describing a nearly round orbit. */
  const nearCircular = !!(el && isFinite(el.ecc) && el.ecc < 1.5e-3);
  const rHat = rS.clone().normalize();

  // the arrow points at mean perigee; say so when that is not a real place
  if(eDir){
    const eLen = Math.max(1.30, rLen*0.92);
    setRay(live.e, live.eTip, eDir.clone().multiplyScalar(eLen));
    live.eLbl.position.copy(eDir).multiplyScalar(eLen + 0.16);
    live.e.visible = live.eTip.visible = true; live.eLbl.userData.off = false;
    live.e.material.opacity = nearCircular ? .38 : .95;
    live.eTip.userData.baseOpacity = nearCircular ? .38 : .95;
  } else {
    live.e.visible = live.eTip.visible = false; live.eLbl.userData.off = true;
  }

  /* The angle is measured from the arrow that is actually drawn, so the arc
     starts where the reader can see that it starts. That makes it the angle
     from MEAN perigee rather than the osculating true anomaly; the two differ
     by up to 64 degrees on KNACKSAT-2, which is precisely the short-period
     wander the mean elements remove. The label names its reference rather than
     leaving a bare theta to be read as the textbook quantity it is no longer. */
  /* Measure in the OSCULATING plane. The osculating e was perpendicular to
     h = r x v by construction, so the arc closed on the spacecraft exactly; the
     mean vector is not, because the mean plane and the instantaneous one differ
     by the short-period wobble. Projecting first keeps the arc landing on the
     spacecraft instead of a fraction of a degree beside it. The drawn ARROW
     stays along the unprojected mean vector, which is the actual quantity. */
  let fromDir = null;
  if(eDir){
    const pIn = eDir.clone().addScaledVector(hDir, -hDir.dot(eDir));
    if(pIn.lengthSq() > 1e-12) fromDir = pIn.normalize();
  }
  if(fromDir){
    const inPlane = new THREE.Vector3().crossVectors(hDir, fromDir).normalize();
    /* Signed, in the direction of motion. The old test - r.v < 0 means past
       apogee, so take 360 - ang - was pinned to OSCULATING perigee, because
       that is exactly where r.v changes sign. Carried over to a MEAN reference
       it breaks: measured against this angle it is wrong by up to 82.0 deg on
       KNACKSAT-2 and 9.1 deg on LANDSAT 8, over a band as wide as the two
       perigees are apart. atan2 in the orbit plane has no branch to choose. */
    let ang = Math.atan2(rHat.dot(inPlane), rHat.dot(fromDir))*DEG;
    if(ang < 0) ang += 360;
    /* OUTSIDE the orbit. It was max(0.62, 0.42 r), which for anything in LEO
       is 0.62 Earth radii - inside the planet, so the globe hid the arc and
       the theta label anchored on it was culled as behind the body. Just past
       the e arrow's tip, so the angle visibly starts from that arrow. */
    const Rnu = Math.max(1.36, rLen*1.22);
    const arr = live.nu.geometry.attributes.position.array;
    for(let k=0;k<=live.seg;k++){
      const t = ang*k/live.seg;
      const p = fromDir.clone().multiplyScalar(Rnu*cos(t)).addScaledVector(inPlane, Rnu*sin(t));
      arr[k*3]=p.x; arr[k*3+1]=p.y; arr[k*3+2]=p.z;
    }
    live.nu.geometry.attributes.position.needsUpdate = true;
    live.nu.geometry.computeBoundingSphere();
    // rebuilt rather than bent: 8 Hz, a few hundred vertices
    const tubePts = [];
    for(let k=0;k<=live.seg;k+=2) tubePts.push(new THREE.Vector3(arr[k*3], arr[k*3+1], arr[k*3+2]));
    live.nuTube.geometry.dispose();
    live.nuTube.geometry = ang > 0.5 ? tubeGeo(tubePts) : new THREE.BufferGeometry();
    live.nu.visible = true; live.nuLbl.userData.off = false;
    const nuEnd = fromDir.clone().multiplyScalar(Rnu*cos(ang)).addScaledVector(inPlane, Rnu*sin(ang));
    const nuDir = fromDir.clone().multiplyScalar(-sin(ang)).addScaledVector(inPlane, cos(ang));
    setSeg(live.nuSpoke, null, rS, nuEnd);         // spacecraft out to the end of the arc
    live.nuTip.position.copy(nuEnd).addScaledVector(nuDir, -0.036);
    live.nuTip.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), nuDir);
    live.nuTube.visible = live.nuSpoke.visible = live.nuTip.visible = true;
    /* At the arc's END, beside the spacecraft, not at its middle: past
       theta = 180 the middle is on the far side of the planet from a camera
       that is following the spacecraft, and the label was culled as behind
       the body for half of every orbit. */
    live.nuLbl.position.copy(nuEnd).multiplyScalar(1.08);
    if(nuShown === null || Math.abs(ang - nuShown) > 0.05){
      nuShown = ang;
      // one symbol for the angle either way, with the reference named, rather
      // than switching between nu and u and leaving the reader to notice
      live.nuLbl.userData.paint('\u03b8 = '+ang.toFixed(2)+'\u00b0 from mean perigee');
      /* The MEAN magnitude, because that is now what the arrow is: constant
         across the element set, and the same number the elements card carries.
         Quoting it beside an osculating arrow would have described a different
         quantity, which is why this used to print the osculating value. */
      const eShown = el.ecc;
      if(!live.eLbl.userData.off) live.eLbl.userData.paint(nearCircular
        ? 'e = '+eShown.toFixed(7)+'  (mean; perigee barely defined)'
        : 'e = '+eShown.toFixed(7)+'  (mean)');
    }
  } else {
    live.nu.visible = live.nuTube.visible = live.nuSpoke.visible = live.nuTip.visible = false;
    live.nuLbl.userData.off = true;
  }
  /* Velocity, split in the plane. Note the cross-track component here is zero
     by construction, not by physics: h is defined as r x v, so v.h vanishes for
     any pair of vectors whatever. A real cross-track term would have to be
     measured against the MEAN-element orbit normal, from i and RAAN. What this
     frame can show is the useful split - local horizontal against local vertical:
       v_t  transverse, perpendicular to r, the direction of travel
       v_n  radial, along r, which is zero exactly at perigee and apogee      */
  const vMag = Math.hypot(V[0],V[1],V[2]);
  const VS = eci(V[0],V[1],V[2]);
  const rHatS = rS.clone().normalize();
  const tHat = new THREE.Vector3().crossVectors(hDir, rHatS).normalize();
  const vRad = VS.dot(rHatS), vTan = VS.dot(tHat);
  const K = 0.085;                                  // scene units per km/s
  const vEnd  = rS.clone().addScaledVector(VS.clone().normalize(), vMag*K);
  const vtEnd = rS.clone().addScaledVector(tHat, vTan*K);
  const vnEnd = rS.clone().addScaledVector(rHatS, vRad*K);
  setSeg(live.v,  live.vTip,  rS, vEnd);
  setSeg(live.vt, live.vtTip, rS, vtEnd);
  setSeg(live.vn, live.vnTip, rS, vnEnd);
  live.vLbl.position.copy(vEnd).addScaledVector(VS.clone().normalize(), 0.10);
  live.vtLbl.position.copy(vtEnd).addScaledVector(tHat, Math.sign(vTan)*0.10);
  live.vnLbl.position.copy(vnEnd).addScaledVector(rHatS, Math.sign(vRad || 1)*0.10);
  /* On a near-circular orbit v_t IS v to three decimals and v_n is nothing, so
     drawing all three stacks three arrows and three labels on one another.
     Show the split only where there is a split to show. */
  const tiny = Math.abs(vRad) < 0.02;
  live.vn.visible = live.vnTip.visible = !tiny; live.vnLbl.userData.off = tiny;
  live.vt.visible = live.vtTip.visible = !tiny; live.vtLbl.userData.off = tiny;
  if(vShown === null || Math.abs(vMag - vShown) > 0.0005){
    vShown = vMag;
    live.vLbl.userData.paint('v = '+vMag.toFixed(3)+' km/s');
    live.vtLbl.userData.paint('vt = '+vTan.toFixed(3)+' km/s (transverse)');
    live.vnLbl.userData.paint('vn = '+vRad.toFixed(3)+' km/s (radial)');
  }
  live.hLbl.userData.paint('h = '+(hMag).toFixed(0)+' km\u00b2/s');
  return true;
}

function buildElements(){
  const g = new THREE.Group();
  clearTags();                 // a rebuild must not leave the last orbit's tags behind
  if(!el) return g;
  const b = basis(el), O = new THREE.Vector3();
  const rp = el.a*(1-el.ecc)*U, ra = el.a*(1+el.ecc)*U;
  // arc radii ride the orbit's size: fixed radii disappear inside a GEO ellipse
  // and swamp a LEO one
  const Rn = Math.max(1.40, ra*0.58);            // RAAN arc, in the equatorial plane
  const Rw = Math.max(1.18, ra*0.44);            // argument of perigee, in the orbit plane
  const Ln = Math.max(1.65, ra*1.22);            // how far the node line runs

  // the orbit plane, as a plane
  const disc = new THREE.Mesh(new THREE.RingGeometry(1.02, Math.max(2.2, ra*1.08), 120),
    new THREE.MeshBasicMaterial({ color:C('track'), transparent:true, opacity:0.075,
      side:THREE.DoubleSide, depthWrite:false }));
  disc.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(b.n, b.v, b.w));
  g.add(disc);

  // the ellipse from the elements rather than from a propagator: this is the
  // two-body geometry the numbers describe, not the perturbed path orbit3d draws
  const ell = [];
  for(let k=0;k<=256;k++){
    const nu = k*360/256, r = radiusAt(el, nu)*U, u = el.argp + nu;
    ell.push(b.n.clone().multiplyScalar(r*cos(u)).addScaledVector(b.v, r*sin(u)));
  }
  g.add(lineFrom(ell, 'track', 0.9));

  // line of nodes, marked where it actually pierces the orbit
  g.add(lineFrom([b.n.clone().multiplyScalar(-Ln), b.n.clone().multiplyScalar(Ln)], 'ink2', 0.7));
  const rAsc = radiusAt(el, -el.argp)*U, rDes = radiusAt(el, 180-el.argp)*U;
  const asc = b.n.clone().multiplyScalar(rAsc), des = b.n.clone().multiplyScalar(-rDes);
  const ascDot = dot(asc, 0.030, 'raan'); g.add(ascDot);
  const ascL = tagLabel('☊', 'ascending node', SPACE.raan,
                        { h:0.017, key:'asc', prio:4 });
  ascL.position.copy(asc).addScaledVector(b.n, 0.22);
  g.add(ascL); regPick(ascL,'asc'); regPick(ascDot,'asc');
  const desDot = dot(des, 0.020, 'ink2', 0.6); g.add(desDot);
  /* Plain letters for the descending node where the ascending one gets the
     astronomical symbol: a reader of this page can be assumed to know neither,
     but the ascending node is the one the RAAN arc points at and the one worth
     a mark of its own. */
  const desL = tagLabel('DESC', 'descending node', SPACE.ink2,
                        { h:0.014, opacity:0.75, key:'desc', prio:6 });
  desL.position.copy(des).addScaledVector(b.n, -0.22);
  g.add(desL); regPick(desL,'desc'); regPick(desDot,'desc');

  // RAAN: measured in the equatorial plane, from Aries, eastward. The arc starts
  // on +X by construction — that is the assertion this layer exists to make.
  const raan = arcPts(O, b.x, b.y, Rn, el.raan, Math.max(24, Math.round(el.raan/2)));
  const raanArc = lineFrom(raan, 'raan', 1); g.add(raanArc); g.add(tubeFrom(raan, 'raan', 1));
  const tipN = raan[raan.length-1];
  const raanCone = cone(tipN, new THREE.Vector3().subVectors(tipN, raan[raan.length-2]), 0.11, 'raan');
  g.add(raanCone);
  g.add(lineFrom([O, b.x.clone().multiplyScalar(Rn*1.06)], 'aries', 0.55));
  /* The +Y nudge that used to be here, and on the four labels below, is gone.
     A world-space push along +Y is a screen-space push only when the camera
     happens to sit near the equator; at the pole it does nothing at all. It was
     de-collision attempted in the wrong space, and the layout pass at the end of
     this file does that job now. What stays is the push that MEANS something:
     outward, away from the thing being named. */
  const raanL = tagLabel('Ω', 'RAAN  Ω = '+el.raan.toFixed(2)+'°', SPACE.raan,
                         { h:0.021, key:'raan', prio:0 });
  raanL.position.copy(raan[raan.length>>1]).multiplyScalar(1.10);
  g.add(raanL); regPick(raanL,'raan'); regPick(raanArc,'raan'); regPick(raanCone,'raan');

  // Inclination is a dihedral angle, so it is drawn where it is defined: on a
  // circle about the node line, from the equatorial plane up into the orbit plane.
  const Ci = b.n.clone().multiplyScalar(Rn*0.90), rho = Math.max(0.30, Rn*0.26);
  const inc = arcPts(Ci, b.eq, b.z, rho, el.inc, Math.max(20, Math.round(el.inc/2)));
  const incArc = lineFrom(inc, 'inc', 1); g.add(incArc); g.add(tubeFrom(inc, 'inc', 1));
  g.add(lineFrom([Ci, new THREE.Vector3().copy(Ci).addScaledVector(b.eq, rho)], 'ring', 0.6));
  g.add(lineFrom([Ci, new THREE.Vector3().copy(Ci).addScaledVector(b.v, rho)], 'inc', 0.6));
  const tipI = inc[inc.length-1];
  const incCone = cone(tipI, new THREE.Vector3().subVectors(tipI, inc[inc.length-2]), 0.085, 'inc');
  g.add(incCone);
  const incL = tagLabel('i', 'inclination  i = '+el.inc.toFixed(2)+'°', SPACE.inc,
                        { h:0.021, key:'inc', prio:0 });
  incL.position.copy(inc[inc.length>>1]).addScaledVector(b.z, 0.15).addScaledVector(b.eq, 0.06);
  g.add(incL); regPick(incL,'inc'); regPick(incArc,'inc'); regPick(incCone,'inc');

  // argument of perigee: inside the orbit plane, node -> perigee
  const argp = arcPts(O, b.n, b.v, Rw, el.argp, Math.max(24, Math.round(el.argp/2)));
  const argpArc = lineFrom(argp, 'argp', 1); g.add(argpArc); g.add(tubeFrom(argp, 'argp', 1));
  const tipW = argp[argp.length-1];
  const argpCone = cone(tipW, new THREE.Vector3().subVectors(tipW, argp[argp.length-2]), 0.10, 'argp');
  g.add(argpCone);
  const argpL = tagLabel('ω', 'arg. of perigee  ω = '+el.argp.toFixed(2)+'°',
                         SPACE.argp, { h:0.021, key:'argp', prio:0 });
  argpL.position.copy(argp[argp.length>>1]).multiplyScalar(1.10);
  g.add(argpL); regPick(argpL,'argp'); regPick(argpArc,'argp'); regPick(argpCone,'argp');

  // apsides
  const pPos = b.p.clone().multiplyScalar(rp), aPos = b.p.clone().multiplyScalar(-ra);
  g.add(lineFrom([pPos, aPos], 'muted', 0.35));
  const periDot = dot(pPos, 0.028, 'argp'); g.add(periDot);
  const apoDot  = dot(aPos, 0.024, 'muted');    g.add(apoDot);
  /* One line each, not two. makeLabel gives a two-line label 1.6x the height as
     well as the width, and these two share the apse line with the e arrow -
     three stacked two-line labels on a near-circular orbit was the single
     largest contributor to the pile-up. The altitudes are in the elements card
     below as min and max altitude. */
  const pl = tagLabel('perigee', 'perigee  '+(el.a*(1-el.ecc)-RE).toFixed(0)+' km alt',
                      SPACE.argp, { h:0.016, key:'peri', prio:3 });
  pl.position.copy(pPos).addScaledVector(b.p, 0.24);
  g.add(pl); regPick(pl,'peri'); regPick(periDot,'peri');
  const al = tagLabel('apogee', 'apogee  '+(el.a*(1+el.ecc)-RE).toFixed(0)+' km alt',
                      SPACE.muted, { h:0.016, key:'apo', prio:3 });
  al.position.copy(aPos).addScaledVector(b.p, -0.24);
  g.add(al); regPick(al,'apo'); regPick(apoDot,'apo');

  // the orbit normal, so the sense of the inclination arc reads at a glance
  g.add(lineFrom([O, b.w.clone().multiplyScalar(Rn*0.85)], 'track', 0.35));
  buildLive(g);                                  // the parts that move with the spacecraft
  return g;
}

/* ---- layer 3: the star field ---------------------------------------------
   HYG v4.0 (Hipparcos/Yale/Gliese), every star to V = 5.5, positions J2000 and
   rounded to 0.01 deg (36 arcsec — a tenth of a pixel out there). Flat quads of
   ra, dec, magnitude, B-V, packed as one string because 11460 numbers written as
   a JS array literal cost the parser more than a split() does.
   -------------------------------------------------------------------------- */
let STAR_DATA = '';                                // CHANGED: the table is in sky-data.ts and arrives through setSkyData()

/* B-V -> temperature (Ballesteros 2012) -> a blackbody ramp, then pulled most of
   the way to white: real stars look far less saturated than a Planck curve does. */
function bvColour(bv){
  const T = 4600*(1/(0.92*bv+1.7) + 1/(0.92*bv+0.62)), t = T/100;
  const cl = v => Math.max(0, Math.min(255, v))/255;
  let r, g, b;
  if(T <= 6600){
    r = 255;
    g = 99.4708025861*Math.log(t) - 161.1195681661;
    b = T <= 1900 ? 0 : 138.5177312231*Math.log(t-10) - 305.0447927307;
  } else {
    r = 329.698727446*Math.pow(t-60, -0.1332047592);
    g = 288.1221695283*Math.pow(t-60, -0.0755148492);
    b = 255;
  }
  const k = 0.45;                                 // mix toward white
  return [cl(r)*(1-k)+k, cl(g)*(1-k)+k, cl(b)*(1-k)+k];
}

let starMat = null;
function buildStars(){
  const d = STAR_DATA.split(','), n = d.length/4;
  const pos = new Float32Array(n*3), col = new Float32Array(n*3);
  const siz = new Float32Array(n), alp = new Float32Array(n);
  for(let i=0;i<n;i++){
    const ra = +d[i*4]/100, dec = +d[i*4+1]/100, mag = +d[i*4+2]/10, bv = +d[i*4+3]/100;
    const p = raDec(ra, dec, R_SKY);
    pos[i*3] = p.x; pos[i*3+1] = p.y; pos[i*3+2] = p.z;
    const c = bvColour(bv);
    col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2];
    // magnitude is logarithmic and the eye is too; a flat linear ramp makes
    // everything a uniform grey dust and loses the constellations entirely
    const f = Math.max(0.01, (5.6-mag)/7.0);
    siz[i] = 1.1 + 5.2*Math.pow(f, 1.9);          // CSS px, before pixel ratio
    alp[i] = 0.34 + 0.66*Math.pow(f, 0.8);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',  new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('starColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize',     new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aAlpha',    new THREE.BufferAttribute(alp, 1));

  // one Points object with a per-vertex size: PointsMaterial has a single size
  // for the whole cloud, which is exactly the thing a star field must not have
  starMat = new THREE.ShaderMaterial({
    uniforms: { pxScale: { value: dpr } },
    vertexShader: [
      'attribute vec3 starColor; attribute float aSize; attribute float aAlpha;',
      'uniform float pxScale; varying vec3 vC; varying float vA;',
      'void main(){ vC = starColor; vA = aAlpha;',
      '  gl_PointSize = aSize * pxScale;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vC; varying float vA;',
      'void main(){ float r = length(gl_PointCoord - vec2(0.5)) * 2.0;',
      '  float a = smoothstep(1.0, 0.12, r);',
      '  if(a < 0.004) discard;',
      '  gl_FragColor = vec4(vC, a * vA); }'
    ].join('\n'),
    transparent: true, depthWrite: false
  });
  const pts = new THREE.Points(geo, starMat);
  pts.frustumCulled = false;                      // the camera sits inside the sphere
  const g = new THREE.Group();
  g.add(pts);
  return g;
}

/* ---- layer 4: constellation lines ------------------------------------------
   IAU line figures from d3-celestial, which carries the standard Western set as
   RA/Dec polylines. Real data or nothing — invented joins would be worse than
   an empty sky.
   -------------------------------------------------------------------------- */
let CONST_DATA = [];                               // CHANGED: likewise

// straight chords through a 400-unit sphere sag visibly on a 25-degree join, and
// a sagging line no longer touches the stars it is supposed to connect
function greatCircle(out, ra0, de0, ra1, de1){
  const a = raDec(ra0, de0, 1), b = raDec(ra1, de1, 1);
  const dotp = Math.max(-1, Math.min(1, a.dot(b))), ang = Math.acos(dotp);
  const steps = Math.max(1, Math.ceil(ang*DEG/4));
  let prev = a.clone().multiplyScalar(R_SKY*1.01);
  for(let k=1;k<=steps;k++){
    const t = k/steps, s = Math.sin(ang);
    const p = s < 1e-6 ? b.clone()
      : a.clone().multiplyScalar(Math.sin((1-t)*ang)/s)
         .addScaledVector(b, Math.sin(t*ang)/s);
    p.multiplyScalar(R_SKY*1.01);                 // just behind the stars
    out.push(prev, p.clone());
    prev = p;
  }
}
function buildConstellations(){
  const g = new THREE.Group(), segs = [];
  for(let i=0;i<CONST_DATA.length;i++){
    const polys = CONST_DATA[i][4];
    for(let j=0;j<polys.length;j++){
      const p = polys[j];
      for(let k=0;k+3<p.length;k+=2) greatCircle(segs, p[k], p[k+1], p[k+2], p[k+3]);
    }
  }
  const geo = new THREE.BufferGeometry().setFromPoints(segs);
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: C('ring'), transparent:true, opacity:0.45 }));
  lines.frustumCulled = false;
  g.add(lines);
  for(let i=0;i<CONST_DATA.length;i++){
    const c = CONST_DATA[i];
    const t = makeLabel(c[1].toUpperCase(), SPACE.muted, { h:0.012, opacity:0.55, order:8 });
    t.position.copy(raDec(c[2], c[3], R_SKY*0.99));
    g.add(t);
  }
  return g;
}

/* ---- layer 5: Sun, Moon and planets ----------------------------------------
   Schlyter's low-precision analytic ephemeris ("How to compute planetary
   positions"), with his outer-planet and lunar perturbation terms. Positions
   come out referred to the mean equinox of date, which is the frame this scene
   already uses — no rotation needed, unlike the J2000 star catalogue above.
   Checked against JPL Horizons apparent RA/Dec: worst body 0.039 deg.
   -------------------------------------------------------------------------- */
const PL = {
  Mercury:[48.3313,3.24587e-5, 7.0047,5.00e-8, 29.1241,1.01444e-5, 0.387098,0, 0.205635,5.59e-10, 168.6562,4.0923344368],
  Venus:  [76.6799,2.46590e-5, 3.3946,2.75e-8, 54.8910,1.38374e-5, 0.723330,0, 0.006773,-1.302e-9, 48.0052,1.6021302244],
  Mars:   [49.5574,2.11081e-5, 1.8497,-1.78e-8,286.5016,2.92961e-5, 1.523688,0, 0.093405,2.516e-9, 18.6021,0.5240207766],
  Jupiter:[100.4542,2.76854e-5,1.3030,-1.557e-7,273.8777,1.64505e-5, 5.20256,0, 0.048498,4.469e-9, 19.8950,0.0830853001],
  Saturn: [113.6634,2.38980e-5,2.4886,-1.081e-7,339.3939,2.97661e-5, 9.55475,0, 0.055546,-9.499e-9,316.9670,0.0334442282],
  Uranus: [74.0005,1.3978e-5,  0.7733,1.9e-8,   96.6612,3.0565e-5,  19.18171,-1.55e-8,0.047318,7.45e-9,142.5905,0.011725806],
  Neptune:[131.7806,3.0173e-5, 1.7700,-2.55e-7,272.8461,-6.027e-6,  30.05826,3.313e-8,0.008606,2.15e-9,260.2471,0.005995147]
};
function dayNo(date){ return date.getTime()/86400000 + 2440587.5 - 2451543.5; }
function kepler(M, e){
  let E = M + DEG*e*sin(M)*(1+e*cos(M));
  for(let k=0;k<12;k++){
    const dE = (E - DEG*e*sin(E) - M)/(1 - e*cos(E));
    E -= dE;
    if(Math.abs(dE) < 1e-7) break;
  }
  return E;
}
function sunEcl(d){
  const w = 282.9404 + 4.70935e-5*d, e = 0.016709 - 1.151e-9*d;
  const M = rev(356.0470 + 0.9856002585*d);
  const E = M + DEG*e*sin(M)*(1+e*cos(M));
  const xv = cos(E)-e, yv = Math.sqrt(1-e*e)*sin(E);
  return { lon: rev(Math.atan2(yv,xv)*DEG + w), r: Math.hypot(xv,yv), M: M, w: w };
}
function helio(name, d){
  const p = PL[name];
  const N = rev(p[0]+p[1]*d), i = p[2]+p[3]*d, w = rev(p[4]+p[5]*d);
  const a = p[6]+p[7]*d, e = p[8]+p[9]*d, M = rev(p[10]+p[11]*d);
  const E = kepler(M, e);
  const xv = a*(cos(E)-e), yv = a*Math.sqrt(1-e*e)*sin(E);
  const v = Math.atan2(yv,xv)*DEG, r = Math.hypot(xv,yv), u = v+w;
  const x = r*(cos(N)*cos(u) - sin(N)*sin(u)*cos(i));
  const y = r*(sin(N)*cos(u) + cos(N)*sin(u)*cos(i));
  const z = r*(sin(u)*sin(i));
  let lon = rev(Math.atan2(y,x)*DEG), lat = Math.atan2(z, Math.hypot(x,y))*DEG;
  // the great Jupiter-Saturn inequality: without these terms Saturn lands most
  // of a degree off, which is visible against the star field behind it
  const Mj = rev(19.8950+0.0830853001*d), Ms = rev(316.9670+0.0334442282*d),
        Mu = rev(142.5905+0.011725806*d);
  if(name === 'Jupiter'){
    lon += -0.332*sin(2*Mj-5*Ms-67.6) -0.056*sin(2*Mj-2*Ms+21) +0.042*sin(3*Mj-5*Ms+21)
           -0.036*sin(Mj-2*Ms) +0.022*cos(Mj-Ms) +0.023*sin(2*Mj-3*Ms+52) -0.016*sin(Mj-5*Ms-69);
  } else if(name === 'Saturn'){
    lon += 0.812*sin(2*Mj-5*Ms-67.6) -0.229*cos(2*Mj-4*Ms-2) +0.119*sin(Mj-2*Ms-3)
           +0.046*sin(2*Mj-6*Ms-69) +0.014*sin(Mj-3*Ms+32);
    lat += -0.020*cos(2*Mj-4*Ms-2) +0.018*sin(2*Mj-6*Ms-49);
  } else if(name === 'Uranus'){
    lon += 0.040*sin(Ms-2*Mu+6) +0.035*sin(Ms-3*Mu+33) -0.015*sin(Mj-Mu+20);
  }
  const cl = cos(lat);
  return { x: r*cl*cos(lon), y: r*cl*sin(lon), z: r*sin(lat) };
}
function moonEcl(d){
  const N = rev(125.1228-0.0529538083*d), i = 5.1454, w = rev(318.0634+0.1643573223*d);
  const a = 60.2666, e = 0.054900, M = rev(115.3654+13.0649929509*d);
  const E = kepler(M, e);
  const xv = a*(cos(E)-e), yv = a*Math.sqrt(1-e*e)*sin(E);
  const v = Math.atan2(yv,xv)*DEG;
  let r = Math.hypot(xv,yv);
  const u = v+w;
  const x = r*(cos(N)*cos(u) - sin(N)*sin(u)*cos(i));
  const y = r*(sin(N)*cos(u) + cos(N)*sin(u)*cos(i));
  const z = r*(sin(u)*sin(i));
  let lon = rev(Math.atan2(y,x)*DEG), lat = Math.atan2(z, Math.hypot(x,y))*DEG;
  const s = sunEcl(d);
  const Ls = rev(s.M+s.w), Lm = rev(M+w+N), D = rev(Lm-Ls), F = rev(Lm-N),
        Ms = s.M, Mm = M;
  lon += -1.274*sin(Mm-2*D) +0.658*sin(2*D) -0.186*sin(Ms) -0.059*sin(2*Mm-2*D)
         -0.057*sin(Mm-2*D+Ms) +0.053*sin(Mm+2*D) +0.046*sin(2*D-Ms) +0.041*sin(Mm-Ms)
         -0.035*sin(D) -0.031*sin(Mm+Ms) -0.015*sin(2*F-2*D) +0.011*sin(Mm-4*D);
  lat += -0.173*sin(F-2*D) -0.055*sin(Mm-F-2*D) -0.046*sin(Mm+F-2*D)
         +0.033*sin(F+2*D) +0.017*sin(2*Mm+F);
  r += -0.58*cos(Mm-2*D) -0.46*cos(2*D);
  return { lon: rev(lon), lat: lat, r: r };
}
function toEq(d, x, y, z){                        // ecliptic of date -> equatorial of date
  const ecl = 23.4393 - 3.563e-7*d;
  const ye = y*cos(ecl) - z*sin(ecl), ze = y*sin(ecl) + z*cos(ecl);
  return { ra: rev(Math.atan2(ye,x)*DEG), dec: Math.atan2(ze, Math.hypot(x,ye))*DEG,
           dist: Math.sqrt(x*x + ye*ye + ze*ze) };
}
function ephemeris(date){
  const d = dayNo(date), s = sunEcl(d);
  const xs = s.r*cos(s.lon), ys = s.r*sin(s.lon);
  const out = { Sun: toEq(d, xs, ys, 0) };
  const m = moonEcl(d), cl = cos(m.lat);
  out.Moon = toEq(d, m.r*cl*cos(m.lon), m.r*cl*sin(m.lon), m.r*sin(m.lat));
  out.Moon.dist = m.r;                            // Earth radii, for the angular size
  for(const k in PL){
    const p = helio(k, d);
    out[k] = toEq(d, p.x+xs, p.y+ys, p.z);
  }
  return out;
}

const BODIES = [
  { k:'Sun',     n:'SUN',     c:'#FFE7A8', s:0     },
  { k:'Moon',    n:'MOON',    c:'#DCE2E8', s:0     },
  { k:'Mercury', n:'MERCURY', c:'#C4BAAC', s:0.007 },
  { k:'Venus',   n:'VENUS',   c:'#F5E9CC', s:0.013 },
  { k:'Mars',    n:'MARS',    c:'#E0784F', s:0.010 },
  { k:'Jupiter', n:'JUPITER', c:'#EAD8A6', s:0.012 },
  { k:'Saturn',  n:'SATURN',  c:'#DCC48E', s:0.009 },
  { k:'Uranus',  n:'URANUS',  c:'#9FD8DC', s:0.006 },
  { k:'Neptune', n:'NEPTUNE', c:'#8FB6E8', s:0.005 }
];
let bodyNodes = null;
function buildPlanets(){
  const g = new THREE.Group();
  bodyNodes = [];
  for(let i=0;i<BODIES.length;i++){
    const b = BODIES[i];
    const disc = new THREE.Sprite(new THREE.SpriteMaterial({
      map: discTexture(), color: new THREE.Color(b.c), transparent:true,
      depthWrite:false, sizeAttenuation: b.s === 0 }));
    // the Sun and the Moon are the only two objects up there with a disc you can
    // actually resolve, so they get their true angular size and everything else
    // gets a dab sized by how bright it is
    if(b.s) disc.scale.set(b.s, b.s, 1);
    disc.renderOrder = 9;
    const lab = makeLabel(b.n, b.c, { h: b.k === 'Sun' || b.k === 'Moon' ? 0.017 : 0.014,
                                      opacity:0.9, order:10 });
    lab.visible = skyNames;
    g.add(disc); g.add(lab);
    bodyNodes.push({ b: b, disc: disc, lab: lab });
  }
  updatePlanets(simTime, true);
  return g;
}
function updatePlanets(date, force){
  if(!bodyNodes) return;
  const ms = date.getTime();
  // the Moon is the fastest thing here at 0.55 deg/h; a minute of sim time moves
  // it a hundredth of a degree, so there is nothing to gain from a 60 Hz rebuild
  if(!force && planetMs !== null && Math.abs(ms - planetMs) < 60000) return;
  planetMs = ms;
  const e = ephemeris(date);
  for(let i=0;i<bodyNodes.length;i++){
    const nd = bodyNodes[i], p = e[nd.b.k];
    if(!p) continue;
    const dir = raDec(p.ra, p.dec, R_SKY*0.985);
    nd.disc.position.copy(dir);
    nd.lab.position.copy(dir).add(new THREE.Vector3(0, -7.5, 0));
    if(nd.b.k === 'Sun' || nd.b.k === 'Moon'){
      const km = nd.b.k === 'Sun' ? p.dist*149597870.7 : p.dist*RE;
      const rad = nd.b.k === 'Sun' ? 695700 : 1737.4;
      const w = 2*R_SKY*0.985*Math.tan(Math.asin(Math.min(0.9, rad/km)));
      nd.disc.scale.set(w*2.1, w*2.1, 1);         // the dab's core is ~half its sprite
    }
  }
}

/* ---- precession -----------------------------------------------------------
   The catalogue is J2000 and the scene is true-of-date, so by 2026 the two are
   0.36 deg apart — enough that a star field would visibly sit off the frame
   axes. One rotation on the sky group fixes it; the planets are computed of-date
   already and stay outside that group.
   -------------------------------------------------------------------------- */
function precess(date){
  const T = (date.getTime()/86400000 + 2440587.5 - 2451545.0)/36525, as = 1/3600;
  const zeta  = (2306.2181*T + 0.30188*T*T + 0.017998*T*T*T)*as;
  const z     = (2306.2181*T + 1.09468*T*T + 0.018203*T*T*T)*as;
  const theta = (2004.3109*T - 0.42665*T*T - 0.041833*T*T*T)*as;
  // the classical P = Rz(-z)Ry(theta)Rz(-zeta) is written for rotating the frame;
  // three.js rotates vectors, so what is wanted here is its transpose
  const R = new THREE.Matrix4().makeRotationZ(zeta*RAD)
    .multiply(new THREE.Matrix4().makeRotationY(-theta*RAD))
    .multiply(new THREE.Matrix4().makeRotationZ(z*RAD));
  // R is an ECI rotation; the scene axes are ECI turned -90 deg about X, so the
  // same rotation expressed in scene axes is M R M^-1
  const M = new THREE.Matrix4().makeRotationX(-Math.PI/2);
  const S = M.clone().multiply(R).multiply(M.clone().invert());
  sky.quaternion.setFromRotationMatrix(S);
}

/* ---- housekeeping --------------------------------------------------------- */
function disposeObj(o){
  o.traverse(function(x){
    if(x.geometry) x.geometry.dispose();
    const m = x.material;
    if(!m) return;
    const arr = Array.isArray(m) ? m : [m];
    for(let i=0;i<arr.length;i++){
      // discTexture() is shared across every marker in the scene; only the
      // per-label canvases belong to the object being thrown away
      if(arr[i].map && arr[i].map !== _disc) arr[i].map.dispose();
      arr[i].dispose();
    }
  });
}
function killLayer(key){
  const g = G[key];
  if(!g) return;
  if(g.parent) g.parent.remove(g);
  disposeObj(g);
  G[key] = null;
  if(key === 'elements'){ live = null; liveMs = null; nuShown = null; vShown = null; }
  if(key === 'planets') bodyNodes = null;
  if(key === 'stars') starMat = null;
}
const BUILD = { frame: buildFrame, elements: buildElements,
                stars: buildStars, constellations: buildConstellations,
                planets: buildPlanets };
/* CHANGED: the star catalogue and the constellation figures arrive after the scene is built (setSkyData, below). A layer asked for before
   then is an empty group that is switched on and off like any other, and is built for real, in the same place and with the same
   visibility, the moment the data is there. */
let skyData = false;
function ensure(key){
  if(G[key]) return G[key];
  if(!skyData && (key === 'stars' || key === 'constellations')){
    const ph = new THREE.Group();
    ph.userData.placeholder = true;
    G[key] = ph; sky.add(ph);
    return ph;
  }
  const g = BUILD[key]();
  G[key] = g;
  (key === 'stars' || key === 'constellations' ? sky : root).add(g);
  return g;
}

/* Elements may arrive already parsed by the page, or only as a satrec. Take
   whichever is present and refuse to draw a plane we cannot place. */
function normElements(satrec, e){
  const o = { inc:NaN, raan:NaN, argp:NaN, ecc:NaN, a:NaN, period:NaN };
  const take = (k, v) => { if(typeof v === 'number' && isFinite(v)) o[k] = v; };
  if(e){
    take('inc', e.inc); take('raan', e.raan); take('argp', e.argp);
    take('ecc', e.ecc); take('a', e.a); take('period', e.period);
  }
  if(satrec){
    if(!isFinite(o.inc))  o.inc  = satrec.inclo*DEG;
    if(!isFinite(o.raan)) o.raan = satrec.nodeo*DEG;
    if(!isFinite(o.argp)) o.argp = satrec.argpo*DEG;
    if(!isFinite(o.ecc))  o.ecc  = satrec.ecco;
    // satrec.a is the SGP4 semi-major axis in Earth radii, set by sgp4init
    if(!isFinite(o.a) && isFinite(satrec.a) && satrec.a > 0.9) o.a = satrec.a*RE;
    if(!isFinite(o.a) && isFinite(satrec.no) && satrec.no > 0){
      const n = satrec.no/60;                     // rad/min -> rad/s
      o.a = Math.cbrt(MU/(n*n));
    }
  }
  /* Was RE*0.9 with RE hard-coded to Earth: a 1829 km lunar orbit fails that
   test by a factor of three and the whole element panel silently vanishes.
   Gate on the BODY radius instead. */
  if(!isFinite(o.a) || o.a < BODYRE*0.9) return null;
  if(!isFinite(o.inc) || !isFinite(o.raan) || !isFinite(o.argp) || !isFinite(o.ecc)) return null;
  o.inc = Math.max(0, Math.min(180, o.inc));
  o.raan = rev(o.raan);
  o.argp = rev(o.argp);
  o.ecc = Math.max(0, Math.min(0.95, o.ecc));
  return o;
}

/* ---- public --------------------------------------------------------------- */
const OrbitViz = {
  init(opts){
    opts = opts || {};
    THREE = opts.THREE || global.THREE;
    if(!THREE || !THREE.Sprite) return false;
    scene = opts.scene; sat = opts.satellite || global.satellite;
    if(!scene) return false;
    /* Handed in rather than reached for: the camera and the canvas belong to
       orbit3d, and this module borrows them to project its own labels.
       `occluder` returns a RADIUS in scene units, not a boolean, so orbitviz
       never has to know what orbit3d is drawing - and so that hiding the Earth
       correctly switches occlusion off, because a reader who asked to see
       through the planet must not have labels hidden behind it. */
    camRef = opts.camera || null;
    viewEl = opts.viewport || null;
    occluder = opts.occluder || null;
    U = (typeof opts.scale === 'number' && opts.scale > 0) ? opts.scale : 1/RE;
    if(opts.body){ BODYRE = opts.body.Re; MU = opts.body.mu; }
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    root = new THREE.Group();
    sky = new THREE.Group();                      // holds the J2000 sky, precessed as one
    root.add(sky);
    scene.add(root);
    precess(simTime); precMs = simTime.getTime();
    for(let i=0;i<LAYERS.length;i++){
      const L = LAYERS[i];
      if(L.on && L.key !== 'elements') ensure(L.key);   // elements waits for an orbit
    }
    started = true;
    return true;
  },

  /* The pointer seam. orbit3d owns the camera and the canvas and hands in a
     raycaster it has already aimed; this says what was hit and what it means.
     pick() has no side effects so a check can call it and assert on the answer;
     setHover() is what actually changes the picture. */
  pick(rc, ndc){ return rc ? pickKey(rc, ndc, false) : null; },
  /* Is the pointer over a label? Answered from the rectangles alone, with no
     raycast, so the caller can ask before it decides what the pointer means. */
  pickLabel(ndc){ return ndc ? pickKey(null, ndc, true) : null; },
  setHover(k){ setHoverKey(k || null); },
  get hover(){ return hotKey; },
  /* For the checks: the registered labels, their priorities, and which form is
     on screen - read off the material, not off a flag that says what should
     have been bound. */
  tags(){ return TAGS.map(function(t){
    return { key:t.key, prio:t.prio, visible:t.sprite.visible,
             full: t.sprite.material.map === t.sprite.userData.form.full.tex }; }); },
  setOrbit(o){
    if(!started) return false;
    o = o || {};
    el = normElements(o.satrec, o.elements);
    satrecRef = o.satrec || null;
    killLayer('elements');                        // a switch of spacecraft must not leak the last one
    clearTags();
    if(el && layerOn('elements')) ensure('elements');
    return !!el;
  },

  setTime(date){
    if(!started || !date) return;
    simTime = date instanceof Date ? date : new Date(date);
    const ms = simTime.getTime();
    if(precMs === null || Math.abs(ms - precMs) > 2.6e9){   // ~30 days; precession is 50"/yr
      precess(simTime); precMs = ms;
    }
    /* When the anchors have just moved, lay out in the same frame rather than
       waiting out the 30 Hz cap: until then a label would be drawn with the
       last pass's offset against its new anchor, or shown after the physics
       switched it off. */
    if(G.elements && live && updateLive(simTime)){ layoutDirty = true; lastLayoutMs = -Infinity; }
    /* Deliberately NOT inside the updateLive throttle above. That one is gated
       on simulated time, and with playback paused sim time stops while the
       camera keeps moving under the reader's drag - the labels would freeze
       where they were and slide off their anchors. */
    layoutIfStale();
    if(G.planets) updatePlanets(simTime, false);
    if(starMat){
      // the window can be dragged to a screen with a different pixel ratio, and
      // gl_PointSize is in device pixels, so the stars would double in size
      const d = Math.min(global.devicePixelRatio || 1, 2);
      if(d !== dpr){ dpr = d; starMat.uniforms.pxScale.value = d; }
    }
  },

  show(key, on){
    const L = find(key);
    if(!L || !started) return false;
    L.on = !!on;
    if(L.on){
      // the toggle stays on with nothing behind it until an orbit arrives; the
      // next setOrbit then builds it, so the checkbox never lies about its state
      if(key === 'elements' && !el) return true;
      ensure(key).visible = true;
    } else if(G[key]){
      G[key].visible = false;
    }
    /* The constellations switch also owns the sky's writing. Applied after the
       group visibility above, and guarded because the planets layer may not be
       built yet on the first call. */
    if(key === 'constellations'){
      skyNames = L.on;
      if(bodyNodes) for(let i=0;i<bodyNodes.length;i++) bodyNodes[i].lab.visible = skyNames;
    }
    return true;
  },

  layers(){
    return LAYERS.map(function(L){ return { key:L.key, label:L.label, on:L.on }; });
  },

  dispose(){
    if(!started) return;
    for(const k in G) killLayer(k);
    if(root && root.parent) root.parent.remove(root);
    if(_disc){ _disc.dispose(); _disc = null; }
    root = sky = null; el = null; started = false;
    planetMs = precMs = null;
  },

  /* CHANGED: the sky's data tables (see sky-data.ts), given once, after init. Layers that were asked for in the meantime are built now. */
  setSkyData(stars, constJson){
    STAR_DATA = stars; CONST_DATA = JSON.parse(constJson); skyData = true;
    for(const key of ['stars', 'constellations']){
      const ph = G[key];
      if(!ph || !ph.userData.placeholder) continue;
      const vis = ph.visible;
      killLayer(key);
      ensure(key).visible = vis;
      if(key === 'constellations') for(let i = 0; bodyNodes && i < bodyNodes.length; i++) bodyNodes[i].lab.visible = skyNames;
    }
  },
  get hasSkyData(){ return skyData; },
  ok(){ return started; },
  get elements(){ return el ? Object.assign({}, el) : null; },
  // the same analytic sky the planets layer draws, for anything else that wants it
  ephemeris(date){ return ephemeris(date || simTime); }
};
function find(key){
  for(let i=0;i<LAYERS.length;i++) if(LAYERS[i].key === key) return LAYERS[i];
  return null;
}
function layerOn(key){ const L = find(key); return !!(L && L.on); }

return OrbitViz;
}
