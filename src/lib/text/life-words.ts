// @ts-nocheck - verbatim; the typed surface is in ../text/life.ts
/* What the Decay section says: the backtest's accuracy words, the durations, why there is no history, and the verdict for the
 * history that arrived.
 *
 * Moved VERBATIM from legacy/index.html (main@4eadd7a): lifeAccuracy and lifeFmtDays (lines 11612-11652), lifeHours, lifeSpan
 * and lifeAxis (11700-11705), lifeWhyNot (11764-11793) and paintLife (11823-11970), with their comments and every word. What the
 * page's closure supplied is the arguments of makeLifeWords(): the Lifetime module's constants, and the date formatters.
 * paintLife wrote its verdict into the page (#lifebig, #lifesub, #lifenote, #lifespan, #lifealt, #liferate, #lifehist); here
 * lifeSet() and the field assignments capture it and paintLife returns it, with the clock as its third argument. The chart is
 * drawn by a component, so drawLife is a no-op. The notes are strings of the old page's inline markup (<b>, <br>, entities),
 * read into data by text/markup.ts; nothing else about them is changed.
 */
export function makeLifeWords({ Lifetime, iso, ymd }) {
  let view = null, fields = {};
  const lifeSet = (big, sub, note, spanTxt) => { view = { big, sub: sub || '', note: note || '', span: spanTxt || '' }; };
  const drawLife = () => {};

  /* What the backtest actually measured, at the horizon being shown. Objects that
     really re-entered, history truncated at a fixed lead time, prediction compared
     with the recorded decay date. The bias is one-sided and grows with range, so
     quoting a single "+/- some days" for every forecast would be a fiction.
     Where the bias has a direction, the date moved by it is given as a month:
     the headline stays the model's own figure, which the README quotes, and a
     month is as fine as a median from one fortnight of re-entries will bear.
     The median is the one measured at the nearest horizon the backtest has, and
     it is applied across the band around it - a 135-day forecast is moved by the
     180-day figure - so the note names that horizon rather than implying the
     shift was measured at this exact range. */
  const LIFE_MONTHS = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  function lifeAccuracy(days, date){
    const caveat = ' Every object in that check re-entered within the same fortnight, ' +
      'so they all met the same solar weather — the spread understates how wrong ' +
      'this can be in a different phase of the cycle.';
    const moved = d => { const m = new Date(date.getTime() + d*86400000);
      return LIFE_MONTHS[m.getUTCMonth()] + ' ' + m.getUTCFullYear(); };
    if(days <= 130)
      return 'Backtested against objects that really re-entered, a forecast at this range ' +
        'ran <b>within about three weeks</b> of the truth (median −20 to +12 d).' + caveat;
    if(days <= 220)
      return 'Backtested against objects that really re-entered, a forecast at this range ran ' +
        '<b>about two months early</b> (median −63 d at a 180-day horizon). The real date is ' +
        'more likely after this one than before it: moved by that median, the one measured at the ' +
        'nearest horizon the backtest has, it falls in <b>' + moved(63) + '</b>.' + caveat;
    if(days <= 330)
      return 'Backtested at this range the method ran <b>about five months early</b> ' +
        '(median −144 d at a 270-day horizon), so read this as a lower bound rather than ' +
        'a date — moved by that median, measured at the nearest horizon the backtest has, <b>' +
        moved(144) + '</b>.' + caveat;
    return 'Beyond a year this is <b>not a forecast</b>. The backtest at a 365-day horizon ' +
      'scattered by half a year either way, because it depends on solar activity that ' +
      'nobody can predict that far out.' + caveat;
  }
  function lifeFmtDays(d){
    if(d < 60) return d.toFixed(0) + ' days';
    if(d < 400) return (d/30.44).toFixed(1) + ' months';
    return (d/365.25).toFixed(1) + ' years';
  }

  const lifeHours = d => { const h = Math.max(1, Math.round(d*24)); return h + (h === 1 ? ' hour' : ' hours'); };
  /* a span of time, never a date: hours under two days, then the page's own days/months/years */
  const lifeSpan = d => d === Infinity ? 'more than a century' : d < 2 ? lifeHours(d) : lifeFmtDays(d);
  /* the Decay chart's x axis: days after the epoch, "+4 h", "+30 d", "+2.7 y" */
  const lifeAxis = d => d < 2 ? Math.max(1, Math.round(d*24)) + ' h' : d < 120 ? Math.round(d) + ' d'
    : (d/365.25 < 10 ? (d/365.25).toFixed(1) : String(Math.round(d/365.25))) + ' y';

  /* Why there is no history to fit, in the words of what actually happened. One
     sentence - "returned no element-set history, or it could not be reached in
     time" - used to cover every case, including a history that arrived whole and
     was thrown away: XMM-NEWTON's 779 element sets came back in a second and
     were all above the old 60,000 km ceiling. A failed request is worth trying
     again; an answer is not, so only the first kind gets the button. */
  function lifeWhyNot(entry, got){
    const id = 'NORAD ' + entry.satnum;
    const why = got ? got.why : 'unreachable';
    if(why === 'timeout')
      return ['Not received', 'CelesTrak did not answer for ' + id + ' within 75 seconds. Its history ' +
        'endpoint rebuilds the record on every request and is sometimes slower than that. Nothing ' +
        'arrived to extrapolate from.', true];
    if(why === 'http')
      return ['Not received', 'CelesTrak answered the request for ' + id + ' with HTTP ' + got.status +
        ', an error rather than a history. Nothing arrived to extrapolate from.', true];
    if(why === 'unreadable')
      return ['Not received', 'CelesTrak answered for ' + id + ', but not with the page of element-set ' +
        'history this reads. Nothing to extrapolate from.', true];
    if(why === 'empty')
      return ['No history', 'CelesTrak answered, and holds no element-set history for ' + id +
        '. Nothing to extrapolate from.', false];
    if(why === 'outside')
      return ['Out of range', 'CelesTrak returned <b>' + got.rows + '</b> element sets for ' + id +
        ', and none has a mean altitude between ' + Lifetime.SMA_MIN + ' km and ' +
        Lifetime.SMA_MAX.toLocaleString('en-US') + ' km, the range this estimate reads. The history ' +
        'arrived; there is nothing in it to fit.', false];
    return ['Not received', 'CelesTrak could not be reached for ' + id + ' — offline, blocked, or ' +
      'refusing the request. Nothing arrived to extrapolate from.', true];
  }

  function paintLife(r, P, now){
    const span = r.span ? r.span.toFixed(0) + ' days of element sets, ' + r.n + ' of them' : '';
    fields.span = span;
    if(r.hNow !== undefined){
      fields.alt = r.hNow.toFixed(1) + ' km';
      fields.rate =
        (r.rate ? (r.rate > 0 ? '+' : '') + r.rate.toFixed(3) + ' km/day' : '—');
      fields.hist =
        iso(new Date(P[0].t)).slice(0,10) + ' → ' + iso(new Date(P[P.length-1].t)).slice(0,10);
    }
    if(r.verdict === 'thin'){
      lifeSet('Too little history', '',
        'Only ' + r.n + ' element sets' + (r.span ? ' over ' + r.span.toFixed(0) + ' days' : '') +
        '. A decay fit needs a couple of months of record to separate the trend from TLE scatter.', span);
      drawLife(); return;
    }
    /* Refused by lifetime.js above e = 0.02, where drag acts at perigee rather
       than at the mean altitude the model integrates. Three cases, by where that
       perigee is: already under the re-entry line, above the top of the model's
       atmosphere, or in between - where a date would be a circular-orbit answer
       to an eccentric question.

       And two, by how far out the apogee reaches (Lifetime.HA_DRAG). Every
       eccentric orbit in between was told it "comes down apogee first, with
       perigee holding nearly still", which is drag's doing and true only where
       drag is what shapes the orbit: ARKTIKA-M 1, perigee 789 km and apogee
       39,572 km, read it too, and a Molniya orbit's perigee is the Moon's and the
       Sun's to move. Above 1,000 km the same thing held in reverse - "what moves
       a perigee this high is the Moon and the Sun" went to orbits too small for
       them to move it much.

       The e beside the perigee is that element set's own; the eccentricity the
       refusal quotes is the 45-day median it was made on, which for an orbit
       rounding out can be above the cap while the latest set is under it. */
    if(r.verdict === 'eccentric'){
      const km = x => Math.round(x).toLocaleString('en-US');
      /* Within 0.001 of the cap three decimals can print a median above it and
         a latest set under it as the same "0.020"; a fourth tells them apart. */
      const cap = Lifetime.ECC_MAX, eFix = x => x.toFixed(Math.abs(x - cap) < 0.001 ? 4 : 3);
      const e = eFix(r.ecc);
      const pg = r.hp < 0 ? 'perigee below the surface' : 'perigee ' + km(r.hp) + ' km';
      const far = r.ha >= Lifetime.HA_DRAG;
      const moon = 'the Moon and the Sun pull on an orbit that reaches this far, and walk its ' +
        'perigee up or down by more the farther out it goes — on the highest orbits by hundreds of ' +
        'kilometres in months, which is how a dead one usually comes down.';
      if(r.hp <= Lifetime.FLOOR){
        lifeSet('Re-entering', pg + ' · e ' + e,
          'The latest element sets put perigee <b>' + (r.hp < 0 ? km(-r.hp) + ' km below the surface'
            : 'at ' + km(r.hp) + ' km') + '</b>, under the ' + Lifetime.FLOOR + ' km line this page ' +
          'calls re-entry. An eccentric orbit comes down at perigee, and one reaching that deep does ' +
          'not come round many more times; it may already have come down. The drag model here is for ' +
          'near-circular orbits and has nothing to add, so no date is offered.', span);
      } else if(r.hp > 1000){
        lifeSet('No drag decay', pg + ' · e ' + e,
          'This orbit is eccentric, and drag acts at perigee: <b>' + km(r.hp) + ' km</b> up, above the ' +
          'top of the atmosphere this model knows, which ends at 1,000 km. The mean altitude on the ' +
          'chart is not being pulled down by air, and no re-entry date is offered. ' + (far
            ? 'With apogee at <b>' + km(r.ha) + ' km</b>, ' + moon + ' A drag model does not see them.'
            : 'What air there is at this height takes centuries or longer to bring an orbit down.'), span);
      } else {
        const med = eFix(r.eccMed);
        lifeSet('Eccentric orbit', pg + ' · e ' + e,
          'Drag acts at perigee, <b>' + km(r.hp) + ' km</b> up, not at the <b>' + km(r.hNow) +
          ' km</b> mean altitude on the chart. This estimate is for near-circular orbits: it applies ' +
          'drag at the mean altitude, so at an eccentricity of <b>' + med + '</b>, the median over the ' +
          'last 45 days, it would be timing the wrong height, and above ' + cap + ' no date is offered.' +
          (r.ecc <= cap ? ' The latest sets are down to e <b>' + e + '</b>, under that line, but the ' +
            'test reads the median so that no one element set can flip it.' : '') + ' ' + (far
            ? 'With apogee at <b>' + km(r.ha) + ' km</b>, drag is not all that moves this perigee: ' +
              moon + ' A drag model does not see them, and this page models nothing else.'
            : 'With apogee at <b>' + km(r.ha) + ' km</b>, drag is what shapes this orbit: it comes ' +
              'down apogee first, with perigee holding nearly still until the orbit is close to ' +
              'circular. Forecasting that needs an integration on perigee height, which this page ' +
              'does not do.'), span);
      }
      drawLife(); return;
    }
    if(r.verdict === 'maneuvered'){
      lifeSet('Not drag-limited', 'orbit is being raised',
        'This orbit has climbed by up to <b>' + r.rise.toFixed(1) + ' km</b> inside a fortnight, so ' +
        'something is thrusting. Re-entry is then a decision, not a physical deadline, and any date ' +
        'from a drag model would be fiction.', span);
      drawLife(); return;
    }
    if(r.verdict === 'stable'){
      lifeSet('No measurable decay', (r.hNow > 1500 ? 'too high for drag to matter' : 'station-kept or near-stable'),
        'Mean altitude is changing by <b>' + Math.abs(r.rate).toFixed(3) + ' km/day</b>, which is ' +
        'not a decay signal. At this altitude drag is negligible against station-keeping and ' +
        'measurement scatter, so no re-entry date is offered.', span);
      drawLife(); return;
    }
    if(r.verdict === 'slow' || r.days === null){
      lifeSet('Beyond a century', '',
        'Decaying at <b>' + Math.abs(r.rate).toFixed(3) + ' km/day</b>, but from ' +
        r.hNow.toFixed(0) + ' km that is centuries of falling. The forecast is not meaningful ' +
        'that far out — solar activity over such a span is unknowable.', span);
      drawLife(); return;
    }

    const date = new Date(r.tNow + r.days*86400000);
    const day = x => ymd(new Date(r.tNow + x*86400000));
    /* A forecast already in the past. CelesTrak stops publishing element sets
       for an object once it is down, so a record that ends before its own
       forecast date is the record of one that has most likely come down.
       ICEYE-X34's panel read "2026-09-14 - 0 days from the last element set"
       eleven days after that date, with the three-weeks-of-the-truth blurb
       under it. The accuracy is left out: the backtest measured forecasts of
       dates still to come. */
    const past = now - date.getTime();
    if(past > 0){
      const nd = Math.floor(past/86400000);
      lifeSet('Probably re-entered',
        'forecast ' + ymd(date) + ', ' + (nd < 1 ? 'less than a day' : nd < 60
          ? nd + (nd === 1 ? ' day' : ' days') : lifeFmtDays(past/86400000)) + ' ago',
        'Run from the last element set CelesTrak holds, dated <b>' + ymd(new Date(r.tNow)) +
        '</b> at <b>' + r.hNow.toFixed(1) + ' km</b>, the model brings this object down on <b>' +
        ymd(date) + '</b>, a date already past. CelesTrak publishes no element sets for an object ' +
        'once it has come down, so a record that ends before its own forecast most likely belongs ' +
        'to one that has. The decay date in the SATCAT, once recorded, is the one to quote.', span);
      drawLife(); return;
    }
    /* The two models are named, not called a bracket. The shading between them
       is how far they disagree, which says nothing about where the truth is: at
       a 180-day range the backtest put it about two months past the headline. */
    const both = (r.simple !== null && r.trend !== null);
    lifeSet(ymd(date),
      lifeFmtDays(r.days) + ' from the last element set',
      (both
        ? 'The two models give <b>' + day(r.simple) + '</b> with the atmosphere held still and <b>' +
          day(r.trend) + '</b> with a density trend fitted to the record; the headline is the ' +
          'second, and the shading between them on the chart is how far they disagree, not an ' +
          'error bar. '
        : '') +
      (r.trend !== null
        ? 'The trend is <b>' + (r.g*100).toFixed(2) +
          '%/day</b> — the atmosphere is ' + (r.g < 0 ? 'thinning' : 'thickening') +
          (r.g < 0 ? ', halving' : ', doubling') + ' every ' + (Math.log(2)/Math.abs(r.g)).toFixed(0) +
          ' days at that rate — ' +
          'and matches the observed curve to <b>' + r.rms.toFixed(1) + ' km</b> rms. '
        : r.g !== null
          ? 'A density trend was fitted to the record, but its projection does not come down ' +
            'within the model’s horizon, so the headline holds the atmosphere still. '
          : 'Too little history to fit a solar trend, so the atmosphere is assumed to stand still. ') +
      lifeAccuracy(r.days, date),
      span);
    drawLife();
  }


  /** The verdict for a history: what the headline, the sub-line, the note and the span say, and the three figures. */
  function lifePaint(r, P, now) {
    view = null; fields = {};
    paintLife(r, P, now);
    return { view, fields };
  }

  return { lifeAccuracy, lifeFmtDays, lifeHours, lifeSpan, lifeAxis, lifeWhyNot, lifePaint };
}
