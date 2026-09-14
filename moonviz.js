/* ============================================================================
   MoonViz — the Earth–Moon system drawn in the frame the geometry lives in.

   The scene is geocentric equatorial (ECI, mean of date): the Earth sits at the
   origin with its spin axis up, and the Moon walks around it. Nothing here is
   in the rotating frame — which is exactly the point the page is making, since
   the Lagrange points only stand still in a frame that turns with the Moon.
   Positions arrive from lunar.js in kilometres; the scene's unit of length is
   one Earth radius, so the Moon lives at ~60 units and the numbers on screen
   stay the ones an orbit person would recognise.
   Coordinates: ECI (x,y,z) -> scene (x, z, -y), i.e. the spin axis is scene Y.

   Space has no light mode, so the palette is fixed — but it is read from CSS
   custom properties that carry the same value in both themes, so the legend
   chips in the page chrome and the marks in the scene can never drift apart.
   ========================================================================== */
(function (global) {
'use strict';

const RE    = 6371;        // km, mean Earth radius — one scene unit
const RMOON = 1737.4;      // km, mean lunar radius
const MAXTRACE = 2400;     // vertices reserved for the orbit trace, once

let THREE, LUN;
let renderer, scene, cam, canvas, layer;
let earthGrp, earth, moon, sunLight, ambient;
let traceLine, tracePos, traceCol, traceGeom;
let axisLine, triGeom, triLine, sunLine, grid;
let marks = {}, labels = {};

let bodyK = 1;                       // 1 = true scale; >1 exaggerates bodies only
let traceDays = 27.321661;           // one sidereal month by default
let traceDirty = true, traceAtMs = 0, traceWall = 0;
/* Elevation is measured from the EQUATOR, but what must not be viewed edge-on is
   the Moon's ORBIT, and that is inclined 18.3-28.6 deg to the equator depending
   on where the nodes have regressed to. At lat 24 the camera could sit within a
   degree of the orbit plane: the orbit collapsed to a line and L4/L5 appeared
   collinear with L1/L2/L3, which is the one thing this view exists to disprove.
   At 58 the camera stays 37-83 deg off the plane for every azimuth and phase. */
let cam0 = { lon: -58, lat: 58, dist: 185 };
let autoFit = true, dragging = false, lastPt = null, pinch0 = 0;
let layers = { lpts: true, tri: true, sun: true, grid: true };
let started = false;

/* ---- helpers -------------------------------------------------------------- */
const css = (n, fb) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return v || fb;
};
const C = (n, fb) => new THREE.Color(css(n, fb));
// km (ECI) -> scene units, spin axis up
function v3(p){ return new THREE.Vector3(p.x/RE, p.z/RE, -p.y/RE); }

/* Greenwich mean sidereal time, IAU 1982, treating UTC as UT1. The Earth's
   orientation is a depth cue on this page, not data. */
function gmst(date){
  const jd = date.getTime()/86400000 + 2440587.5;
  const d  = jd - 2451545.0, T = d/36525;
  let g = 280.46061837 + 360.98564736629*d + 0.000387933*T*T - T*T*T/38710000;
  g = ((g % 360) + 360) % 360;
  return g*Math.PI/180;
}

/* ---- textures ------------------------------------------------------------- */
/* No coastlines: this page owns no map data, and an invented continent would be
   a lie in a document about honest geometry. A graticule says "planet, and this
   way up" without claiming to say where anything is. */
function earthTexture(){
  const W = 1024, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const px = lon => (lon+180)/360*W, py = lat => (90-lat)/180*H;
  g.fillStyle = css('--sc-earth','#16374E'); g.fillRect(0,0,W,H);
  const grad = g.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'rgba(255,255,255,.10)');
  grad.addColorStop(.5,'rgba(0,0,0,0)');
  grad.addColorStop(1,'rgba(255,255,255,.10)');
  g.fillStyle = grad; g.fillRect(0,0,W,H);
  g.strokeStyle = css('--sc-grat','#2C5670');
  g.lineWidth = 1; g.globalAlpha = .55; g.beginPath();
  for(let lon=-180; lon<=180; lon+=15){ g.moveTo(px(lon),0); g.lineTo(px(lon),H); }
  for(let lat=-75; lat<=75; lat+=15){ g.moveTo(0,py(lat)); g.lineTo(W,py(lat)); }
  g.stroke();
  g.globalAlpha = 1; g.lineWidth = 2.4; g.beginPath();
  g.moveTo(0,py(0)); g.lineTo(W,py(0));                 // equator
  g.moveTo(px(0),0); g.lineTo(px(0),H);                 // prime meridian
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  if(renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

/* a ring with a dot in it: reads as "a place", not as "a thing" */
function markTexture(){
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 4;
  g.beginPath(); g.arc(S/2, S/2, S/2-6, 0, Math.PI*2); g.stroke();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(S/2, S/2, 6, 0, Math.PI*2); g.fill();
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

function makeMark(tokName, fb, size){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const m = new THREE.PointsMaterial({
    color: C(tokName, fb), size: size, sizeAttenuation: false,
    map: markTexture(), transparent: true, depthTest: false, depthWrite: false
  });
  const p = new THREE.Points(g, m);
  p.renderOrder = 10; p.frustumCulled = false;
  scene.add(p);
  return p;
}
function setMark(p, vec){
  p.geometry.attributes.position.setXYZ(0, vec.x, vec.y, vec.z);
  p.geometry.attributes.position.needsUpdate = true;
}

/* ---- build ---------------------------------------------------------------- */
function build(cv){
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, 2));
  if(THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(40, 2, 0.05, 4000);

  ambient = new THREE.AmbientLight(0xffffff, 0.16); scene.add(ambient);
  sunLight = new THREE.DirectionalLight(0xfff4e4, 1.30); scene.add(sunLight);

  earthGrp = new THREE.Group(); scene.add(earthGrp);
  earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 64),
    new THREE.MeshPhongMaterial({ map: earthTexture(), shininess: 5, specular: 0x0a141c })
  );
  earthGrp.add(earth);

  moon = new THREE.Mesh(
    new THREE.SphereGeometry(RMOON/RE, 48, 32),
    new THREE.MeshPhongMaterial({ color: C('--sc-moonbody','#8E979C'), shininess: 2 })
  );
  scene.add(moon);

  /* the equatorial plane, as a depth cue only: rings every 15 Earth radii out
     to 75, so the eye can tell "above the plane" from "behind it" */
  const gpos = [];
  for(const r of [15,30,45,60,75]){
    const N = 180;
    for(let i=0;i<N;i++){
      const a0 = i/N*2*Math.PI, a1 = (i+1)/N*2*Math.PI;
      gpos.push(r*Math.cos(a0), 0, r*Math.sin(a0), r*Math.cos(a1), 0, r*Math.sin(a1));
    }
  }
  for(let d=0; d<360; d+=30){
    const a = d*Math.PI/180;
    gpos.push(6*Math.cos(a), 0, 6*Math.sin(a), 78*Math.cos(a), 0, 78*Math.sin(a));
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
  grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({
    color: C('--sc-grid','#1E3440'), transparent: true, opacity: .9 }));
  scene.add(grid);

  /* the orbit trace: one buffer, reserved once, redrawn by moving vertices */
  traceGeom = new THREE.BufferGeometry();
  tracePos = new Float32Array(MAXTRACE*3);
  traceCol = new Float32Array(MAXTRACE*3);
  traceGeom.setAttribute('position', new THREE.BufferAttribute(tracePos, 3));
  traceGeom.setAttribute('color', new THREE.BufferAttribute(traceCol, 3));
  traceGeom.setDrawRange(0, 0);
  traceLine = new THREE.Line(traceGeom, new THREE.LineBasicMaterial({ vertexColors: true }));
  traceLine.frustumCulled = false;
  scene.add(traceLine);

  /* the collinear axis: L3 — Earth — barycentre — L1 — Moon — L2, one straight
     line, drawn through the Earth because that is where the barycentre is */
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  axisLine = new THREE.Line(ag, new THREE.LineBasicMaterial({
    color: C('--sc-line','#61798A'), transparent: true, opacity: .85, depthTest: false }));
  axisLine.renderOrder = 5; axisLine.frustumCulled = false;
  scene.add(axisLine);

  /* the two equilateral triangles, Earth–Moon–L4 and Earth–Moon–L5 */
  triGeom = new THREE.BufferGeometry();
  triGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8*3), 3));
  triLine = new THREE.LineSegments(triGeom, new THREE.LineBasicMaterial({
    color: C('--sc-stable','#45B98A'), transparent: true, opacity: .38 }));
  triLine.frustumCulled = false;
  scene.add(triLine);

  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  sunLine = new THREE.Line(sg, new THREE.LineBasicMaterial({
    color: C('--sc-sun','#C9A227'), transparent: true, opacity: .6 }));
  sunLine.frustumCulled = false;
  scene.add(sunLine);

  marks.bary = makeMark('--sc-bary', '#E2557E', 13);
  marks.moon = makeMark('--sc-moonmark', '#D8DEE2', 11);
  for(const k of ['L1','L2','L3'])  marks[k] = makeMark('--sc-unstable','#E08A2E', 13);
  for(const k of ['L4','L5'])       marks[k] = makeMark('--sc-stable','#45B98A', 13);

  bindCamera(cv);
}

/* ---- camera --------------------------------------------------------------- */
function pt(e){
  const t = e.touches && e.touches[0] ? e.touches[0] : e;
  return { x: t.clientX, y: t.clientY };
}
function bindCamera(cv){
  const down = e => {
    if(e.touches && e.touches.length === 2){
      pinch0 = Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                          e.touches[0].clientY-e.touches[1].clientY);
      dragging = false; return;
    }
    dragging = true; lastPt = pt(e); cv.style.cursor = 'grabbing';
  };
  const move = e => {
    if(e.touches && e.touches.length === 2 && pinch0){
      const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                           e.touches[0].clientY-e.touches[1].clientY);
      if(d > 0){ zoom(pinch0/d); pinch0 = d; }
      if(e.cancelable) e.preventDefault();
      return;
    }
    if(!dragging || !lastPt) return;
    const p = pt(e);
    cam0.lon -= (p.x-lastPt.x)*0.32;
    cam0.lat = Math.max(-88, Math.min(88, cam0.lat + (p.y-lastPt.y)*0.28));
    lastPt = p;
    if(e.cancelable && e.touches) e.preventDefault();
  };
  const up = () => { dragging = false; pinch0 = 0; lastPt = null; cv.style.cursor = 'grab'; };
  cv.addEventListener('mousedown', down);
  cv.addEventListener('touchstart', down, { passive: true });
  window.addEventListener('mousemove', move);
  cv.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    zoom(Math.exp(e.deltaY*0.0012));
  }, { passive: false });
}
function zoom(k){
  autoFit = false;
  cam0.dist = Math.max(2.2, Math.min(900, cam0.dist*k));
}
/* frame the whole orbit whatever the aspect ratio is — on a 390 px phone the
   limiting direction is horizontal, on a desktop it is vertical */
function fitDist(aspect){
  const want = 74;                                  // Earth radii to keep in frame
  const vhalf = cam.fov*Math.PI/360;
  const hhalf = Math.atan(Math.tan(vhalf)*aspect);
  return want/Math.tan(Math.max(0.08, Math.min(vhalf, hhalf)));
}

/* ---- the trace ------------------------------------------------------------ */
/* Sampled from lunar.js itself rather than drawn as a conic: an ellipse would
   close, and the whole point of the long spans is that this path does not. */
function buildTrace(date){
  const n = traceDays > 40 ? MAXTRACE : 900;
  const end = date.getTime(), start = end - traceDays*86400000;
  const a = C('--sc-orbit-old','#2B5568'), b = C('--sc-orbit','#17A3CC');
  for(let i=0;i<n;i++){
    const f = i/(n-1);
    let p = null;
    try { p = LUN.moon(new Date(start + (end-start)*f)); } catch(e){ p = null; }
    const v = p ? v3(p) : new THREE.Vector3();
    tracePos[i*3] = v.x; tracePos[i*3+1] = v.y; tracePos[i*3+2] = v.z;
    const k = 0.20 + 0.80*f*f;
    traceCol[i*3]   = a.r + (b.r-a.r)*k;
    traceCol[i*3+1] = a.g + (b.g-a.g)*k;
    traceCol[i*3+2] = a.b + (b.b-a.b)*k;
  }
  traceGeom.setDrawRange(0, n);
  traceGeom.attributes.position.needsUpdate = true;
  traceGeom.attributes.color.needsUpdate = true;
  traceGeom.computeBoundingSphere();
  traceAtMs = end; traceDirty = false;
}

/* ---- labels --------------------------------------------------------------- */
function place(node, vec){
  if(!node) return;
  if(!vec){ node.style.display = 'none'; return; }
  const v = vec.clone().project(cam);
  if(v.z > 1 || v.x < -1.06 || v.x > 1.06 || v.y < -1.06 || v.y > 1.06){
    node.style.display = 'none'; return;
  }
  const box = renderer.domElement;
  node.style.display = 'block';
  /* A point may project just inside the frustum yet still leave its label text
     hanging off the edge - 'to Sun' was rendering as 'to Su'. Clamp the anchor
     so the tag stays readable; a few pixels of positional lie beats a truncated
     word. */
  const w = node.offsetWidth || 46;
  const x = (v.x*0.5+0.5)*box.clientWidth;
  node.style.left = Math.max(2, Math.min(box.clientWidth - w - 12, x)) + 'px';
  node.style.top  = ((-v.y*0.5+0.5)*box.clientHeight) + 'px';
}

/* ---- frame ---------------------------------------------------------------- */
function frame(st){
  if(!started || !st || !st.moon || !st.lag) return;
  const cv = renderer.domElement;
  const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
  const dpr = Math.min(window.devicePixelRatio||1, 2);
  if(renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
  if(cv.width !== Math.floor(w*dpr) || cv.height !== Math.floor(h*dpr)){
    renderer.setSize(w, h, false);
    cam.aspect = w/h; cam.updateProjectionMatrix();
  }
  if(autoFit) cam0.dist = fitDist(cam.aspect);

  const t = st.date;
  earthGrp.rotation.y = gmst(t);
  earth.scale.setScalar(bodyK);
  moon.scale.setScalar(bodyK);

  const mv = v3(st.moon);
  moon.position.copy(mv);

  if(st.sun){
    const sv = v3(st.sun).normalize();
    sunLight.position.copy(sv).multiplyScalar(4000);
    const sp = sunLine.geometry.attributes.position;
    sp.setXYZ(0, sv.x*8, sv.y*8, sv.z*8);
    sp.setXYZ(1, sv.x*96, sv.y*96, sv.z*96);
    sp.needsUpdate = true;
    sunLine.visible = layers.sun;
  }

  const L = st.lag;
  const bv = v3(L.bary), l1 = v3(L.L1), l2 = v3(L.L2), l3 = v3(L.L3),
        l4 = v3(L.L4), l5 = v3(L.L5);

  setMark(marks.bary, bv);
  setMark(marks.moon, mv);
  setMark(marks.L1, l1); setMark(marks.L2, l2); setMark(marks.L3, l3);
  setMark(marks.L4, l4); setMark(marks.L5, l5);
  for(const k of ['L1','L2','L3','L4','L5']) marks[k].visible = layers.lpts;

  const ap = axisLine.geometry.attributes.position;
  ap.setXYZ(0, l3.x, l3.y, l3.z); ap.setXYZ(1, l2.x, l2.y, l2.z);
  ap.needsUpdate = true;

  const tp = triGeom.attributes.position;
  const seg = (i, A, B) => { tp.setXYZ(i*2, A.x,A.y,A.z); tp.setXYZ(i*2+1, B.x,B.y,B.z); };
  const O = new THREE.Vector3(0,0,0);
  seg(0, O, l4); seg(1, l4, mv); seg(2, O, l5); seg(3, l5, mv);
  tp.needsUpdate = true;
  triLine.visible = layers.tri && layers.lpts;
  grid.visible = layers.grid;

  // rebuilding the trace is the expensive thing on this page, so it is bounded
  // both by how far the clock has moved and by wall time
  const step = traceDays*86400000/1200, now = performance.now();
  if((traceDirty || Math.abs(t.getTime()-traceAtMs) > step) && now-traceWall > 140){
    buildTrace(t); traceWall = now;
  }

  const rad = cam0.lat*Math.PI/180, lon = cam0.lon*Math.PI/180;
  cam.position.set(
    cam0.dist*Math.cos(rad)*Math.cos(lon),
    cam0.dist*Math.sin(rad),
    cam0.dist*Math.cos(rad)*Math.sin(lon));
  cam.lookAt(0,0,0);
  cam.updateMatrixWorld();

  place(labels.earth, new THREE.Vector3(0, bodyK*1.04, 0));
  place(labels.moon, mv);
  place(labels.bary, bv);
  place(labels.L1, layers.lpts ? l1 : null);
  place(labels.L2, layers.lpts ? l2 : null);
  place(labels.L3, layers.lpts ? l3 : null);
  place(labels.L4, layers.lpts ? l4 : null);
  place(labels.L5, layers.lpts ? l5 : null);
  if(st.sun) place(labels.sun, layers.sun ? v3(st.sun).normalize().multiplyScalar(96) : null);

  renderer.render(scene, cam);
}

/* ---- public --------------------------------------------------------------- */
global.MoonViz = {
  init(opts){
    THREE = global.THREE; LUN = opts.lunar;
    if(!THREE || !THREE.WebGLRenderer || !LUN) return false;
    // a context can fail to come up on perfectly modern hardware (blocklists,
    // headless, a lost GPU) — that is a normal outcome here, not an error
    try {
      build(opts.canvas);
      if(!renderer.getContext()) return false;
    } catch(e){ return false; }
    canvas = opts.canvas; layer = opts.layer; labels = opts.labels || {};
    canvas.style.cursor = 'grab';
    started = true;
    return true;
  },
  frame,
  get ok(){ return started; },
  setBodyScale(k){ bodyK = Math.max(1, k||1); },
  setTrace(days){ traceDays = days; traceDirty = true; },
  setLayer(name, on){ if(name in layers) layers[name] = !!on; },
  resetView(){ cam0.lon = -58; cam0.lat = 58; autoFit = true; },
  /* the scene's palette is theme-independent by design; kept so callers need
     not know that */
  retheme(){}
};

})(window);
