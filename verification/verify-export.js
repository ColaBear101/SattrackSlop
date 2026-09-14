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
             aos: r.map(x => x.aos.getTime()), maxEl: r.map(x => x.maxEl) };
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
       'naked_eye','site_lat_deg'].every(n => idx(n) >= 0),
      h.length + ' columns');

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

  const uids = (unfolded.match(/UID:(\S+)/g) || []);
  chk('every event has a unique UID, so a re-import updates rather than duplicates',
      new Set(uids).size === uids.length && uids.length === expected.n,
      uids.length + ' UIDs, ' + new Set(uids).size + ' distinct');

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASS'));
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
