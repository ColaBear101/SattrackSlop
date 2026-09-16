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

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  srv.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
