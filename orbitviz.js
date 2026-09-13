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
(function (global) {
'use strict';

const RAD = Math.PI/180, DEG = 180/Math.PI, RE = 6378.137;
const R_SKY = 400;                               // far sphere radius, in Earth radii

/* Same palette as orbit3d.js so the two views read as one instrument, plus the
   few roles this view needs and that one does not. Space has no light mode. */
const SPACE = {
  track:'#17A3CC', contact:'#CE801A', observer:'#E2557E', ring:'#3A4E5A',
  ink:'#E8EFF2', ink2:'#AEBFC8', muted:'#8096A1',
  aries:'#F0C24B',                               // the direction everything is measured from
  hvec:'#9FD3E3', evec:'#F0A03C', rvec:'#E8EFF2',
  vvec:'#7FE0B0', vtvec:'#6FC79C', vnvec:'#D6A0E0',
  pole:'#9FD3E3', star:'#DCE7EE'
};

let THREE, sat, scene, U = 1/RE;
let root = null, sky = null, started = false;
let el = null;                                   // normalised elements of the current orbit
let simTime = new Date(), planetMs = null, precMs = null, dpr = 1;
const MU = 398600.4418;                          // km^3/s^2, for the e vector
let satrecRef = null;                            // needed for the live state vector
let live = null, liveMs = null, nuShown = null, vShown = null;  // the parts that follow the spacecraft

/* The layer table is the single source of truth: layers() hands it to the UI,
   and show() builds a layer the first time it is switched on rather than at
   init, so a view nobody opens costs nothing. */
const LAYERS = [
  { key:'frame',          label:'Inertial frame (ECI + Aries)', on:false },
  { key:'elements',       label:'Orbital elements',             on:true  },
  { key:'stars',          label:'Star field (mag ≤ 5.5)',   on:false },
  { key:'constellations', label:'Constellation lines',          on:false },
  { key:'planets',        label:'Sun, Moon & planets',          on:false }
];
const G = {};                                    // key -> THREE.Group, absent until built

/* ---- small helpers -------------------------------------------------------- */
const rev = a => a - Math.floor(a/360)*360;
const sin = a => Math.sin(a*RAD), cos = a => Math.cos(a*RAD);
const C = n => new THREE.Color(SPACE[n]);
function eci(x, y, z){ return new THREE.Vector3(x, z, -y); }
function raDec(ra, dec, r){
  const cd = cos(dec);
  return eci(r*cd*cos(ra), r*cd*sin(ra), r*sin(dec));
}

/* Labels: r128 has no text, and an HTML overlay would need the camera and the
   canvas rect, neither of which this module is handed. Canvas sprites it is.
   sizeAttenuation is off so a label is the same size on screen whether it sits
   at 1.1 Earth radii or out on the star sphere at 400. */
function makeLabel(text, colour, opt){
  opt = opt || {};
  const lines = Array.isArray(text) ? text : [text];
  // these were rendering around 12 screen pixels tall over a star field, which
  // is legible in a screenshot and not in use
  const px = opt.px || 56, pad = Math.round(px*0.42), lh = Math.round(px*1.28);
  const cv = document.createElement('canvas');
  let g = cv.getContext('2d');
  const font = (opt.weight || 600)+' '+px+'px "IBM Plex Mono", ui-monospace, '+
    '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", "DejaVu Sans Mono", monospace';
  g.font = font;
  let w = 0;
  for(let i=0;i<lines.length;i++) w = Math.max(w, g.measureText(lines[i]).width);
  cv.width  = Math.ceil(w) + pad*2;              // resizing the canvas resets the context
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
  const m = new THREE.SpriteMaterial({ map:t, transparent:true, depthWrite:false,
    depthTest: opt.depthTest !== false, sizeAttenuation:false,
    opacity: opt.opacity === undefined ? 1 : opt.opacity });
  const s = new THREE.Sprite(m);
  // a fraction of viewport height at fov 42; 1.75x over the first pass, which
  // was sized for a screenshot rather than for reading. h covers the WHOLE
  // sprite, so a two-line label would otherwise set each line at half size.
  const h = (opt.h || 0.020) * 1.75 * (lines.length > 1 ? 1 + 0.6*(lines.length-1) : 1);
  s.scale.set(h*cv.width/cv.height, h, 1);
  s.renderOrder = opt.order || 12;
  return s;
}

/* makeLabel bakes its text into a texture, which is right for a label that never
   changes and wrong for one that counts. This one keeps its own canvas so the
   value can be repainted in place. */
function liveLabel(colour, opt){
  opt = opt || {};
  const px = 56, pad = 24, h = px + pad*2;
  const cv = document.createElement('canvas');
  // size to the longest string this label will ever hold, or it clips
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '600 '+px+'px "IBM Plex Mono", ui-monospace, monospace';
  const w = Math.ceil(probe.measureText(opt.sample || '000000000000000000000000').width) + pad*2;
  cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  if(THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  else if(THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, transparent:true,
    depthWrite:false, depthTest:false, sizeAttenuation:false }));
  const hh = (opt.h || 0.019) * 1.75;
  sp.scale.set(hh*w/h, hh, 1);
  sp.renderOrder = 14;
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
  };
  return sp;
}

function lineFrom(pts, colour, opacity){
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(g, new THREE.LineBasicMaterial({
    color: C(colour), transparent:true, opacity: opacity }));
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

/* h, e, r and the true anomaly are the parts that MOVE. They are computed from
   the live state vector rather than from the mean elements, so they follow the
   spacecraft exactly and carry the orbit's precession for free:
     h = r x v          e = (v x h)/mu - r_hat          nu = angle(e, r)        */
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
    h: mk(SPACE.hvec), e: mk(SPACE.evec), r: mk(SPACE.rvec),
    hTip: cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.085, SPACE.hvec, .95),
    eTip: cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.075, SPACE.evec, .95),
    nu: new THREE.Line(arcGeo, new THREE.LineBasicMaterial({
          color:C(SPACE.contact), transparent:true, opacity:.9 })),
    v:  mk(SPACE.vvec), vt: mk(SPACE.vtvec), vn: mk(SPACE.vnvec),
    vTip:  cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.075, SPACE.vvec, .95),
    vtTip: cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.060, SPACE.vtvec, .9),
    vnTip: cone(new THREE.Vector3(), new THREE.Vector3(0,1,0), 0.060, SPACE.vnvec, .9),
    vLbl:  liveLabel(SPACE.vvec,  {h:0.017, sample:'v = 00.000 km/s'}),
    vtLbl: liveLabel(SPACE.vtvec, {h:0.015, sample:'vt = 00.000 km/s (transverse)'}),
    vnLbl: liveLabel(SPACE.vnvec, {h:0.015, sample:'vn = 00.000 km/s (radial)'}),
    hLbl: liveLabel(SPACE.hvec, {h:0.017, sample:'h = 000000000 km2/s'}),
    eLbl: liveLabel(SPACE.evec, {h:0.017, sample:'e = 0.0000000  (near-circular)'}),
    nuLbl: liveLabel(SPACE.contact, {h:0.018, sample:'\u03b8 = 000.00\u00b0 from perigee'})
  };
  [live.h, live.e, live.r, live.hTip, live.eTip, live.nu,
   live.hLbl, live.eLbl, live.nuLbl,
   live.v, live.vt, live.vn, live.vTip, live.vtTip, live.vnTip,
   live.vLbl, live.vtLbl, live.vnLbl].forEach(o=>parent.add(o));
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
  if(!live || !satrecRef || !sat) return;
  const ms = date.getTime();
  if(liveMs !== null && Math.abs(ms - liveMs) < 120) return;   // ~8 Hz is plenty
  liveMs = ms;
  let pv = null;
  try { pv = sat.propagate(satrecRef, date); } catch(e){ pv = null; }
  const vis = !!(pv && pv.position && pv.velocity && isFinite(pv.position.x));
  [live.h, live.e, live.r, live.hTip, live.eTip, live.nu,
   live.hLbl, live.eLbl, live.nuLbl,
   live.v, live.vt, live.vn, live.vTip, live.vtTip, live.vnTip,
   live.vLbl, live.vtLbl, live.vnLbl].forEach(o=>o.visible = vis);
  if(!vis) return;

  const R = [pv.position.x, pv.position.y, pv.position.z];
  const V = [pv.velocity.x, pv.velocity.y, pv.velocity.z];
  const rMag = Math.hypot(R[0],R[1],R[2]);
  const H = [R[1]*V[2]-R[2]*V[1], R[2]*V[0]-R[0]*V[2], R[0]*V[1]-R[1]*V[0]];
  const hMag = Math.hypot(H[0],H[1],H[2]);
  const VxH = [V[1]*H[2]-V[2]*H[1], V[2]*H[0]-V[0]*H[2], V[0]*H[1]-V[1]*H[0]];
  const E = [VxH[0]/MU - R[0]/rMag, VxH[1]/MU - R[1]/rMag, VxH[2]/MU - R[2]/rMag];
  const eMag = Math.hypot(E[0],E[1],E[2]);

  // scene vectors
  const rS = eci(R[0],R[1],R[2]).multiplyScalar(U);
  const hDir = eci(H[0],H[1],H[2]).normalize();
  const eDir = eMag > 1e-9 ? eci(E[0],E[1],E[2]).normalize() : null;
  const rLen = rS.length();

  setRay(live.r, null, rS);
  setRay(live.h, live.hTip, hDir.clone().multiplyScalar(Math.max(1.55, rLen*1.12)));
  live.hLbl.position.copy(hDir).multiplyScalar(Math.max(1.55, rLen*1.12) + 0.16);

  /* True anomaly is measured from perigee, and on a near-circular orbit perigee
     is not a real place: at e = 1.5e-4 it sits about a kilometre below apogee and
     the eccentricity vector's DIRECTION is mostly perturbation noise, so nu
     jitters and can point anywhere. Checked against radius over a full
     revolution, LANDSAT 9 put its minimum radius at nu = 180.7 deg. Below the
     threshold the honest angle is the argument of latitude, measured from the
     ascending node, which stays well conditioned as e goes to zero. */
  /* Decide this ONCE from the published eccentricity, not from the osculating
     value: the osculating e wobbles across any fixed threshold mid-orbit, which
     flipped the reference direction between perigee and node and made the angle
     jump by omega - measured at 108 degrees on KNACKSAT-2. */
  // only used to warn on the e label now: the angle is always the true anomaly
  const nearCircular = (el && isFinite(el.ecc) ? el.ecc : eMag) < 1.5e-3;
  const rHat = rS.clone().normalize();
  const rdotv = R[0]*V[0] + R[1]*V[1] + R[2]*V[2];

  // the e arrow still points somewhere, but say so when it cannot be trusted
  if(eDir){
    const eLen = Math.max(1.30, rLen*0.92);
    setRay(live.e, live.eTip, eDir.clone().multiplyScalar(eLen));
    live.eLbl.position.copy(eDir).multiplyScalar(eLen + 0.16);
    live.e.visible = live.eTip.visible = live.eLbl.visible = true;
    live.e.material.opacity = nearCircular ? .38 : .95;
    live.eTip.material.opacity = nearCircular ? .38 : .95;
  } else {
    live.e.visible = live.eTip.visible = live.eLbl.visible = false;
  }

  /* True anomaly, measured from the eccentricity vector, which is the
     definition. On a near-circular orbit that reference is genuinely unstable -
     KNACKSAT-2's perigee direction wanders 64 degrees in one revolution - so the
     value will jitter there. That is a property of the orbit, not of the
     drawing, and the e label says so rather than the angle quietly switching to
     a different quantity. */
  const fromDir = eDir;
  if(fromDir){
    let ang = Math.acos(Math.max(-1, Math.min(1, fromDir.dot(rHat))))*DEG;
    if(rdotv < 0) ang = 360 - ang;
    const inPlane = new THREE.Vector3().crossVectors(hDir, fromDir).normalize();
    const Rnu = Math.max(0.62, rLen*0.42);
    const arr = live.nu.geometry.attributes.position.array;
    for(let k=0;k<=live.seg;k++){
      const t = ang*k/live.seg;
      const p = fromDir.clone().multiplyScalar(Rnu*cos(t)).addScaledVector(inPlane, Rnu*sin(t));
      arr[k*3]=p.x; arr[k*3+1]=p.y; arr[k*3+2]=p.z;
    }
    live.nu.geometry.attributes.position.needsUpdate = true;
    live.nu.geometry.computeBoundingSphere();
    live.nu.visible = live.nuLbl.visible = true;
    const mid = ang/2;
    live.nuLbl.position.copy(fromDir).multiplyScalar(Rnu*cos(mid)*1.12)
      .addScaledVector(inPlane, Rnu*sin(mid)*1.12);
    if(nuShown === null || Math.abs(ang - nuShown) > 0.05){
      nuShown = ang;
      // one symbol for the angle either way, with the reference named, rather
      // than switching between nu and u and leaving the reader to notice
      live.nuLbl.userData.paint('\u03b8 = '+ang.toFixed(2)+'\u00b0 from perigee');
      /* Print the OSCULATING magnitude: this label sits on the osculating
         arrow, whose length varies by a factor of two and a half over one
         revolution, so quoting the TLE's constant mean e beside it described a
         different quantity. The elements card still carries the mean value. */
      const eShown = eMag;
      if(live.eLbl.visible) live.eLbl.userData.paint(nearCircular
        ? 'e = '+eShown.toFixed(7)+'  (perigee direction unstable)'
        : 'e = '+eShown.toFixed(7));
    }
  } else {
    live.nu.visible = live.nuLbl.visible = false;
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
  live.vn.visible = live.vnTip.visible = live.vnLbl.visible = !tiny;
  live.vt.visible = live.vtTip.visible = live.vtLbl.visible = !tiny;
  if(vShown === null || Math.abs(vMag - vShown) > 0.0005){
    vShown = vMag;
    live.vLbl.userData.paint('v = '+vMag.toFixed(3)+' km/s');
    live.vtLbl.userData.paint('vt = '+vTan.toFixed(3)+' km/s (transverse)');
    live.vnLbl.userData.paint('vn = '+vRad.toFixed(3)+' km/s (radial)');
  }
  live.hLbl.userData.paint('h = '+(hMag).toFixed(0)+' km\u00b2/s');
}

function buildElements(){
  const g = new THREE.Group();
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
  g.add(dot(asc, 0.030, 'contact'));
  const ascL = makeLabel('ASCENDING NODE', SPACE.contact, { h:0.017, depthTest:false });
  ascL.position.copy(asc).addScaledVector(b.n, 0.22).add(new THREE.Vector3(0,0.10,0));
  g.add(ascL);
  g.add(dot(des, 0.020, 'ink2', 0.6));
  const desL = makeLabel('DESCENDING NODE', SPACE.ink2,
                         { h:0.014, depthTest:false, opacity:0.75 });
  desL.position.copy(des).addScaledVector(b.n, -0.22).add(new THREE.Vector3(0,0.09,0));
  g.add(desL);

  // RAAN: measured in the equatorial plane, from Aries, eastward. The arc starts
  // on +X by construction — that is the assertion this layer exists to make.
  const raan = arcPts(O, b.x, b.y, Rn, el.raan, Math.max(24, Math.round(el.raan/2)));
  g.add(lineFrom(raan, 'aries', 0.95));
  const tipN = raan[raan.length-1];
  g.add(cone(tipN, new THREE.Vector3().subVectors(tipN, raan[raan.length-2]), 0.11, 'aries'));
  g.add(lineFrom([O, b.x.clone().multiplyScalar(Rn*1.06)], 'aries', 0.55));
  const raanL = makeLabel('Ω = '+el.raan.toFixed(2)+'°', SPACE.aries,
                          { h:0.021, depthTest:false });
  raanL.position.copy(raan[raan.length>>1]).multiplyScalar(1.10).add(new THREE.Vector3(0,0.08,0));
  g.add(raanL);

  // Inclination is a dihedral angle, so it is drawn where it is defined: on a
  // circle about the node line, from the equatorial plane up into the orbit plane.
  const Ci = b.n.clone().multiplyScalar(Rn*0.90), rho = Math.max(0.30, Rn*0.26);
  const inc = arcPts(Ci, b.eq, b.z, rho, el.inc, Math.max(20, Math.round(el.inc/2)));
  g.add(lineFrom(inc, 'track', 0.95));
  g.add(lineFrom([Ci, new THREE.Vector3().copy(Ci).addScaledVector(b.eq, rho)], 'ring', 0.6));
  g.add(lineFrom([Ci, new THREE.Vector3().copy(Ci).addScaledVector(b.v, rho)], 'track', 0.6));
  const tipI = inc[inc.length-1];
  g.add(cone(tipI, new THREE.Vector3().subVectors(tipI, inc[inc.length-2]), 0.085, 'track'));
  const incL = makeLabel('i = '+el.inc.toFixed(2)+'°', SPACE.track,
                         { h:0.021, depthTest:false });
  incL.position.copy(inc[inc.length>>1]).addScaledVector(b.z, 0.15).addScaledVector(b.eq, 0.06);
  g.add(incL);

  // argument of perigee: inside the orbit plane, node -> perigee
  const argp = arcPts(O, b.n, b.v, Rw, el.argp, Math.max(24, Math.round(el.argp/2)));
  g.add(lineFrom(argp, 'contact', 0.95));
  const tipW = argp[argp.length-1];
  g.add(cone(tipW, new THREE.Vector3().subVectors(tipW, argp[argp.length-2]), 0.10, 'contact'));
  const argpL = makeLabel('ω = '+el.argp.toFixed(2)+'°', SPACE.contact,
                          { h:0.021, depthTest:false });
  argpL.position.copy(argp[argp.length>>1]).multiplyScalar(1.10).add(new THREE.Vector3(0,0.08,0));
  g.add(argpL);

  // apsides
  const pPos = b.p.clone().multiplyScalar(rp), aPos = b.p.clone().multiplyScalar(-ra);
  g.add(lineFrom([pPos, aPos], 'muted', 0.35));
  g.add(dot(pPos, 0.028, 'contact'));
  g.add(dot(aPos, 0.024, 'muted'));
  const pl = makeLabel(['PERIGEE', (el.a*(1-el.ecc)-RE).toFixed(0)+' km'], SPACE.contact,
                       { h:0.016, depthTest:false });
  pl.position.copy(pPos).addScaledVector(b.p, 0.24).add(new THREE.Vector3(0,0.09,0));
  g.add(pl);
  const al = makeLabel(['APOGEE', (el.a*(1+el.ecc)-RE).toFixed(0)+' km'], SPACE.muted,
                       { h:0.016, depthTest:false });
  al.position.copy(aPos).addScaledVector(b.p, -0.24).add(new THREE.Vector3(0,0.09,0));
  g.add(al);

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
const STAR_DATA = '10129,-1672,-14,1,9599,-5270,-6,16,21392,1918,0,124,21991,-6083,0,71,27923,3878,0,0,7917,4600,1,80,7863,-820,2,-3,11483,522,4,43,2443,-5724,5,-16,8879,741,5,150,21096,-6037,6,-23,18665,-6310,8,-24,29770,887,8,22,6898,1651,9,154,20130,-1116,10,-23,7917,4600,10,60,24735,-2643,11,187,11633,2803,12,99,34441,-2962,12,14,19193,-5969,13,-24,31036,4528,13,9,15209,1197,14,-9,21991,-6084,14,90,10466,-2897,15,-21,8128,635,16,-22,11365,3189,16,3,18779,-5711,16,160,26340,-3710,16,-23,8157,2861,17,-13,8405,-120,17,-18,8519,-194,17,-20,13830,-6972,17,7,33206,-4696,17,-7,5108,4986,18,48,10710,-2639,18,67,12238,-4734,18,-14,16593,6175,18,106,19351,5596,18,-2,27604,-3438,18,-3,8988,4495,19,8,9943,1640,19,0,12563,-5951,19,120,13118,-5471,19,4,20689,4931,19,-10,25217,-6903,19,145,26433,-4300,19,41,30641,-5674,19,-12,1090,-1799,20,102,3179,2346,20,115,3795,8926,20,64,9567,-1796,20,-24,14190,-866,20,144,15499,1984,20,113,210,2909,21,-4,1743,3562,21,158,3097,4233,21,137,4704,4096,21,0,8694,-967,21,-17,17726,1457,21,9,21167,-3637,21,101,22268,7416,21,147,26373,1256,21,16,28382,-2630,21,-13,34067,-4688,21,161,1013,5654,22,117,1418,6072,22,-5,12090,-4000,22,-27,13700,-4343,22,167,13927,-5928,22,19,19038,-4896,22,-2,20098,5493,22,6,23367,2671,22,3,26915,5149,22,152,30556,4026,22,67,229,5915,23,38,8300,-30,23,-17,16546,5638,23,3,20497,-5347,23,-17,21888,-4216,23,-16,22048,-4739,23,-15,24008,-2262,23,-12,25254,-3429,23,114,657,-4231,24,108,17846,5369,24,4,22125,2707,24,97,25759,-1572,24,6,26562,-3903,24,-17,32605,988,24,152,34594,2808,24,166,4557,409,25,163,11102,-2930,25,-8,14053,-5501,25,-14,24929,-1057,25,4,31155,3397,25,102,31964,6259,25,26,34619,1521,25,0,2866,2081,26,17,8318,-1782,26,21,16853,2052,26,13,18209,-5072,26,-13,18395,-1754,26,-11,20889,-4729,26,-18,22925,-938,26,-7,23607,643,26,117,24136,-1981,26,-6,28565,-2988,26,6,2145,6024,27,16,7425,3317,27,149,8491,-3407,27,-12,8993,3721,27,-8,10929,-3710,27,162,16074,-6439,27,-22,16169,-4942,27,90,18860,-2340,27,89,18930,-6914,27,-18,19042,-145,27,37,20867,1840,27,58,22463,-4313,27,-18,24359,-369,27,158,24600,6151,27,91,26269,-3730,27,-18,27525,-2983,27,138,29656,1061,27,151,331,1518,28,-19,642,-7725,28,62,5853,3188,28,27,7696,-509,28,16,8206,-2076,28,81,8386,-591,28,-21,12189,-2430,28,46,18379,-5875,28,-19,20015,-3671,28,7,22272,-1604,28,15,23379,-4117,28,-22,23879,-6343,28,32,24756,2149,28,95,24897,-2822,28,-21,25032,3160,28,65,25866,1439,28,116,26132,-5553,28,148,26261,5230,28,95,26296,-4988,28,-14,26587,457,28,117,27699,-2542,28,102,2969,-6157,29,29,4457,-4030,29,13,4620,5351,29,72,5687,2411,29,-9,5946,4001,29,-20,9574,2251,29,162,10248,-5061,29,121,11179,829,29,-10,14678,-6507,29,27,18747,-1652,29,-1,19401,3832,29,-11,19554,1096,29,93,22973,-6868,29,1,23971,-2611,29,-18,24530,-2559,29,30,28744,-2102,29,38,29624,4513,29,0,32289,-557,29,83,32676,-1613,29,18,33463,-6026,29,139,34075,3022,29,85,11365,3189,29,60,3239,3499,30,14,5573,4779,30,-12,5951,-1351,30,159,7549,4382,30,54,8441,2114,30,-15,9508,-3006,30,-16,10576,-2383,30,-8,14646,2377,30,81,16742,4450,30,114,18253,-2262,30,133,19157,-6811,30,-18,19973,-2317,30,92,21802,3831,30,19,23018,7183,30,6,25297,-3805,30,-20,26690,-4013,30,51,27145,-3042,30,98,28635,1386,30,1,32848,-3736,30,-8,33145,-32,30,97,8774,-3577,31,115,10098,2513,31,138,13385,595,31,98,13480,4804,31,22,14026,3439,31,155,15558,4150,31,160,16241,-1619,31,123,17395,-6302,31,-4,22479,-4210,31,-21,25466,-5599,31,155,25876,2484,31,8,27441,-3676,31,158,28814,6766,31,99,29268,2796,31,109,30525,-1478,31,79,30939,-4729,31,100,7246,696,32,48,7637,-2237,32,146,7663,4123,32,-15,9944,-4320,32,-10,10205,-6194,32,23,14281,-5703,32,154,14322,5168,32,48,22063,-6498,32,26,23034,-4065,32,-23,24458,-469,32,97,25442,938,32,116,25720,6571,32,-12,25876,3681,32,144,26746,-3704,32,119,27533,-290,32,94,28141,-2699,32,-11,30283,-82,32,-7,31823,3023,32,99,32216,7056,32,-20,35484,7763,32,103,983,3086,33,127,1652,-4672,33,89,4629,3884,33,153,5681,-7424,33,159,6361,-6247,33,92,6850,-5504,33,-8,7823,-1621,33,-11,9372,2251,33,160,11231,-4330,33,151,11732,-2486,33,122,15343,-7004,33,-7,15801,-6169,33,-9,16856,1543,33,0,18386,5703,33,8,21159,-2668,33,109,22602,-2528,33,167,23123,5897,33,117,25804,-4324,33,44,26050,-2500,33,-19,26135,-5638,33,-15,26976,-977,33,99,28474,3269,33,-5,28674,-2767,33,117,34366,-1582,33,7,2209,-4332,34,154,2827,2958,34,49,2860,6367,34,-15,6017,1249,34,-10,6717,1587,34,18,8112,-240,34,-24,8378,993,34,-16,10132,1290,34,44,12757,6072,34,86,13169,642,34,69,13774,-5897,34,-19,15417,2342,34,31,15427,-6133,34,154,19390,340,34,157,20367,-60,34,11,20738,-4169,34,-22,22807,-5210,34,92,23067,-4469,34,-19,24003,-3840,34,-21,26661,2772,34,75,28656,-488,34,-10,29137,311,34,32,31124,-6620,34,16,31132,6184,34,91,33271,5820,34,156,34037,1083,34,-9,25759,-1573,34,60,1227,5782,35,59,1715,-1018,35,116,2602,-1594,35,73,4083,324,35,9,5581,-976,35,92,6715,1918,35,101,10246,-3251,35,-12,10543,-2793,35,173,11003,2198,35,37,11919,-5298,35,-18,12413,919,35,148,14529,989,35,52,14922,-5457,35,-7,15183,1676,35,-3,15427,4291,35,3,16962,3309,35,140,17325,-3186,35,95,20740,-4247,35,-17,22549,4039,35,96,22888,3331,35,96,23741,-343,35,-4,25072,3892,35,92,26440,-1540,35,26,27674,-4597,35,-18,28252,3336,35,0,28443,-2111,35,115,29969,1949,35,157,33255,620,35,9,34214,-5132,35,8,34242,6620,35,105,34250,2460,35,93,19041,-145,35,60,486,-882,36,121,2101,-818,36,107,2287,1535,36,97,2450,4863,36,127,3413,-5151,36,-12,4250,2726,36,-10,5120,903,36,89,5729,2405,36,-7,6447,-3380,36,-11,7940,-684,36,-11,8612,-2245,36,48,8674,-1482,36,10,10320,3396,36,10,10952,1654,36,11,11611,2440,36,93,11631,-3797,36,171,13007,-5292,36,-17,13591,4716,36,1,14268,-4047,36,37,15265,-1235,36,101,16984,-1478,36,111,17640,-6673,36,16,17767,176,36,52,18534,-6040,36,139,19557,-7155,36,119,21485,-4606,36,-18,21796,3037,36,130,23045,-3626,36,153,23426,-2814,36,136,25308,-3802,36,-21,25365,-4236,36,139,26277,-6068,36,-10,26643,-6472,36,116,27526,7273,36,49,30218,-6618,36,75,30451,-1254,36,88,30939,1460,36,43,34548,4233,36,-10,924,5390,37,-20,2787,-1034,37,114,2899,-5161,37,84,4988,-2176,37,161,5179,973,37,-8,5323,-946,37,88,5622,2411,37,-10,6495,1563,37,98,7280,561,37,-16,7356,244,37,-18,7562,4108,37,115,8910,-1417,37,34,8988,5428,37,101,11805,-4058,37,101,13090,-3319,37,-18,14288,6306,37,36,14631,-6251,37,101,17651,4778,37,118,21110,6438,37,-5,22156,189,37,0,23196,2911,37,32,23466,-2978,37,-18,23655,1542,37,7,23770,448,37,15,24548,1915,37,30,26838,5687,37,118,26944,2925,37,94,27166,-5009,37,-10,27184,956,37,16,29685,1853,37,131,29883,641,37,86,31370,-5845,37,125,31623,4393,37,161,31870,3805,37,39,32502,-1666,37,32,32537,-7739,37,101,33721,-2,37,41,34315,-758,37,163,34736,-2117,37,120,34929,328,37,92,3051,276,38,2,4267,5590,38,169,4737,4486,38,98,4802,-2899,38,54,5605,-6481,38,113,5608,3229,38,2,5630,4258,38,43,6573,1754,38,98,6714,1596,38,95,6889,-3056,38,96,8341,-6249,38,64,8469,-260,38,-19,8783,-2088,38,98,9720,-703,38,-11,10719,-7050,38,101,11143,2780,38,102,11471,-2680,38,-16,12643,-6614,38,113,13016,-4665,38,67,13376,-6064,38,-10,13604,-4710,38,117,13971,3680,38,7,14775,5904,38,29,15652,-1684,38,146,15697,-5874,38,32,15820,931,38,-15,15933,-4823,38,30,16333,3421,38,104,16337,-5885,38,95,17285,6933,38,161,18812,-7213,38,-16,20957,-4210,38,-22,22029,1373,38,4,22197,-7904,38,143,23370,1054,38,27,23569,2630,38,2,24773,198,38,2,25245,-5904,38,156,26487,4601,38,-18,26697,271,38,4,27189,2876,38,-2,27344,-2106,38,20,28617,-2174,38,101,28928,5337,38,95,29243,5173,38,15,29704,7027,38,89,30341,4674,38,127,30991,1591,38,-6,31192,-950,38,0,32167,-2241,38,100,33175,2535,38,44,33782,5028,38,3,35439,4646,38,98,235,-4575,39,101,655,-4368,39,18,1419,3850,39,13,1710,-5525,39,-12,2281,-4907,39,97,2838,1929,39,-5,4356,5276,39,76,4411,-890,39,109,5646,2437,39,-6,6079,599,39,3,6350,-4229,39,109,6908,-335,39,-21,6955,-1430,39,108,8280,-3547,39,113,8682,-5107,39,17,9553,-3344,39,86,10353,-2418,39,174,11531,-955,39,102,11546,-7261,39,103,11595,-2895,39,16,12642,-391,39,-1,13117,1815,39,108,13151,-4604,39,2,13859,231,39,-6,14496,-114,39,131,14819,2601,39,122,15368,-4212,39,5,16715,-5898,39,123,17025,-5449,39,-16,18498,-67,39,3,18701,-5023,39,-19,18837,6979,39,-12,18943,-4854,39,5,20276,-3941,39,119,20967,-4480,39,-21,22077,-566,39,39,22628,-4705,39,-14,22798,-4874,39,-3,23388,-1479,39,101,23911,1566,39,48,23922,-2921,39,-20,24170,-2067,39,-5,24386,-6369,39,111,24494,4631,39,-15,24836,-7890,39,92,25507,3093,39,-2,26906,3725,39,135,27016,293,39,3,27592,2177,39,117,27880,-824,39,132,29042,-1785,39,23,29812,101,39,63,29908,3508,39,102,31429,4117,39,3,31896,525,39,55,33541,-139,39,-6,34759,-4525,39,100,2592,5069,40,-10,3000,-2108,40,155,3086,7242,40,0,3433,3385,40,2,5974,3579,40,2,6217,4771,40,-2,6297,-684,40,33,6601,-3402,40,147,7138,-325,40,-15,7585,6044,40,92,8787,3915,40,113,8979,-4282,40,115,9371,-627,40,132,9917,-1926,40,104,10603,2057,40,90,10870,-2677,40,-15,10921,-6796,40,76,13003,-3531,40,94,13167,2876,40,101,13263,-2771,40,127,13516,4178,40,46,13561,-6640,40,14,13782,-6232,40,-18,15610,-7403,40,37,17098,1053,40,42,17646,653,40,150,18210,-2473,40,33,18291,-5237,40,-16,19365,-5718,40,-18,20131,5499,40,17,21630,5185,40,50,22049,-3779,40,-16,23774,-3363,40,-4,24047,5857,40,53,24300,-1946,40,8,24496,-5016,40,108,27136,250,40,86,28076,-7143,40,113,28491,1507,40,108,28542,-574,40,108,29066,-4446,40,-8,29097,-4062,40,-10,30015,-7291,40,-3,30387,4771,40,145,30735,3037,40,40,30830,1130,40,-12,32350,4559,40,89,33732,-4350,40,102,33884,-12,40,-8,34163,2357,40,107,34936,-5824,40,41,35074,-2010,40,108,35983,686,40,42,20098,5492,40,13,1183,2427,41,110,2420,4141,41,54,3544,-6866,41,3,3987,33,41,-21,3990,-6827,41,-6,4017,-3986,41,101,4105,4923,41,51,4560,-2362,41,16,4727,4961,41,60,5272,1294,41,111,5658,2395,41,-5,6372,4841,41,94,7409,1351,41,116,8099,-781,41,94,8423,929,41,95,9060,965,41,17,9724,2021,41,-11,10355,-1204,41,142,10594,-1563,41,-11,11398,2690,41,154,11731,-4637,41,-16,12463,-7692,41,41,12941,-4299,41,11,12941,570,41,0,13110,-4265,41,87,14361,-5923,41,-1,14787,-1485,41,92,15887,-7861,41,158,16494,-1830,41,108,17028,603,41,-6,17122,-1768,41,22,17663,-6118,41,90,18130,873,41,97,18172,-6461,41,35,18439,-6796,41,160,18461,-6400,41,-17,20737,1580,41,152,21400,-600,41,51,21514,-3789,41,-3,21947,-4943,41,-15,22091,-3517,41,136,22721,-4528,41,-16,22938,-5880,41,9,23323,3136,41,-13,23418,-6632,41,116,23718,1814,41,162,23846,-1673,41,100,23940,2688,41,123,25490,-5316,41,145,27721,-4907,41,100,28383,4395,41,140,28737,-3790,41,4,28751,-3934,41,116,29882,-4187,41,106,31152,-2527,41,43,31296,-2692,41,163,31649,-1723,41,-1,32052,1980,41,111,32616,2565,41,43,33399,3775,41,145,33729,5842,41,78,33744,-4375,41,157,34152,-8138,41,21,34240,-1359,41,157,34522,-5275,41,96,35499,563,41,51,501,-6487,42,58,825,6293,42,13,1718,8626,42,121,3675,-4770,42,-14,4103,-1386,42,-12,4265,3832,42,34,5227,5994,42,42,5671,-2325,42,43,5736,-3620,42,93,6634,2229,42,14,8270,595,42,-14,9103,2326,42,84,10797,-49,42,0,11228,3178,42,32,11583,2888,42,112,11833,-4810,42,-13,11921,-2288,42,72,15697,3671,42,91,18459,-7931,42,-12,18844,4136,42,59,19797,2788,42,57,20642,-3304,42,39,20736,-3445,42,152,21041,154,42,12,21322,-1027,42,132,21410,4609,42,9,24165,-3680,42,-18,24219,4493,42,-4,24676,-1846,42,22,24785,-3470,42,-17,24853,4244,42,-1,24909,-3526,42,154,25077,-7752,42,106,25149,8204,42,90,26092,3715,42,-1,26159,-2418,42,28,26535,-1288,42,9,27519,7134,42,-9,28142,2055,42,48,28179,-475,42,109,28305,-6219,42,-15,28363,3690,42,158,28660,-3706,42,52,30740,6299,42,20,31142,3072,42,105,31935,3939,42,10,32161,-6537,42,49,32588,5878,42,224,32670,4931,42,-12,33376,5704,42,28,33421,-778,42,98,34016,-2704,42,-10,34167,1217,42,50,34399,-3254,42,95,34858,-605,42,155,34897,-909,42,111,35510,4433,42,-7,922,3372,43,-12,964,2931,43,87,1465,-2936,43,-15,1574,789,43,95,1738,4724,43,1,1778,5515,43,17,1894,-6888,43,48,2635,916,43,94,3704,846,43,-5,4124,1011,43,31,4998,-4307,43,71,5345,-2163,43,-11,5412,4819,43,-6,5422,40,43,57,5630,2447,43,-11,5715,-3762,43,-4,6165,5035,43,-1,6388,889,43,-5,6401,-5149,43,31,6637,1793,43,5,6658,2281,43,26,6891,1016,43,18,6917,4126,43,117,6954,1251,43,12,7011,-1967,43,160,7056,2296,43,-11,7351,6634,43,-1,7729,-875,43,-19,7989,-1318,43,-23,8305,1859,43,206,8619,-6574,43,22,8998,4594,43,170,9384,2950,43,102,9796,-2342,43,-24,11204,893,43,143,12516,-7748,43,116,12571,4319,43,155,13015,-5976,43,-12,13081,340,43,-19,13159,-1355,43,90,13462,1186,43,14,13905,-5754,43,160,14293,2297,43,154,14421,-4936,43,17,14427,8133,43,149,15679,-3107,43,143,15983,-5560,43,102,16390,2475,43,2,17424,-82,43,98,17742,-6379,43,-15,17823,-3391,43,-10,18076,-6331,43,28,18802,-1620,43,39,19328,-4894,43,134,19336,-4018,43,22,19673,-4991,43,-18,19750,1753,43,46,20796,-3299,43,-15,21043,-4560,43,60,21508,-5639,43,8,21655,-4538,43,43,21673,-8367,43,130,21688,7570,43,143,22291,-4358,43,-15,22963,-4788,43,-9,23112,3738,43,31,23451,-4257,43,141,23601,7779,43,4,24185,-2087,43,83,24778,-1661,43,92,25884,-2660,43,86,26021,-1285,43,4,26163,414,43,148,26184,-2987,43,40,26414,-3864,43,108,27038,2160,43,41,27215,-6367,43,23,27497,3606,43,116,28119,3761,43,19,28176,1818,43,15,29080,-4480,43,35,30335,5657,43,11,30441,-1251,43,93,30958,-111,43,95,31166,1612,43,104,32056,-1683,43,89,32613,1735,43,116,32636,6112,43,47,33095,6463,43,38,33161,-1387,43,-7,33250,3318,43,47,33738,4771,43,168,33788,-3235,43,1,34672,-4352,43,42,35199,638,43,106,35453,4327,43,-8,16955,3153,43,59,49,-601,44,163,366,-1893,44,164,789,-6296,44,-6,1084,-5746,44,2,1217,759,44,150,1430,2342,44,94,2841,-4630,44,160,3325,885,44,88,4791,1973,44,103,5264,4800,44,137,5654,-1210,44,160,5738,6553,44,187,6117,2208,44,106,6382,-765,44,82,6412,-5930,44,108,7014,-4186,44,34,7265,890,44,1,7322,-545,44,26,7432,5375,44,-2,7831,-1294,44,-9,8371,949,44,-16,8860,2028,44,59,8938,-3528,44,-16,9189,1477,44,-16,9414,-3514,44,98,9491,5901,44,3,9594,459,44,22,9874,-5298,44,-2,9947,-1824,44,114,10246,-5362,44,90,10403,-1705,44,-6,10432,5842,44,85,10778,3025,44,126,10838,-4464,44,133,10856,-2635,44,-17,10968,-2495,44,-13,11351,-2230,44,52,11702,-2594,44,-7,12057,233,44,125,12198,-6862,44,-11,12215,-298,44,97,12226,-1925,44,-16,12284,-3962,44,159,12351,-4035,44,117,12464,-3666,44,22,13211,584,44,-4,15198,1000,44,145,16504,-4223,44,12,16558,2018,44,5,18673,2827,44,113,19749,-554,44,-1,21151,-4118,44,-20,21576,-3951,44,-18,21815,-5046,44,-18,22257,-2796,44,137,22573,209,44,103,22946,-3015,44,110,23661,735,44,60,25350,1017,44,-9,26025,-2111,44,39,26268,2611,44,143,26305,8659,44,2,26963,3019,44,38,27044,131,44,5,27219,2081,44,-16,27581,-6149,44,146,28424,-6723,44,53,28844,3915,44,-15,28909,3813,44,126,29218,2466,44,150,29418,-129,44,-8,29502,1801,44,78,29526,1748,44,104,29993,-3528,44,-15,30066,-2771,44,164,30222,7771,44,-5,30597,3219,44,133,31086,1507,44,30,31193,-503,44,164,31948,3490,44,-10,31997,-5345,44,19,32624,-3303,44,-5,32948,-5499,44,30,33589,5223,44,101,34697,7539,44,80,34948,-918,44,-14,34971,-3253,44,111,35134,2340,44,62,35151,-2064,44,146,35324,-3782,44,-9,458,3679,45,5,789,-6297,45,15,1118,4828,45,-7,1245,4108,45,-14,1792,3009,45,109,2536,549,45,135,3049,7091,45,16,3727,6740,45,15,4128,-1857,45,48,4198,2925,45,111,4227,-3241,45,98,5008,2905,45,156,5857,-295,45,67,6022,-6216,45,150,6659,1562,45,26,6838,-2977,45,97,7464,171,45,137,7807,-1187,45,-10,7832,286,45,117,7954,3337,45,125,8480,412,45,-10,8729,3918,45,95,8746,-5617,45,108,9001,-307,45,120,9298,1421,45,-18,9704,-3258,45,-17,9823,733,45,2,9876,-2296,45,-4,10100,1323,45,117,10197,241,45,110,10814,-4676,45,32,11434,-3497,45,-8,11816,-3886,45,-19,11956,-4924,45,-18,12969,334,45,122,13168,-5677,45,-17,13502,-4125,45,65,13629,-7260,45,61,13722,5160,45,29,14116,2618,45,122,14231,-3595,45,141,14300,-118,45,11,14356,3640,45,91,14362,6983,45,78,14371,5205,45,3,14484,-6133,45,-7,15186,3524,45,19,15198,-37,45,-3,15523,-5604,45,-10,15890,-5756,45,160,16145,-8054,45,-19,16791,-2283,45,3,16917,-365,45,21,17700,2022,45,55,17779,-4517,45,128,18202,-5066,45,-16,20066,-6099,45,-14,20100,-6454,45,82,20682,1746,45,51,21337,5179,45,23,21478,-1337,45,13,21867,2975,45,36,22018,1642,45,0,22285,1910,45,72,22430,-435,45,32,22611,2695,45,124,22806,-1979,45,-7,23079,-3686,45,-15,23084,-5932,45,17,23539,1967,45,6,24603,-2004,45,100,24680,-4755,45,-7,24803,-2147,45,13,26166,-509,45,39,26689,-2783,45,60,27281,-4595,45,101,28889,7336,45,126,29043,-1596,45,8,29352,738,45,118,29411,5022,45,40,29924,-2717,45,146,30070,6787,45,131,30394,2781,45,126,31101,-5192,45,28,31134,5758,45,54,31185,3649,45,-8,31678,-2501,45,160,31740,-1137,45,93,31862,1001,45,53,32218,-2181,45,89,32249,2364,45,162,32427,-1947,45,-18,32604,2874,45,51,33153,-3954,45,135,33210,-3299,45,5,33347,3971,45,139,33683,-6497,45,-3,33762,4312,45,-9,34013,4428,45,132,34313,-3288,45,-4,34597,382,45,-11,34667,-2374,45,89,34675,941,45,156,34814,4941,45,30,35229,1276,45,94,35551,178,45,20,35568,-1454,45,-3,35860,5750,45,119,35998,-6558,45,-7,93,-1734,46,-5,133,-571,46,103,427,3868,46,6,1033,-4609,46,95,1417,5918,46,96,2839,319,46,93,4288,3506,46,155,4480,2134,46,5,4782,3961,46,112,5248,5888,46,49,5427,-4027,46,102,5571,-3731,46,119,5759,7133,46,6,5843,-2461,46,-14,5969,-6140,46,159,5998,-2402,46,-12,6456,5030,46,4,7372,1015,46,9,7577,2159,46,16,7610,-3548,46,118,8171,310,46,-20,8298,-730,46,-26,8385,-484,46,-18,8833,2761,46,-1,9098,2014,46,24,10502,7698,46,137,11168,4921,46,0,11245,1201,46,128,11588,-2841,46,163,11827,-4961,46,-23,11997,-1840,46,9,13005,6433,46,118,13092,-723,46,84,13663,3845,46,104,13701,-2586,46,159,13894,-3741,46,47,14229,-277,46,41,14792,-4655,46,117,14803,5406,46,4,15128,-1306,46,-9,15490,-5503,46,160,16088,-6057,46,170,16418,-3714,46,101,16625,734,46,33,16664,-6242,46,99,16815,-6032,46,54,16880,2310,46,166,17369,-5426,46,-8,18997,-3999,46,-8,19159,-5649,46,-15,19366,-5915,46,-15,19807,-5992,46,-7,20518,5468,46,163,20666,-5143,46,96,20786,6472,46,157,21653,-4522,46,-15,22131,1696,46,97,22440,6593,46,159,23133,-3873,46,0,23354,-1006,46,100,23397,-4496,46,-17,23484,3664,46,-10,23530,-4466,46,41,23740,2607,46,79,23774,-2575,46,-7,23817,4245,46,56,23840,-2533,46,-7,24088,-5778,46,25,24308,-2793,46,-17,24516,-2417,46,76,24635,1403,46,0,24640,-2345,46,23,24695,-837,46,19,25246,-1078,46,48,25942,3729,46,4,26391,-4651,46,-2,26446,-812,46,13,26548,7215,46,43,27012,-369,46,39,27183,873,46,95,27202,-2846,46,94,27784,-6228,46,-12,27838,-4231,46,99,28109,3961,46,18,28280,5939,46,119,28369,2265,46,78,28405,420,46,16,28709,-4050,46,107,29017,6571,46,3,29163,34,46,58,29418,-2488,46,-7,29837,2408,46,-5,30848,3525,46,159,30883,1467,46,12,31303,2710,46,84,31665,4765,46,157,32548,7131,46,111,33526,4654,46,-10,33613,4948,46,9,33934,5155,46,25,34605,5005,46,106,35016,2374,46,18,35723,-2813,46,0,35944,2514,46,158,794,5452,47,-10,1786,2103,47,102,1844,2458,47,105,1987,2726,47,3,2148,6813,47,105,2348,5923,47,99,2740,-1069,47,33,2873,-6765,47,93,3112,-2930,47,-16,3641,5028,47,153,3802,-1524,47,45,3995,-4289,47,6,4086,2771,47,-12,4469,3966,47,7,4493,891,47,-11,5000,6565,47,-11,5234,4951,47,-10,5234,-6294,47,41,5265,-508,47,-9,6372,4048,47,101,6665,1471,47,98,6846,1484,47,26,6982,1592,47,15,7313,1425,47,177,7614,1540,47,-6,7638,-5747,47,53,7978,4010,47,63,8011,-2124,47,-5,8044,-38,47,-17,8243,-109,47,159,8318,3219,47,28,8776,3731,47,162,8852,-6309,47,102,9154,-1494,47,5,9257,-5497,47,-23,10024,990,47,-23,10366,1318,47,32,10391,-2014,47,37,10915,-2788,47,159,10958,-3673,47,-10,11268,-3096,47,90,11385,-2837,47,-11,11458,-2536,47,-10,11708,-4708,47,104,12031,-139,47,148,12225,-6130,47,44,12282,-1293,47,94,12286,-4299,47,16,12305,1765,47,53,13030,-4732,47,14,13082,2147,47,1,13408,-5272,47,-11,13564,6763,47,154,13641,-7054,47,-15,13773,6351,47,38,14037,-2597,47,163,14080,-2883,47,89,14183,-2234,47,115,14461,465,47,131,15005,804,47,159,15648,3380,47,26,15685,-5764,47,47,15758,-7199,47,4,15831,4043,47,22,15968,3198,47,82,15969,-5918,47,156,16349,4319,47,-4,16546,-248,47,159,17417,-980,47,-7,17505,-3474,47,-7,17619,-1835,47,96,18022,661,47,12,18108,-6317,47,-8,18518,1779,47,101,18981,-800,47,124,19065,-4881,47,108,19141,-6098,47,105,19657,-4846,47,-15,19939,4057,47,31,19960,-1831,47,71,20299,-626,47,161,20361,4902,47,13,20941,-6369,47,108,21248,-5344,47,94,23494,-3441,47,96,23782,2098,47,153,24070,4604,47,-9,24080,-4923,47,90,24162,-4517,47,23,24224,3649,47,101,24509,-7870,47,168,25350,-4236,47,44,25915,-45,47,112,26995,-2382,47,-3,27001,1675,47,125,27126,-2958,47,77,27451,-2704,47,163,27591,-893,47,93,27730,-1457,47,8,28057,-905,47,36,28108,3967,47,17,28578,-4210,47,-3,29294,3445,47,-15,29309,6966,47,79,29484,3015,47,97,29856,846,47,102,29896,-2630,47,75,30028,2775,47,18,31316,-898,47,33,31496,4752,47,-8,31532,-3226,47,89,31759,1013,47,26,31948,-3217,47,7,32444,-785,47,18,32552,5119,47,-12,32566,-1887,47,87,33083,-5679,47,106,33083,-216,47,-10,34090,-1883,47,136,34360,8435,47,142,34748,-2246,47,67,35332,-2091,47,2,35377,-4262,47,8,35446,-4549,47,8,14268,-4047,47,60,40,-7707,48,125,365,2021,48,157,785,-4880,48,2,1052,5051,48,-10,1105,-1061,48,100,1325,-114,48,155,1327,6112,48,54,1375,5897,48,122,2191,4541,48,42,2255,614,48,137,2929,-4739,48,86,2948,2360,48,29,3212,3786,48,12,3331,4423,48,148,3426,3422,48,61,3989,-1187,48,45,4139,-6762,48,6,4262,-7507,48,134,4276,-2100,48,91,4639,5671,48,102,4896,-882,48,23,4984,337,48,68,5651,6335,48,75,6348,926,48,80,6539,4650,48,-2,6602,1744,48,15,6764,1619,48,17,7316,3670,48,141,7498,-1254,48,27,7536,-717,48,-16,7742,1560,48,31,7836,3848,48,19,7844,-6719,48,127,7937,-3490,48,99,8376,-600,48,-25,8472,-721,48,14,8532,1653,48,-12,8811,186,48,138,8950,2595,48,-9,9471,6932,48,3,9982,-1415,48,146,9983,4249,48,124,10183,804,48,140,10339,-2022,48,-21,10721,-3966,48,-18,10866,-4827,48,-9,10915,-2332,48,160,11345,-1452,48,136,11486,-3831,48,-19,11942,-3033,48,15,12008,-6357,48,-17,12211,5151,48,5,12337,-3590,48,-11,12535,-3305,48,142,12563,-4849,48,-15,12883,-5801,48,98,13061,-5311,48,-17,13760,6713,48,49,13905,5402,48,20,13994,-1197,48,93,14012,-956,48,91,14024,-6240,48,93,14377,3962,48,99,14532,-2359,48,-12,14605,-2777,48,52,15493,1947,48,45,15558,-4165,48,110,15766,5598,48,54,16056,-6447,48,-14,16103,-6396,48,-13,16514,362,48,114,16978,3819,48,11,17115,-1086,48,156,17258,-300,48,153,17632,826,48,17,17706,-6681,48,152,18563,2585,48,52,18601,5156,48,88,18663,-5145,48,-14,18871,2263,48,1,19359,-954,48,159,19473,1741,48,157,19589,-4953,48,3,19679,2762,48,148,19881,-6789,48,-8,19940,547,48,164,20186,-1597,48,110,20437,3629,48,24,20795,3444,48,161,20830,-3193,48,-11,21221,7755,48,137,21260,2509,48,54,21404,5137,48,24,21450,3551,48,106,21494,1631,48,123,21518,-4519,48,31,21565,-5846,48,80,21577,-2775,48,130,21705,-223,48,69,22086,2653,48,167,22553,2501,48,151,22595,4765,48,65,22821,-4450,48,-18,23549,-1968,48,157,23567,-3471,48,-15,23781,3566,48,100,24057,2280,48,7,24457,-2861,48,1,24552,103,48,34,24716,4188,48,129,24755,-2512,48,-12,24815,1149,48,150,25023,6459,48,121,25132,5678,48,38,25231,4598,48,9,25527,-422,48,148,25621,-3412,48,26,25933,3310,48,-17,26050,-6777,48,119,26285,-2396,48,2,26424,6876,48,43,26510,-4942,48,42,26729,-3170,48,-3,26755,-4009,48,26,27007,437,48,-10,27077,-818,48,41,27634,-2054,48,131,27650,6556,48,118,27814,5705,48,61,28136,-6487,48,20,28152,2666,48,120,28360,7130,48,115,28427,-585,48,106,28468,-3711,48,40,28905,2139,48,-6,29974,-2620,48,88,30089,-3794,48,142,30333,4682,48,10,30382,2559,48,-18,30445,3803,48,38,30517,-1276,48,-5,30722,-1781,48,39,30890,-6058,48,29,30963,2120,48,-3,31223,4611,48,57,31331,4439,48,-13,31610,-1985,48,17,32019,-4081,48,3,32448,6208,48,25,33245,7234,48,92,33390,-4135,48,79,33533,2833,48,-1,33538,1221,48,-13,33632,138,48,-17,33696,470,48,104,33766,-1068,48,-5,34044,2931,48,-1,34087,-4141,48,103,34141,-5350,48,118,34187,8315,48,126,34665,5942,48,-6,34678,2547,48,129,34944,4902,48,167,34966,6811,48,84,35544,-1782,48,82,16955,3153,48,60,24109,-1137,48,45,282,-1547,49,49,698,-3301,49,163,1221,5097,49,-9,2059,4553,49,108,2141,-1460,49,123,2917,-2253,49,143,3309,3030,49,77,3649,-1229,49,-3,3897,559,49,88,4056,4019,49,58,4477,3518,49,124,4798,7439,49,4,4873,2104,49,-1,4959,-2251,49,90,4968,3422,49,149,6271,-4199,49,33,6360,-1026,49,116,6432,2058,49,26,6510,3457,49,95,6797,-4,49,132,7248,3749,49,145,7481,3789,49,4,7536,-2005,49,-5,7686,1865,49,66,8119,185,49,-20,8191,2194,49,-14,8562,147,49,114,8725,2457,49,102,8739,1265,49,-7,8828,-3380,49,-15,9046,-1060,49,-13,9125,-1648,49,20,9500,-294,49,161,9622,4929,49,191,10156,5944,49,8,10407,-4872,49,167,10440,4509,49,3,10597,-4958,49,14,10756,-424,49,102,10791,3932,49,145,10831,-4518,49,0,10967,-2456,49,-16,11056,-1902,49,-4,11246,-2302,49,24,11277,8241,49,163,11392,-5253,49,137,11479,3458,49,41,11575,5871,49,10,11653,1851,49,143,11993,-368,49,121,12088,2779,49,113,12993,-2956,49,90,13043,-1594,49,106,13245,-4531,49,4,13388,-2768,49,14,13424,-5923,49,-18,13890,-3857,49,108,14556,-2392,49,53,14855,-2593,49,120,14872,-1901,49,156,15223,-5181,49,-12,15603,6557,49,-5,15776,-7322,49,168,15784,-5372,49,50,15877,7571,49,96,15931,-2741,49,163,15939,-1338,49,280,15965,-1688,49,92,16171,-6438,49,-15,16633,-2729,49,37,17307,-2926,49,54,17522,-6209,49,111,17663,-4050,49,66,17796,-6521,49,-12,17991,-7822,49,-5,18409,2395,49,96,18660,2727,49,28,19047,1024,49,8,19049,-5969,49,-4,19267,-3400,49,-3,19292,2754,49,68,19332,2124,49,90,19507,3079,49,117,19518,5637,49,37,19726,-2312,49,105,19801,-3780,49,69,19843,4015,49,106,19856,-5910,49,49,19930,-6678,49,148,20353,366,49,3,20370,3718,49,40,20743,2126,49,143,21271,-1630,49,168,21456,-8101,49,24,21584,845,49,1,22041,816,49,99,22125,-3519,49,1,22275,-230,49,99,22524,-852,49,0,22683,2487,49,43,22866,-3152,49,37,22941,-6361,49,126,23105,-1032,49,45,24085,-3860,49,-15,24136,-1980,49,-2,24300,-1006,49,9,24552,3089,49,97,24700,6877,49,-5,24712,-7008,49,56,24852,-4405,49,5,24969,4893,49,156,25039,-1774,49,110,25401,6513,49,48,25633,5447,49,47,25634,1274,49,13,26304,5518,49,25,26307,5517,49,28,26586,-2168,49,47,26920,-4434,49,118,26945,-4172,49,162,27171,-4343,49,26,27507,2196,49,159,27522,338,49,91,27794,-4591,49,-10,28088,-828,49,111,28108,-3564,49,-17,28331,5071,49,90,28354,-2274,49,141,28462,-5294,49,-5,28500,3215,49,147,28889,-2526,49,57,28941,-1895,49,101,29380,-4810,49,110,29422,-703,49,-5,29607,3735,49,95,29659,-1976,49,106,29777,2261,49,-15,29891,5244,49,12,30185,-5288,49,159,30236,3684,49,-14,30357,1520,49,7,30363,3681,49,15,30741,-289,49,116,30751,4895,49,-9,30918,-255,49,161,30940,-6153,49,45,31122,2527,49,118,31179,3437,49,129,31237,-4623,49,149,31249,-3378,49,100,32369,3853,49,109,33142,506,49,144,33254,-3255,49,49,33825,-6198,49,161,33982,3905,49,-21,34381,882,49,0,34921,-773,49,161,35251,5855,49,-12,35600,2936,49,94,35676,5865,49,112,35967,-356,49,93,35975,5575,49,-7,58,-2972,50,-15,113,-1051,50,162,258,4607,50,41,701,1789,50,158,1087,4702,50,17,1700,4394,50,11,1880,-4553,50,57,2002,5823,50,68,2484,4439,50,88,2515,4058,50,-7,2545,4261,50,62,2568,-369,50,138,2653,-5352,50,3,2900,6869,50,-8,3058,5449,50,-7,3164,2265,50,12,3236,2594,50,34,3846,-2823,50,-5,4470,-6407,50,13,4905,5094,50,111,5036,4333,50,5,5201,4906,50,-9,5556,-3194,50,-16,5559,3397,50,-5,5928,6111,50,144,5936,6307,50,-7,6033,-6108,50,139,6111,5916,50,50,6509,2735,50,115,6711,1636,50,114,6721,1305,50,22,6972,-1212,50,7,7051,-3714,50,39,7255,-1622,50,99,7554,-2628,50,106,7667,5160,50,34,7885,3269,50,22,7982,2210,50,94,8071,354,50,-10,8111,1738,50,54,8116,3739,50,145,8382,-539,50,60,8385,-542,50,-10,8521,-113,50,-20,8871,5571,50,5,8887,-3712,50,110,8977,-956,50,19,9081,-2628,50,134,9176,-6215,50,126,9188,-3725,50,-9,9281,-6559,50,160,9301,1613,50,-15,9394,-1372,50,-8,9411,1227,50,43,9448,6152,50,184,10077,4452,50,148,10269,4178,50,126,10272,-3437,50,138,10403,-1404,50,118,10573,-424,50,-19,10921,-3659,50,-16,10963,4946,50,9,11087,2505,50,90,11141,928,50,99,11245,2792,50,112,11487,1767,50,162,11510,-1526,50,154,11574,-4517,50,77,11649,-1456,50,34,11807,-3471,50,47,11837,2677,50,10,12167,-4527,50,149,12333,-1579,50,107,12736,-4472,50,-17,12868,-4994,50,130,13001,-1248,50,142,13649,509,50,119,13777,-4487,50,22,14299,1130,50,105,14330,-2112,50,102,14354,-5126,50,-18,14430,684,50,105,15574,-6690,50,-13,15824,-4700,50,105,16077,6908,50,141,16393,3351,50,110,16487,4043,50,62,16519,610,50,17,17071,4348,50,100,17080,-3616,50,146,17198,286,50,100,17487,-6540,50,80,17588,-6249,50,78,17749,-7023,50,136,18119,-7652,50,149,18413,3306,50,114,18475,-5514,50,160,18509,331,50,117,18646,3902,50,96,18675,2683,50,9,18753,6920,50,162,18868,7002,50,131,18878,1838,50,115,19801,-1620,50,46,20128,-7489,50,111,20211,1378,50,71,20236,-5117,50,6,20540,-870,50,162,20544,-5456,50,-5,20747,-1813,50,106,20914,2749,50,144,21307,241,50,-12,21374,-5709,50,-7,21704,-2949,50,-7,22321,-3780,50,-15,22924,-6096,50,-8,22927,7182,50,137,22983,177,50,54,23053,-4793,50,52,23080,3029,50,58,23273,4083,50,159,23285,7735,50,155,23295,4090,50,9,23507,-2382,50,130,23833,-2017,50,-1,23945,5475,50,27,23955,-1428,50,-8,23988,-4174,50,99,24036,2985,50,-5,24084,-2587,50,123,24202,1705,50,93,24337,-5463,50,102,24425,-5007,50,79,24438,7576,50,39,25294,2466,50,125,25547,-3214,50,-10,25578,1409,50,160,25965,1086,50,154,26008,1806,50,165,26727,5078,50,4,26736,7696,50,52,26977,-3025,50,165,27151,2222,50,166,27187,4346,50,91,27293,-2370,50,106,27298,3141,50,164,27347,6440,50,44,27539,4912,50,162,27598,5880,50,8,28066,5554,50,-7,28121,206,50,-5,28378,-2267,50,135,28406,420,50,20,28434,-2066,50,14,28536,4693,50,19,28848,5771,50,116,29014,-542,50,94,29071,-5442,50,2,29103,2962,50,-12,29132,-2451,50,24,29267,-279,50,177,29365,1977,50,-9,29661,3373,50,48,29724,1914,50,10,29766,5299,50,129,29897,3849,50,-9,29898,5885,50,158,29949,-1549,50,6,30044,-5938,50,136,30108,-3206,50,121,31364,2806,50,148,31961,4395,50,-6,32424,4041,50,20,32693,-3090,50,4,32981,7318,50,44,33211,-3404,50,150,33944,-423,50,114,34301,4331,50,156,34411,4973,50,178,34974,-961,50,-2,35121,6228,50,168,35173,126,50,4,35349,3133,50,138,35495,-1422,50,26,35651,4642,50,109,35660,349,50,251,35940,-6430,50,6,13117,-5471,50,60,24109,-1137,50,60,28660,-3706,50,60,46,-303,51,-13,362,-778,51,160,818,-6303,51,4,903,5417,51,-10,919,4449,51,159,1215,-7492,51,135,1224,1694,51,50,1860,-792,51,45,1945,361,51,7,2240,-2163,51,3,2859,-4250,51,-6,2934,1782,51,92,3701,-3381,51,9,4432,3193,51,-1,4590,-5974,51,35,4819,-120,51,57,4978,5009,51,-7,5069,2074,51,123,5117,6459,51,204,5250,5545,51,2,5260,1134,51,-4,5554,6322,51,165,5707,1114,51,-12,5730,2414,51,-8,5739,3309,51,6,5841,-3473,51,-13,6251,8070,51,59,6597,946,51,7,6771,-4495,51,-19,6979,1580,51,14,6998,5308,51,108,7284,1884,51,21,7509,8119,51,130,7624,-4958,51,148,7669,-466,51,-6,7718,-446,51,46,7885,-2694,51,-7,8000,3396,51,29,8044,-2477,51,66,8064,7923,51,51,8112,-89,51,96,8158,-5891,51,99,8191,3448,51,140,8382,-539,51,2,8747,-6690,51,-13,9086,1969,51,-10,9218,-6884,51,-7,9256,-7475,51,71,9297,-655,51,-20,9699,-476,51,-17,9841,-122,51,-13,9966,-4822,51,100,10191,-900,51,180,10248,-4661,51,46,10274,6757,51,-15,10343,6889,51,-11,10460,-3411,51,-15,10521,-5140,51,165,10591,1095,51,139,10608,-5675,51,-3,10770,-4893,51,125,10834,1616,51,165,10966,-3674,51,-17,11049,2044,51,153,11051,3676,51,108,11159,-5102,51,104,11234,2812,51,12,11358,-2347,51,47,11432,-411,51,44,11513,8702,51,160,11592,-4093,51,110,11685,-3851,51,-11,11688,3342,51,164,11792,177,51,-12,11933,-4411,51,-17,11947,-4558,51,126,11977,-2331,51,111,12127,1312,51,2,12340,-4699,51,-14,12349,-3632,51,-18,12458,-6561,51,113,12502,2722,51,49,12648,756,51,93,12690,-5309,51,26,12978,-2266,51,72,13264,-4653,51,-20,13910,-4427,51,164,14157,-5338,51,-10,14299,972,51,136,14344,-4901,51,-11,14347,-8094,51,-14,14508,-1433,51,-15,14663,5713,51,159,14715,4602,51,62,14749,-4573,51,-10,14813,-811,51,4,14942,4106,51,48,15155,-4737,51,88,15757,-64,51,-14,15850,-2375,51,160,15870,695,51,92,15909,-5956,51,117,16049,6572,51,121,16085,2319,51,4,16174,-5676,51,-8,16339,5459,51,136,16521,3921,51,26,16714,-6195,51,20,17084,-6495,51,-6,17084,-1878,51,44,17215,-4267,51,-3,17294,-5944,51,103,17295,-5952,51,43,17323,-3109,51,158,17425,-6128,51,111,17719,-2675,51,159,18305,7762,51,36,18400,1490,51,7,18523,-1357,51,105,18894,-4102,51,22,19166,1658,51,135,19365,-5717,51,-9,19922,-3151,51,96,19956,4968,51,-5,20153,-3976,51,118,21198,4385,51,149,21319,-2726,51,113,21489,-227,51,102,21560,-8011,51,-11,21605,582,51,12,22418,-6278,51,-2,22633,-4107,51,101,23366,-2805,51,131,23381,3901,51,165,23781,-309,51,14,23887,-6860,51,111,23922,-3397,51,13,24031,1782,51,99,24276,-2942,51,113,24381,-4737,51,-11,24906,5292,51,-3,25167,-6711,51,-8,25739,4078,51,127,25768,-4456,51,87,25950,-2429,51,105,26023,2450,51,0,26105,-4416,51,-5,26299,6814,51,108,26604,-5183,51,69,26720,2562,51,114,27176,3056,51,53,27222,2005,51,18,27525,2887,51,21,27558,-3866,51,150,27606,3951,51,5,27786,-1840,51,2,27801,-4576,51,-13,27876,-1098,51,93,28095,-3832,51,8,28368,-1560,51,14,28465,-6020,51,136,28674,1107,51,-5,28729,7656,51,31,28792,5686,51,101,28843,229,51,-7,28964,109,51,114,29137,1980,51,100,29269,2797,51,-9,29378,-1056,51,112,29521,4552,51,43,29563,-1612,51,32,29776,1042,51,56,29832,5752,51,-12,30034,5010,51,112,30129,1999,51,106,30172,2361,51,-16,30466,3498,51,66,30683,-1821,51,-5,30848,-4452,51,100,30963,2412,51,-13,30978,1009,51,70,31001,-6055,51,54,31049,-6676,51,-6,31212,-4399,51,36,31252,4406,51,20,31288,-5161,51,113,31618,-7702,51,49,31834,-7013,51,158,32489,224,51,103,32505,4327,51,160,32625,-908,51,111,32746,3017,51,1,32827,2593,51,-15,32832,-1355,51,38,32916,6363,51,155,33129,6228,51,24,33151,4501,51,157,33288,5941,51,19,33411,-4163,51,93,33501,-8044,51,128,33540,-2160,51,106,33894,7364,51,40,33966,5680,51,154,34102,4182,51,96,34502,5695,51,101,34565,4276,51,9,34587,-3475,51,31,34738,868,51,148,35009,538,51,120,35077,1231,51,132,35584,1033,51,169,35698,6781,51,1,35803,-8202,51,93,35812,1912,51,159,35973,-5275,51,112,25884,-2660,51,85,293,-3513,52,46,528,3797,52,44,538,-2898,52,101,706,4439,52,4,753,2975,52,27,759,-2379,52,13,881,-359,52,57,1118,-2201,52,35,1253,-1064,52,51,1267,-5099,52,36,1695,-4149,52,16,1706,5492,52,70,1778,3142,52,26,1843,758,52,32,2028,2874,52,140,2562,2027,52,84,2573,7062,52,-2,3043,-4471,52,147,3138,7612,52,95,3320,2121,52,46,3559,5585,52,37,3564,-2382,52,61,3610,5001,52,98,3803,3615,52,147,3951,7282,52,90,4016,-5455,52,41,4124,1245,52,23,4416,-371,52,8,4468,-278,52,1,4522,5235,52,-5,4664,-609,52,158,4955,-6251,52,60,4966,5022,52,-7,5407,-1747,52,-12,5613,-116,52,-9,5692,-2387,52,8,5758,2558,52,23,6165,2760,52,-12,6175,2900,52,36,6365,1001,52,-8,6418,5361,52,5,6547,-6339,52,96,6592,-375,52,7,6855,-823,52,171,6855,-897,52,147,6940,-247,52,28,7370,1143,52,12,7654,5897,52,-8,7689,-6340,52,165,7792,1605,52,153,8045,4180,52,-13,8087,5754,52,-1,8297,-7634,52,113,8391,-486,52,27,8493,2590,52,-15,8650,-3231,52,-27,8772,-5211,52,96,8874,5989,52,1,8971,55,52,1,9106,-671,52,-7,9371,1916,52,43,9442,-1682,52,129,9604,-1153,52,123,9670,5842,52,154,9681,30,52,119,9737,-5685,52,109,9785,-1239,52,126,9795,1154,52,19,10048,-917,52,153,10060,1765,52,6,10112,-3107,52,-13,10168,4358,52,57,10191,4879,52,113,10496,-6792,52,140,10548,-572,52,169,10560,2422,52,95,10601,-4234,52,20,10898,5964,52,108,10964,-3921,52,3,11104,4067,52,125,11117,-1620,52,-4,11193,2145,52,46,11201,694,52,22,11302,191,52,23,11666,3752,52,159,11688,-4661,52,-15,11742,-1723,52,128,11794,-1390,52,60,11987,-3930,52,40,11991,-6059,52,176,12240,-4412,52,-17,12243,-4794,52,-20,12382,-6292,52,9,12534,-3648,52,-19,12638,-5173,52,-16,12947,-2625,52,-3,12977,-7039,52,1,12999,-5305,52,-15,13008,-4026,52,-3,13049,-4541,52,17,13092,-4982,52,-20,13246,-3278,52,88,13299,4373,52,97,13392,2793,52,100,13431,1532,52,15,13472,-4723,52,27,13485,-5908,52,42,13489,3242,52,91,13544,-5219,52,-12,13694,1067,52,-9,13710,6687,52,151,13734,2205,52,97,13859,6142,52,61,13860,-4323,52,-14,13917,-635,52,117,14574,7225,52,103,14972,-3589,52,30,15338,-6637,52,22,15737,-274,52,-5,15879,5708,52,35,16089,4620,52,32,16162,-6426,52,-8,16337,-2014,52,48,16682,-4264,52,3,16819,-6417,52,-8,16932,201,52,151,17137,-3606,52,98,17143,-6397,52,50,17165,-6112,52,-8,17401,6932,52,97,17453,-6183,52,-4,17462,813,52,150,17543,-3250,52,148,17900,-1715,52,-2,18053,4305,52,28,18091,-4243,52,42,18196,-7537,52,128,18514,-2222,52,-9,18553,-6752,52,20,18608,2610,52,8,19032,-1301,52,43,19140,767,52,32,19387,6544,52,30,19427,-5120,52,-7,19644,3580,52,-6,19697,-1074,52,114,19785,-4337,52,105,19899,-1994,52,101,19919,942,52,59,20324,-1016,52,96,20673,-3625,52,-1,20868,-150,52,109,20963,-2497,52,-9,21302,6943,52,160,21497,-6127,52,28,22150,-2544,52,32,22176,-5238,52,98,22194,-2609,52,94,22267,-1600,52,40,22389,-6011,52,116,22620,-6403,52,94,22657,5456,52,96,22666,-1626,52,159,22866,6735,52,55,22902,-4149,52,56,23145,1543,52,165,23216,184,52,25,23361,-918,52,-9,23566,-3742,52,99,23667,6260,52,6,23757,220,52,102,24346,-1184,52,139,24367,3386,52,60,24559,3380,52,163,24693,-760,52,172,24764,2048,52,127,24771,-6163,52,124,25146,858,52,154,25194,525,52,0,25289,-4123,52,5,25365,-615,52,110,26082,-4747,52,-10,26150,-5063,52,106,26375,6187,52,60,26833,4001,52,117,27608,-4411,52,-16,27680,20,52,49,27809,-3970,52,8,28194,-4041,52,78,28242,-2032,52,140,28247,3255,52,10,28317,-5211,52,96,28426,3290,52,59,28658,-5234,52,53,28686,3250,52,37,28725,607,52,35,29071,2626,52,-12,29124,1194,52,76,29154,3632,52,-12,29416,4469,52,93,29480,540,52,0,29764,3872,52,167,29928,-5890,52,1,29998,3704,52,-13,30037,6482,52,160,30051,2494,52,37,30356,2869,52,19,30388,2351,52,102,30788,7495,52,10,30982,-1495,52,-13,30985,49,52,106,31001,-1814,52,165,31166,1612,52,50,31390,1372,52,112,31477,429,52,46,31631,-5473,52,120,31660,-3234,52,110,31672,3875,52,107,31891,-2065,52,116,31984,6487,52,-4,32072,681,52,6,32236,4654,52,97,32539,-1405,52,67,32550,-2326,52,99,32577,7232,52,106,33295,5684,52,53,33867,-2071,52,45,33966,6358,52,8,34189,-1961,52,94,34310,984,52,49,34793,872,52,14,34978,-1346,52,79,35066,-1504,52,20,35282,3924,52,103,35605,-1828,52,-8,35682,-5023,52,-16,35784,-1891,52,-12,19750,1753,52,60,27077,-818,52,38,251,-8222,53,105,304,-1794,53,148,1028,3946,53,89,1642,2147,53,0,1766,6878,53,-1,2253,4701,53,100,2463,7304,53,97,2554,-3233,53,104,2641,-2505,53,40,2991,6462,53,0,3031,-3000,53,88,3128,7728,53,35,3323,-3072,53,-1,3340,5107,53,93,3398,3336,53,0,3474,2864,53,4,3482,4738,53,1,3549,40,53,165,3704,2967,53,31,3788,227,53,127,3792,-7911,53,98,3935,-5254,53,29,4017,2706,53,8,4226,-6281,53,10,4232,1746,53,-7,4343,3834,53,42,4568,-769,53,94,4607,-760,53,19,5031,2115,53,-7,5080,4921,53,-8,5311,4606,53,40,5642,605,53,-10,5915,5070,53,43,6038,-155,53,-13,6094,544,53,-8,6339,772,53,37,6482,-4427,53,107,6490,2177,53,-11,6515,1510,53,23,6517,6514,53,82,6635,2220,53,25,6653,3144,53,99,6931,100,53,-11,7069,-5048,53,98,7073,4337,53,3,7109,-5973,53,21,7200,5676,53,25,7334,251,53,163,7370,778,53,121,7568,-7131,53,100,7695,2042,53,12,7697,850,53,34,7980,260,53,41,8000,-1232,53,-10,8088,-1393,53,-22,8317,-159,53,-19,8325,-6423,53,104,8357,377,53,5,8444,-2869,53,49,8556,-3467,53,-3,8661,-4660,53,104,8693,1390,53,-16,8700,645,53,23,8871,-5264,53,30,9192,-1917,53,166,9385,1614,53,-10,9493,-782,53,-18,9544,5345,53,45,9745,-5024,53,37,9809,-3770,53,98,9880,2802,53,-1,9945,-3234,53,118,9970,3990,53,-7,10150,-1480,53,8,10171,5717,53,96,10171,-1443,53,-2,10184,-3793,53,-8,10289,2176,53,-2,10327,5945,53,68,10395,-2294,53,-16,10807,-4050,53,7,10971,-2659,53,96,11340,1583,53,6,11379,3096,53,101,11602,5043,53,0,11603,2578,53,154,11657,1077,53,2,11726,-2491,53,75,11959,222,53,93,12107,-3267,53,188,12183,-2055,53,10,12194,2158,53,64,12320,6847,53,104,12495,-7151,53,-6,12552,-7340,53,1,12627,-2405,53,148,12727,-4793,53,-14,12790,1809,53,157,12818,2044,53,125,12881,-5822,53,-13,13181,-190,53,6,13234,-344,53,-8,13264,-6679,53,42,13346,-4752,53,28,13845,4322,53,-13,13858,-5557,53,98,13896,5674,53,157,13924,-3940,53,117,13936,-7489,53,2,13952,-5105,53,-6,14104,-8079,53,45,14459,4024,53,22,14518,-5798,53,20,14797,2440,53,23,14893,4982,53,9,14956,1244,53,-4,15218,-6582,53,97,15252,-1282,53,37,15335,-5123,53,26,15441,-807,53,34,15587,-3801,53,25,15722,-6417,53,186,15777,8256,53,40,16157,-6451,53,-10,16231,1055,53,4,16313,-5724,53,13,16897,1331,53,119,17227,3934,53,2,17398,-4764,53,26,17520,2135,53,98,17526,3420,53,72,17562,6674,53,127,17643,-4569,53,-12,17673,5563,53,128,17698,825,53,4,17868,-2571,53,88,18021,-1966,53,-19,18116,-6833,53,-1,18206,-4869,53,-1,18351,-4572,53,140,18495,4898,53,162,18590,-3541,53,-7,18723,2591,53,-6,19071,-6306,53,20,19399,-5684,53,1,19855,-1993,53,86,19932,1368,53,130,20131,-6449,53,41,20168,-1271,53,148,20802,-5281,53,-8,21207,4946,53,164,21371,1010,53,101,21620,-2481,53,96,22233,-1415,53,7,22358,-2464,53,134,22394,-3386,53,5,22862,2916,53,6,22880,494,53,109,23235,-4673,53,173,23412,1001,53,93,23446,4035,53,89,23545,1285,53,3,24511,-7867,53,141,24545,6911,53,112,24562,-4957,53,-5,24699,-6406,53,38,24792,-4182,53,30,24950,5602,53,106,25324,3170,53,32,25540,3357,53,3,25579,-5324,53,50,25812,1059,53,159,26084,-2814,53,155,26172,-4584,53,-6,26260,-106,53,72,26452,-5450,53,20,27060,2083,53,-10,27380,-2073,53,1,27479,2445,53,151,27570,1783,53,125,27572,-3667,53,-12,27849,-3302,53,-11,28144,7409,53,95,28370,-8761,53,130,28456,1736,53,73,28477,1362,53,57,28494,2623,53,123,28683,3610,53,-11,28747,-6842,53,90,28945,1160,53,20,29367,4241,53,6,29518,-1629,53,111,29564,1183,53,57,29700,-5636,53,20,29796,-3987,53,-4,29906,1142,53,1,29996,-3470,53,17,30001,1752,53,158,30047,-6694,53,122,30280,-3610,53,87,30420,2467,53,95,30423,4037,53,165,30485,-1912,53,139,30579,534,53,98,31342,-3981,53,132,31457,2233,53,142,31477,429,53,46,31574,-3863,53,42,31714,-2119,53,0,31826,-3942,53,46,31894,-1517,53,164,32172,4884,53,11,32184,3712,53,-14,32302,-4118,53,111,32556,568,53,165,32652,2295,53,138,32754,1729,53,39,32773,-8272,53,76,33097,6312,53,156,33120,-91,53,23,33125,6279,53,141,33320,3460,53,113,33329,8611,53,-3,33358,-2107,53,81,33420,-1283,53,113,33615,-7226,53,66,33623,-5780,53,67,34037,4023,53,-14,34259,-8012,53,-13,34427,4868,53,-10,34589,6721,53,125,34691,4639,53,141,35337,2250,53,148,35516,-3207,53,97,35562,-1545,53,134,35650,-1868,53,30,35815,1095,53,19,234,-2799,54,41,289,-2780,54,135,515,819,54,134,620,6183,54,1,711,-3992,54,156,815,2029,54,107,998,2144,54,116,1062,-6547,54,52,1132,5522,54,2,1164,1548,54,156,1194,7485,54,-7,1268,6425,54,53,1401,-1127,54,151,1446,2899,54,108,1570,-4640,54,90,1576,-484,54,111,1683,-6178,54,88,1915,-250,54,89,2117,-4149,54,103,2156,1917,54,40,2400,-1540,54,123,2650,-573,54,152,2832,4073,54,131,2994,-2082,54,164,3011,-852,54,139,3080,13,54,15,3551,-1078,54,36,3555,-88,54,34,3622,-6031,54,40,3804,-103,54,100,3895,3469,54,165,4064,-5080,54,56,4102,4430,54,90,4248,-2794,54,1,4435,-2386,54,24,5008,7773,54,21,5709,2342,54,-7,5731,7087,54,10,5899,4787,54,-7,6065,-27,54,52,6104,283,54,51,6259,-692,54,94,6271,2648,54,35,6516,-2064,54,-3,6545,6074,54,150,6565,2563,54,-4,6676,8082,54,118,6766,1372,54,26,6978,787,54,26,6999,5347,54,33,7111,1115,54,25,7151,1171,54,20,7496,-1026,54,80,7570,-4915,54,42,7733,983,54,25,7809,7395,54,-11,7975,3375,54,-17,7984,-5061,54,52,8179,1796,54,-9,8254,6307,54,170,8338,-116,54,-17,8386,2404,54,-9,8466,3049,54,45,8496,-3263,54,91,8784,-752,54,-19,9165,3848,54,25,9166,-419,54,-12,9250,5894,54,110,9321,6572,54,134,9392,6000,54,134,9394,1255,54,2,9428,994,54,11,9471,-939,54,124,9637,-6969,54,97,9796,-816,54,137,9846,-3623,54,142,9914,3845,54,277,10119,2897,54,145,10156,7956,54,53,10172,-5127,54,133,10224,-1514,54,-10,10286,-7096,54,-11,10360,-113,54,17,10667,-1129,54,3,10785,-30,54,31,10858,311,54,119,10884,-3069,54,-15,11016,-5209,54,-7,11075,-3192,54,-16,11087,-2783,54,154,11088,-3220,54,-17,11118,-3181,54,107,11124,1167,54,11,11227,-3881,54,-15,11248,4967,54,47,11346,-3634,54,-8,11532,-3853,54,-13,11640,-3417,54,59,11826,-3636,54,116,11892,1988,54,-4,11924,-4350,54,-17,12005,7392,54,142,12120,7948,54,-4,12289,-777,54,89,12788,-1958,54,-6,13025,4583,54,99,13163,-4591,54,24,13356,3058,54,105,13398,1163,54,146,13417,-8566,54,31,13424,3291,54,18,13700,2965,54,89,13881,1494,54,132,13932,-6869,54,42,14194,-607,54,64,14211,906,54,61,14217,4560,54,99,14289,3510,54,154,14308,-4065,54,90,14392,3581,54,77,14430,-5367,54,14,14593,1402,54,161,14659,-7678,54,90,15025,3192,54,68,15417,1373,54,165,15805,1414,54,170,16067,-5922,54,21,16147,3068,54,-5,16172,-1730,54,11,16623,-3580,54,2,16718,-2808,54,7,16814,-4910,54,18,16844,-7,54,-2,17101,141,54,94,17341,-4059,54,12,17683,-5770,54,166,17956,-5632,54,-6,17999,366,54,0,18571,-5768,54,-10,18687,-5899,54,154,18749,5841,54,21,18841,3325,54,101,18943,-2714,54,33,19128,4544,54,299,19189,6679,54,157,19231,8341,54,3,19498,6660,54,128,19703,-6531,54,-3,20075,-1774,54,99,20211,5995,54,-1,20550,-5879,54,-3,20577,354,54,109,20686,-1786,54,162,21482,1300,54,39,21661,1923,54,23,21717,-690,54,149,21759,-4952,54,6,21933,-4613,54,93,21971,4440,54,3,22132,-6288,54,31,22407,-5281,54,14,22447,-7666,54,144,22970,-6050,54,-9,23026,72,54,119,23045,3293,54,-5,23119,-3971,54,-9,23288,-7339,54,-15,23405,-4440,54,150,23471,-5237,54,1,23473,-1930,54,88,23602,-1567,54,24,23652,-180,54,-4,23847,-2453,54,-1,23848,-2398,54,-3,23866,4314,54,165,23895,3795,54,35,23965,-2483,54,-9,24026,3330,54,61,24158,6781,54,-2,24203,-2633,54,164,24246,-347,54,145,24303,-855,54,12,24431,5976,54,155,24482,-4267,54,10,24562,3370,54,152,24601,-3919,54,63,24613,-3757,54,-10,24617,-2970,54,63,24714,67,54,146,24743,-4624,54,49,25373,2096,54,97,25384,1843,54,141,25701,3594,54,31,25745,-1052,54,47,26004,2554,54,6,26016,3247,54,62,26052,-7012,54,-4,26221,33,54,24,26416,4859,54,114,26880,7201,54,34,26920,-408,54,116,27071,-2428,54,50,27428,-5602,54,-5,27479,726,54,108,27504,-1583,54,147,27554,2329,54,163,27673,-4812,54,86,27742,-199,54,96,27777,-3299,54,18,27849,5235,54,109,27912,912,54,39,27916,3347,54,-10,27916,667,54,39,27990,-4319,54,165,28124,-3969,54,85,28159,-2239,54,159,28159,7543,54,5,28187,-571,54,128,28307,2143,54,-7,28407,-4271,54,100,28417,-3734,54,-15,28506,5053,54,-18,28573,-370,54,0,28623,5340,54,-1,28624,-403,54,112,28817,-794,54,9,28909,-4547,54,135,29371,2946,54,58,29486,4282,54,-6,29736,-7250,54,23,29769,-5919,54,8,29769,-1076,54,40,30139,6200,54,119,30159,3597,54,85,30331,-101,54,143,30706,8142,54,101,30783,4922,54,157,30849,1303,54,9,30945,1138,54,5,31055,5034,54,-11,31189,8055,54,114,31233,-6878,54,112,31530,4616,54,-21,31832,-2762,54,143,31949,-1799,54,-12,32104,-2085,54,118,32192,2761,54,5,32194,6681,54,-10,33021,-2845,54,-9,33248,-3401,54,24,33266,-1156,54,-12,33279,5082,54,15,33301,6076,54,118,33456,-5363,54,61,33505,-782,54,-5,33511,579,54,-4,34244,5590,54,117,34276,-3916,54,144,34486,96,54,98,34617,-5396,54,145,34629,-769,54,31,34717,213,54,91,34751,982,54,-7,34987,4863,54,101,35048,3181,54,-10,35478,5047,54,-6,35539,-1803,54,158,35721,6221,54,67,25032,3160,54,60,31862,1001,54,60,516,-6962,55,-5,934,3540,55,89,979,4935,55,164,1155,-2252,55,98,1317,-2401,55,127,1374,2363,55,101,1375,-6953,55,110,1561,-3155,55,8,1570,3180,55,-4,2167,1924,55,111,2323,-3687,55,102,2652,-5082,55,162,3074,3328,55,3,3620,1061,55,-10,3970,2196,55,17,4267,-3568,55,126,4496,4722,55,87,4636,2526,55,-3,4653,7942,55,157,4945,4403,55,-6,5035,-2364,55,89,5108,2472,55,119,5304,4802,55,-10,5620,2429,55,-3,5817,-536,55,-9,5912,3508,55,-6,6099,820,55,37,6109,2411,55,81,6232,-1639,55,-15,6370,-6219,55,111,6481,5005,55,24,6486,2114,55,-7,6750,8334,55,86,6766,1569,55,26,6983,-1436,55,105,7001,1220,55,-12,7190,-1693,55,63,7302,6351,55,156,7380,-7494,55,152,7410,-517,55,-12,7703,2427,55,3,7868,516,55,137,7942,-1352,55,93,8006,4109,55,12,8232,2515,55,-4,8254,-4708,55,62,8281,329,55,-18,8306,1706,55,0,8321,-3851,55,122,8648,4983,55,3,8686,1773,55,30,8740,-1448,55,87,8757,-7936,55,-8,9163,-2311,55,6,9197,-4215,55,1,9224,-2243,55,-1,9535,-1177,55,0,10414,-7942,55,4,10439,-2463,55,39,10581,-5918,55,-12,10709,1593,55,102,10758,-2749,55,100,10835,5143,55,164,10906,-1559,55,8,11009,-5231,55,48,11295,1709,55,113,11651,-677,55,138,11699,-1219,55,48,11855,-3588,55,-17,11868,4756,55,146,12647,-4215,55,-14,12865,6515,55,21,12933,-6285,55,101,12985,-5344,55,-13,13033,-7896,55,-10,13057,-4810,55,-17,13058,-5310,55,-13,13241,-4032,55,7,13568,2445,55,-4,13635,4853,55,48,13740,-879,55,100,13917,-874,55,-8,14178,-7160,55,108,14248,-2659,55,135,14252,-5152,55,-8,14290,-7308,55,156,14997,5681,55,149,15406,2931,55,2,15880,-3956,55,299,15936,-5873,55,50,16132,-8047,55,96,16160,1889,55,113,16161,1419,55,91,16343,-213,55,97,16506,4553,55,147,17309,6108,55,52,17374,-4914,55,104,17439,-4775,55,123,17467,-1320,55,52,18277,-2360,55,6,18471,7516,55,5,18709,-3904,55,-7,18736,2411,55,45,18775,2457,55,6,18792,-5942,55,62,18844,-945,55,-4,18978,2106,55,98,19100,-2832,55,135,19374,-8512,55,99,19383,-4292,55,167,20016,-5275,55,-12,20430,7124,55,122,20488,5292,55,11,20648,-1243,55,90,20691,-5032,55,135,21059,-2743,55,133,21168,-931,55,35,22262,3727,55,103,22286,5929,55,137,22419,-1141,55,149,22575,-3264,55,-13,22782,-5535,55,112,23157,3434,55,141,23183,-3677,55,-15,23315,-1967,55,20,23324,-119,55,109,23571,5236,55,-4,23864,2031,55,159,24008,-1653,55,52,24247,-3355,55,-7,24271,7588,55,-9,24331,502,55,147,24391,-837,55,65,24418,-5381,55,170,24498,3971,55,41,24858,-7099,55,124,24894,-6550,55,95,24909,-4286,55,34,25170,-3938,55,98,25258,725,55,11,25351,-4181,55,18,25430,-3326,55,161,25976,-4664,55,76,26885,2605,55,34,27201,3640,55,116,27261,-6200,55,59,27267,332,55,120,27330,-4134,55,-15,27357,-2171,55,153,27397,-4421,55,96,27590,-7504,55,4,27818,-1487,55,200,27821,3055,55,-8,27847,-2403,55,180,28221,-4368,55,13,28372,4160,55,103,28610,-3105,55,3,28943,2303,55,2,29015,-89,55,-4,29137,-2396,55,144,29247,-2699,55,112,29439,-1430,55,50,29445,-465,55,43,29589,-1547,55,46,29593,2577,55,94,29931,4037,55,-9,30551,2445,55,-9,31008,-3343,55,112,31158,-3920,55,-8,31333,4518,55,109,31347,3344,55,152,31423,-970,55,147,31719,-8896,55,28,32105,-1288,55,30,32132,-356,55,145,32176,-4255,55,39,32219,-6951,55,155,32444,1932,55,32,32909,-3725,55,8,32982,-3840,55,100,33358,-2777,55,-12,33446,-7751,55,31,33650,7077,55,122,33716,-3913,55,96,33747,7882,55,9,34437,2077,55,67,35201,-8748,55,128,35449,1840,55,1,35699,-276,55,94';

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
const CONST_DATA = JSON.parse('[["And","Andromeda",0.75,43,[[30.97,42.33,17.43,35.62,9.83,30.86,2.1,29.09],[14.3,23.42,11.83,24.27,9.64,29.31,9.83,30.86,9.22,33.72,-5.47,43.27,-14.52,42.33],[-5.47,43.27,-4.9,44.33,-5.61,46.46],[17.43,35.62,14.19,38.5,12.45,41.08,17.38,47.24,24.5,48.63],[-4.9,44.33,-3.49,46.42]]],["Ant","Antlia",156,-36,[[142.31,-35.95,156.79,-31.07,164.18,-37.14]]],["Aps","Apus",-120,-74,[[-138.03,-79.04,-114.91,-78.7,-109.23,-77.52,-111.64,-78.9]]],["Aqr","Aquarius",-22.5,-5,[[-48.08,-9.5,-46.84,-8.98,-37.11,-5.57,-28.55,-0.32,-24.59,-1.39,-22.79,-0.02,-21.16,-0.12,-16.85,-7.58,-10.52,-9.18,-12.64,-21.17],[-37.11,-5.57,-28.39,-13.87],[-28.55,-0.32,-25.79,-7.78],[-22.79,-0.02,-23.68,1.38],[-9.26,-20.1,-10.52,-9.18,-4.56,-17.82]]],["Aql","Aquila",-69,8,[[-63.44,10.61,-62.3,8.87,-61.17,6.41,-57.17,-0.82,-61.88,1.01,-68.63,3.11,-73.65,13.86,-62.3,8.87,-68.63,3.11,-73.44,-4.88]]],["Ara","Ara",-102,-56,[[-98.65,-56.38,-97.23,-60.68,-107.55,-59.04,-105.34,-55.99,-105.1,-53.16,-97.04,-49.88,-98.67,-55.53]]],["Ari","Aries",42,22,[[42.5,27.26,31.79,23.46,28.66,20.81,28.38,19.29]]],["Aur","Auriga",82.5,37,[[89.88,44.95,79.17,46,76.63,41.23,74.25,33.17,81.57,28.61,89.93,37.21,89.88,44.95,89.88,54.28,79.17,46,75.49,43.82,75.62,41.08]]],["Boo","Boötes",-136.5,35,[[-153.18,17.46,-151.33,18.4,-146.08,19.18,-142.04,30.37,-141.98,38.31,-134.51,40.39,-131.12,33.31,-138.75,27.07,-146.08,19.18,-139.71,13.73],[-141.98,38.31,-145.9,46.09,-146.63,51.79,-143.7,51.85,-145.9,46.09]]],["Cae","Caelum",73.5,-42,[[67.71,-44.95,70.14,-41.86,70.51,-37.14,76.1,-35.48]]],["Cam","Camelopardalis",84,72,[[74.32,53.75,75.85,60.44,73.51,66.34,57.59,71.33,57.38,65.53,52.27,59.94],[73.51,66.34,94.71,69.32,105.02,76.98]]],["Cnc","Cancer",128.25,27,[[134.62,11.86,131.17,18.15,130.82,21.47,131.67,28.77],[131.17,18.15,124.13,9.19]]],["CVn","Canes Venatici",-168,43,[[-166,38.31,-171.56,41.36]]],["CMa","Canis Major",97.5,-26,[[95.67,-17.96,101.29,-16.72,105.76,-23.83,107.1,-26.39,105.43,-27.93,104.66,-28.97,95.08,-30.06],[111.02,-29.3,107.1,-26.39],[101.29,-16.72,104.03,-17.05,105.94,-15.63,103.55,-12.04,104.03,-17.05]]],["CMi","Canis Minor",109.5,5,[[114.83,5.23,111.79,8.29]]],["Cap","Capricornus",-45,-22,[[-55.59,-12.51,-54.75,-14.78,-52.78,-17.81,-48.48,-25.27,-47.04,-26.92,-38.33,-22.41,-33.24,-16.13,-34.98,-16.66,-39.44,-16.83,-43.51,-17.23,-55.59,-12.51]]],["Car","Carina",144,-66,[[99.44,-43.2,95.99,-52.7,138.3,-69.72,153.43,-70.04,160.74,-64.39,158.01,-61.69,154.27,-61.33,139.27,-59.28,125.63,-59.51,119.19,-52.98,122.38,-47.34,131.18,-54.71,139.27,-59.28],[160.74,-64.39,166.64,-62.42,167.14,-61.95,168.15,-60.32,167.15,-58.97,163.37,-58.85,158.01,-61.69]]],["Cas","Cassiopeia",-6,55.5,[[28.6,63.67,21.45,60.24,14.18,60.72,10.13,56.54,2.29,59.15]]],["Cen","Centaurus",-160.5,-40,[[170.25,-54.49,-177.91,-50.72,-172.99,-50.23,-169.62,-48.96,-155.03,-53.47,-151.12,-47.29,-152.6,-42.47,-152.62,-41.69,-148.33,-36.37,-141.12,-42.16,-135.21,-42.1],[-152.62,-41.69,-159.85,-36.71],[-140.1,-60.84,-155.03,-53.47,-149.04,-60.37],[-172.99,-50.23,-177.09,-52.37,172.94,-59.44]]],["Cep","Cepheus",-22.5,71,[[-52.6,62.99,-48.68,61.84,-40.36,62.59,-34.12,58.78,-26.24,57.04,-27.29,58.2,-22.71,58.42,-17.58,66.2,-5.16,77.63,-37.83,70.56,-40.36,62.59],[-37.83,70.56,-17.58,66.2]]],["Cet","Cetus",28.5,-5,[[40.83,3.24,38.97,5.59,37.04,8.46,41.24,10.11,44.93,8.91,45.57,4.09,40.83,3.24,39.87,0.33,34.84,-2.98,27.87,-10.33,26.02,-15.94,10.9,-17.99,4.86,-8.82,17.15,-10.18,21.01,-8.18,27.87,-10.33]]],["Cha","Chamaeleon",-171,-81,[[124.63,-76.92,158.87,-78.61,161.32,-80.47,-175.41,-79.31,179.91,-78.22,158.87,-78.61]]],["Cir","Circinus",-142.5,-67,[[-130.62,-58.8,-139.37,-64.98,-129.16,-59.32]]],["Col","Columba",85.5,-39,[[95.53,-33.44,87.74,-35.77,84.91,-34.07,82.8,-35.47],[87.74,-35.77,89.79,-42.82]]],["Com","Coma Berenices",-166.5,24,[[-162.5,17.53,-162.03,27.88,-173.27,28.27]]],["CrA","Corona Austrina",-78,-40,[[-75.32,-37.11,-73.4,-37.06,-72.63,-37.9,-72.49,-39.34,-72.91,-40.5,-74.22,-42.1,-77.6,-43.43,-81.62,-42.31]]],["CrB","Corona Borealis",-121.5,32,[[-126.77,31.36,-128.04,29.11,-126.33,26.71,-124.31,26.3,-122.6,26.07,-120.6,26.88,-119.64,29.85]]],["Crv","Corvus",-174,-19.5,[[-177.9,-24.73,-177.47,-22.62,-176.05,-17.54,-172.53,-16.52,-171.4,-23.4,-177.47,-22.62]]],["Crt","Crater",174.75,-15,[[174.17,-9.8,171.15,-10.86,169.84,-14.78,164.94,-18.3,167.91,-22.83,170.84,-18.78,171.22,-17.68,176.19,-18.35,179,-17.15],[169.84,-14.78,171.22,-17.68]]],["Cru","Crux",-166.5,-62,[[-168.07,-59.69,-176.21,-58.75],[-173.35,-63.1,-172.21,-57.11]]],["Cyg","Cygnus",-52.5,50,[[-41.77,30.23,-48.45,33.97,-54.44,40.26,-63.76,45.13,-67.57,51.73,-70.72,53.37],[-49.64,45.28,-54.44,40.26,-60.92,35.08,-67.32,27.96]]],["Del","Delphinus",-51,6,[[-51.7,11.3,-50.61,14.6,-50.09,15.91,-48.34,16.12,-49.14,15.07,-50.61,14.6]]],["Dor","Dorado",76.5,-64,[[64.01,-51.49,68.5,-55.04,83.41,-62.49,86.19,-65.74,88.53,-63.09,83.41,-62.49,76.38,-57.47,68.5,-55.04]]],["Dra","Draco",-91.5,64,[[-91.62,56.87,-90.85,51.49,-97.39,52.3,-96.93,55.17,-91.62,56.87,-71.86,67.66,-84.81,71.34,-102.8,65.71,-114,61.51,-119.53,58.57,-128.77,58.97,-148.9,64.38,-171.63,69.79,172.85,69.33],[-84.81,71.34,-84.74,72.73],[-71.86,67.66,-62.96,70.27]]],["Equ","Equuleus",-39.75,11.5,[[-41.04,5.25,-41.38,10.01,-42.41,10.13]]],["Eri","Eridanus",52.5,-18,[[76.96,-5.09,71.38,-3.25,69.08,-3.35,62.97,-6.84,59.51,-13.51,56.54,-12.1,55.81,-9.76,53.23,-9.46,44.11,-8.9,41.03,-13.86,41.28,-18.57,45.6,-23.62,49.88,-21.76,53.45,-21.63,56.71,-23.25,68.89,-30.56,66.01,-34.02,64.47,-33.8,57.36,-36.2,54.27,-40.27,49.98,-43.07,44.57,-40.3,40.17,-39.86,36.75,-47.7,34.13,-51.51,28.99,-51.61,24.43,-57.24]]],["For","Fornax",40.5,-28,[[48.02,-28.99,42.27,-32.41,31.12,-29.3]]],["Gem","Gemini",107.25,23.5,[[93.72,22.51,95.74,22.51,100.98,25.13,107.78,30.25,113.65,31.89,116.33,28.03,113.98,26.9,110.03,21.98,106.03,20.57,99.43,16.4,101.32,12.9],[110.03,21.98,109.52,16.54]]],["Gru","Grus",-18,-41.5,[[-14.78,-52.75,-17.86,-51.32,-19.33,-46.88,-22.56,-43.75,-27.94,-46.96,-19.33,-46.88],[-22.68,-43.5,-26.1,-41.35,-28.47,-39.54,-31.52,-37.36]]],["Her","Hercules",-106.5,35,[[-114.52,19.15,-112.44,21.49,-109.68,31.6,-109.28,38.92,-111.47,42.44,-115.06,46.31,-117.81,44.93,-121.83,42.45],[-109.68,31.6,-104.93,30.93],[-109.28,38.92,-101.24,36.81],[-90.94,37.25,-99.08,37.15,-101.24,36.81,-104.93,30.93,-101.24,24.84,-93.39,27.72,-90.56,29.25,-88.11,28.76],[-101.34,14.39,-112.44,21.49]]],["Hor","Horologium",51,-52,[[63.5,-42.29,40.64,-50.8,39.35,-52.54,40.17,-54.55,45.9,-59.74,44.7,-64.07]]],["Hya","Hydra",150,-22,[[131.69,6.42,132.11,5.84,130.81,3.4,129.69,3.34,129.41,5.7,131.69,6.42,133.85,5.95,138.59,2.31,144.96,-1.14,141.9,-8.66,147.87,-14.85,152.65,-12.35,156.52,-16.84,162.41,-16.19,173.25,-31.86,178.23,-33.91,-160.27,-23.17,-148.41,-26.68,-137.43,-27.96]]],["Hyi","Hydrus",34.5,-72,[[6.44,-77.25,56.81,-74.24,39.9,-68.27,35.44,-68.66,28.73,-67.65,29.69,-61.57]]],["Ind","Indus",-42,-55.5,[[-50.61,-47.29,-48.99,-51.92,-46.3,-58.45,-30.52,-54.99,-40.03,-53.45,-50.61,-47.29]]],["Lac","Lacerta",-18,47,[[-24.11,52.23,-22.18,50.28,-22.62,47.71,-24.74,46.54,-22.38,43.12,-19.87,44.28,-22.62,47.71,-23.87,49.48,-24.11,52.23],[-22.38,43.12,-26.53,39.71,-26.01,37.75]]],["Leo","Leo",159,15,[[152.09,11.97,151.83,16.76,154.99,19.84,168.53,20.52,177.26,14.57,168.56,15.43,152.09,11.97],[154.99,19.84,154.17,23.42,148.19,26.01,146.46,23.77]]],["LMi","Leo Minor",157.5,30,[[151.86,35.24,156.48,33.8,163.33,34.21,156.97,36.71,151.86,35.24,143.56,36.4]]],["Lep","Lepus",88.5,-25,[[91.54,-14.94,89.1,-14.17,86.74,-14.82,83.18,-17.82,78.23,-16.21,76.37,-22.37,82.06,-20.76,86.12,-22.45,87.83,-20.88],[78.31,-12.94,78.23,-16.21,79.89,-13.18]]],["Lib","Libra",-129,-26,[[-133.98,-25.28,-137.28,-16.04,-130.75,-9.38,-126.12,-14.79,-125.74,-28.14,-125.34,-29.78],[-137.28,-16.04,-126.12,-14.79]]],["Lup","Lupus",-131.25,-35,[[-122.26,-33.63,-125.06,-34.41,-129.55,-36.26,-129.66,-40.65,-135.37,-43.13,-139.52,-47.39,-131.93,-52.1,-130.37,-47.88,-129.33,-44.69,-126.21,-41.17,-119.97,-38.4,-118.35,-36.8],[-129.66,-40.65,-126.21,-41.17]]],["Lyn","Lynx",121.5,49,[[94.91,59.01,104.32,58.42,111.68,49.21,125.71,43.19,135.16,41.78,139.71,36.8,140.26,34.39]]],["Lyr","Lyra",-81,30,[[-78.81,37.61,-78.91,39.61,-80.77,38.78,-78.81,37.61,-76.37,36.9,-75.26,32.69,-77.48,33.36,-78.81,37.61]]],["Men","Mensa",82.5,-80,[[92.56,-74.75,82.97,-76.34,73.8,-74.94,75.68,-71.31]]],["Mic","Microscopium",-43.5,-37,[[-47.51,-33.78,-47.88,-43.99,-39.81,-40.81,-40.52,-32.17,-44.68,-32.26,-47.51,-33.78]]],["Mon","Monoceros",114.75,-6,[[115.31,-9.55,122.15,-2.98,107.97,-0.49,97.2,-7.03,93.71,-6.27],[107.97,-0.49,101.97,2.41,95.94,4.59,98.23,7.33,100.24,9.9]]],["Mus","Musca",-165,-73,[[176.4,-66.73,-175.61,-67.96,-170.7,-69.14,-168.43,-68.11,-164.43,-71.55,-171.88,-72.13,-170.7,-69.14]]],["Nor","Norma",-117,-52,[[-118.38,-45.17,-113.2,-47.55,-115.04,-50.16,-119.2,-49.23,-118.38,-45.17]]],["Oct","Octans",-60,-80,[[-143.27,-83.67,-18.49,-81.38,-34.63,-77.39,-143.27,-83.67]]],["Oph","Ophiuchus",-102,3,[[-90.24,-9.77,-93.03,2.71,-94.13,4.57,-96.27,12.56,-105.58,9.38,-112.27,1.98,-116.41,-3.69,-115.42,-4.69,-110.71,-10.57,-102.41,-15.72],[-105.58,9.38,-110.71,-10.57,-112.22,-16.61,-113.24,-18.46,-113.97,-20.04,-113.6,-23.45],[-94.13,4.57,-102.41,-15.72,-99.5,-25,-98.16,-29.87]]],["Ori","Orion",84,13,[[91.89,14.77,88.6,20.28,90.98,20.14,92.99,14.21,90.6,9.65,88.79,7.41,81.28,6.35,73.72,10.15],[74.64,1.71,73.56,2.44,72.8,5.61,72.46,6.96,72.65,8.9,73.72,10.15,74.09,13.51,76.14,15.4,77.42,15.6],[78.63,-8.2,81.12,-2.4,83,-0.3,81.28,6.35,83.78,9.93,88.79,7.41,85.19,-1.94,86.94,-9.67],[85.19,-1.94,84.05,-1.2,83,-0.3]]],["Pav","Pavo",-63,-62,[[-53.59,-56.74,-48.76,-66.2,-57.82,-66.18,-76.95,-62.19,-84.19,-61.49,-87.85,-63.67,-93.57,-64.72,-79.24,-71.43,-59.85,-72.91,-48.76,-66.2,-38.39,-65.37]]],["Peg","Pegasus",-25.5,16,[[-27.5,33.18,-19.25,30.22,-14.06,28.08,2.1,29.09,3.31,15.18,-13.81,15.21,-18.33,12.17,-19.63,10.83,-27.45,6.2,-33.95,9.88],[-13.81,15.21,-14.06,28.08,-17.5,24.6,-18.37,23.57,-28.25,25.35,-33.84,25.65]]],["Per","Perseus",66,45,[[56.08,32.29,58.53,31.88,59.74,35.79,59.46,40.01,56.3,42.58,55.73,47.79,54.12,48.19,51.08,49.86,46.2,53.51,42.67,55.9,43.56,52.76,47.27,49.61,47.37,44.86,47.04,40.96,47.82,39.61,46.29,38.84,44.69,39.66,44.92,41.03,47.04,40.96],[61.65,50.35,63.72,48.41,62.17,47.71,55.73,47.79],[47.27,49.61,41.05,49.23,25.92,50.69]]],["Phe","Phoenix",16.5,-43,[[6.57,-42.31,16.52,-46.72,22.09,-43.32,22.81,-49.07,17.1,-55.25,16.52,-46.72,2.35,-45.75,6.57,-42.31]]],["Pic","Pictor",82.5,-50,[[102.05,-61.94,87.46,-56.17,86.82,-51.07]]],["Psc","Pisces",19.5,15,[[18.44,24.58,17.92,30.09,19.87,27.26,18.44,24.58,17.86,21.03,22.87,15.35,26.35,9.16,30.51,2.76,28.39,3.19,25.36,5.49,22.55,6.14,18.43,7.58,15.74,7.89,12.17,7.59,-0.17,6.86,-5.01,5.63,-8.01,6.38,-9.91,5.38,-10.71,3.28,-8.27,1.26,-4.49,1.78,-3.4,3.49,-5.01,5.63],[-10.71,3.28,-14.03,3.82]]],["PsA","Piscis Austrinus",-27,-29,[[-19.84,-27.04,-15.59,-29.62,-16.01,-32.54,-16.87,-32.88,-22.12,-32.35,-27.9,-32.99,-33.76,-33.03,-33.07,-30.9,-27.9,-32.99,-19.84,-27.04]]],["Pup","Puppis",111,-46,[[99.44,-43.2,109.29,-37.1,113.85,-28.37,114.71,-26.8,117.32,-24.86,119.21,-22.88,121.89,-24.3,120.9,-40,122.38,-47.34],[117.32,-24.86,117.02,-25.94,115.95,-28.95,113.85,-28.37]]],["Pyx","Pyxis",132,-24,[[120.9,-40,130.03,-35.31,130.9,-33.19,132.63,-27.71]]],["Ret","Reticulum",55.5,-61,[[63.61,-62.47,64.12,-59.3,59.69,-61.4,56.05,-64.81,63.61,-62.47]]],["Sge","Sagitta",-69,18,[[-64.98,18.01,-63.15,18.53,-60.31,19.49],[-64.74,17.48,-63.15,18.53]]],["Sgr","Sagittarius",-67.5,-34,[[-85.59,-36.76,-83.96,-34.38,-84.75,-29.83,-83.01,-25.42,-86.56,-21.06],[-69.34,-44.46,-69.03,-40.62,-74.35,-29.88,-78.59,-26.99,-83.01,-25.42],[-61.18,-41.87,-60.07,-35.28,-61.04,-26.3,-65.82,-24.88,-68.68,-24.51,-71.11,-25.26,-76.18,-26.3,-78.59,-26.99,-84.75,-29.83,-88.55,-30.42,-83.96,-34.38,-74.35,-29.88,-73.26,-27.67,-76.18,-26.3,-73.83,-21.74,-72.56,-21.02,-70.59,-18.95,-69.58,-17.85,-69.57,-15.95],[-73.83,-21.74,-75.57,-21.11,-76.46,-22.74,-76.18,-26.3]]],["Sco","Scorpius",-111,-38,[[-120.29,-26.11,-119.92,-22.62,-118.64,-19.81],[-119.92,-22.62,-114.7,-25.59,-112.65,-26.43,-111.03,-28.22,-107.46,-34.29,-107.03,-38.05,-106.35,-42.36,-101.96,-43.24,-95.67,-43,-93.1,-40.13,-94.38,-39.03,-96.6,-37.1]]],["Scl","Sculptor",1.5,-33,[[14.65,-29.36,-2.77,-28.13,-10.29,-32.53,-6.76,-37.82]]],["Sct","Scutum",-78,-12.5,[[-81.2,-8.24,-78.21,-4.75,-79.43,-9.05,-82.7,-14.57,-81.2,-8.24]]],["Ser","Serpens Cauda",-79.5,3,[[-123.45,15.42,-124.61,19.67,-122.82,18.14,-120.89,15.66,-123.45,15.42,-126.3,10.54,-123.93,6.43,-122.3,4.48,-116.41,-3.69]]],["Ser","Serpens Cauda",-79.5,3,[[-102.41,-15.72,-95.6,-15.4,-90.24,-9.77,-89.23,-8.18,-84.67,-2.9,-75.95,4.2]]],["Sex","Sextans",157.5,-7,[[151.98,-0.37,148.13,-8.1,157.37,-2.74,157.57,-0.64]]],["Tau","Taurus",54,15,[[84.41,21.14,68.98,16.51,67.17,15.87,64.95,15.63,65.73,17.54,67.15,19.18,81.57,28.61],[64.95,15.63,60.17,12.49,51.79,9.73,60.79,5.99],[51.79,9.73,51.2,9.03,54.22,0.4]]],["Tel","Telescopium",-82.5,-54,[[-87.19,-45.95,-83.26,-45.97,-82.79,-49.07]]],["Tri","Triangulum",27,34,[[28.27,29.58,32.39,34.99,34.33,33.85,28.27,29.58]]],["TrA","Triangulum Australe",-120,-67.5,[[-107.83,-69.03,-121.21,-63.43,-130.27,-68.68,-107.83,-69.03]]],["Tuc","Tucana",-12,-64,[[-25.37,-60.26,-10.64,-58.24,7.89,-62.96,5.02,-64.87,-0.02,-65.58,-23.17,-64.97,-25.37,-60.26]]],["UMa","Ursa Major",165,48,[[-176.14,57.03,165.93,61.75,165.46,56.38,178.46,53.69,-176.14,57.03,-166.49,55.96,-159.02,54.93,-153.11,49.31],[178.46,53.69,176.51,47.78,169.62,33.09,169.55,31.53],[176.51,47.78,167.42,44.5,155.58,41.5],[167.42,44.5,154.27,42.91],[165.93,61.75,142.88,63.06,127.57,60.72,147.75,59.04,165.46,56.38],[165.46,56.38,148.03,54.06,143.21,51.68,134.8,48.04],[135.91,47.16,143.21,51.68]]],["UMi","Ursa Minor",-133.5,68,[[-123.99,77.79,-115.62,75.76,-129.82,71.83,-137.32,74.16,-123.99,77.79,-108.51,82.04,-96.95,86.59,37.95,89.26]]],["Vel","Vela",143.25,-46,[[131.18,-54.71,140.53,-55.01,149.22,-54.57,161.69,-49.42,153.68,-42.12,142.68,-40.47,137,-43.43,122.38,-47.34]]],["Vir","Virgo",-160.5,-4,[[176.46,6.53,177.67,1.76,-175.02,-0.67,-169.58,-1.45,-162.51,-5.54,-158.7,-11.16,-146,-6,-139.23,-5.66],[-164.46,10.96,-166.1,3.4,-169.58,-1.45],[-162.51,-5.54,-156.33,-0.6,-149.59,1.54,-138.44,1.89]]],["Vol","Volans",111,-73,[[135.61,-66.4,126.43,-66.14,121.98,-68.62,109.21,-67.96,107.19,-70.5,121.98,-68.62,135.61,-66.4]]],["Vul","Vulpecula",-64.5,21,[[-70.95,21.39,-67.82,24.66,-61.63,24.08,-59.72,27.75,-56.06,27.81]]]]');

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
function ensure(key){
  if(G[key]) return G[key];
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
      o.a = Math.cbrt(398600.4418/(n*n));
    }
  }
  if(!isFinite(o.a) || o.a < RE*0.9) return null;
  if(!isFinite(o.inc) || !isFinite(o.raan) || !isFinite(o.argp) || !isFinite(o.ecc)) return null;
  o.inc = Math.max(0, Math.min(180, o.inc));
  o.raan = rev(o.raan);
  o.argp = rev(o.argp);
  o.ecc = Math.max(0, Math.min(0.95, o.ecc));
  return o;
}

/* ---- public --------------------------------------------------------------- */
global.OrbitViz = {
  init(opts){
    opts = opts || {};
    THREE = opts.THREE || global.THREE;
    if(!THREE || !THREE.Sprite) return false;
    scene = opts.scene; sat = opts.satellite || global.satellite;
    if(!scene) return false;
    U = (typeof opts.scale === 'number' && opts.scale > 0) ? opts.scale : 1/RE;
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

  setOrbit(o){
    if(!started) return false;
    o = o || {};
    el = normElements(o.satrec, o.elements);
    satrecRef = o.satrec || null;
    killLayer('elements');                        // a switch of spacecraft must not leak the last one
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
    if(G.elements && live) updateLive(simTime);
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

})(window);
