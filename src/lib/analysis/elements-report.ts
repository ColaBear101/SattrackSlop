// @ts-nocheck - verbatim; the typed surface is ElementsReport in ../types.ts
/* The orbital-elements section: the six element cards with their notes, the osculating elements and their note, the
 * derived values and theirs, and the rail's four-figure summary.
 *
 * Moved VERBATIM from legacy/index.html (main@4eadd7a), lines 8962-9243: osculating() and renderElements(), with every
 * comment and every word. What the page's closure supplied is the arguments of makeElementsReport(); the analysis the
 * function reads is its argument. The only changes are the five places that wrote the result into the DOM (#elgrid,
 * #osc and #oscnote, #derived, #dnote, #minigrid): they return the same rows, notes and cells instead, and the B* unit's
 * <abbr> is the abbr node of src/lib/text/rich.ts. No number is computed differently and no sentence is reworded.
 */
export function makeElementsReport({ SGP4_MU, DEG, RAD, iso, spanLabel, abbr }) {
  /* ---- (a) render elements ------------------------------------------------- */
  /* Osculating elements: the two-body orbit through SGP4's own r and v at one
     instant, on SGP4's mu. They are not what the TLE holds. The TLE's are MEAN
     elements, with SGP4's periodic terms averaged out, and mean nothing to
     anything but SGP4; these are what converting the state vector gives. The
     two differ by far more than the Kozai and Brouwer a do - for KNACKSAT-2's
     README set, 6 km in a and 70 deg in omega at the epoch. Degrees. u, the
     argument of latitude, is measured from the node rather than from perigee,
     so it survives a near-circular orbit where omega and nu separately do not.
     Built from atan2 throughout: acos of a dot product loses its sign and its
     precision exactly where e and i are small, which is most of this catalogue. */
  function osculating(track, ms){
    const st = track.at(ms);
    if(!st) return null;
    const r = st.r, v = st.v, mu = SGP4_MU;
    const rr = Math.hypot(r.x, r.y, r.z), v2 = v.x*v.x + v.y*v.y + v.z*v.z;
    const rv = r.x*v.x + r.y*v.y + r.z*v.z;
    const h = {x: r.y*v.z - r.z*v.y, y: r.z*v.x - r.x*v.z, z: r.x*v.y - r.y*v.x};
    const hh = Math.hypot(h.x, h.y, h.z);
    const ev = {x: ((v2 - mu/rr)*r.x - rv*v.x)/mu,
                y: ((v2 - mu/rr)*r.y - rv*v.y)/mu,
                z: ((v2 - mu/rr)*r.z - rv*v.z)/mu};
    // unit vectors in the plane: towards the ascending node, and 90 deg on from it
    const nh = Math.hypot(h.x, h.y) || 1e-300;
    const N = {x: -h.y/nh, y: h.x/nh, z: 0};
    const Q = {x: (h.y*N.z - h.z*N.y)/hh, y: (h.z*N.x - h.x*N.z)/hh, z: (h.x*N.y - h.y*N.x)/hh};
    const dot = (p, q) => p.x*q.x + p.y*q.y + p.z*q.z;
    const deg = (y, x) => ((Math.atan2(y, x)*DEG) % 360 + 360) % 360;
    const u = deg(dot(Q, r), dot(N, r)), w = deg(dot(Q, ev), dot(N, ev));
    return { a: 1/(2/rr - v2/mu), e: Math.hypot(ev.x, ev.y, ev.z),
             inc: Math.atan2(nh, h.z)*DEG, raan: deg(N.y, N.x),
             argp: w, nu: ((u - w) % 360 + 360) % 360, u };
  }

  function elementsReport(D){
    const E = D.E;
    const sunSync = E.inc > 95 && E.inc < 104;
    const osc = osculating(D.track, E.epoch.getTime());
    const nearCirc = E.ecc < 0.002;
    /* ...and near the equator in deep space the node is as ill-defined as the
       perigee, so the phase that survives is the longitude, measured from the
       equinox. It is the test compute() uses to stop timing the node, and for
       the same reason: at LEO the node stays definite even at i = 0.23 deg
       (IXPE's mean and osculating RAAN agree to 0.02 deg), so a plain i < 1
       would call a node barely defined that the period beside it relies on. */
    const nearEq = !!E.planeUnclear;
    /* The apsis search runs over E.period. That is one revolution wherever the
       node-to-node time is the period shown, and for a near-equatorial GEO
       object it is not: ASTRA 2G's first node-to-node interval from its epoch
       is 724 min, about half a revolution. A swing sampled over half an orbit is
       not set against 2ae over a whole one as if the two were comparable.
       Whether it is one revolution is judged on the fraction the note under the
       derived values prints, so the two cannot disagree: at |f - 1| < 0.01 the
       e card said "over a revolution" beside a note printing 1.01. */
    const spanRevs = E.period/E.periodShown, oneRev = spanRevs.toFixed(2) === '1.00';
    const over = oneRev ? 'over a revolution'
      : 'over the '+(E.period/60).toFixed(0)+' min sampled ('+spanRevs.toFixed(2)+' of a revolution)';
    // an angle in [0, 360) at dp places - 359.998 must print as 0.00, not 360.00
    const ang = (x, dp) => { const v = ((x % 360) + 360) % 360;
      return (+v.toFixed(dp) >= 360 ? 0 : v).toFixed(dp); };
    /* What the altitude swing is made of. The orbit radius and the ground under
       it both move, and on a near-circular LEO orbit the second is the size of
       the first: the WGS-84 surface is 13 km lower at 51.6 deg than at the
       equator. The two add by phase, not simply, so they are given separately. */
    const swingNote = () => {
      const swing = E.apogeeAlt - E.perigeeAlt;
      if(!E.altMeasured) return 'Effectively circular: a(1∓e) puts perigee and apogee '+swing.toFixed(1)+' km apart.';
      const rs = E.rMax - E.rMin, ss = E.surfMax - E.surfMin, ae2 = 2*E.a*E.ecc;
      return 'Effectively circular. Altitude still swings '+swing.toFixed(1)+' km '+over+'. '+
        'The orbit radius varies '+rs.toFixed(1)+' km ('+(oneRev ? '2ae alone gives ' : '2ae over a whole revolution is ')+ae2.toFixed(1)+
        (oneRev && Math.abs(rs - ae2) >= 0.1 ? '; the difference is SGP4\'s periodic terms)' : ')')+
        (ss >= 0.1 ? ', and the WGS-84 surface beneath the track is '+ss.toFixed(1)+
          ' km lower at its highest latitude than at the equator. The two combine by phase, so the swing is at most their sum.' : '.');
    };
    /* How far the ground track reaches, and why that is not i. Read off the
       track itself, but only when the window holds a whole revolution: a shorter
       one holds an arc - MMS 1's period is 85 h, and a 24 h window of it reached
       ±11.5 deg of a 74 deg orbit - and the top of an arc says nothing about the
       orbit's. Two things separate the reach from i, and both are measured on
       the same samples rather than assumed. The orbit plane bounds GEOCENTRIC
       latitude, and the map is geodetic, which runs higher: 0.18 deg at 51.6 deg
       and 370 km, next to nothing at GEO. And the plane is not tilted at the
       mean i - which is the mean AT THE EPOCH - for two reasons. SGP4's periodic
       terms, which a mean element averages out, put it 0.02 deg off at LEO and
       about 1 deg off for MMS 1; at its epoch ASTRA 2G's plane sat at 0.001 deg
       against a mean 0.024. And in deep space SGP4 moves the mean inclination
       itself at a steady rate under the Moon's and Sun's pull (inclm = inclo +
       didt t), which near the equator soon outweighs the periodic terms: GOES
       18's mean went from 0.035 deg at its epoch to 0.007 deg 14.9 days on,
       where its plane peaked at 0.008. This card used to credit that whole gap
       to periodic terms. So where SGP4 drifts the mean, the mean in force when
       the track peaks is worked out from SGP4's own rate, and the periodic terms
       get only what is left. For an arc, the plane's tilt is geocentric and the
       arc's top geodetic, and both are labelled so: QZS-1R's arc at 6 h can top
       the tilt by the geodetic offset alone. */
    const reach = () => {
      const fold = x => Math.min(90, x > 90 ? 180 - x : x);
      const lim = fold(E.inc), iName = E.inc > 90 ? '180° − i' : 'i';
      const dp = lim < 0.1 ? 3 : lim < 1 ? 2 : 1, tol = 0.5/Math.pow(10, dp);
      const deg = x => x.toFixed(dp)+'°';
      const body = D.track.body, e2 = body.flattening*(2 - body.flattening);
      let ml = 0, mc = 0;                   // geodetic and geocentric, same samples
      let tPeak = D.start.getTime();        // when the geocentric one peaks
      for(const p of D.pts){
        const b = Math.abs(p.lat)*RAD, s = Math.sin(b), c = Math.cos(b);
        const Nv = body.Re/Math.sqrt(1 - e2*s*s);
        const g = Math.atan2((Nv*(1 - e2) + p.alt)*s, (Nv + p.alt)*c)*DEG;
        if(Math.abs(p.lat) > ml) ml = Math.abs(p.lat);
        if(g > mc){ mc = g; tPeak = p.t.getTime(); }
      }
      const revs = D.hours*3600/E.periodShown;
      if(revs < 1){
        /* A period a few minutes over the window's length printed "holds 1.00 of
           a revolution (24.0 h)" in a 24 h window and was then treated as an
           arc; it is said as what it is. */
        const o = osculating(D.track, D.start.getTime()), tilt = o ? fold(o.inc) : lim;
        return 'Over a whole revolution the track would reach about ±'+deg(tilt)+
          (o ? ' geocentric latitude, the orbit plane\'s osculating tilt at the window start'
             : ' latitude, the mean '+iName)+'. This '+spanLabel(D.hours)+' window '+
          (revs.toFixed(2) === '1.00'
            ? 'is just short of one revolution ('+(E.periodShown/60).toFixed(1)+' min)'
            : 'holds '+revs.toFixed(2)+' of a revolution ('+(E.periodShown/3600).toFixed(1)+' h)')+
          ', and the track drawn in it gets to ±'+deg(ml)+' geodetic'+
          // judged on the printed figures, so that the sentence agrees with itself
          (deg(mc) !== deg(ml) ? ', ±'+deg(mc)+' geocentric' : '')+
          // geocentric latitude never exceeds the tilt of the plane at that instant
          (o && +mc.toFixed(dp) > +tilt.toFixed(dp) ? ', so the plane tilts further as the window runs' : '')+'.';
      }
      /* The plane, the mean and the gap between them are each printed rounded,
         so the tests are made on the printed figures too: "0.35°, not the mean
         0.35°", or a gap of 0.01° between two figures that print the same, is
         the sentence disagreeing with itself. The gap is counted in units of the
         last printed digit, which keeps float noise out of it. */
      const why = [], more = [], unit = Math.pow(10, dp);
      if(deg(mc) !== deg(lim)){
        const sr = D.track.raw;
        const days = (tPeak - E.epoch.getTime())/86400000;
        const mNow = sr && sr.method === 'd' && isFinite(sr.didt) && isFinite(sr.inclo)
          ? fold(Math.abs(sr.inclo + sr.didt*days*1440)*DEG) : lim;
        if(deg(mNow) === deg(lim))
          why.push('in this window the orbit plane is tilted at most '+deg(mc)+', not the mean '+deg(lim)+
            ' — a mean inclination averages out SGP4\'s periodic terms'+(E.deepSpace ? ', the Moon\'s and Sun\'s among them' : ''));
        else {
          const gap = Math.round((+mc.toFixed(dp) - +mNow.toFixed(dp))*unit);
          why.push('in this window the orbit plane is tilted at most '+deg(mc)+', not the mean '+deg(lim));
          /* Retrograde, the figures are 180° − i, as everywhere else on the
             card, and the mean itself is said too so that neither reads as the
             other. */
          more.push('That i is the mean at the epoch, and SGP4 moves the mean inclination at a steady rate under the Moon\'s and Sun\'s pull: '+
            'where the track peaks, '+Math.abs(days).toFixed(1)+' days '+(days < 0 ? 'before' : 'after')+' the epoch, it is '+
            (E.inc > 90 ? deg(180 - mNow)+', so 180° − i is '+deg(mNow) : deg(mNow))+
            (gap
              ? ', and SGP4\'s periodic terms put the plane '+(Math.abs(gap)/unit).toFixed(dp)+'° '+(gap > 0 ? 'above' : 'below')+' that.'
              : ', so that drift is the whole of the difference.'));
        }
      }
      if(ml - mc >= tol)
        why.push('the plane bounds geocentric latitude, and geodetic runs '+(ml - mc).toFixed(Math.max(2, dp))+'° higher');
      const d = ml - lim, said = Math.abs(d) >= tol && why.length > 0;
      return 'Ground track reaches ±'+deg(ml)+' geodetic latitude'+
        (said ? ', '+Math.abs(d).toFixed(dp)+'° '+(d > 0 ? 'past ' : 'short of ')+iName+': '+why.join('; ')+'.' : '.')+
        (said && more.length ? ' '+more.join(' ') : '');
    };
    const dA = E.aNaive - E.a;
    const cells = [
      ['a','Semi-major axis', E.a.toFixed(1), 'km',
        E.aSource === 'sgp4'
          ? 'Recovered by SGP4 from the Kozai mean motion; the two-body (μ/n²)^⅓ gives '+E.aNaive.toFixed(1)+
            ', '+Math.abs(dA).toFixed(2)+' km '+(dA < 0 ? 'short' : 'long')+
            '. Half the major axis — not a mean radius, which is a(1+e²/2).'
          : 'From the mean motion as (μ/n²)^⅓.',
        E.aSource === 'sgp4' ? 'SGP4 Brouwer mean value, WGS-72' : 'derived from line 2 cols 53–63 (n)'],
      ['e','Eccentricity', E.ecc.toFixed(7), '',
        (nearCirc ? swingNote()
          : 'Altitude runs '+E.perigeeAlt.toFixed(0)+' to '+E.apogeeAlt.toFixed(0)+' km'+(oneRev ? '.' : ' '+over+'.')),
        'line 2 cols 27–33, leading decimal implied'],
      ['i','Inclination', E.inc.toFixed(4), '°',
        (E.inc>90?'Retrograde. ':'Prograde. ')+(sunSync?'Sun-synchronous — the node drifts ~0.986°/day to hold a fixed local solar time.':reach()),
        'line 2 cols 9–16'],
      ['Ω','RAAN', E.raan.toFixed(4), '°',
        'Where the orbit plane cuts the equator going north, measured from the vernal equinox.'+
        (nearEq && osc ? ' At i this small the node is itself barely defined; the osculating Ω at epoch is '+
          ang(osc.raan, 1)+'°.' : ''),
        'line 2 cols 18–25'],
      ['ω','Argument of perigee', E.argp.toFixed(4), '°',
        'Perigee position measured within the orbit plane from the ascending node.'+
        (nearCirc && osc ? ' A mean-element perigee: at this e it is barely defined, and the osculating ω at epoch is '+
          ang(osc.argp, 1)+'°.' : ''),
        'line 2 cols 35–42'],
      ['M','Mean anomaly', E.ma.toFixed(4), '°',
        'Phase around the orbit at the epoch instant — the anchor the propagation starts from.'+
        (nearCirc && nearEq ? ' Read it with ω and Ω: at this e and i only the sum of all three, the mean longitude, is well defined — '+
          ang(E.raan + E.argp + E.ma, 2)+'°.'
         : nearCirc ? ' Read it with ω: their sum, the mean argument of latitude, is '+
          ang(E.argp + E.ma, 2)+'° and is well defined.' : ''),
        'line 2 cols 44–51']
    ];

    /* The same orbit at the same instant, as the state vector says it is. */
    let ov = [], oscNoteText = '';
    {
      /* The phases that are not on the cards above carry their names: in the
         serif italic, and in the sans of the note, ν is hard to tell from a
         Latin v, and on a page that also deals in velocities it gets read as one. */
      ov = osc ? [
        ['a', osc.a.toFixed(1)+' km'], ['e', osc.e.toFixed(7)], ['i', osc.inc.toFixed(4)+'°'],
        ['Ω', ang(osc.raan, 4)+'°'], ['ω', ang(osc.argp, 2)+'°'], ['ν', ang(osc.nu, 2)+'°', 'true anomaly'],
        nearEq ? ['l = Ω + ω + ν', ang(osc.raan + osc.u, 2)+'°', 'true longitude']
               : ['u = ω + ν', ang(osc.u, 2)+'°', 'argument of latitude']
      ] : [];
      oscNoteText = !osc ? 'SGP4 gives no state at the epoch for this element set.'
        : 'The two-body orbit through SGP4\'s position and velocity at the epoch, on its own μ = 398 600.8 km³/s². '+
          'These are not the TLE\'s elements: the mean elements above have SGP4\'s periodic terms averaged out'+
          (isFinite(E.oscAMax) ? ', and the osculating a alone moves '+(E.oscAMax - E.oscAMin).toFixed(1)+' km over '+
            (oneRev ? 'a revolution' : 'the '+(E.period/60).toFixed(0)+' min sampled') : '')+
          '.'+(!nearCirc ? ''
            : nearEq ? ' At e and i this small Ω, ω and the true anomaly ν are each poorly defined; l, the true longitude, is the phase to trust.'
            : ' At e this small ω and the true anomaly ν are each poorly defined; u, the argument of latitude, measured from the node, is the phase to trust.');
    }

    const P = E.periodShown;
    const dv = [
      ['Mean motion', D.E.n.toFixed(8)+' rev/day'],
      [E.periodKind === 'nodal' ? 'Nodal period' : 'Kepler period', (P/60).toFixed(2)+' min'],
      ['Mean altitude', D.meanAlt.toFixed(1)+' km'],
      ['Min altitude', D.E.perigeeAlt.toFixed(1)+' km'],
      ['Max altitude', D.E.apogeeAlt.toFixed(1)+' km'],
      ['Revs in 24 h', (86400/P).toFixed(2)],
      ['B* drag term', [D.E.bstar.toExponential(4)+' ', abbr({text: '1/ER', title: 'per Earth radius, the unit SGP4 carries B* in'})]],
      /* A planned orbit has no revolution count: the field is 00000 in its synthetic TLE, and
         "Rev. no. @ epoch 0" is a figure with a meaning it does not have. DOM text only;
         compute() and elements() are not touched, so the regression gate cannot see it. */
      ['Rev. no. @ epoch', D.entry.custom ? 'n/a (planned)' : String(D.E.rev)]
    ];
    /* Say what these are measured over. They were headed "at epoch", and they
       are not: the period and the apsis search run from the start of the
       window, which defaults to now, and the mean altitude is over the whole
       window. Measuring them from the epoch instead would move every number the
       regression gate compares, so the label moves instead. Where the period
       shown is Keplerian the apsis search still runs over E.period - one
       node-to-node interval, which for a near-equatorial GEO object can be
       half a revolution or more than one - so the note says how long it was
       rather than calling it a revolution. */
    let dnoteText = '';
    {
      dnoteText = ((E.periodKind === 'nodal'
          ? 'The period and the min and max altitude are propagated over the first revolution from the window start, '+iso(D.start)
          : 'The min and max altitude are propagated from the window start, '+iso(D.start)+', over '+
            (E.periodMeasured ? 'one node-to-node interval: '+(E.period/60).toFixed(1)+' min, '+spanRevs.toFixed(2)+' of a revolution'
                              : 'one mean-motion period, 86 400 s/n'))+
        ', and the mean altitude over the whole '+spanLabel(D.hours)+' window, so they move '+
        (oneRev ? 'slightly ' : '')+'as the window does. '+
        'Revs in 24 h is 86 400 s divided by the period; the mean motion is the TLE\'s own, Kozai\'s. '+
        (E.periodWhy === 'equatorial'
          ? 'At i = '+E.inc.toFixed(4)+'° the ascending node is poorly defined: the Moon and Sun move the latitude being timed by a good fraction of the inclination, '+
            'so node-to-node times wander from one revolution to the next. The period shown is the Keplerian 2π√(a³/μ) from the a above.'
          : E.periodWhy === 'nonodes'
          ? 'No two ascending nodes were found, so the period shown is the Keplerian 2π√(a³/μ) from the a above.'
          : '')).trim();
    }

    // the rail carries only what frames the visibility answer
    const mini = [
      ['Inclination', E.inc.toFixed(2)+'°'],
      [E.periodKind === 'nodal' ? 'Period' : 'Kepler period', (P/60).toFixed(1)+' min'],
      ['Mean alt.', D.meanAlt.toFixed(0)+' km'],
      ['Revs / day', (86400/P).toFixed(2)]
    ];
    return { cells, oscRows: ov, oscNote: oscNoteText, derived: dv, dnote: dnoteText, mini };
  }

  return { osculating, elementsReport };
}
