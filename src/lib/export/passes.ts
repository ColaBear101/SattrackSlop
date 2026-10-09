// @ts-nocheck - verbatim; the typed surface is in the exports of this file's callers
/* Taking the answer away with you: the pass rows, the CSV and the calendar.
 *
 * Moved VERBATIM from legacy/index.html (main@4eadd7a), lines 10140-10346: isoZ, icsStamp, csvEscape, passRows,
 * exportCSV, exportICS, slug and exportStem, with their comments. What the page's closure supplied is the argument
 * of makeExports(): the analysis `D`, the observer `OBS`, the mask, the downlink in use `dopHz`, the engine's
 * range rate and Doppler, the optics, and the element set's provenance as the CSV states it (`sourceText`, from
 * source.ts). Two things differ and nothing else: the two writers return the file (text, name, type, and the hint
 * that goes under the buttons) instead of downloading it and writing the hint into the DOM, which are the
 * component's job; and the calendar's DTSTAMP clock is `stampAt`, so a test can hold it still.
 */
export function makeExports({ D, OBS, MASK, dopHz, rangeRateMs, dopplerHz, passOptical, NAKED_EYE_MAG, sourceText, stampAt = new Date() },
                            { iso, compass, latStr, lonStr }) {
  /* iso() formats for a reader - a space instead of a T, and a Z already on the
     end. Appending another produced "...33ZZ", which Date.parse answers with NaN,
     so the exports use machine forms instead. Found by parsing the files back
     rather than by looking at them, which is the only way this shows up. */
  const isoZ = d => d.toISOString();                       // RFC 3339, for the CSV
  const icsStamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  function csvEscape(v){
    const t = String(v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function passRows(){
    const out = [], f = dopHz;
    for(let i = 0; i < D.passes.length; i++){
      const p = D.passes[i];
      const o = passOptical(D.track, p);
      const rrA = rangeRateMs(D.track, p.aos.getTime());
      const rrL = rangeRateMs(D.track, p.los.getTime());
      out.push({
        n: i+1, sat: D.entry.name, norad: D.E.satnum, custom: !!D.entry.custom,
        site: OBS.name, lat: OBS.lat, lon: OBS.lon,
        aos: p.aos, los: p.los, dur: p.dur,
        maxEl: p.maxEl, maxAt: p.maxAt, maxAz: p.maxAz,
        aosAz: p.aosAz, losAz: p.losAz, minRng: p.minRng,
        rrA, rrL,
        dopA: f ? dopplerHz(f, rrA)/1000 : null,
        dopL: f ? dopplerHz(f, rrL)/1000 : null,
        freqMHz: f ? f/1e6 : null,
        eye: o ? o.eye : '',
        mag: o && o.peak ? o.peak.mag : null, magPen: !!(o && o.peak && o.peak.pen),
        std: o ? o.std : null,
        sunEl: o ? o.sunEl : null, lit: o ? o.litAtMid : '',
        clipA: !!p.clipA, clipL: !!p.clipL
      });
    }
    return out;
  }
  function exportCSV(){
    const rows = passRows();
    const head = ['pass','satellite','norad','site','site_lat_deg','site_lon_deg',
      'aos_utc','los_utc','duration_s','max_elevation_deg','culmination_utc',
      'max_azimuth_deg','aos_azimuth_deg','los_azimuth_deg','min_range_km',
      'range_rate_aos_kms','range_rate_los_kms','downlink_mhz',
      /* 'spacecraft' is its illumination at mid-pass - sun, penumbra or umbra -
         under a short name that is kept because columns are found by name. */
      'doppler_aos_khz','doppler_los_khz','naked_eye','sun_elevation_deg','spacecraft',
      /* A window-edge AOS or LOS is not a horizon crossing, and in the file it was
         indistinguishable from one. Last, so every column a reader already finds
         by name stays where it was. */
      'aos_clipped','los_clipped',
      /* The estimate naked_eye now rests on - brightest while lit against a dark
         sky, before any penumbral dimming, from the standard magnitude, published
         or assumed. After the clip flags for the same reason they went last. */
      'est_magnitude',
      /* What the table was computed from. None of it was in the file: the element
         set is replaced as soon as a newer one is published and the window opens
         at the reader's clock, so a pass table could be neither reproduced nor
         cited - the filename carried the date, and nothing else. Every row
         carries the same values, which is what survives a spreadsheet sorting or
         filtering the rows, and they are appended so no column moves.
         tle_source says where the set came from; see tleSource(). */
      'tle_epoch_utc','tle_line1','tle_line2','tle_source',
      'window_start_utc','window_span_h','mask_deg','site_alt_km'];
    const num = (v, d) => v === null || v === undefined ? '' : v.toFixed(d);
    const prov = [isoZ(D.E.epoch), D.entry.l1, D.entry.l2, sourceText,
      isoZ(D.start), D.hours, MASK, OBS.altKm];
    const body = rows.map(r => [r.n, r.custom ? r.sat + ' (custom orbit)' : r.sat, r.norad, r.site, r.lat, r.lon,
      isoZ(r.aos), isoZ(r.los), r.dur.toFixed(3), num(r.maxEl,3), isoZ(r.maxAt),
      num(r.maxAz,1), num(r.aosAz,1), num(r.losAz,1), num(r.minRng,1),
      num(r.rrA,6), num(r.rrL,6), num(r.freqMHz,3), num(r.dopA,3), num(r.dopL,3),
      r.eye, num(r.sunEl,1), r.lit, r.clipA, r.clipL, num(r.mag,2)].concat(prov)
      .map(csvEscape).join(','));
    /* A leading comment line would break every CSV reader, so the provenance goes
       in the columns above rather than a header block. The filename keeps the
       spacecraft, the site and the window's date: the part in view before the
       file is opened. */
    return { text: head.join(',') + '\r\n' + body.join('\r\n') + '\r\n',
      name: 'passes-' + exportStem() + '-' + slug(OBS.name) + '-'
        + iso(D.start).slice(0,10) + '.csv', mime: 'text/csv',
      hint: rows.length + ' pass' + (rows.length === 1 ? '' : 'es') + ' written as CSV' };
  }
  function exportICS(){
    const rows = passRows();
    /* RFC 5545 wants UTC stamps with no punctuation, and lines folded at 75
       OCTETS. Folding is not optional - Google Calendar and Outlook both reject an
       over-long line outright rather than wrapping it themselves.

       Octets, not characters, and the difference is not academic: the summary
       carries an em dash, which is one JavaScript character and three UTF-8 bytes.
       Folding on .length let a 74-character line out of the door at 76 octets.
       Iterating by code point also keeps surrogate pairs whole - splitting one
       would produce a file that is not valid UTF-8 at all. */
    const stamp = icsStamp;
    const enc = new TextEncoder();
    const fold = l => {
      if(enc.encode(l).length <= 75) return l;
      const out = [];
      let cur = '', bytes = 0;
      for(const ch of l){
        const n = enc.encode(ch).length;
        if(bytes + n > 75){ out.push(cur); cur = ' '; bytes = 1; }   // continuation
        cur += ch; bytes += n;
      }
      out.push(cur);
      return out.join('\r\n');
    };
    const esc = t => String(t).replace(/([\\,;])/g, '\\$1').replace(/\n/g, '\\n');
    const L = ['BEGIN:VCALENDAR','VERSION:2.0',
      'PRODID:-//ground track console//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',
      fold('X-WR-CALNAME:' + esc(D.entry.name + ' from ' + OBS.name))];
    const now = stamp(stampAt);
    for(const r of rows){
      /* A pass cut by the window edge still gets its event, but it says so: its
         DTSTART or DTEND is where the analysis stopped, not a rise or a set, and
         an alarm announcing an "AOS" that is really the window opening would be
         the calendar inventing one. */
      const clipped = r.clipA || r.clipL;
      const desc = [
        r.clipA ? 'Already above 5 deg when the analysis window opens: DTSTART is the'
          + ' window start, and the real AOS is earlier' : null,
        r.clipL ? 'Still above 5 deg when the analysis window closes: DTEND is the'
          + ' window end, and the real LOS is later' : null,
        'Max elevation ' + r.maxEl.toFixed(1) + ' deg ' + compass(r.maxAz)
          + ' at ' + iso(r.maxAt),
        'AOS azimuth ' + r.aosAz.toFixed(0) + ' deg, LOS azimuth ' + r.losAz.toFixed(0) + ' deg',
        'Minimum range ' + r.minRng.toFixed(0) + ' km',
        r.freqMHz ? 'Doppler ' + r.dopA.toFixed(2) + ' to ' + r.dopL.toFixed(2)
          + ' kHz at ' + r.freqMHz.toFixed(3) + ' MHz' : null,
        // both figures are the mid-pass ones, as in the page's At mid-pass row
        'Naked eye: ' + r.eye + ' (mid-pass: sun ' + r.sunEl.toFixed(0) + ' deg, spacecraft ' + r.lit + ')',
        /* The number the verdict rests on, and the assumption under it. Without
           both, a calendar entry reading "yes" would promise what the page is
           careful not to. */
        r.mag !== null ? 'Estimated magnitude ' + r.mag.toFixed(1) + ' at best'
          + (r.magPen ? ' (in penumbra, so fainter by an amount not modelled)' : '')
          + ', from ' + (r.std.known ? 'a standard magnitude of ' + r.std.mag.toFixed(1)
            + ' (Heavens-Above' + (r.std.via ? ', for ' + r.std.via + ', to which it is docked' : '') + ')'
            : 'an assumed standard magnitude of ' + r.std.mag.toFixed(1))
          + '; naked-eye limit ' + NAKED_EYE_MAG.toFixed(1) : null,
        'Site ' + r.site + ' ' + latStr(r.lat) + ' ' + lonStr(r.lon),
        'Element set epoch ' + iso(D.E.epoch),
        r.custom ? 'Hypothetical orbit planned on the Ground Track Console: not a catalogue object, and no spacecraft is known to fly it' : null
      /* Escaped per LINE, not after the join. RFC 5545 section 3.3.11 makes
         backslash, comma and semicolon special inside a TEXT value, and this
         is the one TEXT value on the event that skipped the escaper that
         SUMMARY, LOCATION and the alarm all use - while being the one that
         interpolates the observer's name, which since the place picker can
         be anything Open-Meteo returns. A site called "Bangkok, Thailand"
         emitted a bare comma and importers read the rest of the line as a
         second value.
         After the join would be wrong: the separator below is a literal
         backslash-n, which is how ICS spells a line break inside a value,
         and escaping it would turn every line break into the characters. */
      ].filter(Boolean).map(esc).join('\\n');
      L.push('BEGIN:VEVENT',
        fold('UID:' + r.norad + '-' + r.aos.getTime() + '@ground-track'),
        'DTSTAMP:' + now, 'DTSTART:' + stamp(r.aos), 'DTEND:' + stamp(r.los));
      if(clipped) L.push('X-GT-CLIPPED:' + [r.clipA ? 'AOS' : '', r.clipL ? 'LOS' : '']
        .filter(Boolean).join(','));
      L.push(
        fold('SUMMARY:' + esc((r.custom ? '[custom orbit] ' : '') + r.sat + ' \u2014 ' + r.maxEl.toFixed(0) + '\u00b0 '
          + compass(r.maxAz) + (r.eye === 'yes' ? ' \u2014 naked eye (est. mag ' + r.mag.toFixed(1) + ')' : '')
          + (clipped ? ' \u2014 window-clipped' : ''))),
        fold('DESCRIPTION:' + desc),
        fold('LOCATION:' + esc(r.site)),
        'BEGIN:VALARM','TRIGGER:-PT10M','ACTION:DISPLAY',
        fold('DESCRIPTION:' + esc(r.sat + (r.clipA
          ? ' already up when the window opens, in 10 minutes' : ' AOS in 10 minutes'))),
        'END:VALARM','END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return { text: L.join('\r\n') + '\r\n',
      name: 'passes-' + exportStem() + '-' + slug(OBS.name) + '.ics', mime: 'text/calendar',
      hint: rows.length + ' pass' + (rows.length === 1 ? '' : 'es') + ' written as a calendar' };
  }
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  /* The spacecraft part of an export's file name. A planned orbit says so ("passes-custom-..."), and a
     name with no Latin letter or digit slugs to '' (passes--bangkok-... would break every reader that
     expects a word there), so the stem falls back to "orbit". */
  const exportStem = () => D.entry.custom ? 'custom-' + (slug(D.entry.name) || 'orbit') : slug(D.entry.name);

  return { passRows, exportCSV, exportICS, csvEscape, slug, exportStem, isoZ, icsStamp };
}
