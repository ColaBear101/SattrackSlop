/* ============================================================================
   Orbit3D — a WebGL view of the catalogue, in the frame the physics lives in.
   The scene is ECI (true inertial): orbits are fixed loops and the Earth spins
   underneath them by Greenwich mean sidereal time. Anything that belongs to the
   ground — the track, Bangkok, the access footprint — is parented to the Earth
   so it turns with it. Sunlight is a real directional light aimed from the
   computed subsolar point, so the terminator is the actual terminator.
   Coordinates: ECEF/ECI (x,y,z) -> scene (x, z, -y), i.e. spin axis is scene Y.
   ========================================================================== */
(function (global) {
'use strict';

const RAD = Math.PI/180, DEG = 180/Math.PI, RE = 6378.137;
const U = 1/RE;                                  // scene units: 1 = Earth radius
const FOV_SEG = 144;                             // segments around the footprint

let GT, THREE, sat;
let renderer, scene, cam, earth, earthGroup, sunLight, ambient, cloudPts, cloudMat;
let orbitLine, trackLine, satDot, satHalo, contactLine, footRing, bkkPin, bkkDot, fovRing;
let labels = {}, raycaster, mouse = null, hoverIdx = -1;
let recs = [], cloudPos, cloudColor, cloudValid = [];
let trackPts = [], trackMs = [], trailSpan = null, trailLead = 8*60000;
let curPeriodS = 5400, ringMs = null, ringWall = 0;
let curEntry = null, curRec = null, follow = true, siteLock = false;
let simTime = new Date(), rate = 60, playing = true, lastFrame = 0, frameNo = 0;
let cam0 = { lon: 100, lat: 18, dist: 4.2 };     // spherical camera about the origin
let dragging = false, lastPt = null, pinch0 = 0, travel = 0, downPt = null;
let nearCull = [];                               // points too close to the camera to be useful
let onPick = null, onFollow = null, onSite = null, started = false, fovOn = true;

/* ---- small helpers -------------------------------------------------------- */
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
// Space does not have a light mode. Fixed palette, independent of the page theme.
const SPACE = {
  ocean:'#0B2033', land:'#2C4437', landline:'#496B56', grat:'#27455A', fov:'#E9F2F7',
  track:'#17A3CC', contact:'#CE801A', observer:'#E2557E', ring:'#3A4E5A',
  sunk:'#101A22', panel:'#0A1116', ink:'#E8EFF2', ink2:'#AEBFC8', muted:'#8096A1'
};
// nudge a theme token toward an earthy target: the flat map's greys read as a
// grey ball in 3D, where the eye expects a planet
function mix(hex, target, k){
  if(!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const p = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const a = p(hex), b = p(target);
  return 'rgb(' + a.map((v,i)=>Math.round(v*(1-k)+b[i]*k)).join(',') + ')';
}
const col = n => new THREE.Color(SPACE[n.replace('--','')] || tok(n));
function ecefToScene(v, s){ return new THREE.Vector3(v.x*s, v.z*s, -v.y*s); }
function llToScene(lat, lon, r){
  const a = lat*RAD, b = lon*RAD;
  return new THREE.Vector3(r*Math.cos(a)*Math.cos(b), r*Math.sin(a), -r*Math.cos(a)*Math.sin(b));
}

/* ---- the Earth's surface, drawn from the same coastlines as the flat map --- */
function earthTexture(){
  const W = 2048, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const px = lon => (lon+180)/360*W, py = lat => (90-lat)/180*H;
  g.fillStyle = SPACE.ocean; g.fillRect(0,0,W,H);
  // a touch of depth so the oceans are not a flat slab of one value
  const grad = g.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'rgba(255,255,255,.07)');
  grad.addColorStop(.5,'rgba(0,0,0,0)');
  grad.addColorStop(1,'rgba(255,255,255,.07)');
  g.fillStyle = grad; g.fillRect(0,0,W,H);
  g.beginPath();
  for(const f of GT.WORLD.features){
    const polys = f.geometry.type==='Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for(const poly of polys) for(const ring of poly){
      ring.forEach((p,i)=> i ? g.lineTo(px(p[0]),py(p[1])) : g.moveTo(px(p[0]),py(p[1])));
      g.closePath();
    }
  }
  g.fillStyle = SPACE.land; g.fill();
  g.strokeStyle = SPACE.landline; g.lineWidth = 1.8; g.stroke();
  // a faint reference cage, not a feature: at full strength it out-shouts the coastlines
  g.strokeStyle = SPACE.grat; g.lineWidth = 1; g.globalAlpha = .22; g.beginPath();
  for(let lon=-150; lon<=150; lon+=30){ g.moveTo(px(lon),0); g.lineTo(px(lon),H); }
  for(let lat=-60; lat<=60; lat+=30){ g.moveTo(0,py(lat)); g.lineTo(W,py(lat)); }
  g.stroke(); g.globalAlpha = 1;
  const t = THREE.CanvasTexture ? new THREE.CanvasTexture(c) : new THREE.Texture(c);
  t.needsUpdate = true;
  // An equirectangular map converges every texel row to a point at the poles, so
  // the texture is sampled along a hugely stretched footprint there. Without
  // anisotropic filtering that reads as smeared polar caps at any grazing angle.
  if(renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if(THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  else if(THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
  return t;
}

/* ---- sun direction in ECI, from the subsolar point ------------------------ */
function sunVec(date){
  const jd = date.getTime()/86400000 + 2440587.5, n = jd - 2451545.0;
  const L = (280.460 + 0.9856474*n) % 360;
  const g = ((357.528 + 0.9856003*n) % 360)*RAD;
  const lam = (L + 1.915*Math.sin(g) + 0.020*Math.sin(2*g))*RAD;
  const eps = 23.439*RAD;
  const dec = Math.asin(Math.sin(eps)*Math.sin(lam));
  const ra  = Math.atan2(Math.cos(eps)*Math.sin(lam), Math.cos(lam));
  // ECI unit vector -> scene axes
  const x = Math.cos(dec)*Math.cos(ra), y = Math.cos(dec)*Math.sin(ra), z = Math.sin(dec);
  return new THREE.Vector3(x, z, -y);
}

/* ---- build ---------------------------------------------------------------- */
function build(canvas){
  renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, 2));
  // r128 renders linear by default; without this the globe comes out washed out
  if(THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(42, 2, 0.01, 2000);

  ambient = new THREE.AmbientLight(0xffffff, 0.22); scene.add(ambient);
  sunLight = new THREE.DirectionalLight(0xfff6e8, 1.25); scene.add(sunLight);

  earthGroup = new THREE.Group(); scene.add(earthGroup);
  earth = new THREE.Mesh(
    // more rings toward the poles: at 64 height segments the polar triangle fan
    // is coarse enough to visibly kink the coastline of Antarctica
    new THREE.SphereGeometry(1, 160, 96),
    new THREE.MeshPhongMaterial({map: earthTexture(), shininess: 6, specular: 0x0a1014})
  );
  earthGroup.add(earth);

  // rim of atmosphere: a back-faced shell brightened at grazing angles
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.022, 64, 48),
    new THREE.ShaderMaterial({
      transparent:true, side:THREE.BackSide, depthWrite:false, blending:THREE.AdditiveBlending,
      uniforms:{ tint:{value: new THREE.Color(0x3fa9d8)} },
      vertexShader:'varying vec3 vN; varying vec3 vP;'+
        'void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.);'+
        'vP=mv.xyz; gl_Position=projectionMatrix*mv; }',
      fragmentShader:'uniform vec3 tint; varying vec3 vN; varying vec3 vP;'+
        'void main(){ float f=pow(clamp(1.0-abs(dot(normalize(vN),normalize(-vP))),0.,1.),2.6);'+
        'gl_FragColor=vec4(tint,f*0.85); }'
    }));
  scene.add(atmo);

  starfield();

  // ground-bound overlays ride the Earth
  trackLine = mkLine(0, '--track', 1);
  trackLine.material.opacity = 0.30;
  earthGroup.add(trackLine);
  footRing = new THREE.Line(new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({color: col('--observer'), dashSize:.035, gapSize:.028}));
  earthGroup.add(footRing);

  // What the spacecraft can see right now: the ground it holds above 5 degrees.
  // Pale rather than another hue - the three data colours are already as far
  // apart as they can get under deuteranopia, so a fourth channel is lightness.
  const fovGeo = new THREE.BufferGeometry();
  fovGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((FOV_SEG+1)*3), 3));
  fovRing = new THREE.Line(fovGeo, new THREE.LineBasicMaterial({
    color: new THREE.Color(SPACE.fov), transparent:true, opacity:.72 }));
  earthGroup.add(fovRing);
  bkkPin = new THREE.Group(); earthGroup.add(bkkPin);
  const pinTop = llToScene(GT.OBS.lat, GT.OBS.lon, 1.075);
  bkkPin.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([llToScene(GT.OBS.lat, GT.OBS.lon, 1.001), pinTop]),
    new THREE.LineBasicMaterial({color: col('--observer')})));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10),
    new THREE.MeshBasicMaterial({color: col('--observer')}));
  dot.position.copy(pinTop); bkkPin.add(dot); bkkDot = dot;

  // inertial overlays
  orbitLine = mkLine(0, '--contact', 2); scene.add(orbitLine);
  contactLine = mkLine(2, '--contact', 1); scene.add(contactLine);
  satDot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 12),
    new THREE.MeshBasicMaterial({color: col('--contact')}));
  scene.add(satDot);
  satHalo = new THREE.Mesh(new THREE.RingGeometry(0.030, 0.037, 28),
    new THREE.MeshBasicMaterial({color: col('--contact'), transparent:true, opacity:.65,
                                 side:THREE.DoubleSide, depthWrite:false}));
  scene.add(satHalo);

  buildCloud();
  raycaster = new THREE.Raycaster();
  if(raycaster.params.Points) raycaster.params.Points.threshold = 0.028;
  bindInput(canvas);
}
function mkLine(n, tokenName, width){
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(n,2)*3), 3));
  return new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: col(tokenName), transparent:true, opacity: width>1?.95:.75 }));
}
function starfield(){
  const N = 2600, p = new Float32Array(N*3);
  for(let i=0;i<N;i++){
    const u = Math.random()*2-1, th = Math.random()*Math.PI*2, r = 120 + Math.random()*60;
    const s = Math.sqrt(1-u*u);
    p[i*3] = r*s*Math.cos(th); p[i*3+1] = r*u; p[i*3+2] = r*s*Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p,3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xdbe6ee, size: 0.55, sizeAttenuation:false, transparent:true, opacity:.55 })));
}

// untextured points rasterise as hard squares, which is the single loudest
// 'this is a WebGL demo' tell
function discTexture(){
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S/2,S/2,0, S/2,S/2,S/2);
  gr.addColorStop(0,'rgba(255,255,255,1)');
  gr.addColorStop(.5,'rgba(255,255,255,.95)');
  gr.addColorStop(.78,'rgba(255,255,255,.35)');
  gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(S/2,S/2,S/2,0,7); g.fill();
  return new THREE.CanvasTexture(c);
}

/* ---- the whole catalogue as a point cloud --------------------------------- */
function buildCloud(){
  recs = GT.CAT.map(c => { try { const r = sat.twoline2satrec(c.l1, c.l2);
    return (r && !r.error) ? r : null; } catch(e){ return null; } });
  const n = recs.length;
  cloudPos = new Float32Array(n*3);
  cloudColor = new Float32Array(n*3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(cloudPos,3));
  g.setAttribute('color', new THREE.BufferAttribute(cloudColor,3));
  cloudMat = new THREE.PointsMaterial({ size: 0.030, vertexColors:true, map: discTexture(),
    transparent:true, opacity:.92, depthWrite:false, sizeAttenuation:true });
  cloudPts = new THREE.Points(g, cloudMat);
  cloudPts.frustumCulled = false;
  scene.add(cloudPts);
}
function updateCloud(date){
  const base = col('--track'), hot = col('--contact');
  const gmst = sat.gstime(date);
  // A satellite that happens to sit between the eye and the Earth renders as a
  // huge blob across the view - a high orbit at low zoom does this constantly.
  // Fade anything that close, and take it out of the pick list while faded.
  const camPos = cam.position, camR = camPos.length();
  const cullR = Math.max(0.40, 0.30*camR);
  for(let i=0;i<recs.length;i++){
    const r = recs[i]; let ok = false;
    if(r){
      let pv = null;
      try { pv = sat.propagate(r, date); } catch(e){ pv = null; }
      if(pv && pv.position && isFinite(pv.position.x)){
        cloudPos[i*3]   = pv.position.x*U;
        cloudPos[i*3+1] = pv.position.z*U;
        cloudPos[i*3+2] = -pv.position.y*U;
        ok = true;
      }
    }
    if(!ok){ cloudPos[i*3] = cloudPos[i*3+1] = cloudPos[i*3+2] = 1e6; }
    cloudValid[i] = ok;
    const c = (curEntry && GT.CAT[i] === curEntry) ? hot : base;
    const dim = (curEntry && GT.CAT[i] === curEntry) ? 1 : (i===hoverIdx ? 1 : .55);
    let culled = false;
    if(ok){
      const dxc = cloudPos[i*3]-camPos.x, dyc = cloudPos[i*3+1]-camPos.y, dzc = cloudPos[i*3+2]-camPos.z;
      if(dxc*dxc + dyc*dyc + dzc*dzc < cullR*cullR){
        // PointsMaterial carries no per-vertex alpha, so fading the colour just
        // painted a black disc over a lit Earth. Take the point out instead.
        cloudPos[i*3] = cloudPos[i*3+1] = cloudPos[i*3+2] = 1e6;
        culled = true;
      }
    }
    nearCull[i] = culled;
    cloudColor[i*3] = c.r*dim; cloudColor[i*3+1] = c.g*dim; cloudColor[i*3+2] = c.b*dim;
  }
  cloudPts.geometry.attributes.position.needsUpdate = true;
  cloudPts.geometry.attributes.color.needsUpdate = true;
  return gmst;
}

/* ---- focused satellite: orbit loop, ground track, footprint ---------------- */
function setSat(entry, elements, win){
  curEntry = entry;
  try { curRec = sat.twoline2satrec(entry.l1, entry.l2); } catch(e){ curRec = null; }
  if(!curRec || curRec.error){
    // do not leave the last spacecraft's geometry standing under a new name
    curRec = null; trackPts = []; trackMs = []; ringMs = null;
    [orbitLine, trackLine, footRing].forEach(o=>{ if(o) o.visible = false; });
    satDot.visible = satHalo.visible = contactLine.visible = false;
    if(labels.name){ labels.name.textContent = entry.name; labels.name.style.display = 'none'; }
    return;
  }
  [orbitLine, trackLine, footRing].forEach(o=>{ if(o) o.visible = true; });
  const periodS = elements && elements.period ? elements.period : 5400;
  if(!(GT && GT.now))                              // only self-clocked scenes reset time
    simTime = new Date(elements && elements.epoch ? elements.epoch.getTime() : Date.now());
  // sample across the ANALYSIS WINDOW, not from the epoch: the clock runs
  // inside the window, and a track that does not cover it draws nothing
  // Sample a little BEFORE the window too: the clock starts at the window's
  // first instant, so without some history the trail has nothing to draw on
  // arrival. PAD covers the longest fixed trail setting.
  const PAD = 6*3600000;
  const winStartMs = (win && win.start) ? win.start
                   : (elements && elements.epoch ? elements.epoch.getTime() : simTime.getTime());
  const anchor = new Date(winStartMs - PAD);
  const spanMs = ((win && win.hours) ? win.hours*3600000 : 86400000) + PAD;

  curPeriodS = periodS;
  buildRing(simTime.getTime());

  // 24 h of sub-satellite points, sampled fine enough that a short trail still
  // reads as a curve rather than a polygon
  trackPts = []; trackMs = [];
  const steps = 5040, dtms = spanMs/steps;            // span/5040, ~20 s over a day + pad
  for(let k=0;k<=steps;k++){
    const ms = anchor.getTime() + k*dtms;
    let pv = null; try { pv = sat.propagate(curRec, new Date(ms)); } catch(e){}
    if(!pv || !pv.position) continue;
    const gd = sat.eciToGeodetic(pv.position, sat.gstime(new Date(ms)));
    trackPts.push(llToScene(gd.latitude*DEG, gd.longitude*DEG, 1.004));
    trackMs.push(ms);
  }
  trackLine.geometry.dispose();
  const cap = trackPts.length;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap*3), 3));
  g.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(cap*3), 3));
  trackLine.geometry = g;
  trackLine.material.vertexColors = true;
  trackLine.material.opacity = 1;
  trackLine.material.needsUpdate = true;
  if(trailSpan === null) trailSpan = periodS*1000;     // default: one revolution
  updateTrail(simTime.getTime());

  // 5-degree access footprint around the observer, at mean altitude
  let alt = 500;
  { let pv=null; try{ pv = sat.propagate(curRec, anchor); }catch(e){}
    if(pv && pv.position) alt = sat.eciToGeodetic(pv.position, sat.gstime(anchor)).height; }
  const eps = GT.MASK*RAD;
  const lam = Math.acos(RE*Math.cos(eps)/(RE+alt)) - eps;
  const lat1 = GT.OBS.lat*RAD, lon1 = GT.OBS.lon*RAD, fp = [];
  for(let b=0;b<=360;b+=3){
    const th = b*RAD;
    const la = Math.asin(Math.sin(lat1)*Math.cos(lam) + Math.cos(lat1)*Math.sin(lam)*Math.cos(th));
    const lo = lon1 + Math.atan2(Math.sin(th)*Math.sin(lam)*Math.cos(lat1),
                                 Math.cos(lam) - Math.sin(lat1)*Math.sin(la));
    fp.push(llToScene(la*DEG, lo*DEG, 1.006));
  }
  footRing.geometry.dispose();
  footRing.geometry = new THREE.BufferGeometry().setFromPoints(fp);
  footRing.computeLineDistances();
  if(labels.name) labels.name.textContent = entry.name;
}

function setFollowState(v){
  if(follow === v) return;
  follow = v;
  if(v && siteLock){ siteLock = false; if(onSite) onSite(false); }
  if(onFollow) onFollow(v);                      // the button must track the camera
}
// Holding a ground site needs a mode, not a one-shot aim: the scene is inertial,
// so a fixed camera longitude is a right ascension and the site rotates out of
// frame within seconds. This re-aims every frame by the current GMST.
function setSiteState(v){
  if(siteLock === v) return;
  siteLock = v;
  if(v){
    if(follow){ follow = false; if(onFollow) onFollow(false); }
    cam0.lat = GT.OBS.lat + 6;
    cam0.dist = Math.min(cam0.dist, 4.2);
  }
  if(onSite) onSite(v);
}

// One revolution centred on the given instant, in inertial space.
function buildRing(centreMs){
  if(!curRec) return;
  const N = 360, half = curPeriodS*1000/2, pts = [];
  for(let k=0;k<=N;k++){
    const t = new Date(centreMs - half + k*curPeriodS*1000/N);
    let pv = null; try { pv = sat.propagate(curRec, t); } catch(e){}
    if(pv && pv.position)
      pts.push(new THREE.Vector3(pv.position.x*U, pv.position.z*U, -pv.position.y*U));
  }
  if(!pts.length) return;
  orbitLine.geometry.dispose();
  orbitLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  ringMs = centreMs;
}

// first index whose time is >= ms (times are monotonic)
function seek(ms){
  let lo = 0, hi = trackMs.length - 1;
  if(!trackMs.length || ms <= trackMs[0]) return 0;
  if(ms >= trackMs[hi]) return hi;
  while(lo < hi){ const mid = (lo+hi) >> 1;
    if(trackMs[mid] < ms) lo = mid+1; else hi = mid; }
  return lo;
}
/* Draw only the slice of track inside the trail window, fading the tail out so
   the line reads as motion rather than as a static wire cage. */
function updateTrail(nowMs){
  if(!trackPts.length || !trackLine.geometry.attributes.color) return;
  let i0, i1;
  if(trailSpan === Infinity){ i0 = 0; i1 = trackPts.length-1; }
  else { i0 = seek(nowMs - trailSpan); i1 = seek(nowMs + trailLead); }
  const geo = trackLine.geometry;
  if(i1 <= i0){ geo.setDrawRange(0,0); return; }
  const pos = geo.attributes.position.array, col = geo.attributes.color.array;
  const c = col3(SPACE.track), span = Math.max(1, i1-i0);
  let m = 0;
  for(let i=i0;i<=i1;i++){
    const p = trackPts[i];
    pos[m*3] = p.x; pos[m*3+1] = p.y; pos[m*3+2] = p.z;
    const f = (i-i0)/span;                       // 0 at the tail, 1 at the head
    const k = trailSpan === Infinity ? 0.55 : 0.10 + 0.90*f*f;
    col[m*3] = c[0]*k; col[m*3+1] = c[1]*k; col[m*3+2] = c[2]*k;
    m++;
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
  geo.setDrawRange(0, m);
  geo.computeBoundingSphere();
}
function col3(hex){
  const c = new THREE.Color(hex); return [c.r, c.g, c.b];
}

/* The ground circle inside which the spacecraft sits above MASK degrees. The
   central angle comes straight from the geometry: cos of the Earth-centre angle
   is (Re/(Re+h))·cos(eps), less the mask itself. */
function updateFov(pv, gmst){
  if(!fovRing) return;
  if(!pv || !pv.position){ fovRing.visible = false; return; }
  const gd = sat.eciToGeodetic(pv.position, gmst);
  const lat = gd.latitude, lon = gd.longitude, h = gd.height;
  const eps = GT.MASK*RAD;
  const inner = RE*Math.cos(eps)/(RE+h);
  if(!(inner <= 1)){ fovRing.visible = false; return; }     // below the horizon everywhere
  const lam = Math.acos(inner) - eps;
  const arr = fovRing.geometry.attributes.position.array;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), cosL = Math.cos(lam), sinL = Math.sin(lam);
  for(let k=0;k<=FOV_SEG;k++){
    const th = k/FOV_SEG*Math.PI*2;
    const la = Math.asin(sinLat*cosL + cosLat*sinL*Math.cos(th));
    const lo = lon + Math.atan2(Math.sin(th)*sinL*cosLat, cosL - sinLat*Math.sin(la));
    const v = llToScene(la*DEG, lo*DEG, 1.003);
    arr[k*3] = v.x; arr[k*3+1] = v.y; arr[k*3+2] = v.z;
  }
  fovRing.geometry.attributes.position.needsUpdate = true;
  fovRing.geometry.computeBoundingSphere();
  fovRing.visible = fovOn;
}

/* ---- input ---------------------------------------------------------------- */
function bindInput(canvas){
  const pt = e => ({x: e.touches ? e.touches[0].clientX : e.clientX,
                    y: e.touches ? e.touches[0].clientY : e.clientY});
  const down = e => {
    if(e.touches && e.touches.length === 2){
      pinch0 = Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                          e.touches[0].clientY-e.touches[1].clientY);
      return;
    }
    dragging = true; lastPt = pt(e); downPt = pt(e); travel = 0;
    canvas.style.cursor = 'grabbing';
  };
  const move = e => {
    if(e.touches && e.touches.length === 2 && pinch0){
      const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                           e.touches[0].clientY-e.touches[1].clientY);
      setFollowState(false); setSiteState(false);
      cam0.dist = Math.max(1.25, Math.min(28, cam0.dist * pinch0/d));
      pinch0 = d; e.preventDefault(); return;
    }
    const p = pt(e);
    if(dragging && lastPt){
      setFollowState(false); setSiteState(false);
      cam0.lon -= (p.x-lastPt.x)*0.32;
      cam0.lat = Math.max(-88, Math.min(88, cam0.lat + (p.y-lastPt.y)*0.32));
      travel += Math.abs(p.x-lastPt.x) + Math.abs(p.y-lastPt.y);
      lastPt = p; e.preventDefault();
    } else if(!e.touches){
      const r = canvas.getBoundingClientRect();
      mouse = new THREE.Vector2(((p.x-r.left)/r.width)*2-1, -((p.y-r.top)/r.height)*2+1);
    }
  };
  const up = () => { dragging = false; lastPt = null; pinch0 = 0; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('touchstart', down, {passive:true});
  window.addEventListener('mousemove', move);
  canvas.addEventListener('touchmove', move, {passive:false});
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
  canvas.addEventListener('mouseleave', ()=>{ mouse = null; hoverIdx = -1; });
  canvas.addEventListener('wheel', e => {
    cam0.dist = Math.max(1.25, Math.min(28, cam0.dist * (1 + Math.sign(e.deltaY)*0.12)));
    e.preventDefault();
  }, {passive:false});
  // click fires after mouseup however far the pointer travelled, and hoverIdx is
  // frozen during a drag - so a rotate that began over a point would load it
  canvas.addEventListener('click', (e) => {
    if(!cloudPts || !cloudPts.visible) return;      // nothing on screen to pick
    // Measure how far the pointer actually MOVED, not the length of the path it
    // wandered: summing every delta made ordinary hand jitter look like a drag,
    // so real clicks were being thrown away.
    if(downPt){
      const dx = e.clientX - downPt.x, dy = e.clientY - downPt.y;
      if(Math.hypot(dx, dy) > 6) return;
    }
    // re-pick under the cursor rather than trusting hoverIdx, which may be stale
    const r = canvas.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,
                                -((e.clientY-r.top)/r.height)*2+1);
    raycaster.setFromCamera(m, cam);
    const hit = raycaster.intersectObject(cloudPts, false);
    for(const x of hit){
      if(cloudValid[x.index] && !nearCull[x.index]){
        if(onPick) onPick(x.index, e.clientX, e.clientY);
        return;
      }
    }
  });
}

/* ---- frame ---------------------------------------------------------------- */
function tick(ts){
  requestAnimationFrame(tick);
  const dt = lastFrame ? Math.min((ts-lastFrame)/1000, .25) : 0;
  lastFrame = ts; frameNo++;
  // the page owns sim time; the scene follows it so the globe and the flat map
  // can never drift apart
  simTime = (GT && GT.now) ? GT.now() : new Date(simTime.getTime() + dt*rate*1000);

  const canvas = renderer.domElement;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const wantDpr = Math.min(window.devicePixelRatio||1, 2);
  if(renderer.getPixelRatio() !== wantDpr) renderer.setPixelRatio(wantDpr);  // moved screens
  if(canvas.width !== Math.floor(w*renderer.getPixelRatio()) ||
     canvas.height !== Math.floor(h*renderer.getPixelRatio())){
    renderer.setSize(w, h, false);
    cam.aspect = w/Math.max(h,1); cam.updateProjectionMatrix();
  }

  // the Earth turns under the orbits
  const gmst = (frameNo % 3 === 1) ? updateCloud(simTime) : sat.gstime(simTime);
  earthGroup.rotation.y = gmst;
  sunLight.position.copy(sunVec(simTime)).multiplyScalar(50);

  const nowMs = simTime.getTime();
  updateTrail(nowMs);
  // at 3600x the clock crosses two simulated minutes every ~33 ms, so throttle
  // the rebuild on wall time too rather than spending 30 rebuilds a second
  if(curRec && (ringMs === null || (Math.abs(nowMs - ringMs) > 120000 && ts - ringWall > 120))){
    buildRing(nowMs); ringWall = ts;
  }

  // focused spacecraft
  let satPos = null, el = -90;
  if(curRec){
    let pv = null; try { pv = sat.propagate(curRec, simTime); } catch(e){}
    updateFov(pv, gmst);
    if(pv && pv.position){
      satPos = new THREE.Vector3(pv.position.x*U, pv.position.z*U, -pv.position.y*U);
      satDot.position.copy(satPos);
      satHalo.position.copy(satPos); satHalo.lookAt(cam.position);
      const look = sat.ecfToLookAngles(
        {longitude: GT.OBS.lon*RAD, latitude: GT.OBS.lat*RAD, height: GT.OBS.altKm},
        sat.eciToEcf(pv.position, gmst));
      el = look.elevation*DEG;
    }
  }
  satDot.visible = satHalo.visible = !!satPos;

  // line of sight, drawn only while the pass is actually up
  const seen = satPos && el >= GT.MASK;
  contactLine.visible = !!seen;
  if(seen){
    const b = llToScene(GT.OBS.lat, GT.OBS.lon, 1.0).applyAxisAngle(new THREE.Vector3(0,1,0), gmst);
    const arr = contactLine.geometry.attributes.position.array;
    arr[0]=b.x; arr[1]=b.y; arr[2]=b.z;
    arr[3]=satPos.x; arr[4]=satPos.y; arr[5]=satPos.z;
    contactLine.geometry.attributes.position.needsUpdate = true;
  }

  // camera
  if(siteLock){
    cam0.lon = GT.OBS.lon + gmst*DEG;             // ride the Earth's rotation
  } else if(follow && satPos){
    const r = satPos.length();
    cam0.lat = Math.asin(satPos.y/r)*DEG;
    cam0.lon = Math.atan2(-satPos.z, satPos.x)*DEG;
  }
  const la = cam0.lat*RAD, lo = cam0.lon*RAD;
  cam.position.set(cam0.dist*Math.cos(la)*Math.cos(lo),
                   cam0.dist*Math.sin(la),
                   -cam0.dist*Math.cos(la)*Math.sin(lo));
  cam.lookAt(0,0,0);

  // world-sized markers balloon as you zoom in; scale them with distance so they
  // stay roughly constant on screen
  const mk = Math.max(0.30, Math.min(2.4, cam0.dist/4.2));
  satDot.scale.setScalar(mk); satHalo.scale.setScalar(mk);
  if(bkkDot) bkkDot.scale.setScalar(mk);
  if(cloudMat) cloudMat.size = 0.030*Math.max(0.55, Math.min(1.8, mk));

  // project() below needs this frame's camera, not last frame's
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

  // hover pick against the cloud. Hidden is not the same as absent: three.js
  // will happily raycast an invisible object, which left the whole catalogue
  // clickable after the checkbox was cleared.
  if(mouse && !dragging && cloudPts.visible){
    raycaster.setFromCamera(mouse, cam);
    const hit = raycaster.intersectObject(cloudPts, false);
    let idx = -1;
    for(const x of hit){ if(cloudValid[x.index] && !nearCull[x.index]){ idx = x.index; break; } }
    if(idx !== hoverIdx){ hoverIdx = idx; canvas.style.cursor = idx>=0 ? 'pointer' : 'grab'; }
  } else if(hoverIdx !== -1 && (dragging || !cloudPts.visible)){
    hoverIdx = -1;                                  // drop a stale hover
    canvas.style.cursor = dragging ? 'grabbing' : 'grab';
  }
  paintLabels(satPos, el);
  renderer.render(scene, cam);
}

function paintLabels(satPos, el){
  const box = renderer.domElement.getBoundingClientRect();
  const place = (node, vec) => {
    if(!node) return;
    if(!vec){ node.style.display='none'; return; }
    const v = vec.clone().project(cam);
    if(v.z > 1){ node.style.display='none'; return; }
    node.style.display = 'block';
    node.style.left = ((v.x*0.5+0.5)*box.width) + 'px';
    node.style.top  = ((-v.y*0.5+0.5)*box.height) + 'px';
  };
  place(labels.name, satPos);
  if(labels.hover){
    if(hoverIdx >= 0){
      labels.hover.textContent = GT.CAT[hoverIdx].name;
      place(labels.hover, new THREE.Vector3(cloudPos[hoverIdx*3], cloudPos[hoverIdx*3+1], cloudPos[hoverIdx*3+2]));
    } else labels.hover.style.display = 'none';
  }
  if(labels.clock) labels.clock.textContent = GT.fmtUTC(simTime);
  if(labels.clockLocal) labels.clockLocal.textContent = GT.fmtLocal(simTime);
  if(labels.el){
    const up = el >= GT.MASK;
    labels.el.textContent = (el > -90 ? el.toFixed(1)+'°' : '—');
    labels.el.className = 'o3-el' + (up ? ' up' : '');
  }
}

/* ---- theme ---------------------------------------------------------------- */
function retheme(){
  /* The globe keeps its own palette - space has no light mode - so a theme flip
     needs no repaint here. Kept as a no-op so callers need not care. */
}

/* ---- public --------------------------------------------------------------- */
global.Orbit3D = {
  init(opts){
    GT = opts.gt; THREE = global.THREE; sat = opts.satellite;
    if(!THREE || !THREE.WebGLRenderer) return false;
    try {
      build(opts.canvas);
    } catch(e){ return false; }
    labels = opts.labels || {};
    onPick = opts.onPick; onFollow = opts.onFollow; onSite = opts.onSite;
    started = true;
    requestAnimationFrame(tick);
    return true;
  },
  setSat, retheme,
  get scene(){ return scene; },        // the sky layers hang off the same scene
  get time(){ return simTime; },
  set time(d){ simTime = new Date(d); },
  setRate(r){ rate = r; },
  setPlaying(p){ playing = p; },
  setFollow(f){ setFollowState(!!f); },
  get follow(){ return follow; },
  showFov(v){ fovOn = !!v; if(fovRing) fovRing.visible = fovOn; },
  get fov(){ return fovOn; },
  showCloud(v){
    if(!cloudPts) return;
    cloudPts.visible = v;
    if(!v){ hoverIdx = -1; if(labels.hover) labels.hover.style.display = 'none'; }
  },
  showTrack(v){ if(trackLine) trackLine.visible = v; },
  // the scene is inertial, so a fixed camera longitude is a right ascension and
  // drifts across the ground as the clock runs. Aim at where Bangkok actually is.
  setSite(v){ setSiteState(!!v); },
  setTrail(ms){                                   // a number of ms, or Infinity
    trailSpan = ms;
    if(trackPts.length) updateTrail(simTime.getTime());
  },
  get trail(){ return trailSpan; },
  get site(){ return siteLock; },
  freeCam(){ setFollowState(false); setSiteState(false); },
  ok(){ return started; }
};
})(window);
