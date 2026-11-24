/*
 * A reader's own 3D model (CHANGES-FROM-LEGACY.md, L73): given in the close-up, kept only in this browser.
 *
 *   - the panel is a chunk of its own, fetched at the first press of "Your model…", not with the close-up;
 *   - a file that is not a glTF model, a .gltf that points at a web address, and a model compressed with a decoder the page does not
 *     ship are each refused with their own sentence, and nothing is kept;
 *   - a valid model is shown at once in place of the spacecraft's own, with its size, and "Keep" files it: its list in localStorage
 *     (gt.models) and the file in IndexedDB (the database gt-models), and nothing is sent anywhere;
 *   - after a reload the spacecraft wears it in the close-up, credited as the reader's;
 *   - "Remove my model" gives the spacecraft the page's model back;
 *   - "Forget what this page stored" takes the list and the database with everything else.
 *
 * The models are made here, in memory, and handed to the file input as files: a 20 cm cube, a PNG renamed .glb, a .gltf whose buffer
 * is on the web, and a GLB that says it cannot be drawn without Draco.
 *
 *   node verification/suites/verify-models.js            (the rebuilt page only)
 */
const H = require('../lib/harness');

let fails = 0;
const chk = (name, ok, detail) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) fails++; };

/* ---- the files ---- */
function glb(json, bin) {
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4, fill)]);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), b = bin ? pad(bin, 0) : null;
  const head = Buffer.alloc(12), jh = Buffer.alloc(8);
  const total = 12 + 8 + j.length + (b ? 8 + b.length : 0);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const parts = [head, jh, j];
  if (b) { const bh = Buffer.alloc(8); bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4); parts.push(bh, b); }
  return Buffer.concat(parts);
}
function cube(extra = {}) {
  const s = 0.1, pos = new Float32Array([-s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s, -s, -s, s, s, -s, s, s, s, s, -s, s, s]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  return glb({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.9, 0.3, 0.1, 1], metallicFactor: 0.2, roughnessFactor: 0.5 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 96 }, { buffer: 0, byteOffset: 96, byteLength: 72 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-s, -s, -s], max: [s, s, s] },
                { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }],
    ...extra
  }, bin);
}
const FILES = {
  good: { name: 'test cube.glb', mimeType: 'model/gltf-binary', buffer: cube() },
  png: { name: 'not a model.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) },
  web: { name: 'remote.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.com/a.bin', byteLength: 36 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ count: 3, type: 'VEC3' }] })) },
  draco: { name: 'compressed.glb', mimeType: 'model/gltf-binary', buffer: cube({ extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] }) }
};

(async () => {
  if (H.targetName() !== 'new') { console.log('SKIP  a reader\'s models exist only in the rebuilt page'); return; }
  const srv = await H.up();
  const { chromium } = H.playwright();
  const browser = await chromium.launch({ args: H.GL_ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1, timezoneId: 'UTC', locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = [], got = [], away = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 300)); });
  page.on('request', q => { const u = new URL(q.url()); got.push(u.pathname); if (q.method() !== 'GET' && q.method() !== 'HEAD') away.push(q.method() + ' ' + u.href); });

  const boot = async () => {
    await page.waitForFunction(() => !!window.__gt && !!window.__gt.D && !!window.Orbit3D && !!Orbit3D.scene, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
  };
  const status = () => page.evaluate(() => [...document.querySelectorAll('.closecard [role=status]')].map(n => n.textContent.trim()).filter(Boolean).join(' | '));
  const card = () => page.evaluate(() => (document.querySelector('.closecard') || {}).textContent || '');
  const settle = () => page.waitForFunction(() => !/Loading|Reading/.test((document.querySelector('.closecard') || {}).textContent || ''), null, { timeout: 60000 });
  const tris = () => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(Orbit3D.renderer.info.render.triangles)))));
  const stored = () => page.evaluate(async () => ({
    list: localStorage.getItem('gt.models'),
    db: (await indexedDB.databases()).map(d => d.name).includes('gt-models')
  }));
  const give = async f => { await page.setInputFiles('.closecard input[type=file]', f); await page.waitForTimeout(400); await settle(); await page.waitForTimeout(400); };

  await page.goto(srv.page, { waitUntil: 'load' });
  await boot();
  await page.click('.camseg .cam[data-mode=close]');
  await settle();
  chk('the close-up does not bring the panel with it', !got.some(p => /\/uploads-[\w-]{8}\.js$/.test(p)));
  await page.click('#mymodel');
  await page.waitForSelector('.closecard input[type=file]', { timeout: 30000 });
  chk('"Your model…" fetches the panel', got.some(p => /\/uploads-[\w-]{8}\.js$/.test(p)));

  /* ---- refused ---- */
  await give(FILES.png);
  chk('a file that is not a glTF model is refused', /not a glTF model/.test(await status()), await status());
  await give(FILES.web);
  chk('a .gltf that points at a web address is refused, and nothing is fetched from it', /points to other files/.test(await status()) && !got.some(p => /a\.bin/.test(p)), await status());
  await give(FILES.draco);
  chk('a model compressed with Draco is refused', /compressed with KHR_draco_mesh_compression/.test(await status()), await status());
  let s = await stored();
  chk('...and nothing was kept', s.list === null && !s.db, JSON.stringify(s));

  /* ---- a good one ---- */
  await give(FILES.good);
  const t1 = await tris();
  chk('a valid model is shown at once, in place of the spacecraft\'s own', t1 === 12, t1 + ' triangles');
  chk('...with its size as read', /Size: 20\.0 cm × 20\.0 cm × 20\.0 cm/.test(await card()), await card());
  await page.click('.closecard .btn.primary');
  await page.waitForTimeout(800);
  s = await stored();
  chk('"Keep" files it in this browser: its list and its file', /Kept\./.test(await status()) && /"key":"67683"/.test(s.list || '') && s.db, JSON.stringify(s) + ' ' + await status());
  chk('nothing was sent anywhere', away.length === 0, away.join(' '));

  /* ---- after a reload ---- */
  await page.reload({ waitUntil: 'load' });
  await boot();
  await page.click('.camseg .cam[data-mode=close]');
  await settle();
  await page.waitForTimeout(800);
  const t2 = await tris();
  chk('after a reload the spacecraft wears it in the close-up, credited as the reader\'s', t2 === 12 && /Your model, test cube, kept only in this browser\./.test(await card()), t2 + ' triangles; ' + await card());

  /* ---- removed ---- */
  await page.click('#mymodel');
  await page.waitForSelector('.closecard input[type=file]', { timeout: 30000 });
  await page.click('.closecard .btn:has-text("Remove my model")');
  await page.waitForTimeout(500);
  await settle();
  await page.waitForTimeout(800);
  const t3 = await tris();
  s = await stored();
  chk('"Remove my model" gives the spacecraft the page\'s model back, and the list loses it', t3 > 1000 && /KMUTNB/.test(await card()) && s.list === null, t3 + ' triangles; ' + JSON.stringify(s));

  /* ---- forgotten ---- */
  await page.click('#mymodel');
  await page.waitForSelector('.closecard input[type=file]', { timeout: 30000 });
  await give(FILES.good);
  await page.click('.closecard .btn.primary');
  await page.waitForTimeout(800);
  chk('(kept again, for "Forget")', !!(await stored()).list);
  await page.evaluate(() => document.getElementById('forgetbtn').scrollIntoView());
  await page.click('#forgetbtn');
  await page.waitForTimeout(800);
  const armed = await page.textContent('#forgetsay');
  chk('"Forget" counts the model and says it cannot be brought back', /1 3D model you added/.test(armed) && /models you added cannot be brought back/.test(armed), armed);
  await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }), page.click('#forgetbtn')]);
  await boot();
  s = await stored();
  chk('...and the second press takes the list and the database', s.list === null && !s.db, JSON.stringify(s));

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  chk('nothing in the page complained', errs.length === 0);
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close(); await srv.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
