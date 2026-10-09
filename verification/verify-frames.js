/*
 * How often the globe draws, which is the whole point of its frame policy.
 *
 * The old page drew sixty frames a second whatever was happening: a console left open on a second monitor kept a core busy to
 * show a picture that was not changing. The rebuilt globe draws only while it can be seen and something is moving (see
 * src/components/stage/globe-state.svelte.ts):
 *
 *   - none while the clock is stopped and nothing has been touched for a couple of seconds
 *   - none while another tab, or the report, is what is on screen
 *   - ten a second while only real time is passing; every frame while a pointer is on it
 *   - and anything that changes the picture - a call into the scene, a seek, an image arriving - wakes it
 *
 * A frame is counted off three.js's own counter (renderer.info.render.frame), so this measures what was drawn, not what was
 * asked for. Software WebGL is slow, so the figures are bounds and not targets.
 *
 *   node verification/verify-frames.js          (the rebuilt page only: the old one has no policy to check)
 */
const H = require('./lib/harness');

let fails = 0;
const chk = (name, ok, detail) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) fails++; };

(async () => {
  if (H.targetName() !== 'new') { console.log('SKIP  the frame policy exists only in the rebuilt page'); return; }
  const srv = await H.up();
  const { chromium } = H.playwright();
  const browser = await chromium.launch({ args: H.GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(srv.page, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D && !!window.Orbit3D, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  const frames = () => page.evaluate(() => Orbit3D.renderer.info.render.frame);
  const rate = async ms => { const a = await frames(); await page.waitForTimeout(ms); return ((await frames()) - a) / (ms / 1000); };

  const playing = await rate(3000);
  chk('at real time it draws about ten frames a second, not sixty', playing > 4 && playing < 16, playing.toFixed(1) + ' frames/s');

  await page.evaluate(() => document.getElementById('tpplay').click());          // stop the clock
  await page.waitForTimeout(3000);
  const idle = await rate(3000);
  chk('stopped and untouched it draws nothing', idle === 0, idle.toFixed(1) + ' frames/s');

  const box = await page.evaluate(() => { const r = document.getElementById('globe').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.move(box.x + 8, box.y + 6);
  await page.waitForTimeout(250);
  const touched = await rate(600);
  chk('a pointer on it wakes it, at full rate', touched > 15, touched.toFixed(1) + ' frames/s');
  await page.waitForTimeout(3500);
  chk('...and when the pointer rests it goes quiet again', (await rate(2000)) === 0);

  /* a call into the scene is a change the picture has to show, even on an idle globe */
  await page.waitForTimeout(500);
  const f0 = await frames();
  await page.evaluate(() => Orbit3D.setTrail(Infinity));
  await page.waitForTimeout(700);
  chk('a call into the scene draws a frame on an idle globe', (await frames()) > f0, (await frames() - f0) + ' frames');

  /* a seek moves the clock: the dots, the spacecraft and the terminator move with it */
  const f1 = await frames();
  await page.evaluate(() => { const r = document.getElementById('time'); r.value = Math.round(+r.max / 2); r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(700);
  chk('moving the clock draws a frame on an idle globe', (await frames()) > f1, (await frames() - f1) + ' frames');
  await page.waitForTimeout(3000);

  /* the other tab: not showing, not drawn, even with the clock running */
  await page.evaluate(() => document.getElementById('tpplay').click());          // play
  await H.showMap(page);
  await page.waitForTimeout(800);
  const hidden = await rate(2500);
  chk('with the map showing the globe draws nothing, clock running or not', hidden === 0, hidden.toFixed(1) + ' frames/s');
  await H.showGlobe(page);
  await page.waitForTimeout(800);
  chk('...and draws again when it is back', (await rate(2000)) > 4);

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close(); await srv.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
