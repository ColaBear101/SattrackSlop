/* The realistic globe's words (CHANGES-FROM-LEGACY.md, L71): its name in the Layers panel's list of surfaces, the note under it,
   the source it credits, and what is said when it cannot be drawn. They travel in the scene's chunk, with the list itself
   (scene/globetex.ts), because the list is built before the realistic look is ever asked for. */

export const REAL_LABEL = 'Realistic: clouds & atmosphere';

export const REAL_NOTE = 'Blue Marble under NASA’s cloud composite and a scattering atmosphere: haze, a blue limb, a red band at sunset and city lights after dark; close up, NASA’s 500 m imagery; beyond it the Milky Way, the stars, the Moon in its phase and the Sun’s glare. The clouds are a still picture, not today’s weather.';

export const REAL_SOURCE = 'NASA Blue Marble Next Generation, August 2004 (NASA Earth Observatory, Reto Stöckli), at 500 m from NASA GIBS close up; clouds, NASA Blue Marble (Reto Stöckli, NASA GSFC), thinned over Thailand; city lights, NASA Black Marble 2016 (NASA Earth Observatory, VIIRS); relief, GEBCO_08 (NASA Visible Earth); the open sea, NASA Blue Marble Next Generation, April 2004; the Milky Way, NASA/GSFC Scientific Visualization Studio with Gaia DR2 (ESA/Gaia/DPAC); the Moon, NASA LRO (LROC WAC)';

export const REAL_FAILED = 'the realistic look could not be loaded, so this is the plain Blue Marble';
