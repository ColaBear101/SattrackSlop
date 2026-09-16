/* Photographic surfaces for the globe.
 *
 * The globe has always been drawn from the same coastline polygons as the flat
 * map: honest, legible, and unmistakably a diagram. This adds real imagery as
 * an alternative, from NASA's Global Imagery Browse Services - the same
 * archive that feeds Worldview - because a spacecraft tracker that never shows
 * you the planet is missing something.
 *
 * Two sources, split by whether the pixels ever change.
 *
 * The Blue Marble does not, so it is baked once and SHIPPED with the page. It
 * came out of GIBS to begin with, and the argument for fetching it was that
 * GIBS holds the authoritative copy - but GIBS downsamples it to serve it, and
 * a 43200x21600 original resampled here beats what the WMS will hand back at
 * these sizes. Shipping it also turns a three-to-eight second render-on-demand
 * into a static file off the CDN in under a fifth of a second, and makes the
 * globe work with NASA unreachable. The cost is nine megabytes in git, once,
 * for files that will not change again.
 *
 * Yesterday's weather DOES change, so the dated layers are still fetched, and
 * the night-lights mosaic with them. Those keep the WMS path below.
 *
 * WMS rather than the tiled WMTS endpoint, for the layers still fetched. GetMap
 * renders on demand and takes seconds where a tile is under one - but a full
 * equirectangular sphere map from tiles means thirty-two requests and a stitch,
 * and the sphere wants one seamless image with wrapping mipmaps.
 *
 * Nothing here is on the critical path either way: the vector globe is drawn
 * immediately and the photograph replaces it when it arrives, or never, without
 * an error the reader has to care about.
 *
 * On the axis order: WMS 1.3.0 with CRS=EPSG:4326 takes BBOX as lat,lon - not
 * lon,lat, which is the 1.1.1 convention and the source of a great deal of
 * silently-transposed imagery. -90,-180,90,180 is the whole Earth, north up,
 * dateline at both edges: exactly the equirectangular convention the sphere's
 * UVs already use, so the map applies with no transform.
 */
(function(global){
'use strict';

var WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

/* The layers. Named here rather than inline so the provenance of every pixel on
   screen is one list, and so a dead layer is one edit. */
var MARBLE = 'BlueMarble_ShadedRelief_Bathymetry';   // static composite, land + sea floor
/* The Blue Marble now ships with the page instead of being fetched.
   maps/bake-bluemarble.py builds these from the 43200x21600 land-only Blue
   Marble - 928 m per pixel, far sharper than anything the WMS will serve at
   these sizes - with GIBS bathymetry composited into the 65% of the map where
   that source has nothing but a flat painted ocean.
   Local because it never changes, and because a static file off the CDN lands
   in under a fifth of a second where the WMS renders on demand and took three
   to eight. The dated layers below still come from GIBS: those DO change, and
   there is no baking yesterday's weather ahead of time. */
var LOCAL_DAY = 'earth/img/bluemarble-';
var LIGHTS = 'VIIRS_CityLights_2012';                // the Black Marble night mosaic
var TRUECOL = 'VIIRS_SNPP_CorrectedReflectance_TrueColor';  // daily, with the weather

function url(layer, w, h, time){
  return WMS + '?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326'
    + '&BBOX=-90,-180,90,180&STYLES=&FORMAT=image/jpeg'
    + '&WIDTH=' + w + '&HEIGHT=' + h
    + '&LAYERS=' + encodeURIComponent(layer)
    + (time ? '&TIME=' + time : '');
}

/* Yesterday, UTC. Today's mosaic is still being filled in as the spacecraft
   flies - ask for it and you get the morning's swaths and black where the
   afternoon has not happened yet. Yesterday is complete everywhere the Sun
   reached. The date is reported to the reader rather than the label claiming
   "today" and quietly meaning something else. */
function lastFullDay(now){
  var d = new Date((now ? now.getTime() : Date.now()) - 86400000);
  return d.toISOString().slice(0, 10);
}

/* MODES - what the picker offers.
   `day`/`night`/`under` are GIBS layers; `steps` is the size ladder, coarse
   first so something photographic appears while the sharp one is still coming. */
var MODES = [
  { key:'vector', label:'Coastlines',
    note:'Drawn from the same coastline data as the flat map. No imagery fetched.' },

  { key:'marble', label:'Blue Marble',
    local:true, steps:[[2048,1024],[4096,2048],[8192,4096]],
    note:'NASA Blue Marble at 928 m, with sea-floor bathymetry.' },

  { key:'night', label:'Blue Marble & city lights',
    local:true, night:LIGHTS, steps:[[2048,1024],[4096,2048],[8192,4096]],
    note:'Blue Marble by day, the VIIRS night-lights mosaic after dark, split at the real terminator.' },

  { key:'clouds', label:'Yesterday’s clouds',
    day:TRUECOL, underLocal:true, night:LIGHTS, dated:true, steps:[[2048,1024],[4096,2048]],
    note:'VIIRS true colour, so the weather is the weather that day.' }
];

function mode(key){
  for(var i=0;i<MODES.length;i++) if(MODES[i].key === key) return MODES[i];
  return null;
}

function image(src){
  return new Promise(function(res, rej){
    var im = new Image();
    /* Only for a genuinely cross-origin fetch. An image drawn into a canvas
       taints it without CORS and the clouds mode reads pixels back out, so GIBS
       - which answers every request with Access-Control-Allow-Origin: * - needs
       it. A relative path does not, and asking for it there is actively
       harmful: under file:// the origin is opaque, the CORS check on a file
       sitting in the next directory fails, and the Blue Marble that ships with
       the page never loads for anyone who opened the page from disk. */
    if(/^https?:/i.test(src)) im.crossOrigin = 'anonymous';
    im.onload = function(){ res(im); };
    im.onerror = function(){ rej(new Error('imagery unavailable')); };
    im.src = src;
  });
}

/* Lay a daily true-colour mosaic over the static composite.
 *
 * Needed because a single day of VIIRS is not the whole Earth: the poles are in
 * their own night for months at a time and return nothing, and GIBS encodes
 * nothing as black. Painted straight onto a sphere that is a black cap over
 * Antarctica, which is both ugly and a lie - there is ice under there and we
 * have a picture of it.
 *
 * So black means "no data" and Blue Marble shows through. The threshold is a
 * sum over the three channels rather than a per-channel test, and there is a
 * fade band above it, because JPEG ringing around the coverage edge lifts true
 * black by a few counts and a hard cut leaves a visible fringe of it. Deep
 * ocean at night sits far above the band - the darkest water here sums to about
 * 60, the no-data black to under 10.
 */
var NODATA = 14;     // sum of R+G+B at or below this is certainly no-data
var FADE   = 46;     // ...and blends back to full imagery by here

function over(base, top, w, h){
  /* Reading the pixels back needs an untainted canvas. Over http that is what
     the CORS header buys; from a file:// page every image is opaque and
     getImageData throws whatever the source. Falling back to the daily mosaic
     on its own is the honest degradation - the poles come out black, which is
     what that day's data actually says - and it beats throwing away the whole
     surface. */
  try { return overPixels(base, top, w, h); }
  catch(e){ return top; }
}

function overPixels(base, top, w, h){
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  var g = c.getContext('2d');
  g.drawImage(top, 0, 0, w, h);
  var ti = g.getImageData(0, 0, w, h), t = ti.data;
  g.drawImage(base, 0, 0, w, h);
  var bi = g.getImageData(0, 0, w, h), b = bi.data;
  for(var i = 0; i < t.length; i += 4){
    var s = t[i] + t[i+1] + t[i+2];
    if(s <= NODATA){ t[i] = b[i]; t[i+1] = b[i+1]; t[i+2] = b[i+2]; }
    else if(s < FADE){
      var k = (s - NODATA) / (FADE - NODATA);
      t[i]   = t[i]  *k + b[i]  *(1-k);
      t[i+1] = t[i+1]*k + b[i+1]*(1-k);
      t[i+2] = t[i+2]*k + b[i+2]*(1-k);
    }
  }
  g.putImageData(ti, 0, 0);
  return c;
}

/* load(key, onStage) -> Promise<{day, night, meta}>
 *
 * onStage is called once per rung of the size ladder with the same shape, so
 * the caller can put a 2048 map on the sphere at three seconds and replace it
 * with the 4096 at eight without knowing that is what is happening. The
 * promise resolves on the last rung.
 *
 * The night mosaic is fetched once, at the coarse size: it is a field of point
 * sources with no fine structure to lose, and it is the same picture at every
 * rung.
 */
function load(key, onStage, now, cap){
  var m = mode(key);
  if(!m) return Promise.reject(new Error('unknown surface: ' + key));
  if(!m.day && !m.local) return Promise.resolve({ day:null, night:null, meta:{ mode:m } });

  var when = m.dated ? lastFullDay(now) : null;
  var meta = { mode:m, date:when,
               source: (m.local && !m.night) ? 'NASA Blue Marble'
                     : (m.local ? 'NASA Blue Marble + GIBS' : 'NASA GIBS'),
               layers: m.local ? ['BlueMarble (local)'] : [m.day] };
  if(m.underLocal) meta.layers.push('BlueMarble (local)');
  if(m.night) meta.layers.push(m.night);

  /* A texture wider than the GPU will take is not a sharper globe, it is a
     failed upload - MAX_TEXTURE_SIZE is 8192 on a software renderer and as low
     as 4096 on some phones. The caller passes what its own context reports and
     the ladder stops there, rather than spending five megabytes to find out. */
  var fit = m.steps.filter(function(st){ return !cap || st[0] <= cap; });
  if(!fit.length) fit = [m.steps[0]];
  /* The coarse rung and the best one, and nothing in between. The ladder used
     to climb every rung because each was a slow render-on-demand and the
     intermediate one was worth looking at while the next came; a static file
     off the CDN is not slow, so a middle rung is a megabyte and a half paid for
     an image that is replaced before it is read. The first rung stays as
     insurance for a thin connection. */
  var steps = (fit.length > 2) ? [fit[0], fit[fit.length - 1]] : fit;

  var nightP = m.night ? image(url(m.night, 2048, 1024, null)) : Promise.resolve(null);

  return nightP.then(function(night){
    var out = null;
    /* The rungs run in sequence, not in parallel: two GetMap calls at once make
       the server render both and the coarse one arrives no sooner, which is the
       entire point of asking for it. */
    var chain = Promise.resolve();
    steps.forEach(function(step, i){
      chain = chain.then(function(){
        var w = step[0], h = step[1];
        var dayP = image(m.local ? (LOCAL_DAY + w + '.jpg') : url(m.day, w, h, when));
        var underP = m.underLocal ? image(LOCAL_DAY + w + '.jpg') : Promise.resolve(null);
        return Promise.all([dayP, underP]).then(function(r){
          var day = r[1] ? over(r[1], r[0], w, h) : r[0];
          out = { day:day, night:night, meta:meta, w:w, h:h,
                  last: i === steps.length - 1 };
          if(onStage) onStage(out);
          return out;
        });
      });
    });
    return chain.then(function(){ return out; });
  });
}

global.GlobeTex = {
  modes: function(){ return MODES.map(function(m){
    return { key:m.key, label:m.label, note:m.note, net: !!m.day }; }); },
  load: load,
  lastFullDay: lastFullDay,
  url: url,
  over: over,
  NODATA: NODATA, FADE: FADE,
  /* Kept for callers that have no meta to hand; a loaded surface reports its
     own source, since the Blue Marble is no longer served by GIBS even though
     its bathymetry still came from there. */
  credit: 'Imagery courtesy NASA'
};

})(typeof window !== 'undefined' ? window : globalThis);
