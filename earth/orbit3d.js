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

const RAD = Math.PI/180, DEG = 180/Math.PI;
/* The scene's unit is ONE BODY RADIUS, not one Earth radius. Every geometry
   literal below (sphere 1, atmosphere 1.022, track 1.004, footprint 1.006) is
   therefore already body-relative and needs no change when the body does —
   which is why this file survives the swap so cheaply. */
let BODY = null, mkTrack = null;
let RE = 6378.137;
let U = 1/RE;                                  // scene units: 1 = Earth radius
const FOV_SEG = 144;                             // segments around the footprint

let GT, THREE, sat;
let renderer, scene, cam, earth, earthGroup, sunLight, ambient, cloudPts, cloudMat;
let orbitLine, trackLine, satDot, satHalo, contactLine, footRing, bkkPin, bkkDot, fovRing;
let atmo = null, wire = null, reLine = null, reTip = null;   // the globe, and what stands in for it
let altLine = null, altTip = null;                           // surface -> spacecraft
let labels = {}, raycaster, mouse = null, hoverIdx = -1;
let recs = [], cloudPos, cloudColor, cloudValid = [];
let trackPts = [], trackMs = [], trailSpan = null, trailLead = 8*60000;
let curPeriodS = 5400, ringMs = null, ringWall = 0;
let curEntry = null, curRec = null, follow = true, siteLock = false, pov = false;
let simTime = new Date(), rate = 60, playing = true, lastFrame = 0, frameNo = 0;
let cam0 = { lon: 100, lat: 18, dist: 4.2 };     // spherical camera about the origin
/* POV is a different kind of camera. It has no distance, because it is AT the
   spacecraft; yaw and pitch are offsets from nadir, and the wheel changes the
   lens rather than the range. cam0 is deliberately never written while POV is
   on, so leaving the mode restores the free camera exactly where it was. */
let pov0 = { yaw: 0, pitch: 0, fov: 42 };
const BASE_FOV = 42;                             // what the other three modes use
let dragging = false, lastPt = null, pinch0 = 0, travel = 0, downPt = null;
let nearCull = [];                               // points too close to the camera to be useful
let onPick = null, onFollow = null, onSite = null, onPov = null, started = false, fovOn = true;
let earthOn = true;
/* R(+) and the altitude are both ELEMENT annotations - they measure the body
   and the orbit the way h and e do - so the Orbital elements layer owns the
   pair, rather than the Earth checkbox they happened to be wired to first.
   Starts off, because that layer does.
   Note it runs from the centre to the surface, so with the Earth drawn it is
   inside the globe and occluded. That is honest rather than broken: the arrow is
   where it says it is, and hiding the Earth reveals it. */
let elementsOn = false;

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
  return tuneTex(t, true);
}

/* The filtering every globe map needs, whether it was drawn here or fetched.
   An equirectangular map converges every texel row to a point at the poles, so
   the texture is sampled along a hugely stretched footprint there. Without
   anisotropic filtering that reads as smeared polar caps at any grazing angle.

   `srgb` is false for anything bound to the day/night shader: three.js only
   decodes a texture's encoding for its own materials, and that shader does its
   own gamma - marking the texture too would decode it twice. */
function tuneTex(t, srgb){
  if(renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if(srgb){
    if(THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    else if(THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
  }
  t.needsUpdate = true;
  return t;
}

/* ---- the photographic surface -------------------------------------------- *
 * One shader covers every imagery mode. It exists rather than a second
 * MeshPhongMaterial for one reason: the night side.
 *
 * City lights are not lit by anything. They are emission, and the whole point
 * is that they appear exactly where the Sun has gone - so the terminator has to
 * be found per fragment from the real solar direction and the two maps
 * crossfaded across it. No built-in material does that.
 *
 * The gamma is explicit. r128 applies its output encoding through a shader
 * chunk that only the built-in materials include, so a ShaderMaterial's
 * gl_FragColor reaches the framebuffer untouched - measured rather than
 * assumed: a constant 0.5 comes out as byte 128 with outputEncoding set either
 * way. Lighting has to happen in linear light or the terminator turns to mud,
 * so the maps are decoded on the way in and the result encoded on the way out.
 *
 * The crossfade spans about 8 degrees either side of the geometric terminator,
 * which is roughly the sky's own twilight and reads as dusk rather than a wipe. */
const DAYNIGHT_VERT = [
  'varying vec2 vUv;',
  'varying vec3 vWN;',
  'void main(){',
  '  vUv = uv;',
  /* the WORLD normal: the globe is spun by GMST on its group and the Sun
     direction is given in world space, so a view-space normal would swing the
     terminator round with the camera */
  '  vWN = normalize(mat3(modelMatrix) * normal);',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}'
].join('\n');

const DAYNIGHT_FRAG = [
  'uniform sampler2D dayMap;',
  'uniform sampler2D nightMap;',
  'uniform vec3 sunDir;',
  'uniform float useNight;',
  'uniform float ambient;',
  'uniform float nightGain;',
  'varying vec2 vUv;',
  'varying vec3 vWN;',
  'vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }',
  'void main(){',
  '  float d = dot(normalize(vWN), normalize(sunDir));',
  '  vec3 day = lin(texture2D(dayMap, vUv).rgb);',
  '  vec3 c = day * (ambient + (1.0 - ambient) * clamp(d, 0.0, 1.0));',
  '  if(useNight > 0.5){',
  '    vec3 night = lin(texture2D(nightMap, vUv).rgb) * nightGain;',
  '    c = mix(night, c, smoothstep(-0.14, 0.14, d));',
  '  }',
  '  gl_FragColor = vec4(pow(c, vec3(1.0/2.2)), 1.0);',
  '}'
].join('\n');

let vectorMat = null, photoMat = null, surfaceKey = 'vector';
let dayTex = null, nightTex = null, surfaceSeq = 0;

function photoMaterial(){
  if(photoMat) return photoMat;
  photoMat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap:   { value: null },
      nightMap: { value: null },
      sunDir:   { value: new THREE.Vector3(1, 0, 0) },
      useNight: { value: 0 },
      /* Not black on the night side even without lights: the Earth is lit by a
         whole hemisphere of sky and by the Moon, and a pure black limb reads as
         a hole cut in the starfield. */
      ambient:  { value: 0.055 },
      nightGain:{ value: 1.35 }
    },
    vertexShader: DAYNIGHT_VERT, fragmentShader: DAYNIGHT_FRAG
  });
  return photoMat;
}

/* Put a fetched surface on the globe.
   Called once per rung of the size ladder, so it has to be safe to run with the
   sphere already wearing the previous rung: the old textures are disposed as
   they are replaced, or a mode switch leaks a 4096x2048 map on the GPU every
   time. */
function applyPhoto(stage){
  const mat = photoMaterial();
  const d = tuneTex(new THREE.Texture(stage.day), false);
  if(dayTex) dayTex.dispose();
  dayTex = d; mat.uniforms.dayMap.value = d;
  if(stage.night){
    if(!nightTex || nightTex.image !== stage.night){
      const nt = tuneTex(new THREE.Texture(stage.night), false);
      if(nightTex) nightTex.dispose();
      nightTex = nt;
    }
    mat.uniforms.nightMap.value = nightTex;
    mat.uniforms.useNight.value = 1;
  } else {
    /* A sampler with nothing bound is undefined behaviour on some drivers even
       when the branch that reads it is never taken, so it keeps pointing at the
       day map rather than at null. */
    mat.uniforms.nightMap.value = d;
    mat.uniforms.useNight.value = 0;
  }
  if(earth) earth.material = mat;
}

/* setSurface(key, onStatus)
   onStatus gets {state, key, meta, detail} - 'loading', then 'ready' per rung,
   or 'failed'. The page owns the wording; this owns the sequence.

   Every callback is stamped with the request that started it and dropped if a
   later one has begun, because these take seconds and a reader flicking through
   the list will otherwise have the slow first choice land on top of the fast
   second one. */
function setSurface(key, onStatus){
  const seq = ++surfaceSeq;
  const say = (state, detail, meta) => {
    if(seq === surfaceSeq && onStatus) onStatus({ state, key, detail, meta });
  };
  surfaceKey = key;
  if(key === 'vector' || !global.GlobeTex){
    if(earth && vectorMat) earth.material = vectorMat;
    say('ready', null, null);
    return;
  }
  say('loading', null, null);
  /* The GPU's own ceiling, passed down so the ladder stops there. 8192 on a
     software renderer, 16384 on a discrete card, as low as 4096 on some
     phones - and a texture past it is not a sharper globe, it is a failed
     upload after the bytes have already been paid for. */
  const cap = (renderer && renderer.capabilities && renderer.capabilities.maxTextureSize) || 0;
  global.GlobeTex.load(key, stage => {
    if(seq !== surfaceSeq) return;            // superseded while in flight
    applyPhoto(stage);
    say('ready', stage.w + '×' + stage.h + (stage.last ? '' : ', sharpening…'), stage.meta);
  }, null, cap).catch(err => {
    /* Falling back rather than leaving a half-dressed globe: whatever went
       wrong, the vector surface always works and the reader is told which one
       they are looking at. */
    if(seq !== surfaceSeq) return;
    surfaceKey = 'vector';
    if(earth && vectorMat) earth.material = vectorMat;
    say('failed', (err && err.message) || 'imagery unavailable', null);
  });
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
  /* Kept so a photographic surface can be taken off again without rebuilding
     the coastline canvas, and so a failed fetch has something to fall back to. */
  vectorMat = earth.material;
  earthGroup.add(earth);

  // rim of atmosphere: a back-faced shell brightened at grazing angles
  atmo = new THREE.Mesh(new THREE.SphereGeometry(1.022, 64, 48),
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

  /* With the globe hidden the orbit has nothing to be relative to, so leave a
     wire sphere behind for scale and attitude. It rides the Earth group, so it
     still turns with the planet. */
  wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 16, 8)),
    new THREE.LineBasicMaterial({ color: new THREE.Color(SPACE.grat),
      transparent:true, opacity:.24 }));
  wire.visible = false;
  earthGroup.add(wire);

  // R(+) : from the centre out to the surface, along the radius vector, so the
  // gap between its tip and the spacecraft is the altitude
  const reGeo = new THREE.BufferGeometry();
  reGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  reLine = new THREE.Line(reGeo, new THREE.LineBasicMaterial({
    color: new THREE.Color(SPACE.ink), transparent:true, opacity:.9 }));
  reTip = new THREE.Mesh(new THREE.ConeGeometry(0.030, 0.072, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(SPACE.ink) }));
  reLine.visible = reTip.visible = false;
  scene.add(reLine); scene.add(reTip);

  // the remainder of r: from the surface to the spacecraft. Drawn in the track
  // colour because altitude is the quantity the ground track is a shadow of.
  const altGeo = new THREE.BufferGeometry();
  altGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  altLine = new THREE.Line(altGeo, new THREE.LineBasicMaterial({
    color: new THREE.Color(SPACE.track), transparent:true, opacity:.95 }));
  altTip = new THREE.Mesh(new THREE.ConeGeometry(0.030, 0.072, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(SPACE.track) }));
  altLine.visible = altTip.visible = false;
  scene.add(altLine); scene.add(altTip);


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
  bkkPin.add(new THREE.Line(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({color: col('--observer')})));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10),
    new THREE.MeshBasicMaterial({color: col('--observer')}));
  bkkPin.add(dot); bkkDot = dot;
  placeSite();

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
/* There was a starfield here: 2600 points at random on a shell. It was
   decoration pretending to be sky - the constellations were wrong because there
   were none, and in POV mode you could look up at a sky that does not exist.
   orbitviz.js already carries the real one, 2865 HYG catalogue stars at their
   actual right ascension and declination, so the invented one is deleted rather
   than kept as a fallback. The real layer is now on by default.  */

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
  /* One Track per catalogue object. The cloud does not care what propagates
     them, only that each answers at(ms) — so a mixed catalogue of Earth TLEs
     and lunar element sets would work here unchanged. */
  recs = GT.CAT.map(c => { try { const t = mkTrack(c);
    return (t && t.ok) ? t : null; } catch(e){ return null; } });
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
  const gmst = BODY.spin(date);
  // A satellite that happens to sit between the eye and the Earth renders as a
  // huge blob across the view - a high orbit at low zoom does this constantly.
  // Fade anything that close, and take it out of the pick list while faded.
  const camPos = cam.position, camR = camPos.length();
  const cullR = Math.max(0.40, 0.30*camR);
  for(let i=0;i<recs.length;i++){
    const r = recs[i]; let ok = false;
    if(r){
      const st = r.at(date.getTime());
      const pv = st ? {position: st.r} : null;
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
  try { curRec = mkTrack(entry); } catch(e){ curRec = null; }
  if(!curRec || !curRec.ok){
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
    let st = curRec.at(ms); let pv = st ? {position: st.r, velocity: st.v} : null;
    if(!pv || !pv.position) continue;
    const gd = BODY.toGeodetic(pv.position, BODY.spin(new Date(ms)));
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
  { let st = curRec.at(anchor.getTime()); let pv = st ? {position: st.r} : null;
    if(pv && pv.position) alt = BODY.toGeodetic(pv.position, BODY.spin(anchor)).height; }
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

/* The site pin, as a function of the site rather than a fixed geometry. It was
   built inline from GT.OBS once at init, which is correct exactly until the
   observer moves - and the page can move it now. */
function placeSite(){
  if(!bkkPin || !bkkPin.children.length) return;
  const base = llToScene(GT.OBS.lat, GT.OBS.lon, 1.001);
  const top  = llToScene(GT.OBS.lat, GT.OBS.lon, 1.075);
  const line = bkkPin.children[0];
  if(line && line.geometry) line.geometry.setFromPoints([base, top]);
  if(bkkDot) bkkDot.position.copy(top);
}

function setFollowState(v){
  if(follow === v) return;
  follow = v;
  if(v && siteLock){ siteLock = false; if(onSite) onSite(false); }
  if(v && pov){ pov = false; if(onPov) onPov(false); }
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
    if(pov){ pov = false; if(onPov) onPov(false); }
    cam0.lat = GT.OBS.lat + 6;
    cam0.dist = Math.min(cam0.dist, 4.2);
  }
  if(onSite) onSite(v);
}

/* The other three modes are all the SAME camera: a point at cam0.dist from the
   origin, looking at the origin. They differ only in how the bearing is chosen.
   POV is not that camera - it sits on the spacecraft - so it is exclusive with
   both of the others, and it owns the drag and the wheel while it is on. */
function setPovState(v){
  if(pov === v) return;
  pov = v;
  if(v){
    if(follow){ follow = false; if(onFollow) onFollow(false); }
    if(siteLock){ siteLock = false; if(onSite) onSite(false); }
    pov0.yaw = 0; pov0.pitch = 0;                // re-entering re-centres on the track ahead
  }
  if(onPov) onPov(v);
}

/* Ground sample distance at the boresight: how much ground one rendered pixel
   covers, where the view axis actually meets the surface.

   Measured, not approximated. The obvious formula - range times the per-pixel
   angle, divided by cos(incidence) - is a derivative, and it runs away exactly
   where the geometry gets interesting: near the horizon cos(incidence) goes to
   zero and it reports a footprint the pixel does not have. So instead four
   extra rays are cast, half a pixel either side of the boresight in each screen
   axis, and the ground distance between the pairs IS the answer. Near the limb
   the outer ray simply misses the body and the readout says so, which is the
   truth: that pixel's footprint runs off past the horizon and has no size.

   The two numbers are the screen's own horizontal and vertical, which is why
   they can sit in the same reading order as the field of view above them. That
   is exact rather than convenient: the camera is yawed then pitched from a
   basis whose up IS the zenith and is never rolled, so the screen-vertical axis
   lies in the plane through the spacecraft, the boresight and the body centre -
   the incidence plane - and the screen-horizontal axis is perpendicular to it.
   Vertical therefore carries the whole of the obliquity stretch and horizontal
   carries none, which is what makes them worth printing separately: looking
   forward at a shallow angle they differ by an order of magnitude.

   Distances come from the sphere the scene actually draws. The view has no
   flattening in it - the globe is a SphereGeometry(1) - so measuring against an
   ellipsoid would describe a picture that is not on screen; the difference is
   under a third of a percent either way.

   Pixels are the drawing buffer's, not CSS pixels: those are the samples that
   exist, and on a 2x display there are twice as many of them as the layout
   suggests. */
function gsdAt(){
  const cv = renderer && renderer.domElement;
  if(!cv || !(cv.width > 0) || !(cv.height > 0)) return null;
  const ty = Math.tan(pov0.fov*RAD/2);
  const hy = ty / cv.height;                  // HALF a pixel at the image plane z = -1
  const hx = ty * cam.aspect / cv.width;
  const P = cam.position, r2 = P.lengthSq();
  if(!(r2 > 1)) return null;                  // inside the body: nothing to sample

  /* One pencil of five rays - the centre and half a pixel each way in both
     screen axes - cast about whatever direction it is given, so the boresight
     and the straight-down reference go through the same code rather than one
     being measured and the other trusted to a formula. */
  function pencil(fwd, ax, ay){
    function hit(x, y){
      const d = fwd.clone().addScaledVector(ax, x).addScaledVector(ay, y).normalize();
      const b = P.dot(d), disc = b*b - (r2 - 1);
      if(disc < 0) return null;               // the ray passes the body by
      const t = -b - Math.sqrt(disc);
      if(!(t > 0)) return null;               // the body is behind the camera
      return { p: P.clone().addScaledVector(d, t), d: d, t: t };
    }
    const c = hit(0, 0);
    if(!c) return null;
    const xp = hit(hx, 0), xm = hit(-hx, 0), yp = hit(0, hy), ym = hit(0, -hy);
    if(!xp || !xm || !yp || !ym) return null; // the pixel straddles the limb
    return { x: xp.p.distanceTo(xm.p)*RE*1000,   // metres per pixel, across the look
             y: yp.p.distanceTo(ym.p)*RE*1000,   //                   along it
             range: c.t*RE,
             inc: Math.acos(Math.max(-1, Math.min(1,
                    -c.d.dot(c.p.clone().normalize()))))*DEG };
  }

  const q = cam.quaternion;
  const camX = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const camY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const fwd  = new THREE.Vector3(0, 0, -1).applyQuaternion(q);

  /* Straight down from where the spacecraft is now, in the same lens. This is
     the figure a spec sheet quotes, and it exists whatever the camera happens
     to be pointed at - which matters because POV enters looking along-track,
     and a horizontal ray from any positive altitude never meets the sphere. A
     readout that is blank in its opening frame reads as broken, so the nadir
     value stands in and says that it has. */
  const down = P.clone().normalize().negate();
  let ny = camY.clone().addScaledVector(down, -camY.dot(down));
  if(ny.lengthSq() < 1e-12) ny = camX.clone().addScaledVector(down, -camX.dot(down));
  ny.normalize();
  const nadir = pencil(down, new THREE.Vector3().crossVectors(ny, down).normalize(), ny);

  const bore = pencil(fwd, camX, camY);
  if(!bore && !nadir) return null;
  return bore ? { x: bore.x, y: bore.y, range: bore.range, inc: bore.inc,
                  nadir: nadir ? nadir.x : null, onBody: true }
              : { x: nadir.x, y: nadir.y, range: nadir.range, inc: nadir.inc,
                  nadir: nadir.x, onBody: false };
}

/* 3 significant figures is the most this is worth: the underlying orbit is a
   TLE, and the last digit of a metre would be inventing precision. */
function gsdText(g){
  const sig = v => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  const big = Math.max(g.x, g.y), k = big >= 10000;
  const a = k ? g.x/1000 : g.x, b = k ? g.y/1000 : g.y;
  return { text: sig(a) + ' × ' + sig(b), unit: k ? 'km/px' : 'm/px' };
}

/* Aim the POV camera: looking FORWARD along the velocity vector, with zenith up.
   It used to look at nadir, and that was a mistake for one specific reason.
   Looking straight down puts the view axis on the yaw axis, so dragging
   sideways - which yaws about the local vertical - only ROLLED the image
   instead of turning the head. The camera felt stuck, because in that pose the
   horizontal drag had nowhere to send you. Facing along-track separates the two
   axes: yaw turns left and right, pitch looks up and down, and nadir is simply
   pitch -90, still one drag away.

   Rebuilt from the same basis every frame rather than accumulated onto the
   previous orientation: a long drag would otherwise walk the roll off true, and
   the error would never come back. */
function aimPov(satPos, satVel){
  const zenith = satPos.clone().normalize();
  let ahead = (satVel && satVel.lengthSq() > 1e-12)
    ? satVel.clone() : new THREE.Vector3(0, 1, 0);
  ahead.addScaledVector(zenith, -ahead.dot(zenith));    // the local-horizontal part
  if(ahead.lengthSq() < 1e-12){                         // velocity parallel to r: pick anything
    ahead.set(0, 1, 0).addScaledVector(zenith, -zenith.y);
    if(ahead.lengthSq() < 1e-12) ahead.set(1, 0, 0).addScaledVector(zenith, -zenith.x);
  }
  ahead.normalize();
  const right = new THREE.Vector3().crossVectors(ahead, zenith).normalize();
  /* three.js cameras look down their own -Z, so the basis is (right, up, back).
     back = -ahead makes the view direction +ahead: straight down the track. */
  const back = ahead.clone().negate();
  cam.position.copy(satPos);
  cam.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, zenith, back));
  cam.rotateY(pov0.yaw*RAD);
  cam.rotateX(pov0.pitch*RAD);
  if(cam.fov !== pov0.fov){ cam.fov = pov0.fov; cam.updateProjectionMatrix(); }
}

// One revolution centred on the given instant, in inertial space.
function buildRing(centreMs){
  if(!curRec) return;
  const N = 360, half = curPeriodS*1000/2, pts = [];
  for(let k=0;k<=N;k++){
    const t = new Date(centreMs - half + k*curPeriodS*1000/N);
    const st0 = curRec.at(t.getTime()); const pv = st0 ? {position: st0.r} : null;
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
  const gd = BODY.toGeodetic(pv.position, gmst);
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
      if(pov){
        pov0.fov = Math.max(8, Math.min(90, pov0.fov * pinch0/d));
      } else {
        setFollowState(false); setSiteState(false);
        cam0.dist = Math.max(1.25, Math.min(28, cam0.dist * pinch0/d));
      }
      pinch0 = d; e.preventDefault(); return;
    }
    const p = pt(e);
    if(dragging && lastPt){
      /* A drag drops the other camera modes, because moving the camera IS
         leaving them. In POV it is not: looking around is what the mode is for,
         so the drag turns the head and stays aboard. */
      if(pov){
        /* Pitch stops just short of +-90: straight down and straight up are
           gimbal poles, where yaw and roll collapse onto each other and the
           view tumbles. 89 reaches nadir for all practical purposes without
           ever standing on the singularity. */
        pov0.yaw -= (p.x-lastPt.x)*0.30;
        pov0.pitch = Math.max(-89, Math.min(89, pov0.pitch - (p.y-lastPt.y)*0.30));
      } else {
        setFollowState(false); setSiteState(false);
        cam0.lon -= (p.x-lastPt.x)*0.32;
        cam0.lat = Math.max(-88, Math.min(88, cam0.lat + (p.y-lastPt.y)*0.32));
      }
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
    /* There is no range to change from inside the spacecraft, so in POV the
       wheel is a lens instead: 8 deg is a long telephoto on the limb, 90 deg
       takes in the whole horizon. */
    if(pov) pov0.fov = Math.max(8, Math.min(90, pov0.fov * (1 + Math.sign(e.deltaY)*0.09)));
    else    cam0.dist = Math.max(1.25, Math.min(28, cam0.dist * (1 + Math.sign(e.deltaY)*0.12)));
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
  const gmst = (frameNo % 3 === 1) ? updateCloud(simTime) : BODY.spin(simTime);
  earthGroup.rotation.y = gmst;
  sunLight.position.copy(sunVec(simTime)).multiplyScalar(50);
  /* The same vector the lamp uses, unscaled, so the painted terminator and the
     lit terminator are the same line and not two answers to one question. */
  if(photoMat) photoMat.uniforms.sunDir.value.copy(sunVec(simTime));

  const nowMs = simTime.getTime();
  updateTrail(nowMs);
  // at 3600x the clock crosses two simulated minutes every ~33 ms, so throttle
  // the rebuild on wall time too rather than spending 30 rebuilds a second
  if(curRec && (ringMs === null || (Math.abs(nowMs - ringMs) > 120000 && ts - ringWall > 120))){
    buildRing(nowMs); ringWall = ts;
  }

  // focused spacecraft
  let satPos = null, satVel = null, el = -90;
  if(curRec){
    const st1 = curRec.at(simTime.getTime()); const pv = st1 ? {position: st1.r, velocity: st1.v} : null;
    updateFov(pv, gmst);
    if(pv && pv.position){
      satPos = new THREE.Vector3(pv.position.x*U, pv.position.z*U, -pv.position.y*U);
      // direction only - the POV basis normalises it - so no scale factor here
      if(pv.velocity)
        satVel = new THREE.Vector3(pv.velocity.x, pv.velocity.z, -pv.velocity.y);
      satDot.position.copy(satPos);
      satHalo.position.copy(satPos);
      // in POV the camera IS the spacecraft, so the halo has nothing to turn to
      if(!pov) satHalo.lookAt(cam.position);
      const look = BODY.lookAngles(GT.OBS, BODY.toFixed(pv.position, gmst));
      el = look.elevation*DEG;
    }
  }
  /* The marker sits exactly where the POV camera does, so drawing it fills the
     frame with the inside of a sprite. */
  satDot.visible = satHalo.visible = !!satPos && !pov;

  /* Altitude is the number people actually want, so it is drawn whenever there
     is a spacecraft - not only when the planet is hidden. R(+) still is, because
     it runs from the centre to the surface and would be buried inside the globe
     with nothing to see. */
  if(satPos){
    const dir = satPos.clone().normalize();
    const tip = dir.clone().multiplyScalar(1);
    if(elementsOn){
      const arr = reLine.geometry.attributes.position.array;
      arr[0]=0; arr[1]=0; arr[2]=0; arr[3]=tip.x; arr[4]=tip.y; arr[5]=tip.z;
      reLine.geometry.attributes.position.needsUpdate = true;
      reLine.geometry.computeBoundingSphere();
      reTip.position.copy(dir).multiplyScalar(1 - 0.036);
      reTip.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
      reLine.visible = reTip.visible = true;
      if(labels.earth) labels.earth.__vec = dir.clone().multiplyScalar(0.40);
    } else {
      reLine.visible = reTip.visible = false;
      if(labels.earth) labels.earth.__vec = null;
    }

    /* Drive the arrow's visibility from whether there IS a spacecraft. It used
       to be set in showEarth(), and when the altitude was decoupled from the
       Earth toggle those were the only two lines that ever set it TRUE - so it
       was built invisible at line 190 and stayed that way. The label kept
       updating, which is what made it look fixed. */
    altLine.visible = altTip.visible = elementsOn;
    // and the rest of the way: surface -> spacecraft is the altitude
    const arr2 = altLine.geometry.attributes.position.array;
    arr2[0]=tip.x; arr2[1]=tip.y; arr2[2]=tip.z;
    arr2[3]=satPos.x; arr2[4]=satPos.y; arr2[5]=satPos.z;
    altLine.geometry.attributes.position.needsUpdate = true;
    altLine.geometry.computeBoundingSphere();
    const rLen = satPos.length();
    altTip.position.copy(dir).multiplyScalar(Math.max(1.0, rLen - 0.036));
    altTip.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
    if(labels.alt){
      labels.alt.__vec = elementsOn ? dir.clone().multiplyScalar((1 + rLen)/2) : null;
      const km = (rLen - 1)/U;
      /* This is |r| - R(+), measured from the SPHERE that is actually drawn.
         The panel's altitude is geodetic, above the WGS-84 ellipsoid, whose
         radius at mid latitudes is ~10 km less - so the two legitimately differ
         and the label has to say which one it is. */
      const txt = '|r| − R⊕ = ' + (km >= 10000 ? Math.round(km).toLocaleString('en-US')
                                          : km.toFixed(0)) + ' km';
      if(labels.alt.textContent !== txt) labels.alt.textContent = txt;
    }
  } else {
    altLine.visible = altTip.visible = false;
    reLine.visible = reTip.visible = false;
    if(labels.earth) labels.earth.__vec = null;
    if(labels.alt) labels.alt.__vec = null;
  }


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
  if(pov && satPos){
    aimPov(satPos, satVel);
  } else {
    if(siteLock){
      cam0.lon = GT.OBS.lon + gmst*DEG;           // ride the Earth's rotation
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
    if(cam.fov !== BASE_FOV){ cam.fov = BASE_FOV; cam.updateProjectionMatrix(); }
  }
  /* The atmosphere is a back-faced additive shell at 1.022: from outside it
     draws a rim, from inside it washes the whole frame. A POV camera on
     anything below about 140 km altitude is inside it. */
  if(atmo) atmo.visible = earthOn && !(pov && cam.position.length() < 1.03);

  // world-sized markers balloon as you zoom in; scale them with distance so they
  // stay roughly constant on screen
  /* cam0.dist is the free camera's range from the origin and means nothing in
     POV, where the camera is at the spacecraft. Left as it was, the site pin and
     the 2158-point cloud would render at whatever size the free camera happened
     to be the last time it was used. */
  const camR = pov ? cam.position.length() : cam0.dist;
  const mk = Math.max(0.30, Math.min(2.4, camR/4.2));
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
  /* In POV the camera sits exactly ON satPos, so projecting that point is
     degenerate - it lands on the near plane and skitters around the frame with
     every sub-pixel of camera motion. There is also nothing to label: you are
     inside the thing. Hide it. */
  place(labels.name, pov ? null : satPos);
  place(labels.earth, labels.earth ? labels.earth.__vec : null);
  place(labels.alt, labels.alt ? labels.alt.__vec : null);
  /* R(+) and the altitude both lie ALONG the radius vector, and the default
     Satellite camera sits on that same line - looking straight down it. Every
     point on a ray through the eye projects to one pixel, so the two labels
     landed exactly on top of each other and the altitude simply was not there
     to be read. That is what "unchecking Earth only shows R(+)" actually was:
     not a missing label, a vanishing point.
     Nothing can be done about the foreshortening - it is the honest projection
     of that camera - but the text can be pulled apart so both are legible. */
  if(labels.earth && labels.alt &&
     labels.earth.style.display === 'block' && labels.alt.style.display === 'block'){
    const dy = Math.abs(parseFloat(labels.alt.style.top) - parseFloat(labels.earth.style.top));
    const dx = Math.abs(parseFloat(labels.alt.style.left) - parseFloat(labels.earth.style.left));
    labels.alt.style.marginTop = (dx < 90 && dy < 16) ? '15px' : '0px';
  } else if(labels.alt) labels.alt.style.marginTop = '0px';
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
  /* The lens, but only while looking through it. The wheel drives pov0.fov from
     8 to 90 degrees and until now changed the view with nothing to say what it
     had changed it to.
     Both figures are given because three.js stores the VERTICAL angle while a
     camera is normally quoted by its horizontal one, and the two differ by the
     aspect ratio - on a wide viewport by a lot. Printing only cam.fov would be
     a number that matches no spec sheet.
     The focal length is the 35 mm equivalent, from the horizontal angle: it is
     the form anyone who has held a camera reads instantly, where 42 degrees
     means nothing. */
  if(labels.fov){
    if(pov){
      const v = pov0.fov;
      const h = 2*Math.atan(Math.tan(v*RAD/2) * cam.aspect)*DEG;
      const f = 36 / (2*Math.tan(h*RAD/2));
      labels.fov.textContent = h.toFixed(1)+'° × '+v.toFixed(1)+'°';
      labels.fov.title = 'horizontal × vertical field of view — about '
                       + f.toFixed(0) + ' mm on 35 mm';
      if(labels.fovmm) labels.fovmm.textContent = '≈' + f.toFixed(0) + ' mm';
      labels.fov.parentNode.hidden = false;
    } else labels.fov.parentNode.hidden = true;
  }
  /* The scale of what the lens is pointed at. FOV alone says how wide the view
     is in angle; this says what that is worth on the ground, which is the
     number that changes when you pitch down towards nadir without touching the
     wheel at all.
     The row stays put while the boresight is off the body rather than vanishing
     and shoving the layout about - it just has nothing to report. */
  if(labels.gsd){
    if(pov){
      const g = gsdAt();
      if(g && g.onBody){
        const t = gsdText(g);
        labels.gsd.textContent = t.text;
        if(labels.gsdu) labels.gsdu.textContent = t.unit;
        labels.gsd.title = 'ground covered by one rendered pixel, across × along '
          + 'the look direction — slant range ' + g.range.toFixed(0)
          + ' km, incidence ' + g.inc.toFixed(1) + '°'
          + (g.nadir ? ', ' + gsdText({x:g.nadir, y:g.nadir}).text.split(' × ')[0]
                     + ' ' + gsdText({x:g.nadir, y:g.nadir}).unit + ' straight down' : '');
      } else if(g){
        /* The view axis clears the limb, so the pixel under the crosshair has no
           bounded footprint. Rather than print nothing, fall back to the value
           straight down and label it as such. */
        const t = gsdText(g);
        labels.gsd.textContent = t.text.split(' × ')[0];
        if(labels.gsdu) labels.gsdu.textContent = t.unit + ' at nadir';
        labels.gsd.title = 'the centre of the view clears the limb, so a pixel '
          + 'there covers no bounded patch of ground — this is the figure '
          + 'straight down from the spacecraft instead, in the same lens';
      } else {
        labels.gsd.textContent = '—';
        if(labels.gsdu) labels.gsdu.textContent = '';
        labels.gsd.title = 'no ground in view';
      }
      labels.gsd.parentNode.hidden = false;
    } else labels.gsd.parentNode.hidden = true;
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
    BODY = opts.body; mkTrack = opts.mkTrack;
    if(!THREE || !THREE.WebGLRenderer || !BODY || !mkTrack) return false;
    RE = BODY.Re; U = 1/RE;
    try {
      build(opts.canvas);
    } catch(e){ return false; }
    labels = opts.labels || {};
    onPick = opts.onPick; onFollow = opts.onFollow; onSite = opts.onSite;
    onPov = opts.onPov;
    started = true;
    requestAnimationFrame(tick);
    return true;
  },
  setSat, retheme,
  get scene(){ return scene; },        // the sky layers hang off the same scene
  get camera(){ return cam; },         // and are projected through the same camera
  get time(){ return simTime; },
  set time(d){ simTime = new Date(d); },
  setRate(r){ rate = r; },
  setPlaying(p){ playing = p; },
  setFollow(f){ setFollowState(!!f); },
  get follow(){ return follow; },
  showFov(v){ fovOn = !!v; if(fovRing) fovRing.visible = fovOn; },
  /* Hiding the planet is how you actually look at an orbit: the geometry stops
     being occluded by the thing it goes around. */
  /* Exposed alongside scene and camera so a check can force a frame and read
     the pixels back: a WebGL drawing buffer is gone by the next task, so
     measuring what was actually painted means rendering and reading in one go. */
  get renderer(){ return renderer; },
  /* The globe's surface. The list comes from GlobeTex so the page does not
     carry a second copy of it that can fall out of step. */
  surfaces(){ return global.GlobeTex ? global.GlobeTex.modes() : [{key:'vector', label:'Coastlines'}]; },
  setSurface(key, onStatus){ setSurface(key, onStatus); },
  get surface(){ return surfaceKey; },
  /* Driven by the Orbital elements checkbox, which lives in the page. */
  showRVector(v){ elementsOn = !!v; },
  get rVector(){ return elementsOn; },
  showEarth(v){
    earthOn = !!v;
    if(earth) earth.visible = earthOn;
    if(atmo) atmo.visible = earthOn;
    if(wire) wire.visible = !earthOn;
    /* R(+) is no longer tied to this - see elementsOn. */
    /* The altitude arrow is NOT tied to this. It lives above the surface, so
       the globe never occludes it, and it carries the one number a reader
       wants off a 3D view. Hiding it with the planet was the old behaviour and
       the wrong one. */

  },
  get earth(){ return earthOn; },
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
  /* The observer moved. GT.OBS is mutated in place by the page rather than
     replaced, so the reference here is still live - only the geometry built
     from it at init has to be rebuilt, and the site-lock camera re-aimed. */
  siteMoved(){
    placeSite();
    if(siteLock) cam0.lat = GT.OBS.lat + 6;
  },
  setTrail(ms){                                   // a number of ms, or Infinity
    trailSpan = ms;
    if(trackPts.length) updateTrail(simTime.getTime());
  },
  get trail(){ return trailSpan; },
  get site(){ return siteLock; },
  // the view FROM the spacecraft, rather than of it
  setPov(v){ setPovState(!!v); },
  get pov(){ return pov; },
  freeCam(){ setFollowState(false); setSiteState(false); setPovState(false); },
  ok(){ return started; }
};
})(window);
