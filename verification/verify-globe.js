/*
 * The photographic globe: is the picture the right way round, and is the
 * terminator where the Sun actually is?
 *
 * Both questions matter more than they look. An equirectangular map applied to
 * a sphere renders perfectly plausibly when it is mirrored, rolled by 180
 * degrees of longitude, or flipped north for south - it is still a planet with
 * continents on it, and nothing about the image says it is wrong. WMS 1.3.0
 * takes its bounding box as lat,lon where 1.1.1 took lon,lat, so a transposed
 * request is one character away and returns 200 OK.
 *
 * So geography is checked against the coastline polygons the page already
 * carries: sample the fetched imagery at a dozen places that are unambiguously
 * ocean or unambiguously land, and ask the GeoJSON which they should be. A roll
 * or a flip puts deep ocean where the Sahara should be and the check fails.
 *
 * The terminator is checked against satellite.js's own sunPos - Vallado's
 * algorithm, an implementation this project did not write and does not share a
 * line with, unlike the four-term series inside orbit3d.js that actually aims
 * the light. Surface points are projected to the screen, the frame is rendered
 * and read back, and the brightness at each point is compared with the sign of
 * the solar elevation there. Points within the twilight band are excluded: the
 * shader deliberately blends across it and there is no right answer inside.
 *
 * And the SIZE: the map fetched is the one the view can use, not the biggest the
 * GPU will hold. A phone at the opening zoom used to download the 6.6 MB map
 * for a globe 560 pixels across. The expected rung is worked out here from the
 * canvas and the camera, then checked against what was bound and what was
 * requested - at the opening zoom, zoomed in, on a phone, and under Save-Data.
 *
 *   node verification/verify-globe.js        (needs playwright and the network)
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

/* Served over http rather than opened as a file, for two reasons both learned
   the hard way. A file:// page has an opaque origin, so every image drawn into
   a canvas taints it and the geography check below cannot read back a single
   pixel. And http with no charset header is the environment that exposed
   index.html carrying no <meta charset> at all. It is also how the page really
   runs. */
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml',
                '.css':'text/css', '.ico':'image/x-icon' };
function serve(){
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^[\\/]+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
        res.writeHead(404); return res.end('not here');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
let PAGE = null;

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

/* Which rung a view should get, restated from the geometry rather than read
   out of orbit3d. For a camera d body radii from the centre, looking at it,
   the most magnified point of the map is the middle of the disc, where a unit
   of surface spans f/(d-1) pixels; an equirectangular map W texels wide puts
   W/2pi texels on that unit. The page takes the smallest rung whose texel is
   no wider than 1.25 pixels there - the largest the GPU holds if none is -
   and the coarse rung under Save-Data. */
const LADDER = [2048, 4096, 8192];
const view = page => page.evaluate(() => {
  const cv = Orbit3D.renderer.domElement, gl = Orbit3D.renderer.getContext();
  return { h: cv.clientHeight * Orbit3D.renderer.getPixelRatio(), fov: Orbit3D.camera.fov,
           d: Orbit3D.camera.position.length(), max: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
});
const rungFor = (v, lean) => {
  const fit = LADDER.filter(w => w <= v.max);
  if (lean) return fit[0];
  const need = 2*Math.PI * (v.h/2 / Math.tan(v.fov*Math.PI/360)) / (v.d - 1);
  return fit.find(w => w*1.25 >= need) || fit[fit.length - 1];
};
const dayWidth = page => page.evaluate(() => {
  let m = null;
  Orbit3D.scene.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.dayMap) m = o; });
  const img = m && m.material.uniforms.dayMap.value && m.material.uniforms.dayMap.value.image;
  return img ? (img.width || img.naturalWidth) : 0;
});
/* The wheel, as a reader turns it: one notch at a time, a few frames apart. A
   burst in one task would jump the camera straight to its end and never test
   that a zoom passing through a middle rung does not stop to buy it. */
const zoomIn = (page, notches) => page.evaluate(n => new Promise(res => {
  const cv = document.getElementById('globe');
  let k = 0;
  const step = () => {
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    if (++k < n) setTimeout(step, 60); else res();
  };
  step();
}), notches);

/* Well inside a continent or well out to sea - never within a few degrees of a
   coast, because the page's coastlines are a generalised outline and the
   imagery is not, and disagreement there would be the test's fault. */
const SITES = [
  { name:'Sahara',          lat: 23,  lon:  13,  land:true  },
  { name:'Amazon',          lat: -5,  lon: -62,  land:true  },
  { name:'central Siberia', lat: 62,  lon: 100,  land:true  },
  { name:'outback',         lat:-24,  lon: 133,  land:true  },
  { name:'Greenland',       lat: 72,  lon: -40,  land:true  },
  { name:'Sudan',           lat: 16,  lon:  30,  land:true  },
  { name:'mid Pacific',     lat:  0,  lon:-140,  land:false },
  { name:'south Atlantic',  lat:-25,  lon: -20,  land:false },
  { name:'south Indian',    lat:-38,  lon:  80,  land:false },
  { name:'north Pacific',   lat: 38,  lon:-170,  land:false },
  { name:'Bay of Bengal',   lat: 14,  lon:  88,  land:false },
  { name:'Coral Sea',       lat:-17,  lon: 155,  land:false }
];

(async () => {
  const srv = await serve();
  PAGE = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  /* Every Blue Marble rung the page asks for, in order, and every GIBS call. */
  const rungs = [], gibs = [];
  page.on('request', r => {
    const m = r.url().match(/bluemarble-(\d+)\.jpg/);
    if (m) rungs.push(+m[1]);
    if (/gibs\.earthdata/.test(r.url())) gibs.push(r.url());
  });
  await page.route('**celestrak.org/**', r => r.abort());
  await page.route('**tle.ivanstanojevic.me/**', r => r.abort());
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 40000 });
  await page.waitForTimeout(2000);

  // ---- the control exists and offers what GlobeTex offers --------------------
  const modes = await page.evaluate(() => Orbit3D.surfaces().map(m => m.key));
  chk('the globe offers a choice of surface', modes.length >= 2, modes.join(', '));
  const radios = await page.evaluate(() =>
    [...document.querySelectorAll('input[name=globesurf]')].map(r => r.value));
  chk('...and every one of them is in the panel',
      modes.length === radios.length && modes.every(m => radios.includes(m)),
      radios.join(', '));

  // ---- the vector surface needs no network ----------------------------------
  const netFor = async key => {
    const seen = [];
    const on = r => { const u = r.url(); if (/gibs|nasa|bluemarble-/i.test(u)) seen.push(u); };
    page.on('request', on);
    await page.evaluate(k => new Promise(res => {
      Orbit3D.setSurface(k, st => { if (st.state !== 'loading') res(st); });
    }), key);
    await page.waitForTimeout(600);
    page.off('request', on);
    return seen;
  };
  chk('the coastline surface fetches nothing', (await netFor('vector')).length === 0);

  // ---- load the real imagery ------------------------------------------------
  /* Waits for the LAST rung of the size ladder, not the first: the whole point
     of the ladder is that an earlier, coarser map is already on the sphere, and
     a check that raced it would be measuring the 2048 and reporting the 4096. */
  const loaded = await page.evaluate(() => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timed out waiting for imagery')), 90000);
    Orbit3D.setSurface('night', st => {
      if (st.state === 'failed'){ clearTimeout(t); rej(new Error(st.detail || 'failed')); }
      if (st.state === 'ready' && st.detail && !/sharpening/.test(st.detail)){
        clearTimeout(t); res(st.detail);
      }
    });
  })).catch(e => ({ err: e.message }));
  if (loaded && loaded.err){
    chk('NASA imagery loads', false, loaded.err);
    console.log('\nthe remaining checks need the imagery; stopping here.');
    console.log('\n' + fails + ' CHECK(S) FAILED');
    await browser.close(); process.exit(1);
  }
  const v0 = await view(page), want0 = rungFor(v0);
  chk('imagery loads, at the rung this view can use',
      loaded.indexOf(want0 + '×' + want0/2) === 0,
      loaded + ' - expected ' + want0 + ' for ' + v0.h + ' px of buffer at ' + v0.d.toFixed(2) + ' radii');
  chk('...and nothing bigger was fetched to get there', rungs.length > 0 && rungs.every(w => w <= want0),
      'Blue Marble rungs requested: ' + rungs.join(', '));

  const shaded = await page.evaluate(() => {
    let found = null;
    Orbit3D.scene.traverse(o => {
      if (o.material && o.material.uniforms && o.material.uniforms.dayMap) found = o;
    });
    return !!found && found.material.uniforms.useNight.value === 1;
  });
  chk('...onto the day/night shader, with the lights switched on', shaded);

  // ---- geography: is the map the right way round? ---------------------------
  /* Read the day map back at each site's texel. The equirectangular convention
     is the sphere's own: x from longitude -180 at the left edge, y from
     latitude +90 at the top. If the request had come back transposed, rolled or
     flipped, this is where it shows. */
  const geo = await page.evaluate(sites => {
    let mesh = null;
    Orbit3D.scene.traverse(o => {
      if (o.material && o.material.uniforms && o.material.uniforms.dayMap) mesh = o;
    });
    const img = mesh.material.uniforms.dayMap.value.image;
    const W = img.width || img.naturalWidth, H = img.height || img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    /* Average a small patch rather than trust one texel: JPEG noise on a single
       pixel is worth several counts and a lone dark speck in a desert would
       read as ocean. */
    const R = 3;
    return sites.map(s => {
      const x = Math.round((s.lon + 180) / 360 * W), y = Math.round((90 - s.lat) / 180 * H);
      const d = g.getImageData(Math.max(0, x - R), Math.max(0, y - R), 2*R+1, 2*R+1).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4){ r += d[i]; gg += d[i+1]; b += d[i+2]; n++; }
      return { name: s.name, land: s.land, r: r/n, g: gg/n, b: b/n, W: W, H: H };
    });
  }, SITES);

  /* Blue Marble's deep water is emphatically blue - blue channel tens of counts
     above red. Land is never that: desert and forest run red-or-green-dominant,
     and the one land surface that is not, polar ice, is near-neutral white. One
     threshold separates them with room to spare either side. */
  /* Midway between the bluest land sampled (polar ice, near neutral) and the
     least blue open water, so neither side sits on the line. */
  const BLUE = 12;
  let worstLand = -1e9, worstSea = 1e9;
  for (const s of geo){
    const d = s.b - s.r;
    if (s.land) worstLand = Math.max(worstLand, d); else worstSea = Math.min(worstSea, d);
  }
  for (const s of geo)
    chk('  ' + s.name + ' reads as ' + (s.land ? 'land' : 'ocean'),
        s.land ? (s.b - s.r) < BLUE : (s.b - s.r) > BLUE,
        'B-R ' + (s.b - s.r).toFixed(1));
  chk('the map is not rolled, mirrored or flipped: every site lands on the right surface',
      worstLand < BLUE && worstSea > BLUE,
      'bluest land ' + worstLand.toFixed(1) + ', least blue sea ' + worstSea.toFixed(1)
        + ', threshold ' + BLUE);
  /* The size to expect is worked out from the view, not written down here. It
     used to be the GPU's ceiling outright - min(8192, MAX_TEXTURE_SIZE) - and
     that rule is what sent a phone the 6.6 MB map for a 560 px globe. The GPU
     still caps it, inside rungFor. */
  const cap = v0.max;
  chk('...and that is the map on the sphere',
      geo[0].W === want0 && geo[0].H === geo[0].W/2,
      geo[0].W + '×' + geo[0].H + ', MAX_TEXTURE_SIZE ' + cap);

  // ---- the terminator -------------------------------------------------------
  /* Measured with the city lights OFF. With them on, a lit city on the night
     side is legitimately brighter than dim ground in the daylight, so "bright
     means day" stops being true and the check would be testing the wrong
     thing. Lights get their own check below, which is where they belong. */
  await page.evaluate(() => { Orbit3D.freeCam(); document.getElementById('tpplay').click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => new Promise(res => {
    Orbit3D.setSurface('marble', st => { if (st.state === 'ready' && !/sharpening/.test(st.detail||'')) res(); });
  }));
  await page.waitForTimeout(500);

  /* A grid rather than the geography sites: those are chosen to be
     unambiguous land or ocean, which says nothing about where they fall
     relative to the Sun. Most are on the far side and get filtered out by the
     facing test. */
  const GRID = [];
  for (let la = -60; la <= 60; la += 20)
    for (let lo = -180; lo < 180; lo += 20) GRID.push({ lat: la, lon: lo });

  /* Lit places, for the night-lights check further down. They have to be named
     explicitly: a regular grid over the Earth is mostly ocean, and over ocean
     the night mosaic is darker than shaded Blue Marble is - correctly, since
     there is nothing out there to be lit. The lights brighten cities, so the
     check has to look at cities. */
  const CITIES = [
    { lat: 35.7, lon: 139.7, city:'Tokyo' },     { lat: 31.2, lon: 121.5, city:'Shanghai' },
    { lat: 28.6, lon:  77.2, city:'Delhi' },     { lat: 30.0, lon:  31.2, city:'Cairo' },
    { lat: 51.5, lon:  -0.1, city:'London' },    { lat: 40.7, lon: -74.0, city:'New York' },
    { lat:-23.5, lon: -46.6, city:'Sao Paulo' }, { lat: 34.0, lon:-118.2, city:'Los Angeles' },
    { lat: 55.8, lon:  37.6, city:'Moscow' },    { lat:  6.5, lon:   3.4, city:'Lagos' },
    { lat: 19.4, lon: -99.1, city:'Mexico City' }, { lat: 13.8, lon: 100.5, city:'Bangkok' }
  ];

  const sample = sites0 => page.evaluate(sites => {
    const R = Math.PI/180, D = 180/Math.PI;
    const r = Orbit3D.renderer, cam = Orbit3D.camera, sc = Orbit3D.scene;
    const when = new Date(Orbit3D.time);

    /* The oracle: satellite.js's sunPos, which is Vallado's algorithm and
       shares nothing with the four-term series inside orbit3d.js that aims the
       light. It gives the Sun in ECI; the sub-solar longitude follows from the
       right ascension and Greenwich sidereal time. */
    const jd = when.getTime()/86400000 + 2440587.5;
    const sp = satellite.sunPos(jd);
    const gmst = satellite.gstime(when);
    const decl = sp.decl;
    let subLon = (sp.rtasc - gmst)*D;
    subLon = ((subLon + 180) % 360 + 360) % 360 - 180;

    let mesh = null;
    sc.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.dayMap) mesh = o; });
    mesh.updateWorldMatrix(true, false);

    const gl = r.getContext();
    r.render(sc, cam);                        // read in the same task as the draw
    const cv = r.domElement;
    const buf = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);

    const eye = new THREE.Vector3(); cam.getWorldPosition(eye);

    /* The day map itself, read back once and cached. Knowing the texel under a
       probe is what turns "is it bright?" - which mostly measures whether the
       probe landed on desert or on ocean - into "is it as bright as this
       surface, lit this way, ought to be". */
    if (!window.__texcache || window.__texcache.img !== mesh.material.uniforms.dayMap.value.image){
      const img = mesh.material.uniforms.dayMap.value.image;
      const W = img.width || img.naturalWidth, H = img.height || img.naturalHeight;
      const cc = document.createElement('canvas'); cc.width = W; cc.height = H;
      const cg = cc.getContext('2d'); cg.drawImage(img, 0, 0);
      window.__texcache = { img: img, g: cg, W: W, H: H };
    }
    const TC = window.__texcache;
    const texel = (lat, lon) => {
      const x = Math.round((lon + 180)/360*TC.W), y = Math.round((90 - lat)/180*TC.H);
      const d = TC.g.getImageData(Math.max(0, Math.min(TC.W-5, x-2)),
                                  Math.max(0, Math.min(TC.H-5, y-2)), 5, 5).data;
      let r = 0, g2 = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4){ r += d[i]; g2 += d[i+1]; b += d[i+2]; n++; }
      return [r/n, g2/n, b/n];
    };

    return sites.map(s => {
      const a = s.lat*R, b = s.lon*R;
      /* the globe's lat/lon convention, rebuilt here rather than borrowed */
      const local = new THREE.Vector3(Math.cos(a)*Math.cos(b), Math.sin(a), -Math.cos(a)*Math.sin(b));
      const world = local.clone().applyMatrix4(mesh.matrixWorld);
      const n = world.clone().normalize();
      const facing = n.dot(eye.clone().sub(world).normalize());

      const H = (s.lon - subLon)*R;
      const el = Math.asin(Math.sin(a)*Math.sin(decl) + Math.cos(a)*Math.cos(decl)*Math.cos(H))*D;

      const p = world.clone().project(cam);
      const px = Math.round((p.x*0.5 + 0.5) * cv.width);
      const py = Math.round((p.y*0.5 + 0.5) * cv.height);    // readPixels is bottom-up
      let lum = -1;
      if (facing > 0.05 && px >= 2 && py >= 2 && px < cv.width-2 && py < cv.height-2){
        let t = 0, m = 0;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
          const i = ((py+dy)*cv.width + (px+dx))*4;
          t += 0.2126*buf[i] + 0.7152*buf[i+1] + 0.0722*buf[i+2]; m++;
        }
        lum = t/m;
      }
      return { lat: s.lat, lon: s.lon, city: s.city, el: el, lum: lum, f: facing,
               tex: texel(s.lat, s.lon) };
    });
  }, sites0);

  const spin = (dx, dy) => page.evaluate(d => {
    const cv = document.getElementById('globe'), R = cv.getBoundingClientRect();
    const x = R.left + R.width/2, y = R.top + R.height/2;
    cv.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    for (let i = 1; i <= 12; i++)
      window.dispatchEvent(new MouseEvent('mousemove',
        { clientX: x + d[0]*i/12, clientY: y + d[1]*i/12, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, [dx, dy || 0]);

  /* Six camera bearings around the globe. One view can sit wholly in daylight
     or wholly in darkness - the useful check needs both sides of the line in
     the pool, and spinning right round also means the terminator has to be in
     the right place from every direction, not just one lucky one. */
  const pool = [];
  for (let i = 0; i < 6; i++){
    if (i) { await spin(150); await page.waitForTimeout(450); }
    pool.push(...(await sample(GRID)));
  }
  /* Two filters, both earned the hard way by looking at what the outliers
     actually were.

     |el| > 25 rather than a few degrees: at 12 degrees of solar elevation the
     Southern Ocean genuinely renders at luminance 3, because cos(78 deg) of
     not much is not much. That probe is not a failure, it is grazing light.

     facing > 0.5 keeps the samples off the limb, where the atmosphere shell is
     additively bright and a probe is foreshortened into a handful of pixels.

     And the comparison is between MEDIANS, not extremes. The globe carries
     overlays - the orbit ring, the ground track, the site pin - drawn on top of
     the surface in bright colours, and out of several hundred probes a few land
     on one. A single contaminated probe should not be able to overturn a
     terminator that is right everywhere else; a terminator that is actually
     wrong moves the median and still fails. */
  const usable = pool.filter(s => s.lum >= 0 && Math.abs(s.el) > 25 && s.f > 0.5);
  const day = usable.filter(s => s.el > 0), night = usable.filter(s => s.el <= 0);
  chk('both sides of the terminator got sampled', day.length >= 5 && night.length >= 5,
      day.length + ' daylit, ' + night.length + ' dark, from ' + pool.length + ' probes over 6 bearings');
  const med = a => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };

  /* The decisive check. For each probe: take the colour the map actually holds
     there, light it exactly as the shader says it should be lit - linear space,
     the same ambient floor, the same clamp - and compare with the pixel that
     was drawn. This tests the whole chain at once: the map's orientation, the
     direction of the Sun, the gamma, and the ambient term. Comparing raw
     brightness between probes could never do that, because a lit ocean and an
     unlit desert are the same number.

     The solar elevation comes from satellite.js's sunPos, which this project
     did not write. */
  const AMB = 0.055;
  const lum = c => 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  const shade = (tex, elDeg) => {
    const k = AMB + (1 - AMB)*Math.max(0, Math.sin(elDeg*Math.PI/180));
    return lum(tex.map(v => 255*Math.pow(Math.pow(v/255, 2.2)*k, 1/2.2)));
  };
  const resid = (arr, flip) => arr.map(s => Math.abs(s.lum - shade(s.tex, flip ? -s.el : s.el)));
  const fit = med(resid(usable, false)), anti = med(resid(usable, true));
  chk('the globe is shaded the way the Sun says it should be',
      fit < 18, 'median error ' + fit.toFixed(1) + ' of 255, over ' + usable.length + ' probes');
  /* A control, so the check above is known to be capable of failing: run the
     same comparison with the Sun reversed and it should fit far worse. If it
     did not, the test would be measuring nothing. */
  chk('...and the same test rejects a reversed Sun, so it can tell the difference',
      anti > fit*2.5, 'reversed median error ' + anti.toFixed(1) + ' vs ' + fit.toFixed(1));
  if (day.length && night.length)
    chk('...on both sides of the terminator',
        med(resid(day, false)) < 20 && med(resid(night, false)) < 20,
        'daylit ' + med(resid(day, false)).toFixed(1) + ', dark ' + med(resid(night, false)).toFixed(1));

  // ---- and the lights are on the night side, which is the whole point -------
  /* Spin until some named cities are both on the near side and in darkness,
     then compare those same pixels with the lights off and on. Probe against
     itself, at one camera position: the surface, the geometry and the Sun are
     all held fixed, so anything that changes is the lights. */
  let dark = [];
  const hunt = [];
  for (let i = 0; i < 14; i++){
    const all = await sample(CITIES);
    const got = all.filter(s => s.lum >= 0 && s.f > 0.25 && s.el < -6);
    hunt.push(got.length + (got.length ? '(' + got.map(s => s.city).join('/') + ')' : ''));
    if (got.length > dark.length) dark = got;
    if (dark.length >= 2) break;
    /* alternate horizontal and vertical drags: spinning about one axis alone
       can keep the lit half of the planet in front of the camera indefinitely */
    await spin(150, i % 3 === 2 ? 90 : 0); await page.waitForTimeout(450);
  }
  chk('found cities on the night side to look at', dark.length >= 2,
      dark.map(s => s.city).join(', ') || 'none over ' + hunt.length + ' bearings: ' + hunt.join(' '));
  if (dark.length >= 2){
    await page.evaluate(() => new Promise(res => {
      Orbit3D.setSurface('night', st => { if (st.state === 'ready' && !/sharpening/.test(st.detail||'')) res(); });
    }));
    await page.waitForTimeout(700);
    const litNow = await sample(CITIES);
    const by = {}; litNow.forEach(s => { by[s.city] = s; });
    const pairs = dark.map(s => ({ name: s.city, off: s.lum, on: by[s.city] ? by[s.city].lum : -1 }))
                      .filter(x => x.on >= 0);
    pairs.forEach(x => console.log('        ' + x.name.padEnd(12)
      + ' ' + x.off.toFixed(0).padStart(4) + ' -> ' + x.on.toFixed(0).padStart(4)));
    const gained = pairs.filter(x => x.on > x.off + 3).length;
    chk('switching the lights on lights the cities up',
        gained >= Math.ceil(pairs.length*0.5),
        gained + ' of ' + pairs.length + ' brighter by more than 3 of 255');
    /* And nothing happens in daylight, which is what makes them lights rather
       than a brightness control. */
    const dayNow = litNow.filter(s => s.lum >= 0 && s.f > 0.4 && s.el > 25);
    const dayWas = (await sample(CITIES)).filter(s => s.lum >= 0 && s.f > 0.4 && s.el > 25);
    chk('...and leaves the daylit side alone',
        dayNow.every(s => { const w = dayWas.find(q => q.city === s.city);
                            return !w || Math.abs(s.lum - w.lum) < 4; }),
        dayNow.length + ' daylit cities in view, none changed by 4 of 255');
  }

  // ---- zoomed in, the view can use more, and gets it -----------------------
  /* Twelve notches takes the camera from 4.2 radii to the 1.25 stop, where
     every rung is short of what the disc can show, so the best the GPU holds
     is what should arrive. On the way it passes through the band where the
     4096 would do - and a zoom still moving must not stop to buy it. */
  const before = rungs.length, gibsBefore = gibs.length;
  await zoomIn(page, 12);
  const v1 = await view(page), want1 = rungFor(v1);
  const sharpAt = Date.now();
  let w1 = 0;
  while (Date.now() - sharpAt < 60000){
    w1 = await dayWidth(page);
    if (w1 >= want1) break;
    await page.waitForTimeout(250);
  }
  chk('zooming in sharpens the map to the rung the closer view can use',
      w1 === want1 && want1 > want0,
      w1 + ' bound, ' + want1 + ' expected at ' + v1.d.toFixed(2) + ' radii (was ' + want0 + ')');
  const zoomRungs = rungs.slice(before);
  chk('...fetching that rung alone: no coarse insurance copy, and none of the middle one on the way',
      zoomRungs.length === 1 && zoomRungs[0] === want1, 'requested: ' + (zoomRungs.join(', ') || 'nothing'));
  chk('...and not the night lights again', gibs.length === gibsBefore,
      (gibs.length - gibsBefore) + ' GIBS request(s) while sharpening');
  /* Zooming back out keeps the sharp map: it is already on the GPU, and
     stepping down would only be another download the next time in. */
  await page.evaluate(() => {
    const cv = document.getElementById('globe');
    for (let i = 0; i < 12; i++)
      cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(1200);
  chk('...and zooming back out neither drops it nor fetches again',
      (await dayWidth(page)) === want1 && rungs.length === before + 1,
      (await dayWidth(page)) + ' bound, ' + (rungs.length - before) + ' request(s) since the zoom');

  // ---- a dead NASA ---------------------------------------------------------
  /* The Blue Marble ships with the page now, so losing GIBS has to cost the
     dated layers and nothing else. This is the check that would notice it
     quietly going back to being fetched. */
  await page.route('**gibs.earthdata.nasa.gov/**', r => r.abort());
  const marbleOffline = await page.evaluate(() => new Promise(res => {
    Orbit3D.setSurface('marble', st => { if (st.state !== 'loading') res(st); });
  }));
  chk('the Blue Marble still loads with NASA unreachable',
      marbleOffline.state === 'ready',
      marbleOffline.state + (marbleOffline.detail ? ' - ' + marbleOffline.detail : ''));
  const offlineMap = await page.evaluate(() => {
    let m = null;
    Orbit3D.scene.traverse(o => {
      if (o.material && o.material.uniforms && o.material.uniforms.dayMap) m = o; });
    const img = m && m.material.uniforms.dayMap.value.image;
    return img ? { w: img.width || img.naturalWidth, src: (img.src || '').split('/').pop() } : null;
  });
  chk('...off the file that ships with it',
      !!offlineMap && /bluemarble-/.test(offlineMap.src),
      offlineMap ? offlineMap.src + ' at ' + offlineMap.w : 'no day map bound');

  /* And a layer that genuinely needs the network still says so, rather than
     quietly showing a static Blue Marble and calling it yesterday's weather. */
  await page.evaluate(() => {
    const r = document.querySelector('input[name=globesurf][value=clouds]');
    r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    () => /unavailable/i.test(document.getElementById('texnote').textContent),
    null, { timeout: 30000 }).catch(() => {});
  const cloudNote = await page.evaluate(() => document.getElementById('texnote').textContent);
  chk('a dated layer still reports the dead network', /unavailable/i.test(cloudNote),
      cloudNote.trim());
  chk('...and puts the radio back where the globe actually is',
      await page.evaluate(() => {
        const r = document.querySelector('input[name=globesurf]:checked');
        return r && r.value === 'vector' && Orbit3D.surface === 'vector';
      }));

  // ---- a phone, and a reader saving data ------------------------------------
  /* Each in a fresh context, with the Blue Marble chosen before the page loads
     so neither depends on GIBS. The phone is the finding itself: 390x844 at 3x,
     which the renderer caps to a 2x buffer, 878 px tall. */
  const fresh = async (ctxOpts, init) => {
    const ctx = await browser.newContext(ctxOpts);
    await ctx.addInitScript(init || (() => {}));
    await ctx.addInitScript(() => { try { localStorage.setItem('gt.surface', 'marble'); } catch (e) {} });
    const p = await ctx.newPage();
    const got = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('request', r => { const m = r.url().match(/bluemarble-(\d+)\.jpg/); if (m) got.push(+m[1]); });
    await p.route('**celestrak.org/**', r => r.abort());
    await p.route('**tle.ivanstanojevic.me/**', r => r.abort());
    await p.goto(PAGE, { waitUntil: 'load' });
    await p.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 40000 });
    await p.waitForFunction(() => /\d+×\d+/.test(document.getElementById('texnote').textContent)
      && !/sharpening/.test(document.getElementById('texnote').textContent), null, { timeout: 30000 });
    await p.waitForTimeout(1500);        // long enough for a sharpening to have started, were one due
    return { ctx, p, got };
  };

  {
    const { ctx, p, got } = await fresh({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
                                          isMobile: true, hasTouch: true });
    const v = await view(p), want = rungFor(v), w = await dayWidth(p);
    chk('a phone at the opening zoom gets the rung its view can use', w === want,
        w + ' bound, ' + want + ' expected for ' + v.h + ' px of buffer');
    chk('...and never asks for the 6.6 MB map', got.length > 0 && !got.includes(8192),
        'requested: ' + got.join(', '));
    await ctx.close();
  }
  {
    /* navigator.connection is Chromium's, and Save-Data is a flag on it; the
       page must read it and hold the coarse rung however close the reader
       zooms. */
    const { ctx, p, got } = await fresh({ viewport: { width: 1100, height: 800 } }, () => {
      Object.defineProperty(Navigator.prototype, 'connection',
        { configurable: true, get(){ return { saveData: true, effectiveType: '4g' }; } });
    });
    await p.evaluate(() => Orbit3D.freeCam());
    await zoomIn(p, 12);
    await p.waitForTimeout(2500);
    const v = await view(p), w = await dayWidth(p);
    chk('under Save-Data the coarse rung holds, even zoomed in', w === rungFor(v, true) && got.every(x => x === w),
        w + ' bound at ' + v.d.toFixed(2) + ' radii, requested: ' + got.join(', '));
    const note = await p.evaluate(() => document.getElementById('texnote').textContent);
    chk('...and the note beside the picker says why', /save data/i.test(note), note.trim());
    await ctx.close();
  }

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  srv.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
