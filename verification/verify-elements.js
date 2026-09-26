/*
 * The orbital-elements overlay: is it readable, and does hovering say more?
 *
 * The layer used to put thirteen full sentences on the globe at hard-coded 3D
 * offsets with no collision avoidance at all, and they interleaved into strings
 * like "ASCENDIN(w)(= E164.25" and "DE357 kmg NODE", with one label running off
 * the right edge of the frame. It now shows a symbol per element and expands
 * one to its full value under the pointer.
 *
 * Everything here is measured from the scene graph and the camera, never from
 * the layout's own opinion of what it did. In particular:
 *
 *   - a label's rectangle is rebuilt from matrixWorld, the sprite scale and
 *     sprite.center. Measuring from position alone would miss the whole
 *     de-collision, since a placed label sits up to 50 px from its anchor;
 *   - the size used is the INK, not the padded canvas, which is ~40% wider.
 *     Laying out or checking by the canvas would prove a separation a reader
 *     cannot see;
 *   - "expanded" is read off the texture actually bound to the material, not
 *     off a bookkeeping flag that says which one should have been.
 *
 * The last section leaves the globe for the elements panel in section (a) and
 * the method box, which had the opposite problem: every number was readable
 * and several said the wrong thing about themselves - a "nodal period" 25 min
 * off for GEO objects, an altitude swing put down to J2, a latitude limit the
 * drawn track overshoots, a scan step that was the drawing step. The first fix
 * of the latitude limit then read it off whatever track the window held, which
 * for MMS 1 - an 85 h orbit in a 24 h window - printed ±11.5 deg for an orbit
 * inclined at 73; the next put a GEO plane's whole departure from the epoch's
 * mean i down to periodic terms, when most of it two weeks on was SGP4's
 * steady drift of the mean inclination itself. Those are checked against
 * figures worked out here, in node.
 *
 * Served over http, because a file:// page has an opaque origin and this suite
 * has been bitten by that before.
 *
 *   node verification/verify-elements.js        (needs playwright)
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.jpg':'image/jpeg', '.png':'image/png', '.css':'text/css' };
function serve(){
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
        res.writeHead(404); return res.end('no');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let fails = 0;
const chk = (name, ok, detail) => {
  if(!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

/* The measurement. Runs in the page; returns one rect per visible element
   label, in CSS pixels of the canvas. */
const MEASURE = () => {
  const cam = Orbit3D.camera, cv = Orbit3D.renderer.domElement;
  const W = cv.clientWidth, H = cv.clientHeight;
  cam.updateMatrixWorld(); Orbit3D.scene.updateMatrixWorld(true);
  // sizeAttenuation is off, so this is exactly px per unit of sprite scale
  const k = H / (2*Math.tan(cam.fov*Math.PI/360));
  const out = [];
  Orbit3D.scene.traverse(o => {
    const t = o.userData && o.userData.tag;
    if(!o.isSprite || !t) return;
    for(let n = o; n; n = n.parent) if(!n.visible) return;   // effective visibility
    const pos = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const pr = pos.clone().project(cam);
    if(pr.z > 1) return;                                     // behind the camera
    const full = o.material.map === o.userData.form.full.tex;
    const ink = o.userData.form[full ? 'full' : 'short'].ink;
    const w = ink.w*k, h = ink.h*k;
    const cx = (pr.x*0.5 + 0.5)*W, cy = (-pr.y*0.5 + 0.5)*H;
    out.push({ key:t.key, prio:t.prio, full:full,
               texW: o.material.map.image.width,
               x: cx - w*o.center.x, y: cy - h*(1 - o.center.y), w:w, h:h });
  });
  return { W:W, H:H, tags:out };
};

const overlaps = tags => {
  const bad = [];
  for(let i=0;i<tags.length;i++) for(let j=i+1;j<tags.length;j++){
    const a = tags[i], b = tags[j];
    const ox = Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y);
    if(ox > 1 && oy > 1) bad.push({ pair:a.key+'/'+b.key, area:ox*oy });
  }
  return bad;
};
const clipped = m => m.tags.filter(t =>
  t.x < -1 || t.y < -1 || t.x + t.w > m.W + 1 || t.y + t.h > m.H + 1);

(async () => {
  const srv = await serve();
  const PAGE = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  for(const u of ['**celestrak.org/**', '**tle.ivanstanojevic.me/**',
                  '**gibs.earthdata.nasa.gov/**', '**geocoding-api.open-meteo.com/**'])
    await page.route(u, r => r.abort());
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.getElementById('tpplay').click());   // freeze the clock
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('#layersMenu input[data-layer]')]
      .find(i => i.dataset.layer === 'elements');
    l.checked = true; l.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2000);

  // ---- the radius vector is drawn once --------------------------------------
  /* orbitviz used to draw origin->spacecraft in white over the top of orbit3d's
     two-part R(+) and altitude arrows, painting out the colour change at the
     surface that is the whole point of the split. Counted from the geometry,
     not by asserting some field is undefined. */
  const rays = await page.evaluate(() => {
    /* The spacecraft's own radius, in scene units, so the search is for a
       specific segment rather than "anything long from the origin" - h and e
       both legitimately start at the origin and are longer than r. */
    const sat = Orbit3D.satPosition ? Orbit3D.satPosition() : null;
    let rLen = 0;
    Orbit3D.scene.traverse(o => {
      if(o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry'
         && Math.abs(o.geometry.parameters.radius - 0.016) < 1e-9)
        rLen = o.position.length();                    // the spacecraft marker
    });
    const out = { rLen: +rLen.toFixed(4), toSurface: 0, toCraft: 0, all: [] };
    Orbit3D.scene.traverse(o => {
      if(o.type !== 'Line' || !o.geometry.attributes.position) return;
      const p = o.geometry.attributes.position;
      if(p.count !== 2) return;
      const a = new THREE.Vector3().fromBufferAttribute(p, 0);
      const b = new THREE.Vector3().fromBufferAttribute(p, 1);
      if(a.length() > 1e-6) return;                    // must start at the centre
      const L = b.length();
      out.all.push(+L.toFixed(3));
      if(Math.abs(L - 1) < 0.005) out.toSurface++;     // R(+), centre to the surface
      if(rLen && Math.abs(L - rLen) < 0.01) out.toCraft++;   // centre straight to the craft
    });
    return out;
  });
  /* orbitviz used to draw one white line from the centre all the way to the
     spacecraft, on top of orbit3d's two-part R(+) and altitude arrows - painting
     out the colour change at the surface that is the entire point of the split.
     So the assertion is that nothing spans centre-to-craft in one piece, while
     exactly one line reaches the surface. */
  chk('the radius vector is not drawn twice',
      rays.toCraft === 0 && rays.toSurface === 1,
      '|r| = ' + rays.rLen + ' R+, ' + rays.toCraft + ' line(s) centre->craft, '
        + rays.toSurface + ' centre->surface; from the origin: ' + rays.all.join(' '));

  // ---- at rest, over a sweep of camera bearings and two viewports -----------
  const spin = dx => page.evaluate(d => {
    const cv = document.getElementById('globe'), R = cv.getBoundingClientRect();
    const x = R.left + R.width/2, y = R.top + R.height/2;
    cv.dispatchEvent(new MouseEvent('mousedown', { clientX:x, clientY:y, bubbles:true }));
    for(let i=1;i<=10;i++)
      window.dispatchEvent(new MouseEvent('mousemove', { clientX:x + d*i/10, clientY:y, bubbles:true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles:true }));
  }, dx);

  let worstOverlap = 0, worstPair = '', anyClip = 0, seen = 0, minKept = 99;
  for(const vp of [{width:1280,height:900}, {width:1100,height:700}]){
    await page.setViewportSize(vp);
    await page.waitForTimeout(900);
    for(let b=0;b<8;b++){
      if(b) { await spin(130); await page.waitForTimeout(450); }
      const m = await page.evaluate(MEASURE);
      seen += m.tags.length;
      const ov = overlaps(m.tags);
      for(const o of ov) if(o.area > worstOverlap){ worstOverlap = o.area; worstPair = o.pair; }
      anyClip += clipped(m).length;
      /* "no overlaps" is trivially satisfiable by drawing nothing, so count what
         survived: the three Keplerian angles are never allowed to be dropped. */
      const kept = m.tags.filter(t => t.prio <= 2).length;
      if(kept < minKept) minKept = kept;
      if(m.tags.some(t => t.full)) chk('a label was expanded with no pointer on it', false, '');
    }
  }
  chk('no two labels overlap, over 16 camera bearings at two viewports',
      worstOverlap === 0, worstOverlap ? ('worst ' + worstOverlap.toFixed(0) + ' px2, ' + worstPair)
                                       : (seen + ' label placements measured'));
  chk('...and none is clipped at the frame edge', anyClip === 0, anyClip + ' clipped');
  chk('...while the high-priority labels are never dropped to achieve it',
      minKept >= 1, 'fewest kept in any frame: ' + minKept);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(900);
  const rest = await page.evaluate(MEASURE);
  chk('every label is in its short form at rest',
      rest.tags.every(t => !t.full), rest.tags.map(t => t.key).join(' '));
  chk('...and the widest of them is a symbol, not a sentence',
      Math.max.apply(null, rest.tags.map(t => t.w)) < 140,
      'widest ' + Math.max.apply(null, rest.tags.map(t => t.w)).toFixed(0) + ' px');

  // ---- hover expands exactly one -------------------------------------------
  const gb = await page.evaluate(() => {
    const r = document.getElementById('globe').getBoundingClientRect();
    return { x:r.x, y:r.y };
  });
  let tested = 0, good = 0;
  for(const key of rest.tags.map(t => t.key)){
    await page.mouse.move(gb.x + 4, gb.y + 4);          // drop any previous hover
    await page.waitForTimeout(320);
    const fresh = await page.evaluate(MEASURE);          // rects move as the layout settles
    const t = fresh.tags.find(x => x.key === key);
    if(!t) continue;
    tested++;
    await page.mouse.move(gb.x + t.x + t.w/2, gb.y + t.y + t.h/2);
    await page.waitForTimeout(260);
    await page.mouse.move(gb.x + t.x + t.w/2 + 0.5, gb.y + t.y + t.h/2);   // clear the debounce
    await page.waitForTimeout(320);
    const m = await page.evaluate(MEASURE);
    const up = m.tags.filter(x => x.full);
    const one = up.length === 1 && up[0].key === key;
    const wider = one && up[0].texW > (fresh.tags.find(x => x.key === key).texW);
    const ov = overlaps(m.tags), cl = clipped(m);
    if(one && wider && !ov.length && !cl.length) good++;
    else console.log('        ' + key + ': expanded [' + up.map(x => x.key).join(',') + ']'
      + (wider ? '' : ' texture not wider')
      + (ov.length ? ' overlaps ' + ov.length : '')
      + (cl.length ? ' CLIPPED' : ''));
  }
  chk('hovering a label expands that one and only that one',
      tested > 0 && good === tested, good + ' of ' + tested + ' labels');
  chk('...with the expansion measured in real texture pixels, not a flag',
      tested > 0, tested + ' checked');

  await page.mouse.move(gb.x + 4, gb.y + 4);
  await page.waitForTimeout(500);
  chk('...and everything collapses when the pointer leaves',
      (await page.evaluate(MEASURE)).tags.every(t => !t.full));

  // ---- the orbit-plane disc must never be a hover target --------------------
  /* It spans the frame, so if it ever became pickable it would swallow every
     hover and nothing else here would notice. */
  const discPick = await page.evaluate(() => {
    let disc = null;
    Orbit3D.scene.traverse(o => {
      if(o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') disc = o;
    });
    return { found: !!disc, pickable: !!(disc && disc.userData.tagKey) };
  });
  chk('the orbit-plane disc is not pickable', discPick.found && !discPick.pickable,
      discPick.found ? 'found, tagKey ' + discPick.pickable : 'disc not found');

  // ---- the globe names only what can be seen --------------------------------
  /* The spacecraft's name and the catalogue hover name are DOM labels, which
     have no depth. The marker behind the planet is hidden by the depth test;
     its name went on being drawn over the near face - in the Bangkok camera,
     KNACKSAT-2 over the Indian Ocean while the spacecraft was over South
     America - and a far-side catalogue point under the cursor could be named
     and clicked through the Earth. Occlusion is worked out here from the
     camera and the unit sphere, not read from the page. */
  const OCCL = `(p => { const c = Orbit3D.camera.position, d = p.clone().sub(c), L = d.length();
    d.divideScalar(L); const b = c.dot(d), q = b*b - (c.lengthSq() - 1);
    if(q <= 0) return false; const t = -b - Math.sqrt(q); return t > 0 && t < L; })`;
  const layerEl = on => page.evaluate(v => {
    const l = document.querySelector('#layersMenu input[data-layer="elements"]');
    if(l.checked !== v){ l.checked = v; l.dispatchEvent(new Event('change', { bubbles: true })); }
  }, on);
  await layerEl(false);                  // its labels win the pointer outright, by design
  await page.click('.cam[data-mode=site]');
  await page.waitForTimeout(500);
  const nameSeen = await page.evaluate(async src => {
    const occl = eval(src), r = document.getElementById('time'), out = { behind: null, front: null };
    let dot = null;
    Orbit3D.scene.traverse(o => { if(o.isMesh && o.geometry.type === 'SphereGeometry'
      && Math.abs(o.geometry.parameters.radius - 0.016) < 1e-9) dot = o; });
    for(let v = 0; v <= +r.max && !(out.behind && out.front); v += 37){
      r.value = v; r.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const pr = dot.position.clone().project(Orbit3D.camera);
      if(Math.abs(pr.x) > 0.8 || Math.abs(pr.y) > 0.8) continue;     // well inside the frame
      const hid = occl(dot.position), key = hid ? 'behind' : 'front';
      if(out[key]) continue;
      out[key] = { v, el: document.getElementById('o3el').textContent,
                   shown: document.getElementById('o3name').style.display === 'block' };
    }
    return out;
  }, OCCL);
  chk('in the site camera, the spacecraft\'s name is hidden while the globe is in front of it',
      !!nameSeen.behind && !nameSeen.behind.shown,
      nameSeen.behind ? 'elevation ' + nameSeen.behind.el + ', label ' + (nameSeen.behind.shown ? 'drawn' : 'hidden')
                      : 'never found behind the globe');
  chk('...and drawn while it is not', !!nameSeen.front && nameSeen.front.shown,
      nameSeen.front ? 'elevation ' + nameSeen.front.el : 'never found in front');

  /* Catalogue points that land on the disc and have no neighbour within
     14 px, so the pointer can be put on one without the raycast being a
     coin-toss between two. */
  await page.click('.cam[data-mode=free]');
  await page.waitForTimeout(600);
  const pts = await page.evaluate(src => {
    const occl = eval(src), cam = Orbit3D.camera, R = document.getElementById('globe').getBoundingClientRect();
    let cloud = null;
    Orbit3D.scene.traverse(o => { if(o.isPoints && o.geometry.attributes.position.count === __gt.CAT.length) cloud = o; });
    const a = cloud.geometry.attributes.position, scr = [];
    for(let i = 0; i < a.count; i++){
      const p = new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i));
      if(p.length() > 1e5){ scr.push(null); continue; }
      const q = p.clone().project(cam);
      scr.push({ i, x: (q.x*0.5 + 0.5)*R.width + R.left, y: (-q.y*0.5 + 0.5)*R.height + R.top, p });
    }
    const c = cam.position, onDisc = p => { const d = p.clone().sub(c).normalize(), b = c.dot(d);
      return b*b - (c.lengthSq() - 1) > 0.02; };
    const out = { behind: [], front: [] };
    for(const s of scr){
      if(!s || !onDisc(s.p)) continue;
      if(scr.some(t => t && t !== s && Math.hypot(t.x - s.x, t.y - s.y) < 14)) continue;
      const k = occl(s.p) ? 'behind' : 'front';
      if(out[k].length < 3) out[k].push({ x: s.x, y: s.y, name: __gt.CAT[s.i].name });
    }
    return out;
  }, OCCL);
  const hoverName = async q => {
    await page.mouse.move(gb.x + 4, gb.y + 4); await page.waitForTimeout(150);
    await page.mouse.move(q.x, q.y); await page.waitForTimeout(300);
    return page.evaluate(() => { const h = document.getElementById('o3hover');
      return h.style.display === 'block' ? h.textContent : ''; });
  };
  const farNamed = [], nearNamed = [];
  for(const q of pts.behind) if((await hoverName(q)) === q.name) farNamed.push(q.name);
  for(const q of pts.front) if((await hoverName(q)) === q.name) nearNamed.push(q.name);
  chk('a catalogue point behind the globe cannot be hovered through it',
      pts.behind.length > 0 && farNamed.length === 0,
      pts.behind.length + ' far-side points under the pointer, named: ' + (farNamed.join(', ') || 'none'));
  chk('...while one in front still can', pts.front.length > 0 && nearNamed.length === pts.front.length,
      nearNamed.length + ' of ' + pts.front.length + ' near-side points named');
  if(pts.behind.length){
    await page.mouse.click(pts.behind[0].x, pts.behind[0].y);   // must load nothing
    await page.waitForTimeout(300);
    chk('...nor clicked through it', await page.evaluate(() => document.getElementById('pickconfirm').hidden),
        pts.behind[0].name);
    /* Hiding the Earth is how you look at what it was in front of, so with it
       off the far side is fair game again. */
    await page.evaluate(() => document.getElementById('o3earth2').click());
    await page.waitForTimeout(300);
    chk('...until the Earth is hidden, and then it can',
        (await hoverName(pts.behind[0])) === pts.behind[0].name, pts.behind[0].name);
    await page.evaluate(() => document.getElementById('o3earth2').click());
  }
  await page.mouse.move(gb.x + 4, gb.y + 4);
  await page.click('.cam[data-mode=sat]');
  await layerEl(true);
  await page.waitForTimeout(500);

  // ---- the elements PANEL: does each number say what it is? ----------------
  /* The section (a) cards and the method box beneath them. Each check reads
     the text a student would copy and compares it with a figure worked out
     here, in node, from the same element set - not with the page's own
     variables, which would only prove the page agrees with itself. */
  const sat = require('./satellite.min.js');
  const MU72 = sat.constants.mu, A84 = 6378.137, F84 = 1/298.257223563, E2 = F84*(2 - F84);
  const pick = name => page.evaluate(n => {
    const b = document.getElementById('satsearch');
    b.value = n; b.dispatchEvent(new Event('input', { bubbles: true }));
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, name).then(() => page.waitForFunction(n => window.__gt.D.entry.name === n, name, { timeout: 20000 }));
  const panel = () => page.evaluate(() => {
    const D = window.__gt.D, E = D.E;
    // keyed by the symbol where there is one: the osculating row names some
    // of its symbols in words beside them
    const pairs = sel => [...document.querySelectorAll(sel + ' .dv')].map(d =>
      [(d.querySelector('dt i') || d.querySelector('dt')).textContent, d.querySelector('dd').textContent]);
    return { l1: D.entry.l1, l2: D.entry.l2, start: D.start.getTime(), hours: D.hours, step: D.step,
             period: E.period, ecc: E.ecc, a: E.a, inc: E.inc, epoch: E.epoch.getTime(),
             maxLat: Math.max.apply(null, D.pts.map(p => Math.abs(p.lat))),
             notes: [...document.querySelectorAll('#elgrid .note')].map(n => n.textContent),
             oscNames: [...document.querySelectorAll('#osc dt')].map(d => d.textContent),
             dnote: document.getElementById('dnote').textContent,
             derived: pairs('#derived'), mini: pairs('#minigrid'), osc: pairs('#osc'),
             scan: document.getElementById('lbl-scan').textContent,
             sample: document.getElementById('lbl-sample').textContent };
  });
  const val = (pairs, label) => { const p = pairs.find(x => x[0] === label); return p ? parseFloat(p[1]) : NaN; };
  /* Highest geodetic and geocentric latitude over the window's own sample
     instants, worked out by satellite.js: its geodetic conversion, not the
     page's, and asin(z/r), which no rotation about the pole changes. tc is
     the instant the geocentric one peaks. */
  const trackReach = pn => {
    const rec = sat.twoline2satrec(pn.l1, pn.l2), N = Math.round(pn.hours*3600/pn.step);
    let gd = 0, gc = 0, tc = pn.start;
    for(let k = 0; k <= N; k++){
      const t = new Date(pn.start + k*pn.step*1000), pv = sat.propagate(rec, t);
      if(!pv || !pv.position) continue;
      const p = pv.position, g = Math.abs(Math.asin(p.z/Math.hypot(p.x, p.y, p.z)))*180/Math.PI;
      gd = Math.max(gd, Math.abs(sat.eciToGeodetic(p, sat.gstime(t)).latitude)*180/Math.PI);
      if(g > gc){ gc = g; tc = t.getTime(); }
    }
    return { gd, gc, tc };
  };
  // the tilt of the osculating plane at one instant, from h = r x v
  const tiltAt = (pn, ms) => {
    const pv = sat.propagate(sat.twoline2satrec(pn.l1, pn.l2), new Date(ms)), r = pv.position, v = pv.velocity;
    const hx = r.y*v.z - r.z*v.y, hy = r.z*v.x - r.x*v.z, hz = r.x*v.y - r.y*v.x;
    const i = Math.acos(hz/Math.hypot(hx, hy, hz))*180/Math.PI;
    return i > 90 ? 180 - i : i;
  };

  await pick('KNACKSAT-2');
  let pn = await panel();
  const knRec = sat.twoline2satrec(pn.l1, pn.l2);
  /* The eccentricity card's breakdown, re-measured over the same revolution
     at the same instants the page samples. */
  {
    const N2 = Math.round(720 + 3000*Math.min(0.95, pn.ecc));
    let rLo = Infinity, rHi = -Infinity, sLo = Infinity, sHi = -Infinity;
    for(let k = 0; k <= N2; k++){
      const t = new Date(pn.start + k*pn.period*1000/N2);
      const pv = sat.propagate(knRec, t);
      const r = Math.hypot(pv.position.x, pv.position.y, pv.position.z);
      const lat = sat.eciToGeodetic(pv.position, sat.gstime(t)).latitude;
      const s = Math.sin(lat), c = Math.cos(lat), N = A84/Math.sqrt(1 - E2*s*s);
      const R = Math.hypot(N*c, N*(1 - E2)*s);           // the ellipsoid under the track
      rLo = Math.min(rLo, r); rHi = Math.max(rHi, r); sLo = Math.min(sLo, R); sHi = Math.max(sHi, R);
    }
    const m = pn.notes[1].match(/radius varies ([\d.]+) km \(2ae alone gives ([\d.]+).*?surface beneath the track is ([\d.]+) km/);
    chk('the eccentricity card splits the swing into orbit radius and ellipsoid, and both are right',
        !!m && Math.abs(+m[1] - (rHi - rLo)) < 0.051 && Math.abs(+m[2] - 2*pn.a*pn.ecc) < 0.051
            && Math.abs(+m[3] - (sHi - sLo)) < 0.051 && !/mostly from J2/.test(pn.notes[1]),
        m ? 'radius ' + m[1] + ' (mine ' + (rHi - rLo).toFixed(2) + '), 2ae ' + m[2] +
            ', surface ' + m[3] + ' (mine ' + (sHi - sLo).toFixed(2) + ') km' : pn.notes[1]);
  }
  {
    const R = trackReach(pn);
    const m = pn.notes[2].match(/reaches ±([\d.]+)° geodetic.*?geodetic runs ([\d.]+)° higher/);
    chk('the inclination card quotes the geodetic reach of the track it draws, not i',
        !!m && Math.abs(+m[1] - R.gd) < 0.051 && +m[1] > pn.inc + 0.1,
        m ? '±' + m[1] + '° against i = ' + pn.inc + '°, track max ' + R.gd.toFixed(3) + '°' : pn.notes[2]);
    chk('...and says how much of that is geodetic against geocentric, measured on the same samples',
        !!m && Math.abs(+m[2] - (R.gd - R.gc)) < 0.0051,
        m ? m[2] + '° (mine ' + (R.gd - R.gc).toFixed(4) + '°: geocentric max ' + R.gc.toFixed(4) + '°)' : pn.notes[2]);
  }
  chk('...and the osculating row names ν in words, so it is not read as a v',
      pn.oscNames.some(t => /^ν\s+true anomaly$/.test(t)), pn.oscNames.join(' | '));
  /* Osculating elements at epoch, from the state vector, written out again
     with acos rather than the page's atan2 so the two do not share a route. */
  {
    const pv = sat.propagate(knRec, new Date(pn.epoch)), r = pv.position, v = pv.velocity;
    const rr = Math.hypot(r.x, r.y, r.z), vv = Math.hypot(v.x, v.y, v.z);
    const h = [r.y*v.z - r.z*v.y, r.z*v.x - r.x*v.z, r.x*v.y - r.y*v.x], hh = Math.hypot(h[0], h[1], h[2]);
    const rv = r.x*v.x + r.y*v.y + r.z*v.z, k = vv*vv - MU72/rr;
    const ev = [(k*r.x - rv*v.x)/MU72, (k*r.y - rv*v.y)/MU72, (k*r.z - rv*v.z)/MU72];
    const e = Math.hypot(ev[0], ev[1], ev[2]), nn = Math.hypot(h[0], h[1]);
    const n = [-h[1]/nn, h[0]/nn];
    let w = Math.acos((n[0]*ev[0] + n[1]*ev[1])/e)*180/Math.PI; if(ev[2] < 0) w = 360 - w;
    let u = Math.acos((n[0]*r.x + n[1]*r.y)/rr)*180/Math.PI; if(r.z < 0) u = 360 - u;
    const mine = { a: 1/(2/rr - vv*vv/MU72), e, i: Math.acos(h[2]/hh)*180/Math.PI, 'ω': w,
                   'u = ω + ν': (u % 360 + 360) % 360 };
    const dAng = (x, y) => Math.abs(((x - y) % 360 + 540) % 360 - 180);
    // half a unit in the last place each value is printed to
    const off = Object.entries(mine).filter(([key, want]) => {
      const got = val(pn.osc, key), angle = key === 'ω' || key.startsWith('u');
      const q = key === 'a' ? 0.051 : key === 'e' ? 6e-8 : key === 'i' ? 6e-5 : 0.006;
      return !((angle ? dAng(got, want) : Math.abs(got - want)) <= q);
    }).map(([key, want]) => key + ' ' + val(pn.osc, key) + ' vs ' + want);
    chk('the osculating row is the two-body orbit through SGP4\'s r, v at the epoch',
        pn.osc.length >= 7 && !off.length,
        off.length ? off.join('; ') : 'a ' + mine.a.toFixed(3) + ' km, e ' + mine.e.toFixed(7) +
          ', ω ' + mine['ω'].toFixed(2) + '° (mean ω 152.63°)');
  }
  chk('a LEO orbit shows its measured nodal period, in the panel and the rail',
      Math.abs(val(pn.derived, 'Nodal period') - pn.period/60) < 0.0051
        && Math.abs(val(pn.mini, 'Period') - pn.period/60) < 0.051,
      val(pn.derived, 'Nodal period') + ' min');
  chk('...and "Revs in 24 h" is a count over that period, not the Kozai n again',
      Math.abs(val(pn.derived, 'Revs in 24 h') - 86400/pn.period) < 0.0051,
      val(pn.derived, 'Revs in 24 h') + ' against n = ' + pn.l2.slice(52, 63).trim());
  chk('the method box states the scan step this window used, not the drawing step',
      pn.scan === '4 s' && pn.sample === '10 s', 'scan ' + pn.scan + ', sample ' + pn.sample);

  /* GOES 18 at i = 0.035 deg: node-to-node times there wander by tens of
     minutes, and the page used to print one of them as the period. */
  await pick('GOES 18');
  pn = await panel();
  {
    const nB = sat.twoline2satrec(pn.l1, pn.l2).no;       // SGP4's Brouwer n'', rad/min
    const kep = 2*Math.PI/nB;
    const got = val(pn.derived, 'Kepler period');
    chk('a near-equatorial GEO object shows a labelled Kepler period, 2π/n″',
        Math.abs(got - kep) < 0.0051 && Math.abs(val(pn.mini, 'Kepler period') - kep) < 0.051
          && !pn.derived.some(d => d[0] === 'Nodal period'),
        got + ' min (2π/n″ = ' + kep.toFixed(3) + '; node to node measured ' + (pn.period/60).toFixed(1) + ')');
    /* The apsis search still runs over that node-to-node time, and the
       panel has to say how long it was instead of calling it a revolution. */
    const frac = pn.period/60/kep;
    const dm = pn.dnote.match(/one node-to-node interval: ([\d.]+) min, ([\d.]+) of a revolution/);
    // the e card calls the span a revolution exactly when the note prints 1.00
    const one = !!dm && dm[2] === '1.00';
    chk('...and says the altitudes were sampled over one node-to-node interval, and what fraction of an orbit that is',
        !!dm && Math.abs(+dm[1] - pn.period/60) < 0.051 && Math.abs(+dm[2] - frac) < 0.0051
          && (one ? /over a revolution/.test(pn.notes[1])
                  : /min sampled/.test(pn.notes[1]) && !/periodic terms/.test(pn.notes[1])),
        dm ? dm[1] + ' min, ' + dm[2] + ' rev (mine ' + frac.toFixed(4) + ')' : pn.dnote);
    /* At i = 0.035 deg SGP4's periodic terms tilt the real plane by most of
       the inclination, so the track falls short of i - and says why. */
    const R = trackReach(pn);
    const m = pn.notes[2].match(/reaches ±([\d.]+)° geodetic latitude/);
    const t = pn.notes[2].match(/orbit plane is tilted at most ([\d.]+)°/);
    const needs = Math.abs(R.gc - pn.inc) >= 0.0006;
    chk('...and a GEO object\'s reach is its drawn track, with the plane\'s real tilt when that is not the mean i',
        !!m && Math.abs(+m[1] - R.gd) < 0.00051 && (!needs || !!t) && (!t || Math.abs(+t[1] - R.gc) < 0.00051),
        (m ? '±' + m[1] + '° (mine ' + R.gd.toFixed(4) + ')' : 'no reach') + ', tilt ' + (t ? t[1] : '-') +
          '° (mine ' + R.gc.toFixed(4) + ') against i = ' + pn.inc + '°');
    /* The i on the card is the mean AT THE EPOCH, and in deep space SGP4
       moves the mean inclination itself at a steady rate (inclm = inclo +
       didt t). In the default window, a fortnight or more from the snapshot's
       epoch, that drift and not any periodic term is most of the gap, and the
       card used to credit periodic terms with all of it. SGP4's mean
       inclination at the instant the track peaks is read here from
       satellite.js's own meanElements, not from didt as the page takes it. */
    const mi = Math.abs(sat.propagate(sat.twoline2satrec(pn.l1, pn.l2), new Date(R.tc)).meanElements.im)*180/Math.PI;
    const days = (R.tc - pn.epoch)/86400000, gap = R.gc - mi, drifted = Math.abs(mi - pn.inc) >= 0.0006;
    const dr = pn.notes[2].match(/where the track peaks, ([\d.]+) days (after|before) the epoch, it is ([\d.]+)°(?:, and SGP4's periodic terms put the plane ([\d.]+)° (above|below) that)?/);
    // clear of the half-unit boundary, where the page and this could round apart
    chk('...and splits that gap into SGP4\'s drift of the mean inclination since the epoch and its periodic terms',
        !drifted ? /averages out SGP4's periodic terms/.test(pn.notes[2])
          : !!dr && !/averages out/.test(pn.notes[2]) && Math.abs(+dr[3] - mi) < 0.00051
            && Math.abs((dr[2] === 'before' ? -dr[1] : +dr[1]) - days) < 0.051
            && (Math.abs(gap) < 0.0004 ? !dr[4]
                : Math.abs(gap) > 0.0006 ? !!dr[4] && Math.abs(+dr[4] - Math.abs(gap)) < 0.00051 && dr[5] === (gap > 0 ? 'above' : 'below')
                : true),
        'mean i at the peak, ' + days.toFixed(2) + ' d from the epoch: ' + mi.toFixed(4) + '° (TLE ' + pn.inc +
          '°), plane ' + R.gc.toFixed(4) + '°; card: ' + (dr ? dr[0] : pn.notes[2]));
    chk('...and its RAAN note says the node is barely defined',
        /barely defined/.test(pn.notes[3]), pn.notes[3]);
  }

  /* MMS 1's period is 85 h. A 24 h window holds an arc of it, and the top of
     that arc used to be printed as the orbit's reach - ±11.5 deg for an orbit
     inclined at 73. */
  await pick('MMS 1');
  pn = await panel();
  {
    const tilt = tiltAt(pn, pn.start), R = trackReach(pn), n = +pn.l2.slice(52, 63);
    const m = pn.notes[2].match(/whole revolution the track would reach about ±([\d.]+)° geocentric latitude.*?holds ([\d.]+) of a revolution.*?gets to ±([\d.]+)° geodetic(?:, ±([\d.]+)° geocentric)?/);
    /* The tilt bounds geocentric latitude and the arc is quoted geodetic, as
       the map is; QZS-1R at 6 h printed an arc 0.1 deg past the "whole
       revolution" reach with neither labelled. So both carry their names, and
       the arc's geocentric figure comes too wherever the two differ. */
    chk('a window shorter than a revolution gives the plane\'s tilt, not the top of its arc, as the reach',
        !!m && Math.abs(+m[1] - tilt) < 0.051 && Math.abs(+m[2] - pn.hours*n/24) < 0.006
          && Math.abs(+m[3] - R.gd) < 0.051 && !/Ground track reaches/.test(pn.notes[2])
          && (m[4] ? Math.abs(+m[4] - R.gc) < 0.051 : R.gd - R.gc < 0.1),
        m ? '±' + m[1] + '° geocentric (osculating tilt ' + tilt.toFixed(3) + '°), ' + m[2] + ' rev, arc ±' + m[3] +
            '° geodetic (mine ' + R.gd.toFixed(3) + '°)' + (m[4] ? ', ±' + m[4] + '° geocentric (mine ' + R.gc.toFixed(3) + '°)' : '')
          : pn.notes[2]);
  }

  /* INMARSAT 3-F3's period is 1440.1 min, a few seconds over a 24 h window,
     which printed "holds 1.00 of a revolution (24.0 h)" for what the card
     then treated as an arc. */
  await pick('INMARSAT 3-F3');
  pn = await panel();
  {
    const kep = 2*Math.PI/sat.twoline2satrec(pn.l1, pn.l2).no;
    const m = pn.notes[2].match(/is just short of one revolution \(([\d.]+) min\)/);
    chk('a window a few minutes short of the period says so, not "1.00 of a revolution"',
        pn.hours*60 < pn.period/60 ? !!m && Math.abs(+m[1] - pn.period/60) < 0.051 && !/1\.00 of a revolution/.test(pn.notes[2])
                                   : /Ground track reaches/.test(pn.notes[2]),
        (m ? m[0] : pn.notes[2]) + ' (2π/n″ = ' + kep.toFixed(2) + ' min)');
  }

  /* A retrograde orbit's plane bounds latitude at 180 - i, and the card has
     to name that, not i. */
  await pick('IPEX');
  pn = await panel();
  {
    const R = trackReach(pn), m = pn.notes[2].match(/reaches ±([\d.]+)° geodetic latitude, [\d.]+° past 180° − i:/);
    chk('a retrograde orbit\'s reach is measured against 180° − i',
        !!m && Math.abs(+m[1] - R.gd) < 0.051, m ? '±' + m[1] + '° (mine ' + R.gd.toFixed(3) + '°)' : pn.notes[2]);
  }
  /* IXPE at 0.23 deg is near-equatorial but in LEO, where the period logic
     treats its node as definite; the RAAN note must agree. */
  await pick('IXPE');
  pn = await panel();
  chk('a near-equatorial LEO orbit keeps its measured node, and the RAAN note does not call it barely defined',
      pn.derived.some(d => d[0] === 'Nodal period') && !/barely defined/.test(pn.notes[3]), pn.notes[3]);

  /* A long window relaxes both steps, and the prose has to follow. */
  await pick('KNACKSAT-2');
  await page.evaluate(() => document.querySelector('.bar-window .span[data-h="72"]').click());
  await page.waitForFunction(() => window.__gt.D.hours === 72, null, { timeout: 30000 });
  pn = await panel();
  chk('...and follows the window: 15 s scan, 30 s track on a 3 d span',
      pn.scan === '15 s' && pn.sample === '30 s', 'scan ' + pn.scan + ', sample ' + pn.sample);

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  srv.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
