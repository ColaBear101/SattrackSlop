/*
 * The CSV and calendar exports, parsed back rather than eyeballed.
 *
 * An export is only worth having if something else can read it, and both formats
 * have a way of looking right while being unusable:
 *
 *  - CSV: a field containing a comma, a quote or a newline silently shifts every
 *    column after it. The spacecraft names in this catalogue are full of commas.
 *  - iCalendar: RFC 5545 folds lines at 75 octets, and Google Calendar and
 *    Outlook both reject an over-long line outright rather than wrapping it
 *    themselves. A DESCRIPTION carrying azimuths, range and Doppler goes past 75
 *    immediately, so an unfolded file imports as nothing at all.
 *
 * So this re-parses both: the CSV with a real quoted-field parser, checking the
 * column count on every row and the values against window.__gt; the ICS by
 * unfolding, checking every line's octet length, and confirming the event count,
 * the UTC stamps and the ordering.
 *
 * The download itself is driven through the actual button, with the browser's
 * download intercepted, so what is checked is the file a user would get.
 *
 *   node verification/verify-export.js          (needs playwright)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const PAGE = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');

let fails = 0;
const chk = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

/* A real CSV parser, not split(','). The point is to prove the writer quotes
   correctly, so the reader has to be the strict kind. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
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
  await page.waitForTimeout(1800);

  const grab = async (id) => {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#' + id)
    ]);
    const tmp = path.join(os.tmpdir(), 'gt-' + Date.now() + '-' + dl.suggestedFilename());
    await dl.saveAs(tmp);
    const text = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
    return { name: dl.suggestedFilename(), text };
  };

  const expected = await page.evaluate(() => {
    const r = __gt.passRows();
    return { n: r.length, sat: __gt.D.entry.name, norad: __gt.D.E.satnum,
             site: __gt.OBS.name,
             aos: r.map(x => x.aos.getTime()), maxEl: r.map(x => x.maxEl),
             clip: r.map(x => String(x.clipA) + ',' + String(x.clipL)),
             eye: r.map(x => x.eye), mag: r.map(x => x.mag),
             lim: __gt.NAKED_EYE_MAG,
             prov: { tle_epoch_utc: __gt.D.E.epoch.toISOString(),
                     tle_line1: __gt.D.entry.l1, tle_line2: __gt.D.entry.l2,
                     window_start_utc: __gt.D.start.toISOString(),
                     window_span_h: String(__gt.D.hours), mask_deg: String(__gt.MASK),
                     site_alt_km: String(__gt.OBS.altKm) } };
  });
  console.log('\n' + expected.sat + ' from ' + expected.site + ': '
            + expected.n + ' passes to export\n');

  // ---------------- CSV ----------------------------------------------------
  const csv = await grab('exp-csv');
  const rows = parseCSV(csv.text);
  console.log('  ' + csv.name + '  (' + csv.text.length + ' bytes)');

  chk('the CSV filename carries the spacecraft, the site and the date',
      /^passes-.+-.+-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), csv.name);
  chk('it has a header and one row per pass', rows.length === expected.n + 1,
      rows.length + ' rows for ' + expected.n + ' passes + header');

  const cols = rows[0].length;
  const ragged = rows.findIndex(r => r.length !== cols);
  chk('every row has the same column count', ragged === -1,
      ragged === -1 ? cols + ' columns throughout'
                    : 'row ' + ragged + ' has ' + rows[ragged].length + ' of ' + cols);

  const h = rows[0];
  const idx = n => h.indexOf(n);
  chk('the columns a reader would look for are present',
      ['aos_utc','los_utc','max_elevation_deg','min_range_km','doppler_aos_khz',
       'naked_eye','est_magnitude','site_lat_deg'].every(n => idx(n) >= 0),
      h.length + ' columns');

  /* Columns are only ever appended, so every column a reader finds by name
     keeps its place - including for anyone reading these files by position.
     The window-edge flags went on after 'spacecraft', the magnitude estimate
     the naked-eye verdict rests on after them, and what the table was computed
     from after that. */
  const PROV = ['tle_epoch_utc','tle_line1','tle_line2','tle_source',
                'window_start_utc','window_span_h','mask_deg','site_alt_km'];
  chk('the clip flags follow the columns before them, then the magnitude estimate, then the provenance',
      idx('aos_clipped') === idx('spacecraft') + 1
      && h.slice(idx('aos_clipped'), idx('aos_clipped') + 3).join(',') === 'aos_clipped,los_clipped,est_magnitude'
      && h.slice(-PROV.length).join(',') === PROV.join(','),
      h.slice(idx('spacecraft')).join(','));
  const clipBad = expected.clip.findIndex((c, i) =>
    rows[i+1][idx('aos_clipped')] + ',' + rows[i+1][idx('los_clipped')] !== c);
  chk('...and agree with the page, pass by pass', clipBad === -1,
      clipBad === -1 ? expected.clip.join(' ') : 'pass ' + (clipBad + 1));

  /* The verdict is one of four words now, not a bare yes, and it is only as
     good as the number under it - so both go out, and both have to agree. */
  const EYE = ['yes', 'penumbra only', 'too faint', 'radio only'];
  const eyeBad = expected.eye.findIndex((e, i) =>
    rows[i+1][idx('naked_eye')] !== e || EYE.indexOf(e) < 0);
  chk('the naked-eye verdict is one of the four, and matches the page', eyeBad === -1,
      eyeBad === -1 ? EYE.map(e => e + ' ' + expected.eye.filter(x => x === e).length).join(', ')
                    : 'pass ' + (eyeBad + 1) + ': ' + rows[eyeBad+1][idx('naked_eye')]);
  const magBad = expected.mag.findIndex((m, i) => {
    const v = rows[i+1][idx('est_magnitude')];
    return m === null ? v !== '' : Math.abs(parseFloat(v) - m) > 0.005;
  });
  const yesBad = expected.eye.findIndex((e, i) =>
    e === 'yes' && !(parseFloat(rows[i+1][idx('est_magnitude')]) <= expected.lim));
  chk('...with the magnitude estimate beside it, and no yes fainter than the limit',
      magBad === -1 && yesBad === -1,
      magBad !== -1 ? 'pass ' + (magBad + 1) + ' magnitude differs'
        : yesBad !== -1 ? 'pass ' + (yesBad + 1) + ' is yes at ' + rows[yesBad+1][idx('est_magnitude')]
        : expected.mag.filter(m => m !== null).length + ' of ' + expected.n + ' passes carry one');

  /* What the table was computed from. None of it used to be in the file - the
     element set is replaced live and the window opens at the reader's clock -
     so a pass table could be neither reproduced nor cited. Every row carries
     it, and it has to be what the page actually used. The network is blocked
     here, so the set is the embedded one and has to say so. */
  const provBad = [];
  for (const k of Object.keys(expected.prov))
    rows.slice(1).forEach((r, i) => { if (r[idx(k)] !== expected.prov[k]) provBad.push(k + ' row ' + (i + 1) + ': ' + r[idx(k)]); });
  rows.slice(1).forEach((r, i) => { if (r[idx('tle_source')] !== 'embedded') provBad.push('tle_source row ' + (i + 1) + ': ' + r[idx('tle_source')]); });
  chk('every row records the element set, its epoch and source, the window, the mask and the site altitude',
      provBad.length === 0,
      provBad.length ? provBad.slice(0, 3).join(' | ')
        : 'epoch ' + expected.prov.tle_epoch_utc + ', embedded, window ' + expected.prov.window_start_utc
          + ' + ' + expected.prov.window_span_h + ' h, mask ' + expected.prov.mask_deg + ' deg');
  /* And they are enough: the file alone, handed back to the propagator with
     the site in its own columns, gives the same passes. */
  const rep = await page.evaluate(({ l1, l2, start, span }) => {
    const d = __gt.compute({ name: 'from the file', l1, l2, satnum: l1.substring(2, 7).trim() },
                           Date.parse(start), +span);
    return d.passes.map(p => p.aos.getTime());
  }, { l1: rows[1][idx('tle_line1')], l2: rows[1][idx('tle_line2')],
       start: rows[1][idx('window_start_utc')], span: rows[1][idx('window_span_h')] });
  const fileAos = rows.slice(1).map(r => Date.parse(r[idx('aos_utc')]));
  chk('...and are enough to reproduce the table: the same passes, from the file alone',
      rep.length === fileAos.length && rep.every((t, i) => Math.abs(t - fileAos[i]) <= 1),
      rep.length + ' passes recomputed for ' + fileAos.length + ' in the file');

  /* Values, not just shape: the AOS in the file has to be the AOS on the page. */
  let worstT = 0, worstEl = 0;
  for (let i = 0; i < expected.n; i++) {
    const t = Date.parse(rows[i+1][idx('aos_utc')]);
    worstT = Math.max(worstT, Math.abs(t - expected.aos[i]));
    worstEl = Math.max(worstEl, Math.abs(parseFloat(rows[i+1][idx('max_elevation_deg')]) - expected.maxEl[i]));
  }
  chk('the AOS times round-trip to the millisecond', worstT <= 1,
      'worst ' + worstT + ' ms');
  chk('the elevations round-trip to the printed precision', worstEl < 0.005,
      'worst ' + worstEl.toExponential(2) + ' deg');

  /* Nothing in the catalogue contains a comma or a quote, so the escaping was
     never reached above. The site name is typed by a user, though, and
     "Bangkok, KMUTNB" is the obvious thing to type - so move the observer to a
     name that forces it and check the file still parses. */
  await page.evaluate(() => {
    document.getElementById('siteopen').click();
    document.getElementById('s-name').value = 'Bangkok, "KMUTNB" site';
    document.getElementById('s-lat').value = 13.75;
    document.getElementById('s-lon').value = 100.52;
    document.getElementById('s-alt').value = 0;
    document.getElementById('s-tz').value = 7;
    document.getElementById('siteapply').click();
  });
  await page.waitForTimeout(2200);
  const csv2 = await grab('exp-csv');
  const rows2 = parseCSV(csv2.text);
  const cols2 = rows2[0].length;
  console.log('\n  with a site named: Bangkok, "KMUTNB" site');
  chk('a comma and a quote in a field do not shift the columns',
      rows2.every(r => r.length === cols2) && cols2 === cols,
      cols2 + ' columns on every row');
  chk('...and the field round-trips exactly',
      rows2[1][h.indexOf('site')] === 'Bangkok, "KMUTNB" site',
      JSON.stringify(rows2[1][h.indexOf('site')]));
  chk('...which required real quoting, not luck', /""/.test(csv2.text),
      'doubled quotes present in the file');

  await page.evaluate(() => {
    document.getElementById('sitereset').click();
  });
  await page.waitForTimeout(2000);

  // ---------------- iCalendar ---------------------------------------------
  const ics = await grab('exp-ics');
  console.log('\n  ' + ics.name + '  (' + ics.text.length + ' bytes)');

  const rawLines = ics.text.split('\r\n');
  chk('the calendar uses CRLF line endings, as RFC 5545 requires',
      ics.text.includes('\r\n') && !/[^\r]\n/.test(ics.text));

  /* The one that actually breaks importers. */
  const tooLong = rawLines.filter(l => Buffer.byteLength(l, 'utf8') > 75);
  chk('no line exceeds 75 octets, so importers will not reject it',
      tooLong.length === 0,
      tooLong.length ? tooLong.length + ' long line(s), worst '
        + Math.max(...tooLong.map(l => Buffer.byteLength(l, 'utf8'))) + ' octets'
        : 'longest ' + Math.max(...rawLines.map(l => Buffer.byteLength(l, 'utf8'))) + ' octets');

  // unfold, then read it back
  const unfolded = ics.text.replace(/\r\n[ \t]/g, '');
  const evs = unfolded.split('BEGIN:VEVENT').slice(1);
  chk('it is a well-formed calendar', /^BEGIN:VCALENDAR\r\n/.test(ics.text)
      && /END:VCALENDAR\r\n$/.test(ics.text) && /VERSION:2\.0/.test(unfolded));
  chk('one event per pass', evs.length === expected.n,
      evs.length + ' events for ' + expected.n + ' passes');

  const dt = s => { const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    return m ? Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]) : NaN; };
  let okStamps = true, ordered = true, worstStart = 0;
  for (let i = 0; i < evs.length; i++) {
    const st = (evs[i].match(/DTSTART:(\S+)/) || [])[1];
    const en = (evs[i].match(/DTEND:(\S+)/) || [])[1];
    const a = dt(st || ''), b = dt(en || '');
    if (!isFinite(a) || !isFinite(b) || b <= a) okStamps = false;
    worstStart = Math.max(worstStart, Math.abs(a - Math.floor(expected.aos[i]/1000)*1000));
    if (i && dt((evs[i-1].match(/DTSTART:(\S+)/) || [])[1] || '') > a) ordered = false;
  }
  chk('every event has UTC stamps and ends after it starts', okStamps);
  chk('...matching the page, to the second', worstStart <= 1000,
      'worst ' + worstStart + ' ms');
  chk('...and they are in chronological order', ordered);
  chk('each event carries a 10-minute alarm',
      (unfolded.match(/BEGIN:VALARM/g) || []).length === expected.n
      && /TRIGGER:-PT10M/.test(unfolded));
  chk('the summary names the spacecraft and its peak elevation',
      new RegExp(expected.sat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(unfolded)
      && /SUMMARY:.*\d+°/.test(unfolded));
  chk('the description carries the numbers worth having',
      /Minimum range/.test(unfolded) && /Naked eye/.test(unfolded)
      && /Element set epoch/.test(unfolded));
  /* The summary used to end "— visible" whenever the spacecraft was lit against
     a dark sky, at any range. It now says "naked eye" with the estimate, on
     exactly the passes the page calls yes, and the description gives the
     standard magnitude the estimate was scaled from on every pass that has one. */
  const sums = evs.map(e => (e.match(/SUMMARY:([^\r\n]*)/) || [])[1] || '');
  const sumBad = sums.findIndex((s, i) =>
    /naked eye \(est\. mag -?\d+\.\d\)/.test(s) !== (expected.eye[i] === 'yes') || /visible/.test(s));
  const descBad = evs.findIndex((e, i) => (expected.mag[i] !== null)
    !== /Estimated magnitude -?\d+\.\d.*standard magnitude of -?\d+\.\d/.test(e));
  chk('the summary says naked eye, with the estimate, on the yes passes and no others',
      sumBad === -1 && descBad === -1,
      sumBad !== -1 ? 'event ' + (sumBad + 1) + ': ' + sums[sumBad]
        : descBad !== -1 ? 'event ' + (descBad + 1) + ' description'
        : expected.eye.filter(e => e === 'yes').length + ' naked-eye event(s) of ' + expected.n);

  const uids = (unfolded.match(/UID:(\S+)/g) || []);
  chk('every event has a unique UID, so a re-import updates rather than duplicates',
      new Set(uids).size === uids.length && uids.length === expected.n,
      uids.length + ' UIDs, ' + new Set(uids).size + ' distinct');

  /* A window-edge pass, which the default spacecraft rarely has. A GEO seen
     from Bangkok is above the mask for the whole window, so both of its ends are
     the window's - and before these flags neither file could tell that apart
     from a real rise and set. Loaded through the picker, as a reader would. */
  await page.evaluate(() => {
    const box = document.getElementById('satsearch');
    box.value = 'INTELSAT 36';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const o = document.querySelector('#satlist [role=option]');
    if (o) o.click();
  });
  await page.waitForTimeout(2500);
  const geo = await page.evaluate(() => ({ name: __gt.D.entry.name,
    clip: __gt.D.passes.map(p => [p.clipA, p.clipL]) }));
  console.log('\n  a window-edge pass: ' + geo.name);
  if (geo.clip.length === 1 && geo.clip[0][0] && geo.clip[0][1]) {
    const gc = parseCSV((await grab('exp-csv')).text);
    const gcol = n => gc[1][gc[0].indexOf(n)];
    chk('a pass up for the whole window is flagged at both ends in the CSV',
        gcol('aos_clipped') === 'true' && gcol('los_clipped') === 'true',
        gcol('aos_clipped') + ',' + gcol('los_clipped'));
    /* The finding's own case: 37,000 km away, lit against Bangkok's night sky,
       and exported as naked_eye=yes and "— visible". From that range it would
       take something brighter than the Chinese space station to reach +6. */
    const gm = parseFloat(gcol('est_magnitude'));
    chk('...and is not exported as naked-eye visible from 37,000 km',
        gcol('naked_eye') !== 'yes' && (gcol('est_magnitude') === '' || gm > 6),
        'naked_eye=' + gcol('naked_eye') + ', est_magnitude=' + gcol('est_magnitude'));
    const gi = (await grab('exp-ics')).text.replace(/\r\n[ \t]/g, '');
    chk('...in the calendar either', !/SUMMARY:.*(visible|naked eye)/.test(gi)
        && /Naked eye: (too faint|radio only)/.test(gi),
        (gi.match(/Naked eye: [a-z ]+/) || ['no verdict'])[0]);
    chk('...and in the calendar, by property and in words',
        /X-GT-CLIPPED:AOS,LOS/.test(gi) && /DTSTART is the window start/.test(gi)
        && /DTEND is the window end/.test(gi) && /SUMMARY:.*window-clipped/.test(gi));
    chk('...whose alarm does not announce an AOS that is really the window opening',
        !/AOS in 10 minutes/.test(gi) && /already up when the window opens/.test(gi));
  } else {
    chk('INTELSAT 36 loads as one pass clipped at both ends', false, JSON.stringify(geo));
  }

  /* And the other side: a spacecraft that IS visible, so the "naked eye"
     summary and the estimate beside it are written at all. The default
     spacecraft's 24 hours from now rarely has such a pass, so this pins a week
     that does - HST from 2026-09-15, on its published standard magnitude. */
  await page.evaluate(() => {
    const box = document.getElementById('satsearch');
    box.value = 'HST';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const o = [...document.querySelectorAll('#satlist [role=option]')]
      .find(li => /^HST$/.test((li.querySelector('.nm') || li).textContent.trim()));
    if (o) o.click();
    const w = document.getElementById('winStartIn');
    w.value = '2026-09-15T00:00';
    w.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2500);
  await page.click('.bar-window .span[data-h="168"]');
  await page.waitForTimeout(3000);
  const hst = await page.evaluate(() => {
    const r = __gt.passRows();
    return { name: __gt.D.entry.name, n: r.length, eye: r.map(x => x.eye), mag: r.map(x => x.mag),
             start: __gt.D.start.toISOString(), hours: String(__gt.D.hours) };
  });
  const yesN = hst.eye.filter(e => e === 'yes').length;
  console.log('\n  a visible spacecraft: ' + hst.name + ', ' + hst.n + ' passes, ' + yesN + ' naked-eye');
  const hc = parseCSV((await grab('exp-csv')).text);
  const hcol = (i, n) => hc[i+1][hc[0].indexOf(n)];
  const hBad = hst.eye.findIndex((e, i) => hcol(i, 'naked_eye') !== e
    || (e === 'yes' && !(parseFloat(hcol(i, 'est_magnitude')) <= 6)));
  chk('its naked-eye passes are exported as yes, each within the limit',
      hst.name === 'HST' && yesN > 0 && hBad === -1,
      hBad === -1 ? yesN + ' of ' + hst.n + ', brightest est. mag '
        + Math.min(...hst.mag.filter(m => m !== null)).toFixed(1) : 'pass ' + (hBad + 1));
  /* The window moved and widened, so the file has to say so: a week from a
     chosen start, not the 24 hours from now of the first export. */
  chk('...and its rows record the window it was computed over',
      hst.hours === '168' && hc.slice(1).every(r => r[hc[0].indexOf('window_start_utc')] === hst.start
        && r[hc[0].indexOf('window_span_h')] === hst.hours),
      hst.start + ' + ' + hst.hours + ' h');
  const hi = (await grab('exp-ics')).text.replace(/\r\n[ \t]/g, '');
  const hs = (hi.match(/SUMMARY:[^\r\n]*/g) || []);
  chk('...and their calendar events say naked eye, with the estimate and its source',
      hs.filter(s => /naked eye \(est\. mag -?\d+\.\d\)/.test(s)).length === yesN
      && /standard magnitude of 2\.2 \(Heavens-Above\)/.test(hi),
      (hs.find(s => /naked eye/.test(s)) || 'none').replace(/^SUMMARY:/, ''));

  /* A docked module, loaded the way a reader most often would: "ISS" and
     Enter, which takes the first match - ISS (NAUKA), not ISS (ZARYA). With
     the published figure looked up by number alone, it fell back to the
     assumed 5.0 and was exported "too faint" for the evening pass of
     2026-09-29 (12:30Z) that ISS (ZARYA) was exported "yes" for. */
  await page.fill('#satsearch', 'ISS');
  await page.waitForTimeout(600);
  await page.press('#satsearch', 'Enter');
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const w = document.getElementById('winStartIn');
    w.value = '2026-09-29T12:00';                   // the observer's time: 05:00Z
    w.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2500);
  await page.click('.bar-window .span[data-h="24"]');
  await page.waitForTimeout(2500);
  const dock = await page.evaluate(() => {
    const r = __gt.passRows();
    const i = r.findIndex(x => x.aos.toISOString().startsWith('2026-09-29T12:3'));
    return { name: __gt.D.entry.name, i, n: r.length,
             eye: i >= 0 ? r[i].eye : null, mag: i >= 0 ? r[i].mag : null };
  });
  console.log('\n  a docked module: ' + dock.name + ', ' + dock.n + ' passes');
  const dc = parseCSV((await grab('exp-csv')).text);
  const dEv = ((await grab('exp-ics')).text.replace(/\r\n[ \t]/g, '')
    .split('BEGIN:VEVENT').slice(1))[dock.i] || '';
  chk('a docked module is exported on its station\'s figure: yes for ISS (NAUKA) at 12:30Z',
      dock.name === 'ISS (NAUKA)' && dock.i >= 0 && dock.eye === 'yes'
      && dc[dock.i + 1][dc[0].indexOf('naked_eye')] === 'yes'
      && parseFloat(dc[dock.i + 1][dc[0].indexOf('est_magnitude')]) <= 6,
      dock.i >= 0 ? 'naked_eye=' + dc[dock.i + 1][dc[0].indexOf('naked_eye')]
        + ', est_magnitude=' + dc[dock.i + 1][dc[0].indexOf('est_magnitude')] : 'no 12:30Z pass');
  chk('...and its calendar event says naked eye, and whose figure it took',
      /SUMMARY:.*naked eye \(est\. mag -?\d+\.\d\)/.test(dEv)
      && /standard magnitude of -1\.8 \(Heavens-Above\\, for ISS \(ZARYA\)\\, to which it is docked\)/.test(dEv),
      ((dEv.match(/standard magnitude of [^;]*/) || ['no estimate'])[0]).replace(/\\/g, ''));

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
