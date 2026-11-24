/*
 * The realistic globe (CHANGES-FROM-LEGACY.md, L71): the Layers panel's "Realistic: clouds & atmosphere" surface.
 *
 * It is opt-in and the default globe is the old page's (the ab3d gate holds that), so what is checked here is that it stays out of the
 * way until it is chosen, does what it says when it is, and puts every last thing back when it is left:
 *
 *   - a first load fetches neither its chunk nor its cloud map, and the scene is the one the gate knows;
 *   - choosing it fetches both, puts a cloud shell on the Earth, a scattering sky on the atmosphere shell, black space behind them, and
 *     the clouds' source in the note under the list;
 *   - the picture is what it should be at a fixed instant: the day side lit, the night side dark, a pale-blue limb on the sunlit edge;
 *   - leaving it puts back the Earth's photographic material, the atmosphere's own geometry and material, the clear colour, and the
 *     scene's object count, and nothing in the page has complained.
 *
 *   node verification/suites/verify-realism.js            (the rebuilt page only)
 *   node verification/suites/verify-realism.js --shots    also writes verification/screens/realism-*.png to look at
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness');

/* 18:00 in Bangkok: with the site camera over it the terminator crosses the disc, so day, night and the sunlit limb are all in view */
const T0 = Date.UTC(2026, 8, 13, 11, 0, 0);
const SHOTS = process.argv.includes('--shots');
const SCREENS = path.join(__dirname, '..', 'screens');

let fails = 0;
const chk = (name, ok, detail) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) fails++; };

/* What the scene is, for comparing before and after: every object, the Earth's and the atmosphere's material and geometry. */
const snapshot = () => {
  const s = Orbit3D.scene, r = Orbit3D.renderer;
  let n = 0, earth = null, atmo = null, clouds = 0;
  s.traverse(o => {
    n++;
    if (o.name === 'realism-clouds') clouds++;
    const u = o.material && o.material.uniforms;
    if (u && (u.dayMap || u.uDay) && o.geometry && o.geometry.parameters && o.geometry.parameters.radius === 1) earth = o;
    if (o.material && o.material.side === 1 && o.geometry && o.geometry.parameters && (o.geometry.parameters.radius === 1.022 || o.geometry.parameters.radius === 1.12)) atmo = o;
  });
  return {
    objects: n, clouds,
    earthMat: earth && earth.material.uuid, earthReal: !!(earth && earth.material.uniforms.uDay),
    atmoMat: atmo && atmo.material.uuid, atmoGeo: atmo && atmo.geometry.uuid, atmoReal: !!(atmo && atmo.material.uniforms.uHaloK),
    clearAlpha: r.getClearAlpha(), toneMapping: r.toneMapping
  };
};

/* Render a frame and read back pixels where the day side, the night side and the sunlit limb are, found by projecting points on the
   sphere through the camera: a grid of directions, the most sunward and the most sunward-away of those well inside the visible disc,
   and a point 25 km above the edge of the disc on the side towards the Sun. */
const probes = () => {
  const r = Orbit3D.renderer, gl = r.getContext(), cv = r.domElement, cam = Orbit3D.camera, V = THREE.Vector3;
  let sun = null;
  Orbit3D.scene.traverse(o => { const u = o.material && o.material.uniforms; if (u && u.uSunW) sun = u.uSunW.value.clone().normalize(); });
  const c = cam.position.clone(), d = c.length(), cd = c.clone().normalize();
  let day = null, night = null, best = -2, worst = 2;
  for (let la = -85; la <= 85; la += 5) for (let lo = 0; lo < 360; lo += 5) {
    const a = la * Math.PI / 180, b = lo * Math.PI / 180;
    const n = new V(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b));
    if (n.dot(cd) < 0.75) continue;
    const s = n.dot(sun);
    if (s > best) { best = s; day = n; }
    if (s < worst) { worst = s; night = n; }
  }
  const t = sun.clone().addScaledVector(cd, -sun.dot(cd)).normalize();
  const limb = cd.clone().multiplyScalar(1 / d).addScaledVector(t, Math.sqrt(1 - 1 / (d * d))).multiplyScalar(1 + 25 / 6378.137);
  r.render(Orbit3D.scene, cam);
  const read = p => {
    const q = p.clone().project(cam), x = Math.round((q.x + 1) / 2 * cv.width), y = Math.round((q.y + 1) / 2 * cv.height);
    const px = new Uint8Array(4 * 9), out = [];
    gl.readPixels(x - 1, y - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0; i < 9; i++) out.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
    out.sort((u, v) => (u[0] + u[1] + u[2]) - (v[0] + v[1] + v[2]));
    return out[4];                                           // the median of a 3 x 3 patch
  };
  return { sunCos: [best, worst], day: day && read(day), night: night && worst < -0.3 ? read(night) : null, limb: read(limb) };
};

(async () => {
  if (H.targetName() !== 'new') { console.log('SKIP  the realistic globe exists only in the rebuilt page'); return; }
  const srv = await H.up();
  const { chromium } = H.playwright();
  const browser = await chromium.launch({ args: H.GL_ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1, timezoneId: 'UTC', locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = [], got = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 300)); });
  page.on('request', q => got.push(new URL(q.url()).pathname));
  await page.clock.setFixedTime(new Date(T0));
  await page.goto(srv.page, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D && !!window.Orbit3D && !!Orbit3D.scene, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  /* ---- before: out of the way ---- */
  const realLoaded = () => got.some(p => /\/assets\/realism-[\w-]{8}\.js$/.test(p));
  const cloudsLoaded = () => got.some(p => /\/assets\/clouds-\d+-[\w-]{8}\.jpg$/.test(p));
  chk('a first load fetches neither the realistic look nor its clouds', !realLoaded() && !cloudsLoaded());
  const modes = await page.evaluate(() => Orbit3D.surfaces().map(m => m.key + (m.real ? '*' : '')));
  chk('the surface list offers it last, after the old page\'s four, and only it asks for the look', modes.join(' ') === 'vector marble night clouds real*', modes.join(' '));
  const before = await page.evaluate(`(${snapshot})()`);
  chk('before it is chosen the scene has no cloud shell, the plain atmosphere and a clear canvas', before.clouds === 0 && !before.earthReal && !before.atmoReal && before.clearAlpha === 0,
    JSON.stringify(before));

  /* ---- choosing it, as a reader does ---- */
  await page.click('#layerstoggle');
  await page.click('input[name=globesurf][value=real]');
  await page.waitForFunction(() => {
    let on = false;
    Orbit3D.scene.traverse(o => { if (o.name === 'realism-clouds' && o.material.uniforms.uCloudOn.value === 1) on = true; });
    return on;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const during = await page.evaluate(`(${snapshot})()`);
  chk('choosing it fetches its chunk and the cloud map', realLoaded() && cloudsLoaded());
  chk('...and the Earth wears the realistic material, under a cloud shell, a scattering sky and black space',
    during.earthReal && during.clouds === 1 && during.atmoReal && during.clearAlpha === 1 && during.toneMapping === 0, JSON.stringify(during));
  const note = await page.textContent('#texnote');
  chk('the note under the list names the clouds\' source', /Reto Stöckli/.test(note || ''), (note || '').slice(0, 160));
  await page.keyboard.press('Escape');

  /* ---- the sky layers' names over the realistic sky (L75). It is drawn at the camera, the Moon where the camera sees it, which from the
     opening 4.2 Earth radii is up to 4 degrees from where the Earth's centre sees it; the layers' names, which the old page drew from the
     Earth's centre, go with it, or the Moon's name stands degrees off the Moon. Read off the scene: the drawn Moon's direction from the
     camera, and the name's, less the 7.5 units it is hung below its body. */
  const sky = () => {
    const V = THREE.Vector3, cam = Orbit3D.camera.position.clone();
    let moon = null, name = null;
    Orbit3D.scene.updateMatrixWorld(true);
    Orbit3D.scene.traverse(o => {
      const u = o.material && o.material.uniforms;
      if (o.isMesh && u && u.uLight && u.uView && o.parent && o.parent.name === 'realism-sky-date') moon = o;
      /* the sky layers' bodies: a group of sprites, each body's disc then its name, the Sun first and the Moon second */
      if (o.isGroup && o.children.length >= 4 && o.children.every(c => c.isSprite) && !o.children[2].userData.form && o.children[3].userData.form) name = o.children[3];
    });
    if (!moon || !name) return { moon: !!moon, name: !!name };
    const a = moon.getWorldPosition(new V()).sub(cam).normalize();
    const b = name.getWorldPosition(new V()).add(new V(0, 7.5, 0)).sub(cam).normalize();
    return { moon: true, name: true, deg: Math.acos(Math.min(1, a.dot(b))) * 180 / Math.PI, at: name.parent.position.length() };
  };
  await page.waitForTimeout(500);
  const s1 = await page.evaluate(`(${sky})()`);
  chk("the sky layers' Moon name stands under the Moon the realistic sky draws from the camera, not where the Earth's centre sees it",
    s1.moon && s1.name && s1.deg < 0.05 && s1.at > 1, JSON.stringify(s1));

  /* L83: the stars and the Milky Way are drawn at one exposure, worked out from what is bright in the view (lib/models/exposure.ts, whose
     figures tests/lib/exposure.test.ts holds) */
  const expo = () => page.evaluate(() => {
    const v = [];
    Orbit3D.scene.traverse(o => { const u = o.material && o.material.uniforms; if (u && u.uExpo && o.parent && /^realism-sky/.test(o.parent.name)) v.push(u.uExpo.value); });
    return v;
  });
  const e0 = await expo();
  chk("the realistic sky's stars and Milky Way are drawn at one exposure, between 0 and 1 (L83)", e0.length === 2 && e0[0] === e0[1] && e0[0] > 0 && e0[0] <= 1,
    JSON.stringify(e0));

  /* ---- the picture ---- */
  await page.evaluate(() => Orbit3D.setSite(true));
  await page.waitForTimeout(800);
  const p = await page.evaluate(`(${probes})()`);
  const lum = c => c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : NaN;
  console.log('        probes: ' + JSON.stringify(p));
  chk('the day side is lit', p.day && lum(p.day) > 35 && lum(p.day) < 235, JSON.stringify(p.day));
  chk('the night side is dark', !p.night || lum(p.night) < 40, JSON.stringify(p.night));
  chk('the sunlit limb glows pale blue', p.limb && p.limb[2] > p.limb[0] && lum(p.limb) > 15, JSON.stringify(p.limb));
  if (SHOTS) {
    fs.mkdirSync(SCREENS, { recursive: true });
    await page.locator('#globe').screenshot({ path: path.join(SCREENS, 'realism-free.png') });
    for (let i = 0; i < 8; i++) {                               // in towards the limb
      await page.evaluate(() => Orbit3D.renderer.domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })));
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1500);
    await page.locator('#globe').screenshot({ path: path.join(SCREENS, 'realism-near.png') });
    await page.evaluate(() => Orbit3D.setPov(true));
    await page.waitForTimeout(1500);
    await page.locator('#globe').screenshot({ path: path.join(SCREENS, 'realism-pov.png') });
    await page.evaluate(() => Orbit3D.setFollow(true));
    console.log('        screenshots in ' + SCREENS);
  }

  /* ---- leaving it ---- */
  await page.click('#layerstoggle');
  await page.click('input[name=globesurf][value=night]');
  await page.waitForFunction(() => /city lights|VIIRS/i.test((document.getElementById('texnote') || {}).textContent || ''), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(`(${snapshot})()`);
  chk('leaving it puts back the photographic material, the atmosphere\'s own geometry and material, and the clear canvas',
    !after.earthReal && after.clouds === 0 && !after.atmoReal && after.atmoMat === before.atmoMat && after.atmoGeo === before.atmoGeo && after.clearAlpha === 0,
    JSON.stringify(after));
  chk('...and the scene holds as many objects as it did before', after.objects === before.objects, before.objects + ' -> ' + after.objects);
  const s2 = await page.evaluate(() => {
    let at = null;
    Orbit3D.scene.traverse(o => { if (o.isGroup && o.children.length >= 4 && o.children.every(c => c.isSprite) && !o.children[2].userData.form && o.children[3].userData.form) at = o.position.length(); });
    return at;
  });
  chk("...and the sky layers' names are back at the Earth's centre, as the old page keeps them", s2 === 0, String(s2));

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  chk('nothing in the page complained', errs.length === 0);
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close(); await srv.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
