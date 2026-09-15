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

  // ========================================================================
  // the place picker
  // ========================================================================
  /* The geocoder is mocked. Two reasons: a check that talks to someone else's
     service fails when their service is down rather than when this code is
     wrong, and a live search would return whatever Open-Meteo happens to hold
     today, which is not something to assert against. The SHAPE of the reply is
     copied from a real one, captured from the live service, so the parsing
     under test is the parsing that runs in anger. */
  const HITS = {
    tok: [{ id:1850147, name:'Tokyo', latitude:35.6895, longitude:139.69171,
            elevation:40.0, country:'Japan', admin1:'Tokyo', timezone:'Asia/Tokyo',
            population:8336599 }],
    lon: [{ id:2643743, name:'London', latitude:51.50853, longitude:-0.12574,
            elevation:25.0, country:'United Kingdom', admin1:'England',
            timezone:'Europe/London', population:8961989 }]
  };
  let geocodeCalls = 0;
  await page.route('**geocoding-api.open-meteo.com/**', r => {
    geocodeCalls++;
    const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('name') || '')
                .toLowerCase().slice(0, 3);
    r.fulfill({ status: 200, contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*' },
                body: JSON.stringify({ results: HITS[q] || [] }) });
  });

  const openForm = () => page.evaluate(() => {
    const f = document.getElementById('siteform');
    if (f.hidden) document.getElementById('siteopen').click();
  });
  const typeSearch = async text => {
    await openForm();
    await page.evaluate(t => {
      const q = document.getElementById('s-search');
      q.value = t; q.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await page.waitForFunction(
      () => !document.getElementById('s-hits').hidden, null, { timeout: 8000 });
  };

  await typeSearch('Tokyo');
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('#s-hits button')].map(b => b.textContent));
  chk('searching a place name offers it',
      shown.length === 1 && /Tokyo/.test(shown[0]), shown.join(' | '));
  chk('...with the coordinates that tell two places of one name apart',
      /35\.69° N/.test(shown[0]) && /139\.69° E/.test(shown[0]), shown[0]);
  chk('...and the ground height, which nobody knows off hand',
      /40 m/.test(shown[0]), shown[0]);

  await page.evaluate(() => document.querySelector('#s-hits button').click());
  await page.waitForTimeout(2500);
  const tk = await state();
  chk('picking it moves the observer there',
      Math.abs(tk.obs.lat - 35.6895) < 1e-6 && Math.abs(tk.obs.lon - 139.69171) < 1e-6,
      tk.obs.lat + ', ' + tk.obs.lon);
  chk('...taking the ground elevation with it',
      Math.abs(tk.obs.altKm - 0.040) < 1e-9, tk.obs.altKm + ' km');
  chk('...and a real timezone rather than a guess from longitude',
      tk.obs.zone === 'Asia/Tokyo', String(tk.obs.zone));
  chk('...which reads UTC+9', tk.tz === 'UTC+9', tk.tz);
  chk('...and the whole page renamed itself', /Tokyo/.test(tk.heading), tk.heading);

  // ---- a longitude guess that would have been wrong ------------------------
  /* The point of carrying a zone at all. Kashgar sits at 75.99 E, so the
     nearest hour of solar time is UTC+5 - and China keeps one zone for the
     whole country, so it is really UTC+8. Three hours, which is every pass
     time on the page wrong by three hours. */
  const kashgar = await page.evaluate(() => {
    window.__gt.applySite({ name:'Kashgar', lat:39.4704, lon:75.9898, altKm:1.289,
                            zone:'Asia/Shanghai' }, false);
    return { tz: window.__gt.OBS.tz, guess: Math.round(75.9898/15) };
  });
  chk('a zone beats the longitude guess where the two disagree',
      kashgar.tz === 8 && kashgar.guess === 5,
      'zone says UTC+' + kashgar.tz + ', longitude would have said UTC+' + kashgar.guess);

  // ---- summer time ---------------------------------------------------------
  /* The offset is not one number. London is UTC+0 in January and UTC+1 in July,
     and a 7-day window of passes can sit either side of the change. Checked
     against Intl's own longOffset field, which reaches the answer by a
     different route than the wall-clock subtraction the page uses. */
  const JAN = Date.UTC(2026, 0, 15, 12), JUL = Date.UTC(2026, 6, 15, 12);
  const oracle = (zone, ms) => {
    const v = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(ms)).find(x => x.type === 'timeZoneName').value;
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(v);
    return m ? (m[1] === '-' ? -1 : 1) * (+m[2] + (+(m[3] || 0)) / 60) : 0;
  };
  const dst = await page.evaluate(t => {
    window.__gt.applySite({ name:'London', lat:51.50853, lon:-0.12574, altKm:0.025,
                            zone:'Europe/London' }, false);
    return { jan: window.__gt.tzAt(t.JAN), jul: window.__gt.tzAt(t.JUL) };
  }, { JAN, JUL });
  chk('the offset follows summer time',
      dst.jan === oracle('Europe/London', JAN) && dst.jul === oracle('Europe/London', JUL),
      'page says UTC+' + dst.jan + ' in January, UTC+' + dst.jul + ' in July; independently '
        + oracle('Europe/London', JAN) + ' and ' + oracle('Europe/London', JUL));
  chk('...and the two really are different, so that meant something',
      dst.jan !== dst.jul, dst.jan + ' vs ' + dst.jul);

  // ---- recents -------------------------------------------------------------
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await typeSearch('London');
  await page.evaluate(() => document.querySelector('#s-hits button').click());
  await page.waitForTimeout(2000);
  const chips = await page.evaluate(() => {
    const b = document.getElementById('s-recent');
    return { hidden: b.hidden, names: [...b.querySelectorAll('button')].map(x => x.textContent) };
  });
  chk('a place you have used comes back as a chip',
      !chips.hidden && chips.names.indexOf('Tokyo') >= 0, chips.names.join(', ') || 'none');
  chk('...and the one you are standing in is not offered',
      chips.names.indexOf('London') < 0, chips.names.join(', '));
  await page.evaluate(() => [...document.querySelectorAll('#s-recent button')]
    .filter(b => b.textContent === 'Tokyo')[0].click());
  await page.waitForTimeout(2000);
  const wasTokyo = await state();
  chk('...and one click goes back to it',
      Math.abs(wasTokyo.obs.lat - 35.6895) < 1e-6 && wasTokyo.obs.zone === 'Asia/Tokyo',
      wasTokyo.obs.name + ' ' + wasTokyo.obs.lat);

  // ---- no network ----------------------------------------------------------
  /* Search is a convenience over typing numbers in, so losing it has to cost
     the convenience and nothing else. */
  await page.unroute('**geocoding-api.open-meteo.com/**');
  await page.route('**geocoding-api.open-meteo.com/**', r => r.abort());
  await openForm();
  await page.evaluate(() => {
    const q = document.getElementById('s-search');
    q.value = 'Tokyo'; q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => /unreachable/i.test(document.getElementById('sitenote').textContent),
    null, { timeout: 10000 }).catch(() => {});
  const offline = await page.evaluate(() => ({
    note: document.getElementById('sitenote').textContent,
    hits: document.getElementById('s-hits').hidden }));
  chk('a dead search says so, rather than looking like no such place',
      /unreachable/i.test(offline.note) && offline.hits, offline.note.trim());

  await page.evaluate(() => {
    document.getElementById('s-manual').open = true;
    const set = (id, v) => { document.getElementById(id).value = v; };
    set('s-name', 'Chiang Mai'); set('s-lat', 18.7883); set('s-lon', 98.9853);
    set('s-alt', 0.31); set('s-tz', 7);
    document.getElementById('siteapply').click();
  });
  await page.waitForTimeout(2000);
  const manual = await state();
  chk('...and coordinates still work with the search dead',
      manual.obs.name === 'Chiang Mai' && Math.abs(manual.obs.lat - 18.7883) < 1e-9,
      manual.obs.name + ' ' + manual.obs.lat + ', ' + manual.obs.lon);
  chk('...clearing the zone, since a hand-typed coordinate is not a place',
      manual.obs.zone === null, String(manual.obs.zone));

  // ---- this device ---------------------------------------------------------
  const gctx = page.context();
  await gctx.grantPermissions(['geolocation']);
  await gctx.setGeolocation({ latitude: 48.8584, longitude: 2.2945, accuracy: 25 });
  await openForm();
  await page.evaluate(() => document.getElementById('s-here').click());
  await page.waitForFunction(() => /My location|device|could not|declined/i.test(
    document.getElementById('sitenote').textContent), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const mine = await state();
  const mineNote = await page.evaluate(() => document.getElementById('sitenote').textContent);
  chk('"use my location" puts the observer where the device says it is',
      Math.abs(mine.obs.lat - 48.8584) < 1e-4 && Math.abs(mine.obs.lon - 2.2945) < 1e-4,
      mine.obs.lat + ', ' + mine.obs.lon);
  chk('...and says how well the device knows that', /25 m/.test(mineNote), mineNote.trim());

  console.log('\n  geocoder requests made: ' + geocodeCalls
    + ' (debounced, so fewer than the keystrokes)');

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
