/* moon3d.js — the Moon, in three dimensions.
 *
 * A deliberate difference from earth/orbit3d.js, which draws the Earth in the
 * INERTIAL frame and spins the planet underneath a fixed orbit. Here the scene
 * is BODY-FIXED: the Moon stands still and the orbit sweeps around it.
 *
 * That is the right choice for this body rather than a shortcut. The Moon is
 * tidally locked, so its near side permanently faces the Earth; holding it
 * still is how anyone actually pictures it, and it keeps the near/far side —
 * the thing that decides whether a lander can call home — fixed on screen
 * instead of rotating away. The cost is that the orbit plane visibly turns over
 * a month, which is true and worth seeing.
 *
 * Scene unit is ONE LUNAR RADIUS, so every geometry literal below reads as a
 * multiple of 1737.4 km.
 *
 * Everything is handed in already computed. This module owns the scene and
 * nothing else: no ephemeris, no rotation model, no element sets.
 */
(function(global){
'use strict';

const RAD = Math.PI/180;
let THREE, renderer, scene, cam, canvas, layer, labels = {};
let moonGroup, moonMesh, sunLight, ambient;
let trackLine, orbitLine, satDot, satHalo, earthLine, subEarthRing;
let sitePins = [], siteLabels = [];
let started = false, texState = 'procedural';
let cam0 = { lon: 20, lat: 24, dist: 3.6 }, dragging = false, lastPt = null;

/* Fixed palette. Space has no light mode, exactly as the Earth globe decided. */
const C = {
  bg: 0x05090C, mare: '#3A3E44', highland: '#9A9DA1', rim: '#C6C9CC',
  track: 0x17A3CC, orbit: 0x7FD3E8, sat: 0xE8F4F9,
  site: 0xE2557E, crash: 0xCE801A, earth: 0xF0C674
};

/* body-fixed lat/lon/radius -> scene. Same axis convention as orbit3d.js:
   scene X = body X, scene Y = body Z (north), scene Z = -body Y. */
function ll(lat, lon, r){
  const a = lat*RAD, b = lon*RAD;
  return new THREE.Vector3(r*Math.cos(a)*Math.cos(b), r*Math.sin(a), -r*Math.cos(a)*Math.sin(b));
}
function vecToScene(v, s){ return new THREE.Vector3(v.x*s, v.z*s, -v.y*s); }

/* ---- the surface ---------------------------------------------------------
 * Two sources, in order of preference.
 *
 * NASA Moon Trek serves the LRO Wide Angle Camera global mosaic as WMTS tiles
 * with Access-Control-Allow-Origin: *, which is the only reason a page with no
 * backend can use real imagery at all. Level 1 is a 4x2 grid of 256 px tiles —
 * 1024x512, about 400 KB, which is the right trade for a sphere this size.
 *
 * The fallback is painted from the feature list. It is not a photograph and
 * does not pretend to be, but maria really are the dark areas and that is the
 * one thing the eye needs to orient itself.
 */
const TREK = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02'
           + '/1.0.0/default/default028mm';

function paintProcedural(g, W, H, features){
  const px = lon => (lon+180)/360*W, py = lat => (90-lat)/180*H;
  g.fillStyle = C.highland; g.fillRect(0,0,W,H);
  /* a little large-scale mottling so the highlands are not a flat slab */
  for(let i=0;i<420;i++){
    const x = Math.random()*W, y = Math.random()*H, r = 8 + Math.random()*42;
    g.fillStyle = 'rgba(0,0,0,' + (0.012 + Math.random()*0.03) + ')';
    g.beginPath(); g.ellipse(x, y, r, r*0.75, 0, 0, 7); g.fill();
  }
  for(const f of (features || [])){
    const x = px(f.lon), y = py(f.lat);
    if(f.kind === 'mare' || f.kind === 'basin'){
      const rx = f.kind === 'basin' ? 108 : 78, ry = rx*0.62;
      const grd = g.createRadialGradient(x, y, 0, x, y, rx);
      grd.addColorStop(0, C.mare); grd.addColorStop(0.7, C.mare);
      grd.addColorStop(1, 'rgba(58,62,68,0)');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill();
    } else {
      const r = 11;
      g.strokeStyle = C.rim; g.globalAlpha = .55; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
      g.fillStyle = 'rgba(0,0,0,.16)';
      g.beginPath(); g.arc(x, y, r-1.5, 0, 7); g.fill();
      g.globalAlpha = 1;
    }
  }
}

function moonTexture(features, onUpgrade){
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  paintProcedural(c.getContext('2d'), W, H, features);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;

  /* Tiles go to a SECOND canvas. Drawing a cross-origin image taints a canvas,
     and a tainted canvas throws at texture-upload time rather than here — which
     would kill the whole scene, not just the imagery. Painting somewhere else
     and testing readability first keeps the working procedural texture intact
     if anything is wrong. */
  const t = document.createElement('canvas'); t.width = W; t.height = H;
  const tg = t.getContext('2d');
  let pending = 8, failed = false;
  for(let y=0;y<2;y++) for(let x=0;x<4;x++){
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { try { tg.drawImage(img, x*256, y*256, 256, 256); } catch(e){ failed = true; }
                         if(--pending === 0) finish(); };
    img.onerror = () => { failed = true; if(--pending === 0) finish(); };
    img.src = TREK + '/1/' + y + '/' + x + '.jpg';
  }
  function finish(){
    if(failed) return;
    try {
      t.getContext('2d').getImageData(0, 0, 1, 1);   // throws if tainted
    } catch(e){ return; }
    const real = new THREE.CanvasTexture(t);
    real.needsUpdate = true;
    if(renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
      real.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    if(moonMesh){ moonMesh.material.map = real; moonMesh.material.needsUpdate = true; }
    texState = 'LRO WAC mosaic';
    if(onUpgrade) onUpgrade(texState);
  }
  if(renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
    tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

/* ---- build --------------------------------------------------------------- */
function build(cv, features, onUpgrade){
  renderer = new THREE.WebGLRenderer({canvas: cv, antialias: true, alpha: false});
  renderer.setClearColor(C.bg, 1);
  if(THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(40, 2, 0.005, 500);

  /* Low ambient on purpose: the lunar night is genuinely black, and washing it
     out with fill light would hide the terminator, which is half the point. */
  ambient = new THREE.AmbientLight(0xffffff, 0.10); scene.add(ambient);
  sunLight = new THREE.DirectionalLight(0xfff4e2, 1.45); scene.add(sunLight);

  moonGroup = new THREE.Group(); scene.add(moonGroup);
  moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 96),
    new THREE.MeshPhongMaterial({ map: moonTexture(features, onUpgrade),
      shininess: 2, specular: 0x050505 })
  );
  moonGroup.add(moonMesh);

  const mk = (color, n, width, opacity) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n*3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: opacity === undefined ? 1 : opacity,
      linewidth: width || 1 }));
    l.frustumCulled = false; return l;
  };
  trackLine = mk(C.track, 900, 2);        moonGroup.add(trackLine);
  orbitLine = mk(C.orbit, 400, 1, .75);   moonGroup.add(orbitLine);
  earthLine = mk(C.earth, 2, 1, .8);      moonGroup.add(earthLine);

  satDot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12),
    new THREE.MeshBasicMaterial({color: C.sat}));
  moonGroup.add(satDot);
  satHalo = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.042, 28),
    new THREE.MeshBasicMaterial({color: C.sat, transparent: true, opacity: .5,
      side: THREE.DoubleSide}));
  moonGroup.add(satHalo);

  subEarthRing = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 32),
    new THREE.MeshBasicMaterial({color: C.earth, transparent: true, opacity: .9,
      side: THREE.DoubleSide}));
  moonGroup.add(subEarthRing);

  /* a faint cage, so rotation is readable even over blank highland */
  const cage = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.SphereGeometry(1.0005, 24, 12)),
    new THREE.LineBasicMaterial({color: 0x2A343B, transparent: true, opacity: .30}));
  moonGroup.add(cage);

  bindInput(cv);
}

function setSites(sites){
  sitePins.forEach(p => moonGroup.remove(p));
  sitePins = [];
  for(const s of sites){
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8),
      new THREE.MeshBasicMaterial({color: s.ok ? C.site : C.crash}));
    m.position.copy(ll(s.lat, s.lon, 1.006));
    m.userData = s;
    moonGroup.add(m); sitePins.push(m);
  }
}

/* ---- input --------------------------------------------------------------- */
function bindInput(cv){
  cv.style.cursor = 'grab';
  cv.addEventListener('pointerdown', e => {
    dragging = true; lastPt = {x:e.clientX, y:e.clientY};
    cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', e => {
    if(!dragging || !lastPt) return;
    cam0.lon -= (e.clientX - lastPt.x)*0.32;
    cam0.lat = Math.max(-88, Math.min(88, cam0.lat + (e.clientY - lastPt.y)*0.28));
    lastPt = {x:e.clientX, y:e.clientY};
  });
  const up = e => { dragging = false; lastPt = null; cv.style.cursor = 'grab';
    try { cv.releasePointerCapture(e.pointerId); } catch(_){} };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    cam0.dist = Math.max(1.35, Math.min(60, cam0.dist * (e.deltaY > 0 ? 1.1 : 1/1.1)));
  }, {passive:false});
}

function setLine(line, pts){
  const arr = line.geometry.attributes.position.array;
  const n = Math.min(pts.length, arr.length/3);
  for(let i=0;i<n;i++){ arr[i*3]=pts[i].x; arr[i*3+1]=pts[i].y; arr[i*3+2]=pts[i].z; }
  /* collapse the tail onto the last real point rather than leaving it at the
     origin, which would draw a spike through the centre of the Moon */
  for(let i=n;i<arr.length/3;i++){
    arr[i*3] = n?arr[(n-1)*3]:0; arr[i*3+1] = n?arr[(n-1)*3+1]:0; arr[i*3+2] = n?arr[(n-1)*3+2]:0;
  }
  line.geometry.attributes.position.needsUpdate = true;
  line.visible = n > 1;
}

function place(node, v){
  if(!node) return;
  if(!v){ node.style.display = 'none'; return; }
  const p = v.clone().project(cam);
  if(p.z > 1 || p.x < -1.05 || p.x > 1.05 || p.y < -1.05 || p.y > 1.05){
    node.style.display = 'none'; return;
  }
  node.style.display = 'block';
  node.style.left = ((p.x*0.5+0.5)*renderer.domElement.clientWidth) + 'px';
  node.style.top  = ((-p.y*0.5+0.5)*renderer.domElement.clientHeight) + 'px';
}

/* ---- per frame -----------------------------------------------------------
 * st = { sat:{lat,lon,alt}|null, trackPts:[{lat,lon}], orbitPts:[{lat,lon,alt}],
 *        sunDir:{x,y,z}, earthDir:{x,y,z}, subEarth:{lat,lon} }
 * all body-fixed, all already computed by the page.
 */
function frame(st){
  if(!started || !st) return;
  const cv = renderer.domElement;
  const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
  const dpr = Math.min(window.devicePixelRatio||1, 2);
  if(renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
  if(cv.width !== Math.floor(w*dpr) || cv.height !== Math.floor(h*dpr)){
    renderer.setSize(w, h, false);
    cam.aspect = w/h; cam.updateProjectionMatrix();
  }

  if(st.sunDir) sunLight.position.copy(vecToScene(st.sunDir, 1).normalize().multiplyScalar(40));

  if(st.trackPts && st.trackPts.length)
    setLine(trackLine, st.trackPts.map(p => ll(p.lat, p.lon, 1.004)));
  else trackLine.visible = false;

  if(st.orbitPts && st.orbitPts.length)
    setLine(orbitLine, st.orbitPts.map(p => ll(p.lat, p.lon, 1 + p.alt/1737.4)));
  else orbitLine.visible = false;

  const showSat = !!st.sat;
  satDot.visible = satHalo.visible = showSat;
  if(showSat){
    const v = ll(st.sat.lat, st.sat.lon, 1 + st.sat.alt/1737.4);
    satDot.position.copy(v);
    satHalo.position.copy(v);
    satHalo.lookAt(cam.position);
  }

  if(st.subEarth){
    const v = ll(st.subEarth.lat, st.subEarth.lon, 1.004);
    subEarthRing.position.copy(v);
    subEarthRing.lookAt(v.clone().multiplyScalar(2));
    subEarthRing.visible = true;
  } else subEarthRing.visible = false;

  if(st.earthDir){
    const d = vecToScene(st.earthDir, 1).normalize();
    setLine(earthLine, [d.clone().multiplyScalar(1.02), d.clone().multiplyScalar(1.9)]);
  } else earthLine.visible = false;

  const rad = cam0.lat*RAD, lon = cam0.lon*RAD;
  cam.position.set(cam0.dist*Math.cos(rad)*Math.cos(lon),
                   cam0.dist*Math.sin(rad),
                   cam0.dist*Math.cos(rad)*Math.sin(lon));
  cam.lookAt(0,0,0);
  cam.updateMatrixWorld();

  /* Labels: only the ones facing the camera. On a sphere a tag whose anchor is
     round the back would otherwise float over the near side, attached to
     nothing visible. */
  const camDir = cam.position.clone().normalize();
  for(let i=0;i<sitePins.length;i++){
    const node = siteLabels[i];
    if(!node) continue;
    const p = sitePins[i].position;
    place(node, p.clone().normalize().dot(camDir) > 0.12 ? p : null);
  }
  if(labels.sat) place(labels.sat, showSat ? satDot.position : null);
  if(labels.subEarth) place(labels.subEarth,
    (st.subEarth && subEarthRing.position.clone().normalize().dot(camDir) > 0.05)
      ? subEarthRing.position : null);

  renderer.render(scene, cam);
}

global.Moon3D = {
  init(opts){
    THREE = global.THREE;
    if(!THREE || !THREE.WebGLRenderer) return false;
    try {
      build(opts.canvas, opts.features, opts.onTexture);
      if(!renderer.getContext()) return false;
    } catch(e){ return false; }
    canvas = opts.canvas; layer = opts.layer; labels = opts.labels || {};
    started = true;
    return true;
  },
  frame,
  setSites(sites, nodes){ setSites(sites); siteLabels = nodes || []; },
  resetView(){ cam0.lon = 20; cam0.lat = 24; cam0.dist = 3.6; },
  get ok(){ return started; },
  get texture(){ return texState; }
};

})(typeof window !== 'undefined' ? window : globalThis);
