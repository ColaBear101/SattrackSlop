/*
 * The decay forecast: what it refuses, and what it says when it has nothing.
 *
 * The forecast itself is validated against real re-entries (README, "How well
 * it works"); that needs CelesTrak's archive, at anything from seconds to over
 * a minute a request, so it is not in the suite. What is here is the part that can be pinned offline, on
 * histories made up in this file:
 *
 *  - An eccentric orbit is refused. The model applies drag at the mean
 *    altitude, where a near-circular orbit spends its time; an eccentric one
 *    loses its energy at perigee, and a date for it was a circular-orbit answer
 *    to the wrong question. Eccentricity was parsed with every row and never
 *    read. The same history made near-circular has to get exactly the forecast
 *    it always got, since the README's error table and KNACKSAT-2's figures
 *    rest on that path. What the page says about how such an orbit comes down
 *    depends on its apogee: "apogee first, perigee holding still" is drag's
 *    doing, and was said of a Molniya orbit, whose perigee the Moon and the
 *    Sun move. The eccentricity it quotes is the median it refused on.
 *  - A high orbit's history is read, not thrown away. The parser capped mean
 *    altitude at 60,000 km, so XMM-NEWTON's whole record vanished and the page
 *    said CelesTrak had returned no history or could not be reached.
 *  - Six ways of having no history are told apart, because "returned nothing,
 *    or could not be reached" covered a history that had arrived whole.
 *  - A forecast dated before today is not a forecast. ICEYE-X34 read
 *    "2026-09-14 - 0 days from the last element set" eleven days later, over a
 *    blurb about being within three weeks of the truth.
 *
 * The first three run against lifetime.js in Node, with fetch replaced; the
 * page is then driven with CelesTrak's history endpoint mocked, to check the
 * words a reader gets.
 *
 *   node verification/verify-lifetime.js          (needs playwright)
 */
const path = require('path');
const { chromium } = require('playwright');

require(path.join(__dirname, '..', 'earth', 'lifetime.js'));
const L = globalThis.Lifetime;
const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');
const DAY = 86400000;

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

/* A falling orbit, one element set a day: 420 km to about 359 km over 220 days,
   steepening as it goes, which is the shape of KNACKSAT-2's record. Ending
   `endAgo` days before now. */
function falling(ecc, endAgo, from, to) {
  const t1 = Date.now() - endAgo * DAY, n = 221, rows = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    rows.push({ t: t1 - (n - 1 - i) * DAY, sma: from - (from - to) * (0.72 * t + 0.28 * t * t), ecc });
  }
  return rows;
}
/* The page CelesTrak serves: one plotData string, header first. */
const plot = rows => 'var plotData = "Date,RAAN,Inclination,Arg of Perigee,SMA,Eccentricity|' +
  rows.map(r => [new Date(r.t).toISOString().replace('Z', ''), 0, 0, 0, r.sma,
                 r.ecc === null ? '' : r.ecc].join(',')).join('|') + '"';
/* A high eccentric orbit: XMM-NEWTON's mean altitude, wandering by a few km. */
const heo = () => {
  const rows = [];
  for (let i = 0; i < 200; i++)
    rows.push({ t: Date.now() - (200 - i) * DAY, sma: 60555 + 6 * Math.sin(i / 3), ecc: 0.465 });
  return rows;
};

(async () => {
  // ---------------- lifetime.js, in Node ----------------------------------
  console.log('\nlifetime.js');

  const circ = L.predict(L.parsePlot(plot(falling(0.0008, 2, 420, 359))));
  const bare = L.predict(L.parsePlot(plot(falling(null, 2, 420, 359))));
  const same = ['verdict', 'hNow', 'rate', 'simple', 'trend', 'days', 'g', 'rms']
    .every(k => circ[k] === bare[k]);
  chk('a near-circular history is forecast, exactly as with no eccentricity at all',
      circ.verdict === 'decaying' && isFinite(circ.days) && same,
      circ.verdict + ', ' + (circ.days || 0).toFixed(3) + ' d'
        + (same ? ', identical field by field' : ', DIFFERS: ' + JSON.stringify([circ.days, bare.days])));

  /* 400 km higher, so the perigee lands where the circular one flew. The
     perigee reported is the middle of the last five sets by perigee height -
     on a steady fall, the third from last. */
  const EP = L.parsePlot(plot(falling(0.057, 2, 420 + 400, 359 + 400)));
  const ecc = L.predict(EP);
  const a = L.RE + EP[EP.length - 3].sma, hp = a * (1 - 0.057) - L.RE;
  chk('the same fall at e = 0.057 is refused as eccentric, with its perigee',
      ecc.verdict === 'eccentric' && ecc.days === undefined && ecc.rate === null
        && Math.abs(ecc.hp - hp) < 1e-6 && Math.abs(ecc.ha - (a * 1.057 - L.RE)) < 1e-6,
      ecc.verdict + ', perigee ' + (ecc.hp || 0).toFixed(1) + ' km, mean ' + ecc.hNow.toFixed(1) + ' km');
  const edge = L.predict(L.parsePlot(plot(falling(L.ECC_MAX, 2, 420, 359))));
  chk('...and the threshold itself is still forecast: the cap is e > ' + L.ECC_MAX,
      edge.verdict === 'decaying', edge.verdict);

  /* One wild element set must not flip the verdict either way. */
  const spike = falling(0.0008, 2, 420, 359); spike[spike.length - 3].ecc = 0.5;
  const dip = falling(0.057, 2, 820, 759); dip[dip.length - 3].ecc = 0.0001;
  chk('one outlying eccentricity moves neither verdict',
      L.predict(L.parsePlot(plot(spike))).verdict === 'decaying'
      && L.predict(L.parsePlot(plot(dip))).verdict === 'eccentric');

  /* An orbit rounding out: e 0.03 easing to 0.015 over the last 45 days. The
     median is still over the cap and the latest set is under it, so the page
     has to be told which number the refusal was made on. */
  const round = falling(0.03, 2, 820, 759);
  round.forEach((r, i) => { const k = i - (round.length - 46); if (k > 0) r.ecc = 0.03 - 0.015 * k / 45; });
  const rv = L.predict(L.parsePlot(plot(round)));
  chk('the median the refusal was made on is returned beside the latest set\'s eccentricity',
      rv.verdict === 'eccentric' && rv.eccMed > L.ECC_MAX && rv.ecc <= L.ECC_MAX,
      rv.verdict + ', median ' + (rv.eccMed || 0).toFixed(4) + ', latest ' + (rv.ecc || 0).toFixed(4));

  const H = L.readPlot(plot(heo()));
  chk('a high orbit\'s history is read, not filtered out whole',
      H.P && H.P.length === 200 && H.rows === 200,
      (H.P ? H.P.length : 0) + ' of ' + H.rows + ' rows kept at ~60,555 km');
  const hv = L.predict(H.P);
  chk('...and is refused as eccentric, with a perigee far above the air',
      hv.verdict === 'eccentric' && hv.hp > 25000, hv.verdict + ', perigee ' + (hv.hp || 0).toFixed(0) + ' km');

  /* The six answers history() can give, with fetch standing in for CelesTrak.
     No localStorage in Node, which cached() and the cache write both survive. */
  const realFetch = globalThis.fetch, realST = globalThis.setTimeout;
  const outcome = async (fake, satnum, fastTimeout) => {
    globalThis.fetch = fake;
    if (fastTimeout) globalThis.setTimeout = (fn) => realST(fn, 5);
    try { return await L.history(satnum); }
    finally { globalThis.fetch = realFetch; globalThis.setTimeout = realST; }
  };
  const answer = (status, body) => async () => ({ ok: status < 400, status, text: async () => body });
  const got = {
    ok:          await outcome(answer(200, plot(falling(0.0008, 2, 420, 359))), 90001),
    http:        await outcome(answer(503, 'busy'), 90002),
    unreachable: await outcome(async () => { throw new TypeError('Failed to fetch'); }, 90003),
    timeout:     await outcome((u, o) => new Promise((_, no) =>
                   o.signal.addEventListener('abort', () => no(new Error('aborted')))), 90004, true),
    unreadable:  await outcome(answer(200, '<html>down for maintenance</html>'), 90005),
    empty:       await outcome(answer(200, 'var plotData = "Date,RAAN,Inclination,Arg of Perigee,SMA,Eccentricity"'), 90006),
    outside:     await outcome(answer(200, plot([{ t: Date.now() - DAY, sma: 50, ecc: 0 },
                                                 { t: Date.now(), sma: 40, ecc: 0 }])), 90007)
  };
  const whyOk = Object.keys(got).every(k => k === 'ok'
    ? got.ok.P && got.ok.P.length === 221 && got.ok.why === null
    : got[k].P === null && got[k].why === k);
  chk('each way of having no history is told apart from the others, and from a history',
      whyOk && got.http.status === 503 && got.outside.rows === 2,
      Object.keys(got).map(k => k + '=' + (got[k].P ? got[k].P.length + ' sets' : got[k].why)).join(', '));

  // ---------------- the page ------------------------------------------------
  const browser = await chromium.launch();
  const errs = [];
  const panel = async (body, status) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    await page.route('**gibs.earthdata.nasa.gov/**', r => r.abort());
    await page.route('**tle.ivanstanojevic.me/**', r => r.abort());
    await page.route('**celestrak.org/**', r => /graph-orbit-data/.test(r.request().url())
      ? r.fulfill({ status: status || 200, contentType: 'text/html', body }) : r.abort());
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__gt && !!window.__gt.D, null, { timeout: 30000 });
    await page.click('#lifego');
    await page.waitForFunction(() => !/Fetching/.test(document.getElementById('lifebig').textContent),
      null, { timeout: 20000 });
    const out = await page.evaluate(() => ({
      big: document.getElementById('lifebig').textContent,
      sub: document.getElementById('lifesub').textContent,
      note: document.getElementById('lifenote').textContent,
      legend: document.getElementById('lifelegend').textContent,
      retry: !!document.getElementById('lifego') }));
    await ctx.close();
    return out;
  };
  console.log('\nthe page, with the history endpoint mocked');

  /* Down to 150 km a month ago: the model gives it hours more, so the date is
     about 29 days gone. */
  const past = await panel(plot(falling(0.0008, 30, 400, 150)));
  const ago = +((past.sub.match(/, (\d+) days ago$/) || [])[1]);
  chk('a forecast dated before today reads as probably re-entered, with no accuracy claim',
      past.big === 'Probably re-entered' && /^forecast \d{4}-\d{2}-\d{2}, /.test(past.sub)
      && ago >= 28 && ago <= 30 && /a date already past/.test(past.note) && !/Backtested/.test(past.note),
      past.big + ' / ' + past.sub);
  /* Down to 130 km: both models' projections are then hours long on a 220-day
     chart - a pixel or less - so the key does not offer swatches for them. At
     150 km the headline's runs eight hours and loses its swatch too; the
     fixed-atmosphere one runs two days, a few pixels, and may keep the band's. */
  const gone = await panel(plot(falling(0.0008, 30, 400, 130)));
  chk('...and the chart key names only what can be seen',
      gone.big === 'Probably re-entered' && /observed/.test(gone.legend)
      && !/projected decay|model disagreement/.test(gone.legend) && !/projected decay/.test(past.legend),
      gone.legend + ' | at 150 km: ' + past.legend);

  const fut = await panel(plot(falling(0.0008, 2, 420, 359)));
  chk('a forecast still ahead gives the date, names both models, and calls the band disagreement',
      /^\d{4}-\d{2}-\d{2}$/.test(fut.big) && /The two models give \d{4}-\d{2}-\d{2} with the atmosphere held still/.test(fut.note)
      && !/bracket/.test(fut.note) && /model disagreement/.test(fut.legend) && !/estimator spread/.test(fut.legend),
      fut.big + ' / ' + fut.legend);

  const ec = await panel(plot(falling(0.057, 2, 820, 759)));
  chk('an eccentric orbit gets its perigee and no date',
      ec.big === 'Eccentric orbit' && /^perigee \d[\d,]* km · e 0\.057$/.test(ec.sub)
      && /Drag acts at perigee/.test(ec.note) && !/\d{4}-\d{2}-\d{2}/.test(ec.big),
      ec.big + ' / ' + ec.sub);

  /* Apogee first, perigee holding still, is drag's doing, and true only where
     drag is what shapes the orbit. The low one above has its apogee near
     1,170 km; a Molniya orbit - ARKTIKA-M 1's, perigee 789 km, apogee 39,572
     km - has its perigee moved by the Moon and the Sun, and was told the same. */
  const molniya = [];
  for (let i = 0; i < 200; i++)
    molniya.push({ t: Date.now() - (200 - i) * DAY, sma: 20178 + 3 * Math.sin(i / 5), ecc: 0.7301 });
  const mo = await panel(plot(molniya));
  chk('a low-apogee eccentric orbit is said to come down apogee first; a Molniya orbit is not',
      /apogee first/.test(ec.note) && /With apogee at 1,1\d\d km, drag is what shapes/.test(ec.note)
      && !/Moon/.test(ec.note)
      && mo.big === 'Eccentric orbit' && /^perigee 7\d\d km/.test(mo.sub)
      && !/apogee first|holding nearly still/.test(mo.note)
      && /With apogee at 39,5\d\d km, drag is not all that moves this perigee: the Moon and the Sun/.test(mo.note),
      'low: ' + ((ec.note.match(/With apogee at [\d,]+ km, [^:]*/) || ['?'])[0])
        + ' | Molniya: ' + ((mo.note.match(/With apogee at [\d,]+ km, [^:]*/) || ['?'])[0]));

  const ro = await panel(plot(round));
  chk('the refusal quotes the median it was made on, and says the latest set is under the line',
      /at an eccentricity of 0\.0[2-3]\d, the median over the last 45 days/.test(ro.note)
      && /The latest sets are down to e 0\.01\d, under that line/.test(ro.note)
      && /^perigee \d[\d,]* km · e 0\.01\d$/.test(ro.sub),
      ro.sub + ' / ' + ((ro.note.match(/at an eccentricity of [^,]*/) || ['?'])[0]));
  /* Just either side of the cap, three decimals printed both as 0.020: "at
     an eccentricity of 0.020 ... above 0.02 no date is offered. The latest
     sets are down to e 0.020, under that line". */
  const nearCap = falling(0.0204, 2, 820, 759);
  nearCap.forEach((r, i) => { if (i >= nearCap.length - 10) r.ecc = 0.0199; });
  const nc = await panel(plot(nearCap));
  chk('...and near the cap it prints a fourth decimal, so the two figures read apart',
      /at an eccentricity of 0\.0204, the median over the last 45 days/.test(nc.note)
      && /The latest sets are down to e 0\.0199, under that line/.test(nc.note)
      && / · e 0\.0199$/.test(nc.sub),
      nc.sub + ' / ' + ((nc.note.match(/at an eccentricity of [^,]*/) || ['?'])[0]));

  const hi = await panel(plot(heo()));
  chk('a high orbit\'s history is not reported as missing',
      hi.big === 'No drag decay' && !/No history|could not be reached/.test(hi.note), hi.big + ' / ' + hi.sub);
  /* Above 1,000 km the same split, the other way round: the Moon and the Sun
     for XMM-NEWTON's apogee, not for an orbit topping out at 1,500 km. */
  const low = [];
  for (let i = 0; i < 200; i++)
    low.push({ t: Date.now() - (200 - i) * DAY, sma: 1300 + 0.5 * Math.sin(i / 3), ecc: 0.03 });
  const lo = await panel(plot(low));
  chk('...and above 1,000 km the Moon and the Sun are named for a high apogee, not for a low one',
      /the Moon and the Sun/.test(hi.note) && lo.big === 'No drag decay'
      && !/Moon/.test(lo.note) && /takes centuries or longer/.test(lo.note),
      lo.big + ' / ' + lo.sub);

  const busy = await panel('busy', 503);
  const none = await panel(plot([{ t: Date.now() - DAY, sma: 50, ecc: 0 }, { t: Date.now(), sma: 40, ecc: 0 }]));
  chk('a failed request says so and offers a retry; a history outside the range says that instead',
      busy.big === 'Not received' && /HTTP 503/.test(busy.note) && busy.retry
      && none.big === 'Out of range' && /returned 2 element sets/.test(none.note) && !none.retry,
      busy.big + ' (retry) / ' + none.big + ' (no retry)');

  await browser.close();
  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  process.exit(fails || errs.length ? 1 : 0);
})();
