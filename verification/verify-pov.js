/*
 * The POV camera in earth/orbit3d.js, asserted against the real camera.
 *
 * The other three camera modes are the SAME camera: a point at cam0.dist from
 * the origin, looking at the origin, differing only in how the bearing is
 * chosen. "Satellite" therefore looks at the Earth from the spacecraft's
 * DIRECTION, which is not the same thing as looking from the spacecraft. POV is,
 * and that makes it the one mode whose geometry can be wrong in ways a
 * screenshot will not show: a camera at 0.9999 of the right place still renders
 * a plausible picture.
 *
 * So this measures the camera rather than the pixels - position against the
 * propagated state vector, view direction against nadir, screen-up against the
 * along-track direction - and drives the real input handlers for the rest.
 *
 * One trap worth naming: the PAGE owns the clock and pushes it into the scene
 * every frame, so setting Orbit3D.time is silently overwritten on the next
 * animation frame. At 7.7 km/s one frame of drift is ~0.13 km, which reads
 * exactly like a camera-placement bug. The page transport is paused first.
 *
 *   node verification/verify-pov.js          (needs playwright)
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');
const U = 1 / 6378.137;                         // km -> scene units (Earth radii)

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};
const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const dist3 = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**celestrak.org/**', r => r.abort());
  await page.route('**tle.ivanstanojevic.me/**', r => r.abort());
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  const cam = () => page.evaluate(() => {
    const c = Orbit3D.camera;
    return { pos: c.position.toArray(), fov: c.fov,
             dir: new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion).toArray(),
             up:  new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion).toArray(),
             pov: Orbit3D.pov, follow: Orbit3D.follow, site: Orbit3D.site };
  });
  const pressed = () => page.evaluate(() =>
    [...document.querySelectorAll('.camseg .cam')]
      .map(b => b.dataset.mode + '=' + b.getAttribute('aria-pressed')));

  await page.evaluate(() => document.getElementById('tpplay').click());   // freeze the clock
  await page.waitForTimeout(400);
  await page.evaluate(() => Orbit3D.setPov(true));
  await page.waitForTimeout(900);

  let c = await cam();
  console.log('\naltitude ' + ((Math.hypot(...c.pos) - 1) / U).toFixed(1) + ' km'
            + '   horizon ' + (Math.asin(1/Math.hypot(...c.pos))*180/Math.PI).toFixed(2) + ' deg off nadir\n');

  // ---- mode exclusivity ---------------------------------------------------
  chk('setPov(true) enters POV', c.pov === true);
  chk('...and clears the other two modes', c.follow === false && c.site === false,
      'follow=' + c.follow + ' site=' + c.site);
  const p1 = await pressed();
  chk('...leaving exactly one button pressed, the POV one',
      p1.filter(x => x.endsWith('=true')).length === 1 && p1.includes('pov=true'), p1.join(' '));

  // ---- the geometry, against the propagated state -------------------------
  const ref = await page.evaluate((u) => {
    const st = __gt.D.track.at(Orbit3D.time.getTime());
    return { r: [st.r.x*u, st.r.z*u, -st.r.y*u], v: [st.v.x, st.v.z, -st.v.y] };
  }, U);
  c = await cam();

  chk('the camera sits exactly on the spacecraft', dist3(c.pos, ref.r) < 1e-6,
      'offset = ' + (dist3(c.pos, ref.r)/U).toExponential(2) + ' km');

  const rMag = Math.hypot(...c.pos);
  const nadir = c.pos.map(v => -v/rMag);
  chk('it looks at nadir when yaw and pitch are zero',
      Math.abs(dot3(c.dir, nadir) - 1) < 1e-6, 'dot(view, nadir) = ' + dot3(c.dir, nadir).toFixed(9));

  /* Screen-up is the along-track direction, so the spacecraft flies toward the
     top of the frame - the orientation nadir imagery is published in. */
  const zen = c.pos.map(v => v/rMag);
  const vh = ref.v.map(v => v/Math.hypot(...ref.v));
  const ah = vh.map((v, i) => v - zen[i]*dot3(vh, zen));
  const ahn = ah.map(v => v/Math.hypot(...ah));
  chk('screen-up is the along-track direction', Math.abs(dot3(c.up, ahn) - 1) < 1e-6,
      'dot(up, along-track) = ' + dot3(c.up, ahn).toFixed(9));

  chk('the FOV starts at the value the other modes use', Math.abs(c.fov - 42) < 1e-9,
      'fov = ' + c.fov);

  // ---- the wheel is a lens, not a range -----------------------------------
  const held = c.pos.slice();
  await page.evaluate(() => {
    const cv = document.getElementById('globe');
    for (let i = 0; i < 5; i++)
      cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  c = await cam();
  chk('the wheel narrows the FOV instead of closing a range', c.fov < 42 - 1e-6,
      'fov = ' + c.fov.toFixed(2) + ' deg');
  chk('...without moving the camera off the spacecraft', dist3(c.pos, held) < 1e-6);
  chk('...and without leaving the mode', c.pov === true);

  // ---- a drag looks around rather than dropping the mode ------------------
  /* Every other mode treats a drag as "the user wants the free camera", because
     for those modes moving the camera IS leaving them. Looking around is the
     whole point of POV, so it has to stay aboard. */
  const dirHeld = c.dir.slice();
  await page.evaluate(() => {
    const cv = document.getElementById('globe');
    const R = cv.getBoundingClientRect();
    const x = R.left + R.width/2, y = R.top + R.height/2;
    cv.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    for (let i = 1; i <= 10; i++)
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + i*8, clientY: y, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  c = await cam();
  const turned = Math.acos(Math.max(-1, Math.min(1, dot3(c.dir, dirHeld))))*180/Math.PI;
  chk('a drag stays in POV', c.pov === true);
  chk('...and turns the view', turned > 1e-3, 'turned ' + turned.toFixed(2) + ' deg');
  chk('...while the camera stays on the spacecraft', dist3(c.pos, held) < 1e-6);

  // ---- leaving restores the free camera exactly ---------------------------
  /* cam0 is never written while POV is on, so the free camera comes back where
     it was rather than wherever the spacecraft happened to be. */
  await page.evaluate(() => Orbit3D.freeCam());
  await page.waitForTimeout(600);
  c = await cam();
  chk('leaving POV restores the shared FOV', Math.abs(c.fov - 42) < 1e-9, 'fov = ' + c.fov);
  chk('...and puts the camera back outside the orbit', Math.hypot(...c.pos) > 1.5,
      '|r| = ' + Math.hypot(...c.pos).toFixed(3) + ' Earth radii');
  const p2 = await pressed();
  chk('...with the POV button released', p2.includes('pov=false'), p2.join(' '));

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
