/* Finding out where the observer is.
 *
 * The observer used to be five numbers you had to already know. That is a fair
 * amount to ask of someone whose question is "can I see it from here", and the
 * two fields most likely to be got wrong were the two nobody can answer from
 * memory: the altitude of the ground they are standing on, and their offset
 * from UTC.
 *
 * The offset in particular was guessed as round(lon/15), which is the nearest
 * hour of solar time. It is honest about being a guess, and it is wrong for a
 * good deal of the world: China keeps one zone across sixty degrees of
 * longitude, so Kashgar comes out three hours adrift; India and Nepal are on
 * half and quarter hours; anywhere with summer time is wrong for part of the
 * year whatever you do with longitude.
 *
 * A place name gets all of it - position, ground elevation, and a real IANA
 * zone - from one request.
 *
 * Open-Meteo's geocoder is used because it needs no key, answers with
 * Access-Control-Allow-Origin, and returns elevation and timezone alongside the
 * coordinates. Nominatim would also work but asks callers not to hammer it and
 * wants a descriptive user agent, which a browser will not let a page set.
 *
 * Nothing here touches the DOM, and nothing here is required: every path it
 * offers is a convenience over typing the numbers in, and typing the numbers in
 * still works with no network at all.
 */
(function(global){
'use strict';

var GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

/* The offset from UTC, in hours, at a given instant.
 *
 * Not a constant, because it is not one. A zone that keeps summer time has two
 * answers and the right one depends on the day of the pass, which for a 7-day
 * window can be either side of a transition.
 *
 * Done by formatting the instant IN the zone and reading the wall-clock back as
 * though it were UTC: the difference is the offset. That is the portable way -
 * the timeZoneName:'longOffset' option would say it directly but is younger
 * than some browsers still in use.
 */
var offCache = {};
function offsetAt(zone, ms){
  if(!zone) return null;
  /* Offsets change at most twice a year; an hour of granularity is far finer
     than needed and keeps a 7-day window of passes to a couple of hundred
     entries. */
  var key = zone + '|' + Math.floor(ms/3600000);
  if(key in offCache) return offCache[key];
  var off = null;
  try {
    var f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit' });
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function(x){ p[x.type] = x.value; });
    var wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    /* to the minute: offsets are whole minutes, and the seconds field has
       already thrown away the sub-second part of ms */
    off = Math.round((wall - Math.floor(ms/1000)*1000)/60000)/60;
    if(!isFinite(off) || Math.abs(off) > 16) off = null;
  } catch(e){ off = null; }
  offCache[key] = off;
  return off;
}

/* Does this browser know the zone well enough to be believed? An engine with a
   stub Intl returns UTC for everything, and silently showing UTC as if it were
   local time is worse than admitting there is no zone. */
function zoneKnown(zone){
  if(!zone) return false;
  var jan = offsetAt(zone, Date.UTC(2020, 0, 15)), jul = offsetAt(zone, Date.UTC(2020, 6, 15));
  if(jan === null || jul === null) return false;
  return !(zone !== 'UTC' && zone !== 'Etc/UTC' && jan === 0 && jul === 0 && /\//.test(zone)
           && !/^(Africa\/Abidjan|Africa\/Accra|Atlantic\/Reykjavik|Europe\/London|Europe\/Dublin|Europe\/Lisbon)/.test(zone));
}

/* One search result, flattened to exactly what the observer needs. */
function toSite(r){
  /* Tokyo is in Tokyo, and printing that under the word Tokyo tells the reader
     nothing while costing them a line. The region is only worth naming when it
     is not the place itself. */
  var region = (r.admin1 && r.admin1 !== r.name) ? r.admin1 : null;
  var where = [region, r.country].filter(Boolean).join(', ');
  return {
    name: String(r.name || '').slice(0, 24),
    where: where,
    lat: +r.latitude,
    lon: +r.longitude,
    /* Open-Meteo gives ground elevation in metres; the observer is in km, and
       a person standing on it is about another two metres up, which is below
       the resolution of anything here and is left out. */
    altKm: isFinite(r.elevation) ? Math.round(+r.elevation)/1000 : 0,
    zone: r.timezone || null,
    population: r.population || 0,
    id: r.id
  };
}

/* search(q) -> Promise<[site]>
   Rejects on a dead network so the caller can say so rather than showing an
   empty list, which reads as "no such place". */
function search(q, count, signal){
  q = String(q || '').trim();
  if(q.length < 2) return Promise.resolve([]);
  var url = GEOCODE + '?name=' + encodeURIComponent(q)
          + '&count=' + (count || 6) + '&language=en&format=json';
  return fetch(url, { signal: signal }).then(function(r){
    if(!r.ok) throw new Error('search unavailable (' + r.status + ')');
    return r.json();
  }).then(function(j){
    return (j.results || []).map(toSite);
  });
}

/* Where this device thinks it is. The browser gives coordinates and an
   accuracy, never a name or a zone - so the name is the coordinates and the
   zone is the one the browser itself is set to, which for the device you are
   holding is the right answer and needs no request. */
function here(opts){
  return new Promise(function(res, rej){
    if(!global.navigator || !navigator.geolocation)
      return rej(new Error('this browser has no location service'));
    navigator.geolocation.getCurrentPosition(function(p){
      var c = p.coords, zone = null;
      try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch(e){}
      res({
        name: 'My location',
        where: c.accuracy ? '±' + Math.round(c.accuracy) + ' m' : '',
        lat: c.latitude, lon: c.longitude,
        altKm: isFinite(c.altitude) && c.altitude !== null ? c.altitude/1000 : 0,
        zone: zoneKnown(zone) ? zone : null,
        accuracyM: c.accuracy
      });
    }, function(e){
      /* The refusal is the common case and deserves its own words: the browser
         reports it identically to a genuine failure. */
      rej(new Error(e && e.code === 1 ? 'location permission was declined'
                                      : 'this device could not report a location'));
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
}

global.Places = {
  search: search,
  here: here,
  offsetAt: offsetAt,
  zoneKnown: zoneKnown,
  toSite: toSite,
  GEOCODE: GEOCODE,
  credit: 'Place search by Open-Meteo'
};

})(typeof window !== 'undefined' ? window : globalThis);
