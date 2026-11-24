/* The flat map's own controls (CHANGES-FROM-LEGACY.md, L86): its Layers panel, which holds the globe's switches that the map can
   draw (the trail, the catalogue and its colours, the observer's pin and circle, the footprint), and its full screen. In the map's
   chunk, with the map; the switches' own words are the globe's panel's (view.ts, catcolour.ts). */

export const MAP_LAYERS = 'Map layers';
export const MAP_FULL_TITLE = 'The map over the whole screen (Escape leaves it)';
/** the catalogue's switch, and its row in the map's key while its dots are drawn in one colour */
export const MAP_CATALOGUE = 'Catalogue';
export const MAP_CAT_KEY = 'Rest of the catalogue';
export const MAP_FOOTPRINT = 'Access footprint';
export const MAP_TRAIL = 'Trail';
/** the trail's lengths, the globe's (its panel's buttons and their values) */
export const MAP_TRAILS = [
  { value: 'off', label: 'Off' }, { value: '1800000', label: '30 m' }, { value: 'orbit', label: '1 orbit' },
  { value: '21600000', label: '6 h' }, { value: 'all', label: '24 h' }
];
/** what the map's picture is called while the catalogue's dots are drawn on it (the canvas's name gains it) */
export const mapCatSay = (n: number): string => ' The catalogue\'s ' + n.toLocaleString('en-US') + ' other spacecraft are dots; point at one for its name.';
