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
  /* The globe's NASA imagery is nothing to do with this check, and letting it
     run costs seconds of wall clock that the timings here are measured against.
     Blocked, so the page takes its documented fallback to the drawn coastlines. */
  await page.route('**gibs.earthdata.nasa.gov/**', r => r.abort());
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
  /* The FOV readout. Read the ROW's own hidden flag and the text in it, not a
     module variable that says what should have been written. */
  const lens = () => page.evaluate(() => ({
    hidden: document.getElementById('o3fovrow').hidden,
    text:   document.getElementById('o3fov3').textContent,
    mm:     document.getElementById('o3fovmm').textContent,
    fov:    Orbit3D.camera.fov, aspect: Orbit3D.camera.aspect }));
  /* What the row SHOULD say, derived here rather than in the page. */
  const expect = (v, aspect) => {
    const R = Math.PI/180, D = 180/Math.PI;
    const h = 2*Math.atan(Math.tan(v*R/2) * aspect)*D;
    return { text: h.toFixed(1) + '° × ' + v.toFixed(1) + '°',
             mm: '≈' + (36/(2*Math.tan(h*R/2))).toFixed(0) + ' mm' };
  };
  /* The GSD readout, plus everything needed to recompute it from OUTSIDE the
     page: the camera state and the drawing buffer it renders into. */
  const gsd = () => page.evaluate(() => {
    const c = Orbit3D.camera, cv = document.getElementById('globe');
    return { hidden: document.getElementById('o3gsdrow').hidden,
             text:   document.getElementById('o3gsd').textContent,
             unit:   document.getElementById('o3gsdu').textContent,
             title:  document.getElementById('o3gsd').title,
             pos: c.position.toArray(), fov: c.fov, H: cv.height,
             dir: new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion).toArray() };
  });
  /* The same quantity by a different road. The page casts rays and measures the
     chord between where they land; this is the textbook derivative - one pixel
     of angle at the slant range, stretched along the look by the secant of the
     incidence angle - with the range and incidence from plane trigonometry on
     the triangle centre-spacecraft-target:

       sin i = (r / Re) sin theta        theta = the angle off nadir
       rho   = Re sin(i - theta) / sin theta

     Sharing no line of code with the implementation is the point. It disagrees
     by design near the limb, where the derivative diverges and the measured
     footprint does not, so it is only applied where sin i < 1. */
  const RE_KM = 6378.137;
  const analytic = g => {
    const rmag = Math.hypot(...g.pos);
    const cth = -(g.dir[0]*g.pos[0] + g.dir[1]*g.pos[1] + g.dir[2]*g.pos[2]) / rmag;
    const th = Math.acos(Math.max(-1, Math.min(1, cth)));
    const si = rmag * Math.sin(th);                    // r is already in Earth radii
    if (si >= 1) return null;                          // the boresight clears the limb
    const i = Math.asin(si);
    const rho = th < 1e-9 ? (rmag - 1)*RE_KM : RE_KM*Math.sin(i - th)/Math.sin(th);
    const x = rho * (2*Math.tan(g.fov*Math.PI/360)/g.H) * 1000;
    return { x: x, y: x/Math.cos(i), inc: i*180/Math.PI, range: rho, off: th*180/Math.PI };
  };
  /* The row prints 3 significant figures, so agreement can only be asserted to
     the width of the last digit printed - anything tighter would be testing the
     rounding. */
  const near = (shown, want) => Math.abs(shown - want) <= Math.max(0.5, want*5e-4);
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
  const zen = c.pos.map(v => v/rMag);
  const vh = ref.v.map(v => v/Math.hypot(...ref.v));
  const ah = vh.map((v, i) => v - zen[i]*dot3(vh, zen));
  const ahn = ah.map(v => v/Math.hypot(...ah));

  /* The camera looks FORWARD, down the track, with zenith up.
     It used to default to nadir, and these two assertions used to say so. The
     reason it changed is a real one rather than taste: looking straight down
     puts the view axis ON the yaw axis, so a sideways drag - which yaws about
     the local vertical - only rolled the image instead of turning the head. The
     camera felt stuck. Facing along-track separates the axes.
     Nadir is not lost, it is one drag away, and the pitch check below proves
     it still arrives exactly. */
  chk('it looks along-track when yaw and pitch are zero',
      Math.abs(dot3(c.dir, ahn) - 1) < 1e-6, 'dot(view, along-track) = ' + dot3(c.dir, ahn).toFixed(9));
  chk('screen-up is the zenith', Math.abs(dot3(c.up, zen) - 1) < 1e-6,
      'dot(up, zenith) = ' + dot3(c.up, zen).toFixed(9));
  chk('the view is level: no roll about the boresight',
      Math.abs(dot3(c.up, ahn)) < 1e-6, 'up . along-track = ' + dot3(c.up, ahn).toExponential(2));

  /* Pitching fully down must still land on nadir. That is the capability the
     old default handed over for free, and it would be easy to lose silently
     while changing where the camera starts. A downward drag of 400 px at
     0.30 deg/px saturates the -89 clamp, one degree short of the gimbal pole,
     so the residual is that degree rather than zero. */
  await page.evaluate(() => {
    const cv = document.getElementById('globe');
    const R = cv.getBoundingClientRect();
    const x = R.left + R.width/2, y = R.top + R.height/2;
    cv.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    for (let i = 1; i <= 40; i++)
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y + i*10, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const down = await cam();
  const dn = down.pos.map(v => -v/Math.hypot(...down.pos));
  const offNadir = Math.acos(Math.max(-1, Math.min(1, dot3(down.dir, dn))))*180/Math.PI;
  chk('pitching down still reaches nadir, to within the one-degree clamp',
      offNadir < 1.5, offNadir.toFixed(2) + ' deg off nadir');
  c = await cam();

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

  // ---- the lens says what it is ------------------------------------------
  /* The wheel drives the FOV over a 11:1 range. Without a readout the view
     changes with nothing to say what it changed to, so the row is checked
     against the camera it claims to describe - and against the HORIZONTAL
     angle, since three.js stores the vertical one and a camera is quoted by
     its horizontal. */
  let lz = await lens(), want = expect(lz.fov, lz.aspect);
  chk('the FOV row is showing in POV', lz.hidden === false);
  chk('...and matches the camera it describes', lz.text === want.text,
      lz.text + (lz.text === want.text ? '' : ' != ' + want.text));
  chk('...including the 35 mm equivalent', lz.mm === want.mm, lz.mm);
  chk('...and the horizontal angle is the wider of the two',
      parseFloat(lz.text) > lz.fov, lz.text.split('×')[0].trim() + ' > ' + lz.fov.toFixed(1));
  const wideText = lz.text;

  /* A second wheel step: a readout written once at entry would pass everything
     above and still be stale here. */
  await page.evaluate(() => {
    const cv = document.getElementById('globe');
    const R = cv.getBoundingClientRect();
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: R.left + R.width/2,
                                               clientY: R.top + R.height/2, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  lz = await lens(); want = expect(lz.fov, lz.aspect);
  chk('...and it follows a further zoom', lz.text !== wideText && lz.text === want.text,
      wideText + ' -> ' + lz.text);

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

  // ---- ground sample distance --------------------------------------------
  /* POV enters looking along-track, and a horizontal ray from any positive
     altitude passes the sphere by - so before pitching down there is genuinely
     nothing to measure, and the row has to say so rather than print the
     divergent number the derivative would give. */
  await page.evaluate(() => { Orbit3D.freeCam(); Orbit3D.setPov(true); });
  await page.waitForTimeout(600);
  let gz = await gsd();
  chk('the GSD row shows in POV', gz.hidden === false);
  /* The boresight has no footprint here, so the row shows the value straight
     down instead - which has to be both labelled as such and correct. Its
     reference is the plainest arithmetic in the file: at nadir the range IS the
     altitude and there is no obliquity, so it is altitude times one pixel of
     angle and nothing else. */
  const boreOffNadir = g => Math.acos(Math.max(-1, Math.min(1,
    -(g.dir[0]*g.pos[0] + g.dir[1]*g.pos[1] + g.dir[2]*g.pos[2])/Math.hypot(...g.pos))))*180/Math.PI;
  chk('...with the view axis clear of the limb on entry',
      analytic(gz) === null, 'off-nadir ' + boreOffNadir(gz).toFixed(1) + ' deg');
  chk('...so it falls back to the figure straight down, and says so',
      /at nadir/.test(gz.unit), gz.text + ' ' + gz.unit);
  {
    const want = (Math.hypot(...gz.pos) - 1)*RE_KM * (2*Math.tan(gz.fov*Math.PI/360)/gz.H) * 1000;
    chk('...which is the altitude times one pixel of angle', near(Number(gz.text), want),
        gz.text + ' vs ' + want.toFixed(2) + ' m');
  }

  /* Pitch down onto the ground and check the figure against the trigonometry.
     Two attitudes, because one of them could match by luck: a steep oblique,
     where the two axes differ by a factor of two and a half, and near-nadir,
     where they must converge. */
  const pitchTo = deg => page.evaluate(d => {
    const cv = document.getElementById('globe'), R = cv.getBoundingClientRect();
    const x = R.left + R.width/2, y = R.top + R.height/2;
    cv.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
    for (let i = 1; i <= 20; i++)
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y + d*i/20, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, deg/0.30);                                  // the drag rate, 0.30 deg per pixel

  for (const [what, extra] of [['a steep oblique', 30], ['near nadir', 59]]) {
    await pitchTo(extra); await page.waitForTimeout(500);
    gz = await gsd();
    const a = analytic(gz);
    const got = gz.text.split(' × ').map(Number);
    chk(what + ': the boresight is on the ground', !!a && gz.text !== '—',
        a ? (a.off).toFixed(1) + ' deg off nadir, incidence ' + a.inc.toFixed(1) : 'no intersection');
    if (!a) continue;
    chk('...across-look matches the trigonometry', near(got[0], a.x),
        got[0] + ' vs ' + a.x.toFixed(2) + ' m');
    chk('...along-look matches it too', near(got[1], a.y),
        got[1] + ' vs ' + a.y.toFixed(2) + ' m');
    chk('...and the obliquity stretch is the secant of the incidence angle',
        Math.abs(got[1]/got[0] - 1/Math.cos(a.inc*Math.PI/180)) < 5e-3,
        (got[1]/got[0]).toFixed(3) + ' vs ' + (1/Math.cos(a.inc*Math.PI/180)).toFixed(3));
    chk('...in metres per pixel', gz.unit === 'm/px', gz.unit);
    chk('...with the range and incidence given in full',
        /slant range [0-9]+ km, incidence [0-9.]+/.test(gz.title), gz.title);
    chk('...and the straight-down figure alongside, so the two compare',
        /straight down/.test(gz.title), gz.title);
  }
  chk('near nadir the two axes converge', Math.abs(gz.text.split(' × ')
        .map(Number).reduce((p, q) => p/q) - 1) < 0.02, gz.text);

  /* Narrowing the lens narrows the pixel in exact proportion: the camera has not
     moved, so range and incidence are untouched and only tan(fov/2) changed. */
  const before = gz;
  await page.evaluate(() => {
    const cv = document.getElementById('globe'), R = cv.getBoundingClientRect();
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: R.left + R.width/2,
                                               clientY: R.top + R.height/2, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  gz = await gsd();
  const ratio = Math.tan(gz.fov*Math.PI/360) / Math.tan(before.fov*Math.PI/360);
  /* Both sides of this one come off the screen, so both carry the rounding of
     the last printed digit and the two errors compound: the prediction inherits
     half a unit from the value it is scaled from, and the value it is compared
     against has half a unit of its own. Allowing for one of them - which is all
     near() does, since everywhere else a printed number is checked against an
     exact one - fails this about a third of the time. */
  const now = Number(gz.text.split(' × ')[0]), was = Number(before.text.split(' × ')[0]);
  chk('zooming in shrinks the ground sample in proportion to tan(fov/2)',
      Math.abs(now - was*ratio) <= 0.5*(1 + ratio) + now*5e-4,
      before.text + ' -> ' + gz.text + '  (fov ' + before.fov.toFixed(1) + ' -> ' + gz.fov.toFixed(1)
        + ', predicted ' + (was*ratio).toFixed(2) + ')');

  // ---- leaving restores the free camera exactly ---------------------------
  /* cam0 is never written while POV is on, so the free camera comes back where
     it was rather than wherever the spacecraft happened to be. */
  await page.evaluate(() => Orbit3D.freeCam());
  await page.waitForTimeout(600);
  c = await cam();
  chk('leaving POV restores the shared FOV', Math.abs(c.fov - 42) < 1e-9, 'fov = ' + c.fov);
  chk('...and puts the camera back outside the orbit', Math.hypot(...c.pos) > 1.5,
      '|r| = ' + Math.hypot(...c.pos).toFixed(3) + ' Earth radii');
  lz = await lens();
  chk('leaving POV hides the FOV row', lz.hidden === true);
  chk('...and the GSD row with it', (await gsd()).hidden === true);
  const p2 = await pressed();
  chk('...with the POV button released', p2.includes('pov=false'), p2.join(' '));

  // ---- the minimap ---------------------------------------------------------
  /* POV takes away the one thing every other camera mode gives for free: where
     the spacecraft actually is. The minimap gives it back, so what matters is
     that the dot is in the right PLACE - an equirectangular projection drawn
     into a canvas is exactly the kind of thing that renders plausibly while
     being rolled, flipped or off by a factor.

     Checked by reading the pixels back and finding the marker by its own
     colour, then comparing against satellite.js propagated directly - the
     library's own SGP4 and its own eciToGeodetic, sharing no line with the
     path orbit3d took to draw it. */
  await page.evaluate(() => { Orbit3D.freeCam(); Orbit3D.setPov(true); });
  await page.waitForTimeout(700);
  await pitchTo(70);                       // look down, so the boresight is on the ground
  await page.waitForTimeout(700);

  const mini = await page.evaluate(() => {
    const c = document.getElementById('o3mini');
    if (!c || c.hidden || getComputedStyle(c).display === 'none') return { off: true };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    /* centroid of every pixel close to the track colour - the spacecraft dot is
       the only thing drawn in it */
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++){
      const i = (y*c.width + x)*4;
      if (Math.abs(d[i]-0x17) < 26 && Math.abs(d[i+1]-0xa3) < 26 && Math.abs(d[i+2]-0xcc) < 26){
        sx += x; sy += y; n++;
      }
    }
    if (!n) return { none: true };
    const lon = (sx/n)/c.width*360 - 180, lat = 90 - (sy/n)/c.height*180;

    /* the independent answer */
    const e = __gt.CAT[__gt.D.idx !== undefined ? __gt.D.idx : 0];
    const entry = __gt.D.entry || e;
    const rec = satellite.twoline2satrec(entry.l1, entry.l2);
    const when = new Date(Orbit3D.time);
    const pv = satellite.propagate(rec, when);
    const gd = satellite.eciToGeodetic(pv.position, satellite.gstime(when));
    return { lat: lat, lon: lon, n: n,
             trueLat: satellite.degreesLat(gd.latitude),
             trueLon: satellite.degreesLong(gd.longitude),
             degPerPx: 360/c.width };
  });

  if (mini.off){
    chk('the minimap is drawn in POV', false, 'hidden or display:none at this size');
  } else if (mini.none){
    chk('the minimap is drawn in POV', false, 'no spacecraft marker found in the canvas');
  } else {
    chk('the minimap is drawn in POV', mini.n > 4, mini.n + ' px of marker found');
    const dLat = Math.abs(mini.lat - mini.trueLat);
    let dLon = Math.abs(mini.lon - mini.trueLon); if (dLon > 180) dLon = 360 - dLon;
    /* The marker is a disc a few pixels across and the map is 0.75 deg per
       pixel, so agreement can only be asserted to about the size of the dot. */
    const tol = 3*mini.degPerPx;
    chk('...with the spacecraft where satellite.js independently puts it',
        dLat < tol && dLon < tol,
        'drawn ' + mini.lat.toFixed(2) + ', ' + mini.lon.toFixed(2)
          + '   propagated ' + mini.trueLat.toFixed(2) + ', ' + mini.trueLon.toFixed(2)
          + '   off by ' + dLat.toFixed(2) + ', ' + dLon.toFixed(2)
          + ' deg against a ' + tol.toFixed(2) + ' deg tolerance');
    /* A map drawn upside down or rolled by half the world would still put a dot
       somewhere, so this asserts the two independent answers agree in SIGN as
       well as magnitude - the case a symmetric tolerance can miss. */
    chk('...on the right side of the equator and the right side of the dateline',
        (mini.lat >= 0) === (mini.trueLat >= 0) && (mini.lon >= 0) === (mini.trueLon >= 0),
        'drawn ' + (mini.lat >= 0 ? 'N' : 'S') + (mini.lon >= 0 ? 'E' : 'W')
          + ', propagated ' + (mini.trueLat >= 0 ? 'N' : 'S') + (mini.trueLon >= 0 ? 'E' : 'W'));
  }

  await page.evaluate(() => Orbit3D.freeCam());
  await page.waitForTimeout(500);
  chk('...and it goes away with the mode',
      await page.evaluate(() => document.getElementById('o3mini').hidden === true));

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
