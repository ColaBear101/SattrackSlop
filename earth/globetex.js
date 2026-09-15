/* Photographic surfaces for the globe.
 *
 * The globe has always been drawn from the same coastline polygons as the flat
 * map: honest, legible, and unmistakably a diagram. This adds real imagery as
 * an alternative, from NASA's Global Imagery Browse Services - the same
 * archive that feeds Worldview - because a spacecraft tracker that never shows
 * you the planet is missing something.
 *
 * Why GIBS and not a texture committed to the repository:
 *
 *   - it is the authoritative copy, dated and attributed, rather than a JPEG of
 *     unknown provenance that has been passed between projects for a decade;
 *   - it carries CURRENT imagery, so "what did the Earth look like yesterday"
 *     is a request rather than a rebuild;
 *   - it keeps a megabyte of pixels out of git.
 *
 * The cost is a network round trip, so nothing here is on the critical path:
 * the vector globe is drawn immediately and the photograph replaces it when it
 * arrives, or never, without an error the reader has to care about.
 *
 * WMS rather than the tiled WMTS endpoint. GetMap renders on demand and takes
 * three to eight seconds for these sizes, where a tile is under a second - but
 * a full equirectangular sphere map from tiles means thirty-two requests and a
 * stitch, and the sphere wants one seamless image with wrapping mipmaps. One
 * slow request that arrives behind a globe you can already read beats thirty-two
 * fast ones and a seam. The size ladder below hides most of the wait anyway.
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
    day:MARBLE, steps:[[2048,1024],[4096,2048]],
    note:'NASA Blue Marble: shaded relief with sea-floor bathymetry.' },

  { key:'night', label:'Blue Marble & city lights',
    day:MARBLE, night:LIGHTS, steps:[[2048,1024],[4096,2048]],
    note:'Blue Marble by day, the VIIRS night-lights mosaic after dark, split at the real terminator.' },

  { key:'clouds', label:'Yesterday’s clouds',
    day:TRUECOL, under:MARBLE, night:LIGHTS, dated:true, steps:[[2048,1024],[4096,2048]],
    note:'VIIRS true colour, so the weather is the weather that day.' }
];

function mode(key){
  for(var i=0;i<MODES.length;i++) if(MODES[i].key === key) return MODES[i];
  return null;
}

function image(src){
  return new Promise(function(res, rej){
    var im = new Image();
    /* Required, and not merely polite: an image drawn into a canvas taints it
       without CORS, and the clouds mode reads pixels back out. GIBS answers
       every request with Access-Control-Allow-Origin: *. */
    im.crossOrigin = 'anonymous';
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
function load(key, onStage, now){
  var m = mode(key);
  if(!m) return Promise.reject(new Error('unknown surface: ' + key));
  if(!m.day) return Promise.resolve({ day:null, night:null, meta:{ mode:m } });

  var when = m.dated ? lastFullDay(now) : null;
  var meta = { mode:m, date:when, source:'NASA GIBS', layers:[m.day] };
  if(m.under) meta.layers.push(m.under);
  if(m.night) meta.layers.push(m.night);

  var nightP = m.night ? image(url(m.night, 2048, 1024, null)) : Promise.resolve(null);

  return nightP.then(function(night){
    var out = null;
    /* The rungs run in sequence, not in parallel: two GetMap calls at once make
       the server render both and the coarse one arrives no sooner, which is the
       entire point of asking for it. */
    var chain = Promise.resolve();
    m.steps.forEach(function(step, i){
      chain = chain.then(function(){
        var w = step[0], h = step[1];
        var dayP = image(url(m.day, w, h, when));
        var underP = m.under ? image(url(m.under, w, h, null)) : Promise.resolve(null);
        return Promise.all([dayP, underP]).then(function(r){
          var day = r[1] ? over(r[1], r[0], w, h) : r[0];
          out = { day:day, night:night, meta:meta, w:w, h:h,
                  last: i === m.steps.length - 1 };
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
  credit: 'Imagery courtesy NASA EOSDIS GIBS'
};

})(typeof window !== 'undefined' ? window : globalThis);
