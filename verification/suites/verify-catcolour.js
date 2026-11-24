/*
 * The catalogue's colours by class (CHANGES-FROM-LEGACY.md, L76): the Layers panel's choice under "Catalogue", "One colour" (the old
 * page's, and the default), "By orbit", "By type" and "By purpose".
 *
 * It is opt-in and the default cloud is the old page's (the ab3d gate holds that), so what is checked here is that it stays out of the
 * way until it is chosen, does what it says when it is, and puts every last thing back when it is left:
 *
 *   - a first load fetches neither the colours' chunk (catcolour) nor CelesTrak's table (satcat), stores nothing, has "One colour"
 *     chosen and the key's "Rest of the catalogue", and every dot is the old file's colour: SPACE.track at 0.55, the selected
 *     spacecraft's SPACE.contact at 1, the one under the pointer SPACE.track at 1, named by its name alone;
 *   - "By orbit" fetches the chunk and not the table, and every dot is its class's colour at the same dims, the selected one still
 *     orange; the key holds the seven classes in the colour their dots rest in, every dot is one of them and each of them has dots,
 *     the objects one knows are in the class they belong to, the note says the rules and the counts, the name under the pointer is
 *     followed by the class, and the choice is kept (gt.catcolour);
 *   - "By type" and "By purpose" fetch the table, once between them, and say the day it is of;
 *   - "One colour" puts every value of the colour attribute back to what it was before any was chosen, the key's line, the bare name
 *     under the pointer, and takes the choice out of the store; the scene gained no object, attribute, geometry or material on the way;
 *   - a reload keeps a choice, and "Forget what this page stored" takes it with the rest: the page after it opens on the one colour
 *     and fetches neither chunk.
 *
 *   node verification/suites/verify-catcolour.js            (the rebuilt page only)
 *   node verification/suites/verify-catcolour.js --shots    also writes verification/screens/catcolour-*.png to look at
 */
const fs = require('fs');
const path = require('path');
const H = require('../lib/harness');

const SHOTS = process.argv.includes('--shots');
const SCREENS = path.join(__dirname, '..', 'screens');

let fails = 0;
const chk = (name, ok, detail) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) fails++; };

/* The old file's two colours for the cloud (orbit3d.ts, SPACE: track and contact), read as THREE.Color reads a hex, each channel over
   255, and written into the colour attribute (a Float32Array) times the dim: 0.55 at rest, 1 for the selected spacecraft and the dot
   under the pointer. */
const TRACK = '#17A3CC', CONTACT = '#CE801A';
const ch = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const dimmed = (rgb, dim) => rgb.map(c => Math.fround(c * dim));
const REST = dimmed(ch(TRACK), 0.55), LIT = dimmed(ch(TRACK), 1), HOT = dimmed(ch(CONTACT), 1);

/* What a dot drawn in a colour is seen as at rest (catcolour.ts, seenAs): r128's sRGB encode of the dimmed colour, 0.92 opaque over black.
   The key's swatches are this, so a dot's class is the key's entry whose swatch is its colour's. The tint holds each channel as a 32-bit
   float of the hex's byte over 255; the byte is taken back first, so that the arithmetic is the chunk's own. */
const srgb = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const seenAs = rgb => '#' + rgb.map(c => Math.round(255 * 0.92 * srgb(Math.min(1, c * 0.55))).toString(16).padStart(2, '0')).join('').toUpperCase();
const tintAt = (st, i) => [0, 1, 2].map(k => st.tint[i * 3 + k]);
const classOf = (st, i) => { const s = seenAs(tintAt(st, i).map(v => Math.round(v * 255) / 255)); const k = st.key.flat().find(x => x.c === s); return k ? k.t : null; };

/* The classes as the key names them, row by row (lib/text/catcolour-key.ts), and objects one knows the class of. */
const MODES = {
  orbit: {
    rows: [['LEO', 'SSO', 'MEO'], ['GEO', 'IGSO', 'HEO', 'Beyond GEO']],
    known: { 'ISS (ZARYA)': 'LEO', 'TERRA': 'SSO', 'NAVSTAR 56 (USA 180)': 'MEO', 'INTELSAT 40E (IS-40E)': 'GEO', 'QZS-2 (MICHIBIKI-2)': 'IGSO', 'MMS 1': 'HEO', 'SYRACUSE 3B': 'Beyond GEO' },
    note: /^Read from each object's own elements, the first that fits: HEO, .*\(17\).*\(547\).*\(23\).*\(367\).*\(1,183\).*\(18\).*\(3\)\.$/
  },
  type: {
    rows: [['Payload', 'Rocket body', 'Debris', 'Unknown']],
    known: { 'ISS (ZARYA)': 'Payload', 'PEGASUS R/B': 'Rocket body', 'FREGAT DEB': 'Debris', 'BLUEBIRD-11': 'Unknown' },
    note: /^SATCAT's object type, as CelesTrak had it on \d{4}-\d{2}-\d{2}: [\d,]+ payloads, /
  },
  purpose: {
    rows: [['Communications', 'Navigation', 'Science', 'Military'], ['Earth observation & weather', 'Crewed stations'], ['Amateur & education', 'Other or unknown']],
    known: { 'ISS (ZARYA)': 'Crewed stations', 'INTELSAT 40E (IS-40E)': 'Communications', 'NAVSTAR 56 (USA 180)': 'Navigation', 'TERRA': 'Earth observation & weather',
      'HST': 'Science', 'PRAETORIAN SDA_601': 'Military', 'AO-91': 'Amateur & education', 'BLUEBIRD-11': 'Other or unknown' },
    note: /^From the lists CelesTrak files objects in, as they were on \d{4}-\d{2}-\d{2}, .* are on none of them and are other or unknown/
  }
};

/* ---- in the page (each function is sent as its source, with findCloud's as its first argument) ---- */
/* the cloud: the Points with one vertex per catalogue entry (scene child S.12 of the ab3d inventory) */
const findCloud = () => { let c = null; Orbit3D.scene.traverse(o => { if (o.isPoints && o.geometry.attributes.position.count === __gt.CAT.length) c = o; }); return c; };
const inPage = (fn, ...args) => '(' + fn + ')(' + [findCloud, ...args.map(a => JSON.stringify(a))].join(', ') + ')';
/* everything this suite reads at once: the scene's census, the cloud's colours and tint, the key, the note, the choice and the store */
const state = findCloud => {
  const cloud = findCloud();
  let objects = 0;
  Orbit3D.scene.traverse(() => { objects++; });
  const t = Orbit3D.cloudTint;
  const group = document.querySelector('#layersMenu [role=radiogroup]');
  return {
    objects, attrs: Object.keys(cloud.geometry.attributes).sort().join(' '), geo: cloud.geometry.uuid, mat: cloud.material.uuid,
    colour: Array.from(cloud.geometry.attributes.color.array), tint: t ? Array.from(t) : null,
    key: [...document.querySelectorAll('#o3key li.kcc')].map(li => [...li.querySelectorAll(':scope > span')].map(s => ({
      t: s.textContent.trim(), c: (s.querySelector('i') || { style: { getPropertyValue: () => '' } }).style.getPropertyValue('--c').trim().toUpperCase() }))),
    restLine: [...document.querySelectorAll('#o3key li')].filter(li => li.querySelector('i.k-cat') && li.textContent.trim() === 'Rest of the catalogue').length,
    note: (document.getElementById('catnote') || { textContent: null }).textContent,
    stored: localStorage.getItem('gt.catcolour'),
    chosen: (document.querySelector('input[name=catcolour]:checked') || { value: null }).value,
    radios: [...document.querySelectorAll('input[name=catcolour]')].map(r => r.value + '=' + r.closest('label').textContent.trim()),
    group: group ? group.getAttribute('aria-label') + ' > ' + group.querySelectorAll('input[type=radio]').length : null
  };
};
/* the dots, as the colour attribute has them against what each should be: at rest, under the pointer, or the selected spacecraft's */
function census(st, n) {
  const same = (i, v) => st.colour[i * 3] === v[0] && st.colour[i * 3 + 1] === v[1] && st.colour[i * 3 + 2] === v[2];
  const out = { rest: 0, hot: 0, lit: 0, wrong: [] };
  for (let i = 0; i < n; i++) {
    const rest = st.tint ? dimmed(tintAt(st, i), 0.55) : REST, lit = st.tint ? dimmed(tintAt(st, i), 1) : LIT;
    if (same(i, rest)) out.rest++; else if (same(i, HOT)) out.hot++; else if (same(i, lit)) out.lit++; else out.wrong.push(i);
  }
  return out;
}
/* true once updateCloud has drawn what the scene was handed: every dot but the selected one and the one under the pointer as it should be */
const settled = (findCloud, rest, n) => {
  const col = findCloud().geometry.attributes.color.array, t = Orbit3D.cloudTint;
  let off = 0;
  for (let i = 0; i < n; i++) {
    const want = t ? [0, 1, 2].map(k => Math.fround(t[i * 3 + k] * 0.55)) : rest;
    if (col[i * 3] !== want[0] || col[i * 3 + 1] !== want[1] || col[i * 3 + 2] !== want[2]) off++;
  }
  return off <= 2;
};
/* true once the spacecraft on screen has its dot: exactly one is SPACE.contact at 1 (setSat follows the first analysis) */
const oneHot = (findCloud, hot) => {
  const col = findCloud().geometry.attributes.color.array;
  let k = 0;
  for (let i = 0; i < col.length; i += 3) if (col[i] === hot[0] && col[i + 1] === hot[1] && col[i + 2] === hot[2]) k++;
  return k === 1;
};
/* true once the colour attribute is, value for value, the one given */
const exactly = (findCloud, want) => {
  const col = findCloud().geometry.attributes.color.array;
  return col.length === want.length && want.every((v, i) => col[i] === v);
};
/* catalogue points well inside the picture, in front of the Earth or clear of its disc, with no other within 14 px: the pointer can be
   put on one without the raycast choosing between two (verify-elements.js does the same) */
const isolated = findCloud => {
  const cloud = findCloud(), cam = Orbit3D.camera, R = document.getElementById('globe').getBoundingClientRect();
  const a = cloud.geometry.attributes.position, c = cam.position, scr = [];
  for (let i = 0; i < a.count; i++) {
    const p = new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i));
    if (p.length() > 1e5) continue;
    const q = p.clone().project(cam);
    if (q.z > 1) continue;
    scr.push({ i, x: (q.x * 0.5 + 0.5) * R.width + R.left, y: (-q.y * 0.5 + 0.5) * R.height + R.top, p });
  }
  const clear = p => {
    const d = p.clone().sub(c), tp = d.length(); d.normalize();
    const b = c.dot(d), disc = b * b - (c.lengthSq() - 1);
    return disc < 0 || tp < -b - Math.sqrt(disc) - 0.01;
  };
  const out = [];
  for (const s of scr) {
    if (s.x < R.left + R.width * 0.3 || s.x > R.left + R.width * 0.7 || s.y < R.top + R.height * 0.25 || s.y > R.top + R.height * 0.75) continue;
    if (!clear(s.p) || scr.some(t => t !== s && Math.hypot(t.x - s.x, t.y - s.y) < 14)) continue;
    out.push({ i: s.i, x: s.x, y: s.y, name: __gt.CAT[s.i].name });
    if (out.length >= 3) break;
  }
  return out;
};

(async () => {
  if (H.targetName() !== 'new') { console.log('SKIP  the catalogue\'s colours by class exist only in the rebuilt page'); return; }
  const srv = await H.up();
  const { chromium } = H.playwright();
  const browser = await chromium.launch({ args: H.GL_ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1, timezoneId: 'UTC', locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = [], got = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 300)); });
  page.on('request', q => got.push(new URL(q.url()).pathname));

  const CHUNK = /\/assets\/catcolour-[\w-]{8}\.js$/, TABLE = /\/assets\/satcat-[\w-]{8}\.js$/;
  const fetched = (re, from = 0) => got.slice(from).filter(p => re.test(p)).length;
  const boot = async () => {
    await page.waitForFunction(() => !!window.__gt && !!window.__gt.D && !!window.Orbit3D && !!Orbit3D.scene, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.waitForFunction(inPage(oneHot, HOT), null, { timeout: 30000, polling: 100 });
  };
  const read = () => page.evaluate(inPage(state));
  const shot = async name => {
    if (!SHOTS) return;
    fs.mkdirSync(SCREENS, { recursive: true });
    await page.locator('#globe').locator('xpath=..').screenshot({ path: path.join(SCREENS, 'catcolour-' + name + '.png') });
  };
  const choose = async m => {
    if (await page.isHidden('#layersMenu')) await page.click('#layerstoggle');
    await page.click('input[name=catcolour][value=' + m + ']');
  };
  const keyIs = rows => page.waitForFunction(want => JSON.stringify([...document.querySelectorAll('#o3key li.kcc')].map(li =>
    [...li.querySelectorAll(':scope > span')].map(s => s.textContent.trim()))) === want, JSON.stringify(rows), { timeout: 30000 });
  const drawn = n => page.waitForFunction(inPage(settled, REST, n), null, { timeout: 30000, polling: 100 });
  const gb = async () => page.locator('#globe').boundingBox();
  const hoverText = async q => {
    const b = await gb();
    await page.mouse.move(b.x + 4, b.y + 4); await page.waitForTimeout(150);
    await page.mouse.move(q.x, q.y); await page.waitForTimeout(350);
    return page.evaluate(() => { const h = document.getElementById('o3hover'); return h.style.display === 'block' ? h.textContent : ''; });
  };
  const away = async () => { await page.mouse.move(2, 2); await page.waitForTimeout(300); };

  /* a fixed instant, as the other scene suites have: where the 2,158 dots are, and so whether a few stand alone in the middle of the
     globe for the hover checks, depends on the clock, and on the real one some days none did */
  await page.clock.setFixedTime(new Date(Date.UTC(2026, 8, 13, 11, 0, 0)));
  await page.goto(srv.page, { waitUntil: 'load' });
  await boot();
  const names = await page.evaluate(() => __gt.CAT.map(e => e.name));
  const n = names.length;
  const idx = name => names.indexOf(name);

  /* ---- before: out of the way ---- */
  console.log('\n1. A first load: the old page\'s one colour, and nothing fetched or stored for the others');
  await drawn(n);
  const before = await read();
  const c0 = census(before, n);
  chk('a first load fetches neither the colours\' chunk nor CelesTrak\'s table', fetched(CHUNK) === 0 && fetched(TABLE) === 0);
  chk('...stores no choice, and offers four with "One colour" chosen, as a group with a name', before.stored === null && before.chosen === 'one'
    && before.radios.join(' | ') === 'one=One colour | orbit=By orbit | type=By type | purpose=By purpose' && before.group === 'Colour the catalogue > 4',
    JSON.stringify({ stored: before.stored, chosen: before.chosen, radios: before.radios, group: before.group }));
  chk('...the key says "Rest of the catalogue", and there is no note under the choice', before.restLine === 1 && before.key.length === 0 && before.note === null);
  chk('...the scene holds no tint', before.tint === null);
  chk('every dot is the old file\'s colour: SPACE.track at 0.55, the selected spacecraft\'s SPACE.contact at 1 (and the one under a pointer, if any, SPACE.track at 1)',
    n === 2158 && c0.wrong.length === 0 && c0.hot === 1 && c0.lit <= 1 && c0.rest >= n - 2, JSON.stringify({ n, rest: c0.rest, hot: c0.hot, lit: c0.lit, wrong: c0.wrong.slice(0, 5) }));
  await page.click('.cam[data-mode=free]');
  await page.waitForTimeout(600);
  const pts0 = await page.evaluate(inPage(isolated));
  const bare = [];
  for (const q of pts0) bare.push(await hoverText(q));
  await away();
  chk('a dot under the pointer is named by its name alone', pts0.length > 0 && bare.some((t, i) => t === pts0[i].name) && bare.every((t, i) => t === '' || t === pts0[i].name),
    pts0.map((q, i) => q.name + ' -> "' + bare[i] + '"').join('; '));
  await shot('one');

  /* ---- each colouring, as a reader chooses it ---- */
  const tints = {};
  for (const m of ['orbit', 'type', 'purpose']) {
    const M = MODES[m];
    console.log('\n2. "By ' + m + '"');
    await choose(m);
    await keyIs(M.rows);
    await drawn(n);
    const st = await read();
    tints[m] = st.tint;
    if (m === 'orbit') chk('choosing it fetches the colours\' chunk, and not CelesTrak\'s table (the classes are the elements\')', fetched(CHUNK) === 1 && fetched(TABLE) === 0,
      'catcolour ' + fetched(CHUNK) + ', satcat ' + fetched(TABLE));
    else chk('choosing it ' + (m === 'type' ? 'fetches CelesTrak\'s table, and the chunk is not fetched again' : 'fetches nothing more: the table was fetched once for both'),
      fetched(CHUNK) === 1 && fetched(TABLE) === 1, 'catcolour ' + fetched(CHUNK) + ', satcat ' + fetched(TABLE));
    chk('...the choice is kept, and is the one checked', st.stored === m && st.chosen === m, st.stored + ' / ' + st.chosen);
    const c = census(st, n);
    chk('...every dot is drawn in its class\'s colour at the old dims (0.55 at rest, 1 under the pointer), the selected spacecraft\'s still SPACE.contact at 1',
      !!st.tint && st.tint.length === n * 3 && c.wrong.length === 0 && c.hot === 1 && c.lit <= 1 && c.rest >= n - 2,
      JSON.stringify({ rest: c.rest, hot: c.hot, lit: c.lit, wrong: c.wrong.slice(0, 5) }));
    chk('...the key holds the classes, row by row, in place of "Rest of the catalogue"', JSON.stringify(st.key.map(r => r.map(k => k.t))) === JSON.stringify(M.rows) && st.restLine === 0,
      JSON.stringify(st.key));
    const cls = Array.from({ length: n }, (_, i) => classOf(st, i));
    const per = {};
    for (const k of cls) per[k] = (per[k] || 0) + 1;
    chk('...every dot\'s colour is a swatch of the key, and every class in the key has dots', cls.every(k => k !== null) && M.rows.flat().every(k => per[k] > 0),
      JSON.stringify(per));
    const wrong = Object.entries(M.known).filter(([name, want]) => idx(name) < 0 || classOf(st, idx(name)) !== want);
    chk('...the objects one knows are in their class: ' + Object.entries(M.known).map(([a, b]) => a + ' ' + b).join(', '), wrong.length === 0,
      wrong.map(([name, want]) => name + ': ' + (idx(name) < 0 ? 'not in the catalogue' : classOf(st, idx(name)) + ', not ' + want)).join('; '));
    chk('...and the note under the choice says where the classes come from', M.note.test(st.note || ''), (st.note || 'none').slice(0, 220));
    chk('...and the scene has no object, attribute, geometry or material it did not have', st.objects === before.objects && st.attrs === 'color position'
      && st.geo === before.geo && st.mat === before.mat, st.objects + ' objects (' + before.objects + '), ' + st.attrs);
    if (m === 'orbit') {
      await page.keyboard.press('Escape');
      const pts = await page.evaluate(inPage(isolated));
      const said = [];
      for (const q of pts) said.push(await hoverText(q));
      await away();
      const want = pts.map(q => q.name + ' · ' + classOf(st, q.i));
      chk('a dot under the pointer is named and its class follows the name, the class its colour is in the key', pts.length > 0
        && said.some((t, i) => t === want[i]) && said.every((t, i) => t === '' || t === want[i]), pts.map((q, i) => '"' + said[i] + '" (' + want[i] + ')').join('; '));
    }
    await shot(m);
  }
  chk('the three colourings differ from one another', !!tints.orbit && !!tints.type && !!tints.purpose
    && JSON.stringify(tints.orbit) !== JSON.stringify(tints.type) && JSON.stringify(tints.type) !== JSON.stringify(tints.purpose));

  /* ---- back to the one colour ---- */
  console.log('\n3. "One colour" again');
  await choose('one');
  await page.waitForFunction(() => !Orbit3D.cloudTint && !document.querySelector('#o3key li.kcc'), null, { timeout: 30000 });
  await page.keyboard.press('Escape');
  await away();
  /* the dot the pointer left is lit until the next pass of updateCloud (every third frame): waited for, up to a while, then compared */
  await page.waitForFunction(inPage(exactly, before.colour), null, { timeout: 15000, polling: 100 }).catch(() => {});
  const after = await read();
  const diff = after.colour.reduce((k, v, i) => k + (v === before.colour[i] ? 0 : 1), 0);
  chk('every value of the colour attribute is what it was before any colouring was chosen (=== on all ' + after.colour.length + ')',
    after.colour.length === before.colour.length && diff === 0, diff + ' differ');
  chk('...the key says "Rest of the catalogue" again, the note is gone, the scene holds no tint, and the store holds no choice',
    after.restLine === 1 && after.key.length === 0 && after.note === null && after.tint === null && after.stored === null && after.chosen === 'one',
    JSON.stringify({ restLine: after.restLine, key: after.key.length, note: after.note, stored: after.stored, chosen: after.chosen }));
  chk('...and the scene is the one it was: as many objects, the cloud\'s own geometry, attributes and material', after.objects === before.objects
    && after.attrs === before.attrs && after.geo === before.geo && after.mat === before.mat, before.objects + ' -> ' + after.objects);
  const pts1 = await page.evaluate(inPage(isolated));
  const bare1 = [];
  for (const q of pts1) bare1.push(await hoverText(q));
  await away();
  chk('...and a dot under the pointer is named by its name alone again', pts1.length > 0 && bare1.some((t, i) => t === pts1[i].name) && bare1.every((t, i) => t === '' || t === pts1[i].name),
    pts1.map((q, i) => q.name + ' -> "' + bare1[i] + '"').join('; '));

  /* ---- the observer's pin and its access circle, switched off and on (L79): the switch beside these in the Layers panel ---- */
  console.log('\n3b. The observer\'s pin and its access circle (L79)');
  const pin = () => page.evaluate(() => {
    let dot = null, ring = null;
    Orbit3D.scene.traverse(o => {
      if (o.isMesh && o.geometry.parameters && o.geometry.parameters.radius === 0.012) dot = o;
      if (o.isLine && o.material.isLineDashedMaterial) ring = o;
    });
    const box = document.getElementById('o3site');
    return { pin: !!dot && dot.parent.visible && dot.visible, ring: !!ring && ring.visible, box: !!box && box.checked, api: Orbit3D.siteShown };
  });
  if (await page.isHidden('#layersMenu')) await page.click('#layerstoggle');
  const p0 = await pin();
  await page.click('#o3site'); await page.waitForTimeout(300);
  const p1 = await pin();
  /* another spacecraft loaded: the circle keeps its switch */
  const was = await page.evaluate(() => __gt.D && __gt.D.entry ? __gt.D.entry.name : null);
  await page.keyboard.press('Escape');
  await H.pick(page, 'ISS (ZARYA)');
  await page.waitForTimeout(1200);
  const p2 = await pin();
  if (was) { await H.pick(page, was); await page.waitForTimeout(1200); }     // the rest of the suite is about the spacecraft it opened on
  if (await page.isHidden('#layersMenu')) await page.click('#layerstoggle');
  await page.click('#o3site'); await page.waitForTimeout(300);
  const p3 = await pin();
  chk('"Observer pin & circle" is on at first, and off hides the pin and the circle round it, which stay hidden; on, both are back',
    p0.pin && p0.ring && p0.box && p0.api === true && !p1.pin && !p1.ring && !p1.box && p1.api === false && !p2.pin && !p2.ring
    && p3.pin && p3.ring && p3.box && p3.api === true, JSON.stringify([p0, p1, p2, p3]));
  await page.keyboard.press('Escape');

  /* ---- kept, and forgotten ---- */
  console.log('\n4. Kept over a reload, and taken by "Forget what this page stored"');
  await choose('purpose');
  await keyIs(MODES.purpose.rows);
  await page.keyboard.press('Escape');
  let mark = got.length;
  await page.reload({ waitUntil: 'load' });
  await boot();
  await keyIs(MODES.purpose.rows);
  await drawn(n);
  const kept = await read();
  chk('after a reload the choice holds: "By purpose" is checked, the dots wear it and the key says it', kept.stored === 'purpose' && kept.chosen === 'purpose'
    && JSON.stringify(kept.tint) === JSON.stringify(tints.purpose) && census(kept, n).wrong.length === 0, kept.stored + ' / ' + kept.chosen);
  chk('...the page asked for the colours\' chunk and the table again, once each', fetched(CHUNK, mark) === 1 && fetched(TABLE, mark) === 1,
    'catcolour ' + fetched(CHUNK, mark) + ', satcat ' + fetched(TABLE, mark));
  await page.evaluate(() => document.getElementById('forgetbtn').scrollIntoView());
  await page.click('#forgetbtn');
  await page.waitForTimeout(800);
  const armed = await page.textContent('#forgetsay');
  chk('"Forget" counts it among the display choices', /your display choices/.test(armed || ''), armed);
  mark = got.length;
  await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }), page.click('#forgetbtn')]);
  await boot();
  await drawn(n);
  const gone = await read();
  chk('...and the second press takes it: the page after it opens on "One colour", with the key\'s line and the old colours, and no choice stored',
    gone.stored === null && gone.chosen === 'one' && gone.tint === null && gone.restLine === 1 && gone.key.length === 0 && census(gone, n).wrong.length === 0,
    JSON.stringify({ stored: gone.stored, chosen: gone.chosen, tint: !!gone.tint, restLine: gone.restLine }));
  chk('...and fetches neither the colours\' chunk nor the table', fetched(CHUNK, mark) === 0 && fetched(TABLE, mark) === 0);

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  chk('nothing in the page complained', errs.length === 0);
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close(); await srv.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
