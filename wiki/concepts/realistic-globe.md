---
type: concept
title: "Realistic globe"
tags: [globe, earth-console, moon]
sources: [readme-globe-and-views]
created: 2026-11-24
updated: 2026-11-24
---

# Realistic globe

The realistic globe is an opt-in surface for the [[globe-scene]], chosen under *Layers → Globe surface → Realistic: clouds & atmosphere* (ledger rows L71, L74 and L75 of the [[change-ledger]]). It draws the Earth "the way the owner's Blender renders draw it": a seasonal Blue Marble ground, a lit cloud shell, a scattering atmosphere, ocean glint, relief, city lights and a full sky with stars, Milky Way, Sun and Moon (README.md#L844-L864). It is off unless chosen, remembered like the other surfaces in `gt.surface`, and loads a lazy chunk of its own (`realism`, `src/scene/realism.ts`) plus maps no other view requests (README.md#L845-L847; see [[lazy-chunks-and-entry-budget]]).

## Layers of the look

As listed in the README (README.md#L849-L864):

- **Ground** — NASA's Blue Marble Next Generation for August 2004 (`bmng-2048.jpg`, `-4096`, `-8192`), the month NASA's tile service serves, so the sharper tiles used close up match in colour. The other surfaces keep the 2002 Blue Marble, so their pixels do not move (README.md#L849-L851).
- **Clouds** — a shell 11.5 km up from NASA's Blue Marble cloud composite (`clouds-2048.jpg` and larger), thinned over Thailand so the page's own country shows clearly (ledger row L84; the credit says so). It is lit by the Sun only as far as a deck 11.5 km up sees it, 3.4° past the ground's terminator, and fades out past that, so no black cloud edge stands on the night limb against the stars; on a desktop whose GPU takes 16384 the map is `clouds-16384.jpg` (2.4 km a pixel) from NASA's full-resolution halves, with NASA's combined map blended in at the poles (ledger row L87, CHANGES-FROM-LEGACY.md#L136). It is red at sunset, thicker toward the limb, edge-broken by noise only where a pixel is small enough, and casts shadows a little toward the Sun (README.md#L852-L856).
- **Air** — single-scattered sunlight, Rayleigh and aerosol, in an exponential atmosphere along each ray that misses the planet, with the Earth's shadow on the air and the soft blue glow the owner's compositor laid outside the limb; over the ground, the haze between ground and eye (README.md#L857-L860).
- **Sun glint** off open water, from NASA's open-sea map (`ocean-8192.png`) (README.md#L861).
- **Relief** — GEBCO heights (`relief-8192.jpg`) tilting the normal the sunlight sees (README.md#L862).
- **City lights** — Black Marble 2016 (`blackmarble-8192.jpg`), fading in through twilight (README.md#L863).
- **Sky** beyond, on black, and **AgX**, the owner's view transform, over everything (README.md#L864).

## Map sizes and slow connections

The ground comes at the size the view needs, as for the other surfaces (see the texture ladder in [[globe-scene]]) (README.md#L866). The look's own maps come at the widest size the GPU allows, but no wider than 4096 on a phone or tablet, and at the narrowest on a slow connection or with Save-Data (README.md#L866-L868). The relief and the sharp sea, which exist only at 8192, are "left out on both", with coastlines standing in for the sea (README.md#L869-L870). The README does not say explicitly whether "both" means phone/tablet and slow connection, though that is the natural reading.

Optical depth is never ray-marched: it uses Chapman's grazing-incidence function in Schüler's form (`src/scene/look-glsl.ts`), which the close-up's lighting shares (`src/lib/models/sunlight.ts`) (README.md#L870-L872; see [[close-up-camera]]).

## Closer than the map (ledger row L74)

The sharpest bundled map is 4.9 km a texel and the closest views want about half a kilometre; even a 16384 map, the most most GPUs take, would be 2.4 km (README.md#L874-L876). So whenever a pixel at the middle of the view covers less than four fifths of a texel (about 3.9 km), the page asks NASA GIBS for the same Blue Marble at 500 m (`BlueMarble_NextGeneration`, tile levels 5 to 7, about 2, 1 and 0.5 km a pixel), for the ground under the middle of the view only (`src/scene/realism-detail.ts`) (README.md#L876-L879). Tiles live in one texture as a window of 8 × 8 (4 × 4 with a coarse pointer), addressed round so a moving window fetches only the tiles it gains, six at a time, nearest the middle first; the Earth's shader feathers them into the map toward the window's edge (README.md#L879-L882). Nothing is requested at the opening range, on a slow connection or with Save-Data, and *Data and privacy* lists the request (README.md#L882-L883; see [[data-provenance]]).

## The horizon (ledger row L74)

The Earth mesh is a polygon of 160 × 96 facets whose middles lie up to 2 km inside the true sphere, while the air's shader left any ray meeting the true sphere to the Earth's shader — so close up a dashed dark line ran along the limb where neither drew (README.md#L885-L887). The fix: the Earth and cloud shell are drawn inflated by 0.04 % and cut to the true sphere in their shaders, from each ray's closest approach to the centre and its change across a pixel, which multisampling turns into a smooth edge (`alphaToCoverage`; a hard edge without multisampling); the air clamps its ray to the limb instead of dropping it (README.md#L887-L891). Both limbs are now the true circle, and the compositor's glow fades out once the air's own height spans a few pixels (README.md#L891-L893).

## The sky (ledger row L75)

While the realistic surface is on, the sky behind the Earth is drawn too (`src/scene/realsky.ts`), and the ordinary sky layers' flat Sun and Moon discs and star points step aside; the planets, constellation figures and names stay and move with the sky to the camera (README.md#L895-L899). The Moon's name sits under the drawn Moon, which from orbit stands degrees from where the Earth's centre sees it (README.md#L898-L899).

- **Milky Way** — NASA SVS Deep Star Maps 2020 starless map (light of Gaia DR2 stars too faint to draw singly), baked by `scripts/bake-milkyway.py` to `src/assets/sky/milkyway-4096.jpg` (2048 on a phone or slow connection), in linear light (README.md#L901-L904).
- **Stars** — the page's own HYG catalogue to magnitude 5.5, 2,865 stars, each a soft point sized and brightened by magnitude and coloured by B−V as a black body (README.md#L905-L906).
- **Sun** — disc and glare (wide bloom, six diffraction spikes with six fainter between, a faint ghost ring) in the colour and share of sunlight reaching the camera, so the Earth's limb puts it out and the air reddens it (README.md#L907-L909).
- **Moon** — the LRO colour map (CGI Moon Kit, baked by `scripts/bake-moon.py` to `moon-2048.jpg`, 1024 on a phone) on a sphere lit with the Lommel–Seeliger law, in true direction, size and phase from the camera, turned and librating per the ephemeris, and dark in the Earth's shadow (README.md#L910-L913).

Stars and Milky Way are in J2000, precessed to the date as the sky layers do; the sky is placed at the camera, so it has no parallax (README.md#L915-L916). They fade when something bright is in view (ledger row L83): with the Sun in view only the brightest few remain, faintly; over the sunlit Earth they dim as far as it fills the view; in sunlight they are never more than half there, and in the close-up (sunlit spacecraft mid-view) a sixth; in the Earth's shadow they are all there. The change eases in over about a second (README.md#L916-L920).

### The Moon shared with the Moon pages

The Moon is the Moon pages' own (`src/lib/core/moon.ts`): position from `public/moon/lunar.js`'s truncated ELP-2000/82B, good to about 11 arcseconds and 30 km against JPL's DE441, and orientation from `public/core/body.js`'s IAU/NAIF rotation with its 13-term libration series (README.md#L920-L924). Those two files are frozen for the Moon pages, so the console carries a verbatim copy, and `tests/lib/moon-equivalence.test.ts` runs the classic files beside it at 485 instants from 1990 to 2050 and demands the same bits (README.md#L924-L926; see [[verbatim-ports]], [[earth-moon-page]], [[lunar-track-console]]). The IAU axes are given in J2000 and precessed to the date; without that the libration would be wrong by the precession itself, 0.36° in 2026 (README.md#L926-L927). `tests/lib/moon.test.ts` checks against Meeus's worked examples (47.a place; 48.a lit share and bright limb; 53.a and 53.b librations and axis), published new- and full-Moon instants, and four total eclipses (README.md#L928-L930).

## Reversibility and provenance

Leaving the surface restores everything it changed; `verify-realism` holds that, and the ab3d gate never sees any of it (README.md#L932-L933; see [[regression-gate]]). The maps are made by `scripts/bake-bmng.py`, `bake-clouds.py`, `bake-realism.py`, `bake-milkyway.py` and `bake-moon.py` from NASA's own files, which stay outside the repository (README.md#L933-L935; see [[data-provenance]]).

## Related

- [[globe-scene]] — the default surfaces and the texture ladder.
- [[close-up-camera]] — shares the sunlight model; its card offers *Realistic Earth* as a one-tick shortcut (README.md#L945-L946).
- [[eclipse-shadow-cone]] — the project's treatment of the Earth's shadow, which the sky and Moon here are dimmed by.
