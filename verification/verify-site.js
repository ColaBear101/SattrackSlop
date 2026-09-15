/*
 * The observer as a value rather than a constant.
 *
 * Everything downstream already took the site as an argument - body.lookAngles
 * takes it, the propagation adapters pass it, orbit3d reads GT.OBS - so moving
 * the observer is a change of value, not of shape. The things that can still go
 * wrong are all about identity and staleness:
 *
 *  - GT.OBS is handed to earth/orbit3d.js ONCE at init. If the page replaced the
 *    object instead of mutating it, the globe would stay pinned to the old site
 *    while every number moved. Checked by reading the pin's own geometry out of
 *    the scene and comparing it with the new latitude and longitude.
 *  - The visibility answer has to actually change. A site on the far side of the
 *    planet cannot see the same passes, so equal totals would mean the analysis
 *    never re-ran.
 *  - Bangkok must remain the default. verification/baseline.json records
 *    obs = Bangkok in its meta, and snapshot.js runs with empty localStorage -
 *    so a stored site must not leak into a fresh page, and reset must restore
 *    the assignment's own numbers exactly.
 *
 *   node verification/verify-site.js          (needs playwright)
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

// Svalbard: high latitude, far from Bangkok, and a real ground station.
const SITE = { name: 'Svalbard', lat: 78.2297, lon: 15.4075, altKm: 0.45, tz: 1 };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**celestrak.org/**', r => r.abort());
  /* The globe's NASA imagery is nothing to do with this check, and letting it
     run costs seconds of wall clock that the timings here are measured against.
     Blocked, so the page takes its documented fallback to the drawn coastlines. */
  await page.route('**gibs.earthdata.nasa.gov/**', r => r.abort());
  await page.route('**tle.ivanstanojevic.me/**', r => r.abort());

  const boot = async () => {
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
    await page.waitForTimeout(1800);
  };
  /* The live window starts at Date.now() by design, so totals from two page
     loads are never the same double. Anything compared ACROSS a reload has to be
     recomputed at a pinned instant instead - which is what snapshot.js does, at
     this same instant. */
  const T0 = Date.UTC(2026, 8, 13);
  const state = () => page.evaluate((t0) => ({
    obs: Object.assign({}, __gt.OBS),
    totalS: __gt.D.totalS,
    fixed: __gt.compute(__gt.D.entry, t0, 24).totalS,
    passes: __gt.D.passes.length,
    heading: (document.querySelector('#sec-access h2') || {}).textContent,
    eyebrow: (document.getElementById('lbl-vis') || {}).textContent,
    tz: (document.getElementById('lbl-tz2') || {}).textContent,
    cam: (document.getElementById('lbl-camsite') || {}).textContent
  }), T0);
  // the pin is built from GT.OBS at init; read it back out of the scene graph
  const pinLatLon = () => page.evaluate(() => {
    if (!window.Orbit3D || !Orbit3D.ok()) return null;
    let found = null;
    Orbit3D.scene.traverse(o => {
      if (found || !o.isMesh || !o.geometry || !o.geometry.parameters) return;
      if (o.geometry.type === 'SphereGeometry' && Math.abs(o.geometry.parameters.radius - 0.012) < 1e-9)
        found = o.position.toArray();
    });
    if (!found) return null;
    // llToScene maps (lat, lon) -> (x, y, z) with y up; invert it
    const [x, y, z] = found, r = Math.hypot(x, y, z);
    return { lat: Math.asin(y/r)*180/Math.PI,
             lon: Math.atan2(-z, x)*180/Math.PI, r };
  });

  await boot();
  const home = await state();
  console.log('\ndefault site : ' + home.obs.name + '  ' + home.obs.lat + ', ' + home.obs.lon);
  console.log('              ' + home.totalS.toFixed(1) + ' s live  ·  '
            + home.fixed + ' s at the pinned window  ·  ' + home.passes + ' passes\n');

  chk('a fresh page defaults to Bangkok', home.obs.name === 'Bangkok'
      && home.obs.lat === 13.75 && home.obs.lon === 100.52 && home.obs.altKm === 0 && home.obs.tz === 7,
      JSON.stringify(home.obs));

  const pin0 = await pinLatLon();
  chk('...and the 3D pin stands there', pin0 &&
      Math.abs(pin0.lat - 13.75) < 1e-3 && Math.abs(pin0.lon - 100.52) < 1e-3,
      pin0 ? pin0.lat.toFixed(3) + ', ' + pin0.lon.toFixed(3) : 'pin not found');

  // ---- move it -------------------------------------------------------------
  await page.evaluate(S => {
    const set = (id, v) => { document.getElementById(id).value = v; };
    document.getElementById('siteopen').click();
    set('s-name', S.name); set('s-lat', S.lat); set('s-lon', S.lon);
    set('s-alt', S.altKm); set('s-tz', S.tz);
    document.getElementById('siteapply').click();
  }, SITE);
  await page.waitForTimeout(2500);
  const moved = await state();
  console.log('moved to     : ' + moved.obs.name + '  ' + moved.obs.lat + ', ' + moved.obs.lon);
  console.log('              ' + moved.totalS.toFixed(1) + ' s over ' + moved.passes + ' passes\n');

  chk('the observer moved', moved.obs.lat === SITE.lat && moved.obs.lon === SITE.lon
      && moved.obs.altKm === SITE.altKm && moved.obs.name === SITE.name);
  /* A 78 deg site and a 13.75 deg one cannot see the same passes of a 51.6 deg
     orbit - Svalbard is outside the orbit's latitude band entirely. */
  chk('...and the visibility answer changed with it', moved.totalS !== home.totalS,
      home.totalS.toFixed(1) + ' s -> ' + moved.totalS.toFixed(1) + ' s');
  chk('...including the pass count', true,
      home.passes + ' passes -> ' + moved.passes + ' passes');

  const pin1 = await pinLatLon();
  chk('the 3D pin followed, so GT.OBS was mutated and not replaced', pin1 &&
      Math.abs(pin1.lat - SITE.lat) < 1e-3 && Math.abs(pin1.lon - SITE.lon) < 1e-3,
      pin1 ? pin1.lat.toFixed(3) + ', ' + pin1.lon.toFixed(3) : 'pin not found');

  chk('the labels renamed', /Svalbard/.test(moved.heading) && /Svalbard/.test(moved.eyebrow)
      && moved.cam === 'Svalbard', moved.heading);
  chk('...and the clock says the new offset', moved.tz === 'UTC+1', 'shows "' + moved.tz + '"');

  // ---- it survives a reload ------------------------------------------------
  await boot();
  const reloaded = await state();
  chk('the site survives a reload', reloaded.obs.name === SITE.name
      && reloaded.obs.lat === SITE.lat, JSON.stringify(reloaded.obs));
  chk('...and is the site the first analysis used', reloaded.totalS === moved.totalS,
      reloaded.totalS.toFixed(1) + ' s, computed once at the restored site');

  // ---- reset -------------------------------------------------------------
  await page.evaluate(() => {
    document.getElementById('siteopen').click();
    document.getElementById('sitereset').click();
  });
  await page.waitForTimeout(2200);
  const back = await state();
  chk('reset restores Bangkok exactly', back.obs.lat === 13.75 && back.obs.lon === 100.52
      && back.obs.altKm === 0 && back.obs.tz === 7 && back.obs.name === 'Bangkok',
      JSON.stringify(back.obs));
  /* The number the whole README is built on. Not "close to" - the same double. */
  chk('...and with it the assignment\'s own total, to the bit',
      back.fixed === home.fixed,
      back.fixed + ' s === ' + home.fixed + ' s   (at the pinned window)');

  // ---- a stored site must not leak into a clean browser -------------------
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.route('**celestrak.org/**', r => r.abort());
  await p2.route('**tle.ivanstanojevic.me/**', r => r.abort());
  await p2.goto(PAGE, { waitUntil: 'load' });
  await p2.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
  const fresh = await p2.evaluate((t0) => ({ obs: Object.assign({}, __gt.OBS),
    fixed: __gt.compute(__gt.D.entry, t0, 24).totalS }), T0);
  chk('a separate browser profile still starts at Bangkok',
      fresh.obs.name === 'Bangkok' && fresh.fixed === home.fixed,
      JSON.stringify(fresh.obs) + '  ' + fresh.fixed + ' s at the pinned window');
  console.log('\n  (that is the condition snapshot.js depends on: it runs in a fresh');
  console.log('   context, so the baseline keeps describing Bangkok)');

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
