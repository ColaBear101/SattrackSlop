/*
 * The close-up camera (CHANGES-FROM-LEGACY.md, L72): the spacecraft's own 3D model, from beside it, with the Earth behind it.
 *
 *   - the camera row offers it before POV (which suites and the AR view's tests require last), and exactly one camera button is
 *     pressed whatever is chosen;
 *   - nothing of it is fetched until it is pressed: not its chunk, not a model;
 *   - pressed on KNACKSAT-2 (the page's default spacecraft), it fetches its chunk and that model, and draws it in a pass of its own:
 *     the renderer's last pass is the model's few thousand triangles, and its settings are the globe's again after every frame
 *     (no tone mapping, auto-clear on, no shadow maps, the lights as they were), so nothing the ab3d gate records ever sees it;
 *   - how it flies (L77): KNACKSAT-2 turns about its long axis at 2 degrees a second from the clock's epoch, to the bit as it always
 *     has, the same instant twice is the same turn, and the ISS flies the bare frame; "How it flies…" fetches its panel's chunk (and
 *     nothing before it is pressed); the card's "Spin rates" shows and hides a slider and a number for each of the model's three
 *     axes, KNACKSAT-2's own 2 degrees a second about Z in them; with the clock stopped, a new rate, another axis, rates about two
 *     axes at once and Stop each leave the model where it was at that instant and then turn it as they say (two rates together about
 *     their direction, at their length); "Reset orientation" puts it straight at that instant and turns it on at the rates set; the
 *     card's "Hide" folds it to its title bar and "Show" opens it again; a face toward the Sun is on the Sun at two instants, even after spins have turned
 *     the model; fixed among the stars, the model keeps its turn among the stars over a quarter of an orbit while its frame turns; yaw,
 *     pitch and roll turn it the way the panel says; the renderer is the globe's again after each of those frames; the card says when
 *     the attitude is the reader's; "Reset to its own" draws it exactly as the page does and leaves nothing stored; Escape closes the
 *     panel with the focus back on its button; a setting is kept (gt.attitude) and flown again after a reload, and said; the snapshot
 *     (?tle=embedded) neither reads it nor writes one;
 *   - the ISS wears NASA's model (tens of thousands of triangles), and its credit says so; the Chinese station's numbers say there is
 *     no model yet when none ships, and the pass draws nothing;
 *   - the "Realistic Earth" tick on the card turns the Layers panel's realistic surface on and off again;
 *   - leaving it for the Satellite camera brings the marker back and the lens back to 42 degrees.
 *
 *   node verification/suites/verify-closeup.js            (the rebuilt page only)
 *   node verification/suites/verify-closeup.js --shots    also writes verification/screens/closeup-*.png to look at
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness');

const T0 = Date.UTC(2026, 8, 13, 0, 0, 0);
const SHOTS = process.argv.includes('--shots');
const SCREENS = path.join(__dirname, '..', 'screens');

let fails = 0;
const chk = (name, ok, detail) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) fails++; };

/* ---- quaternions as three keeps them, [x, y, z, w] (how it flies, L77) ---- */
const qmul = (a, b) => [
  a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
  a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2],
  a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const qconj = q => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)); return [p[0], p[1], p[2]]; };
const qaxis = (v, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return [v[0] * s, v[1] * s, v[2] * s, Math.cos(h)]; };
/** the angle between two orientations, degrees (q and -q are one), by atan2, which keeps its precision near 0 */
const apart = (a, b) => { const r = qmul(qconj(a), b); return 2 * Math.atan2(Math.hypot(r[0], r[1], r[2]), Math.abs(r[3])) * 180 / Math.PI; };
const gap = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const fmt = q => '[' + q.map(x => x.toFixed(6)).join(', ') + ']';

(async () => {
  if (H.targetName() !== 'new') { console.log('SKIP  the close-up exists only in the rebuilt page'); return; }
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
  const boot = async (p = page) => {
    await p.waitForFunction(() => !!window.__gt && !!window.__gt.D && !!window.Orbit3D && !!Orbit3D.scene, null, { timeout: 60000 });
    await p.waitForTimeout(2000);
  };
  await boot();

  const buttons = () => page.evaluate(() => [...document.querySelectorAll('.camseg .cam')].map(b => b.getAttribute('data-mode') + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')));
  const pressed = async () => (await buttons()).filter(b => b.endsWith('*'));
  const b0 = await buttons();
  chk('the camera row is Free, Satellite, the site, Close-up and POV, POV last', b0.map(b => b.replace('*', '')).join(' ') === 'free sat site close pov', b0.join(' '));
  chk('...with one button pressed', (await pressed()).length === 1, (await pressed()).join(' '));
  const fetched = re => got.some(p => re.test(p));
  const FLIGHT = /\/flight-[\w-]{8}\.js$/;
  chk('nothing of the close-up is fetched before it is pressed', !fetched(/\/closeup-[\w-]{8}\.js$/) && !fetched(/\.glb$/) && !fetched(FLIGHT));

  /* the last pass's numbers, and the renderer's settings after a whole frame */
  const pass = (p = page) => p.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
    const r = Orbit3D.renderer;
    res({ tris: r.info.render.triangles, calls: r.info.render.calls, toneMapping: r.toneMapping, autoClear: r.autoClear,
          shadows: r.shadowMap.enabled, pcl: r.physicallyCorrectLights, fov: Orbit3D.camera.fov, close: Orbit3D.close });
  }))));
  const globeAgain = p => p.toneMapping === 0 && p.autoClear === true && p.shadows === false && p.pcl === false && p.fov === 42;
  const card = (p = page) => p.evaluate(() => { const c = document.querySelector('.closecard'); return c ? c.textContent.replace(/\s+/g, ' ').trim() : null; });
  const waitModel = (p = page) => p.waitForFunction(() => {
    const c = document.querySelector('.closecard .status');
    return !!document.querySelector('.closecard') && !/Loading/.test((c && c.textContent) || '');
  }, null, { timeout: 120000 });
  const shot = async name => { if (SHOTS) { fs.mkdirSync(SCREENS, { recursive: true }); await page.locator('#globe').screenshot({ path: path.join(SCREENS, name) }); } };

  /* How the model flies (L77), read from the frame the close-up's pass draws, with no hook in the page: the renderer's render is wrapped
     for one call; the craft's scene is the one that is not the globe's and holds a group (the model's pivot) and a light that casts
     shadows (the Sun); the craft's frame is the globe camera's turn taken back out of the pass's camera (scene/closeup-pass.ts: the
     pass's camera is qL^-1 * the globe's), and the Sun is that light's direction. */
  const grab = (p = page) => p.evaluate(() => new Promise((res, rej) => {
    const r = Orbit3D.renderer, had = Object.prototype.hasOwnProperty.call(r, 'render'), orig = r.render;
    const put = () => { if (had) r.render = orig; else delete r.render; };
    const timer = setTimeout(() => { put(); rej(new Error('the close-up drew no frame')); }, 8000);
    r.render = function (scene, cam) {
      const out = orig.apply(this, arguments);
      const pivot = scene !== Orbit3D.scene && scene.children.find(o => o.isGroup);
      const sun = pivot && scene.children.find(o => o.isDirectionalLight && o.castShadow);
      if (pivot && sun) {
        clearTimeout(timer); put();
        const q = o => [o.x, o.y, o.z, o.w], s = sun.position.clone().normalize();
        res({ q: q(pivot.quaternion), g: q(Orbit3D.camera.quaternion), c: q(cam.quaternion), sun: [s.x, s.y, s.z] });
      }
      return out;
    };
    /* and ask for a frame, as a pointer moving over the globe does: with the clock stopped the page draws a change once and then idles,
       and that one frame may have come and gone before this hook was in place (it did, now and then, after "Reset to its own") */
    document.querySelector('.viewport').dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
  })).then(f => ({ ...f, frame: qmul(f.g, qconj(f.c)) }));
  /** the clock stopped at `ms` (as a scrub stops it, to the millisecond), and the turn drawn there */
  const at = async (ms, p = page) => { await p.evaluate(ms => __gt.seek(ms), ms); await p.waitForTimeout(150); return grab(p); };
  /** what the close-up has always drawn for KNACKSAT-2: setFromAxisAngle(+Z, spinAngle(2, ms)), worked out by the page's own Math */
  const own = ms => page.evaluate(ms => { const a = ((ms / 1000 * 2) % 360) * Math.PI / 180, s = Math.sin(a / 2); return [0 * s, 0 * s, 1 * s, Math.cos(a / 2)]; }, ms);
  /** a control of the panel set as a reader sets it: the value, then what the element hears as it moves and as it is let go */
  const set = async (sel, v, p = page) => {
    await p.evaluate(([sel, v]) => {
      const el = document.querySelector(sel);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [sel, v]);
    await p.waitForTimeout(150);
  };
  const stored = (p = page) => p.evaluate(() => localStorage.getItem('gt.attitude'));
  const play = async (p = page) => { if ((await p.getAttribute('#tpplay', 'aria-label')) === 'Play') await p.click('#tpplay'); };
  const openFlight = async (p = page) => { await p.click('#flight'); await p.waitForSelector('#fly-pointing', { timeout: 30000 }); await p.waitForTimeout(150); };

  /* ---- KNACKSAT-2 ---- */
  await page.click('.camseg .cam[data-mode=close]');
  await waitModel();
  await page.waitForTimeout(800);
  chk('pressing it fetches its chunk and KNACKSAT-2\'s model', fetched(/\/closeup-[\w-]{8}\.js$/) && fetched(/\/knacksat2-[\w-]{8}\.glb$/));
  chk('...and it is the one button pressed', (await pressed()).join(' ') === 'close*', (await pressed()).join(' '));
  let p = await pass();
  chk('the model is drawn in a pass of its own', p.close && p.tris > 1500 && p.tris < 20000, JSON.stringify(p));
  chk('...and the renderer is the globe\'s again after the frame', globeAgain(p));
  let text = await card();
  chk('the card names the spacecraft and the model\'s source', /KNACKSAT-2/.test(text) && /KMUTNB/.test(text), text);
  await shot('closeup-knacksat2.png');

  /* ---- how it flies (L77) ---- */
  const T1 = T0 + 600000;
  chk('the card says how it flies, and the panel that changes it is not fetched with the close-up',
    /Along the track, turning 2° a second\./.test(text) && !/As you set it/.test(text) && !fetched(FLIGHT), text);
  const a1 = await at(T1), a2 = await at(T1), a3 = await at(T1 + 45000);
  chk('KNACKSAT-2 turns about its long axis as the close-up always drew it: setFromAxisAngle(+Z, spinAngle(2, ms)), to the bit',
    same(a1.q, await own(T1)) && same(a3.q, await own(T1 + 45000)), fmt(a1.q) + ' ' + fmt(await own(T1)));
  chk('...the same instant twice is the same turn, and 45 s later it is 90 degrees further', same(a1.q, a2.q) && apart(qmul(a1.q, qaxis([0, 0, 1], 90)), a3.q) < 1e-9,
    apart(qmul(a1.q, qaxis([0, 0, 1], 90)), a3.q) + ' deg');
  await openFlight();
  chk('"How it flies…" fetches its panel, and says it is open', fetched(FLIGHT) && await page.getAttribute('#flight', 'aria-expanded') === 'true');

  /* the spin's three rates, on the card under a button that shows and hides them */
  const rates = (p = page) => p.evaluate(() => ['X', 'Y', 'Z'].map(a => { const el = document.querySelector('#spin-' + a); return el ? +el.value : null; }));
  chk("the card shows the spin's three rates, KNACKSAT-2's own 2 degrees a second about Z, under a \"Spin rates\" button that says they are shown",
    JSON.stringify(await rates()) === '[0,0,2]' && await page.getAttribute('#spinrates', 'aria-expanded') === 'true', JSON.stringify(await rates()));
  await page.click('#spinrates');
  const hid = { exp: await page.getAttribute('#spinrates', 'aria-expanded'), sliders: !!(await page.$('#spin-Z')) };
  await page.click('#spinrates');
  chk('...which hides them and shows them again', hid.exp === 'false' && !hid.sliders && !!(await page.$('#spin-Z'))
    && await page.getAttribute('#spinrates', 'aria-expanded') === 'true', JSON.stringify(hid));
  /* the card folded to its title bar, and opened again */
  const folded = () => page.evaluate(() => ({ body: document.querySelector('#closebody').hidden, exp: document.querySelector('#cardfold').getAttribute('aria-expanded'),
    label: document.querySelector('#cardfold').textContent, h: Math.round(document.querySelector('.closecard').getBoundingClientRect().height),
    name: !!document.querySelector('.closecard .nm') && document.querySelector('.closecard .nm').offsetHeight > 0,
    reset: [...document.querySelectorAll('.closecard .head button')].some(b => /Reset view/.test(b.textContent)) }));
  const open0 = await folded();
  await page.click('#cardfold');
  const fold1 = await folded();
  await page.click('#cardfold');
  const fold2 = await folded();
  chk('"Hide" folds the card to its title bar (the name and "Show" left, Reset view folded with the rest), and "Show" opens it again',
    !open0.body && open0.reset && fold1.body && !fold1.reset && fold1.exp === 'false' && fold1.label === 'Show' && fold1.name && fold1.h < 80 && fold1.h < open0.h / 3
    && !fold2.body && fold2.reset && fold2.exp === 'true' && fold2.label === 'Hide' && fold2.h === open0.h, JSON.stringify([open0, fold1, fold2]));

  /* a new rate, at a stopped instant, then the clock moved on */
  const r0 = await at(T1);
  await set('#spin-Z-n', -5);
  const r1 = await grab(), r2 = await at(T1 + 10000);
  chk('a new rate typed with the clock stopped leaves the model where it was at that instant', apart(r0.q, r1.q) < 1e-9, apart(r0.q, r1.q) + ' deg');
  chk('...and then turns it at the new rate (-5 degrees a second: -50 in 10 s)', apart(qmul(r1.q, qaxis([0, 0, 1], -50)), r2.q) < 1e-9, apart(qmul(r1.q, qaxis([0, 0, 1], -50)), r2.q) + ' deg');
  /* another axis: a rate about X, then none about Z */
  await set('#spin-X-n', -5);
  await set('#spin-Z-n', 0);
  const x1 = await grab(), x2 = await at(T1 + 19000);
  chk("another axis leaves the model where it was, and turns it about the model's own new axis from there",
    apart(r2.q, x1.q) < 1e-9 && apart(qmul(x1.q, qaxis([1, 0, 0], -45)), x2.q) < 1e-9, apart(r2.q, x1.q) + ' / ' + apart(qmul(x1.q, qaxis([1, 0, 0], -45)), x2.q) + ' deg');
  /* two axes at once: 3 about X and 4 about Y turn it about (0.6, 0.8, 0) at 5 degrees a second */
  await set('#spin-X-n', 3);
  await set('#spin-Y-n', 4);
  const t1 = await grab(), t2 = await at(T1 + 29000);
  text = await card();
  chk('rates about two axes leave it where it was, then turn it about their direction at their length (5 degrees a second: 50 in 10 s)',
    apart(x2.q, t1.q) < 1e-9 && apart(qmul(t1.q, qaxis([0.6, 0.8, 0], 50)), t2.q) < 1e-9 && /about the direction X 60 %, Y 80 %, Z 0 %/.test(text),
    apart(x2.q, t1.q) + ' / ' + apart(qmul(t1.q, qaxis([0.6, 0.8, 0], 50)), t2.q) + ' deg; ' + text);
  /* straight again, still turning */
  await page.click('#level');
  await page.waitForTimeout(150);
  const l1 = await grab(), l2 = await at(T1 + 39000);
  chk('"Reset orientation" puts it straight at that instant (along the track, front leading), and it turns on at the rates set (50 degrees in 10 s)',
    same(l1.q, [0, 0, 0, 1]) && apart(qmul(l1.q, qaxis([0.6, 0.8, 0], 50)), l2.q) < 1e-9 && JSON.stringify(await rates()) === '[3,4,0]',
    fmt(l1.q) + ' / ' + apart(qmul(l1.q, qaxis([0.6, 0.8, 0], 50)), l2.q) + ' deg ' + JSON.stringify(await rates()));
  /* no spin */
  await page.click('#spin-stop');
  await page.waitForTimeout(150);
  const z1 = await grab(), z2 = await at(T1 + 79000);
  chk('Stop stops it where it is, for as long as the clock runs, and the three rates read 0', apart(l2.q, z1.q) < 1e-9 && same(z1.q, z2.q)
    && JSON.stringify(await rates()) === '[0,0,0]', apart(l2.q, z1.q) + ' deg; ' + fmt(z1.q) + ' ' + fmt(z2.q) + ' ' + JSON.stringify(await rates()));
  p = await pass();
  chk('...and the renderer is the globe\'s again after those frames', globeAgain(p), JSON.stringify(p));
  /* toward the Sun, after all that turning */
  await set('#fly-pointing', 'sun');
  await set('#fly-face', '+Y');
  const s1 = await grab(), s2 = await at(T1 + 79000 + 1200000);
  chk('its top toward the Sun is on the Sun, at two instants twenty minutes apart, whatever the spins before had turned it',
    gap(qrot(s1.q, [0, 1, 0]), s1.sun) < 1e-9 && gap(qrot(s2.q, [0, 1, 0]), s2.sun) < 1e-9 && apart(s1.q, s2.q) > 1,
    gap(qrot(s1.q, [0, 1, 0]), s1.sun) + ' / ' + gap(qrot(s2.q, [0, 1, 0]), s2.sun) + '; turned ' + apart(s1.q, s2.q).toFixed(2) + ' deg');
  text = await card();
  chk('...and the card says it is the reader\'s setting, and it is kept in this browser',
    /As you set it: its top toward the Sun\./.test(text) && /"knacksat2"/.test(await stored() || ''), text + ' ' + await stored());
  p = await pass();
  chk('...and the renderer is the globe\'s again after the frame', globeAgain(p), JSON.stringify(p));
  /* fixed among the stars, over a quarter of an orbit */
  const tS = T1 + 79000 + 1200000;
  await set('#fly-pointing', 'stars');
  const f1 = await grab(), f2 = await at(tS + 1380000);
  const among1 = qmul(f1.frame, f1.q), among2 = qmul(f2.frame, f2.q);
  chk('fixed among the stars: chosen, nothing moves; 23 minutes later the craft\'s frame has turned and the model has not, among the stars',
    apart(s2.q, f1.q) < 1e-9 && apart(f1.frame, f2.frame) > 60 && apart(among1, among2) < 1e-9,
    apart(s2.q, f1.q) + ' deg; the frame turned ' + apart(f1.frame, f2.frame).toFixed(1) + ' deg; among the stars ' + apart(among1, among2) + ' deg');
  p = await pass();
  chk('...and the renderer is the globe\'s again after the frame', globeAgain(p), JSON.stringify(p));
  /* the three offsets, from the model flown along the track, its front leading */
  await set('#fly-pointing', 'track');
  await set('#fly-face', '+Z');
  const o0 = await grab();
  await set('#fly-yaw', 90);
  const oy = await grab();
  await set('#fly-yaw', 0);
  await set('#fly-pitch', 90);
  const op = await grab();
  await set('#fly-pitch', 0);
  await set('#fly-roll', 90);
  const or = await grab();
  await set('#fly-roll', 0);
  chk('along the track, its front leading, it flies the bare frame', apart(o0.q, [0, 0, 0, 1]) < 1e-9, fmt(o0.q));
  chk('yaw + turns the front to the right, pitch + raises it, roll + lowers the right side (the top to the right)',
    gap(qrot(oy.q, [0, 0, 1]), [-1, 0, 0]) < 1e-9 && gap(qrot(op.q, [0, 0, 1]), [0, 1, 0]) < 1e-9 && gap(qrot(or.q, [0, 1, 0]), [-1, 0, 0]) < 1e-9,
    fmt(qrot(oy.q, [0, 0, 1])) + ' ' + fmt(qrot(op.q, [0, 0, 1])) + ' ' + fmt(qrot(or.q, [0, 1, 0])));
  /* back to its own */
  await page.click('#fly-own');
  await page.waitForTimeout(200);
  const tO = T1 + 4000000, b1 = await at(tO);
  text = await card();
  chk('"Reset to its own" draws it exactly as the page does again, says nothing of the reader, and leaves nothing stored',
    same(b1.q, await own(tO)) && /Along the track, turning 2° a second\./.test(text) && !/As you set it/.test(text) && await stored() === null,
    fmt(b1.q) + ' ' + text + ' ' + await stored());
  await page.focus('#fly-yaw-n');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const shut = await page.evaluate(() => ({ panel: !!document.querySelector('#fly-pointing'), focus: document.activeElement && document.activeElement.id, exp: document.querySelector('#flight').getAttribute('aria-expanded') }));
  chk('Escape in the panel closes it, with the focus back on its button', !shut.panel && shut.focus === 'flight' && shut.exp === 'false', JSON.stringify(shut));

  /* kept, and flown again after a reload */
  await openFlight();
  await set('#fly-pointing', 'sun');
  const kept = await stored();
  chk('a setting is kept in this browser under gt.attitude, by model', /^\{"v":1,"items":\{"knacksat2":\{"pointing":"sun","face":"\+Z"/.test(kept || ''), kept);
  await page.reload({ waitUntil: 'load' });
  await boot();
  await page.click('.camseg .cam[data-mode=close]');
  await waitModel();
  await page.waitForTimeout(800);
  const k1 = await at(T1);
  text = await card();
  chk('after a reload the model flies it again (its front on the Sun), and the card says it is the reader\'s',
    /As you set it: its front toward the Sun, turning 2° a second\./.test(text) && gap(qrot(k1.q, [0, 0, 1]), k1.sun) < 1e-9, text + ' ' + gap(qrot(k1.q, [0, 0, 1]), k1.sun));
  /* the snapshot keeps nothing: it does not fly what this browser kept, and a change in it is for the visit only */
  {
    const snap = await ctx.newPage();
    const serrs = [];
    snap.on('pageerror', e => serrs.push(e.message));
    await snap.goto(srv.page + '?tle=embedded', { waitUntil: 'load' });
    await boot(snap);
    await snap.click('.camseg .cam[data-mode=close]');
    await waitModel(snap);
    await snap.waitForTimeout(800);
    const before = await card(snap);
    await openFlight(snap);
    await set('#fly-yaw-n', 10, snap);
    const said = await snap.evaluate(() => document.querySelector('#fly-say').textContent);
    chk('in the snapshot (?tle=embedded) the model flies its own, a change holds for the visit and says so, and nothing is written',
      /Along the track, turning 2° a second\./.test(before) && /snapshot of the page/.test(said) && await stored(snap) === kept && serrs.length === 0,
      before + ' | ' + said + ' | ' + serrs.join(' | '));
    await snap.close();
  }
  await openFlight();
  await page.click('#fly-own');
  await page.waitForTimeout(200);
  chk('...and "Reset to its own" takes it out again', await stored() === null, await stored());
  await play();

  /* ---- the ISS ---- */
  await H.pickExact(page, 'ISS (ZARYA)');
  await page.waitForFunction(() => /ISS \(ZARYA\)/.test((document.querySelector('.closecard') || {}).textContent || ''), null, { timeout: 30000 });
  await waitModel();
  await page.waitForTimeout(1500);
  p = await pass();
  chk('the ISS wears NASA\'s model', fetched(/\/iss-[\w-]{8}\.glb$/) && p.tris > 30000, JSON.stringify(p));
  text = await card();
  chk('...and its credit names NASA and says NASA does not endorse the page', /NASA\/JSC IGOAL/.test(text) && /does not endorse/.test(text), text);
  const i1 = await at(T1);
  chk('...and it flies the bare frame, along the track, as a station does', same(i1.q, [0, 0, 0, 1]) && /Along the track\./.test(await card()), fmt(i1.q));
  chk('...and the panel left open for KNACKSAT-2 closed when another spacecraft was chosen', !(await page.$('#fly-pointing')) && await page.getAttribute('#flight', 'aria-expanded') === 'false');
  await play();
  /* for the pictures: the clock moved on along the window, as a reader drags it, until the station is out of the Earth's shadow */
  for (let k = 1; SHOTS && k <= 24 && /shadow/.test((await card()) || ''); k++) {
    await page.evaluate(k => { const r = document.getElementById('time'); r.value = String(Math.round(+r.max * k / 96)); r.dispatchEvent(new Event('input', { bubbles: true })); }, k);
    await page.waitForTimeout(1200);
  }
  await shot('closeup-iss.png');
  await page.click('.closecard .real input');
  await page.waitForFunction(() => { let on = false; Orbit3D.scene.traverse(o => { if (o.name === 'realism-clouds' && o.material.uniforms.uCloudOn.value === 1) on = true; }); return on; }, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  chk('the card\'s "Realistic Earth" turns the realistic surface on', await page.evaluate(() => Orbit3D.surface) === 'real');
  await shot('closeup-iss-real.png');
  await page.click('.closecard .real input');
  await page.waitForTimeout(1500);
  chk('...and off again, back to the surface that was on before', await page.evaluate(() => Orbit3D.surface) === 'night', await page.evaluate(() => Orbit3D.surface));

  /* ---- the Chinese station: no model ships unless its file is there ---- */
  const css = fs.readdirSync(path.join(H.targetRoot ? H.targetRoot() : srv.root, 'assets')).some(f => /^css-[\w-]{8}\.glb$/.test(f));
  await H.pickExact(page, 'CSS (TIANHE-1)');
  await page.waitForFunction(() => /CSS \(TIANHE-1\)/.test((document.querySelector('.closecard') || {}).textContent || ''), null, { timeout: 30000 });
  await waitModel();
  await page.waitForTimeout(800);
  text = await card();
  if (css) chk('the Chinese station wears its model', /tianGong/.test(text), text);
  else chk('the Chinese station has no model yet, and the card says so, with nothing to fly', /no 3D model of CSS \(TIANHE-1\)/.test(text) && !(await page.$('#flight')), text);

  /* ---- leaving ---- */
  await page.click('.camseg .cam[data-mode=sat]');
  await page.waitForTimeout(800);
  p = await pass();
  const dot = await page.evaluate(() => { let v = null; Orbit3D.scene.traverse(o => { if (o.geometry && o.geometry.parameters && o.geometry.parameters.radius === 0.016) v = o.visible; }); return v; });
  chk('leaving it for the Satellite camera brings the marker back and the lens to 42 degrees', !p.close && p.fov === 42 && dot === true, JSON.stringify(p) + ' marker ' + dot);
  chk('...with one button pressed', (await pressed()).join(' ') === 'sat*', (await pressed()).join(' '));
  chk('...and the card goes', (await card()) === null);

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  chk('nothing in the page complained', errs.length === 0);
  if (SHOTS) console.log('screenshots in ' + SCREENS);
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close(); await srv.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
