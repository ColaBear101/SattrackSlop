# The realistic sky's Milky Way (CHANGES-FROM-LEGACY.md, L75): NASA SVS's "Deep Star Maps 2020" starless Milky Way, in the rungs the
# page ships (src/assets/sky/milkyway-<width>.jpg).
#
# The source is SVS 4851's milkyway_2020_8k.exr (130.9 MB, kept outside the repository):
#   https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_8k.exr
# 8192 x 4096 half floats, linear Rec.709, relative intensity 0..1, the diffuse light of the Milky Way from Gaia DR2 stars fainter than
# Tycho-2, with the Hipparcos and Tycho stars left out (the page draws its own bright stars from its catalogue). Celestial, ICRF/J2000,
# plate carree: right ascension 0h in the middle, increasing to the left as the sky looks from inside, north up:
#   u = 0.5 - RA/360 (mod 1), v from the top = 0.5 - Dec/180.
#
# Two rungs: 4096 (about 3.6 MB; a diffuse glow needs no more, and 8192 came to 16 MB of grain) and 2048 for a phone. They keep the
# light linear up to a scale: each is the map times MILKY_K, sRGB-encoded, so that the brightest 0.1 % of it reaches white and the 8 bits
# go to the band and not to the clusters' clipped cores. The scale is printed (10.012); src/scene/realsky.ts divides it out.
#
#   blender --background --factory-startup --python scripts/bake-milkyway.py -- <milkyway_2020_8k.exr> src/assets/sky
#
# Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC. NASA imagery is not under copyright.
import math
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) != 2:
    sys.exit('usage: blender --background --factory-startup --python scripts/bake-milkyway.py -- <milkyway_2020_8k.exr> <output folder>')
src, out = argv
os.makedirs(out, exist_ok=True)

img = bpy.data.images.load(os.path.abspath(src), check_existing=False)
w, h = img.size
print('source', src, w, 'x', h)
if w != 2 * h:
    sys.exit('the source is not an equirectangular map (2:1)')

# the scale: from a 2048 copy, the 99.9th percentile of luminance
probe = img.copy()
probe.scale(2048, 1024)
px = np.empty(2048 * 1024 * 4, np.float32)
probe.pixels.foreach_get(px)
px = px.reshape(-1, 4)
lum = px[:, 0] * 0.2126 + px[:, 1] * 0.7152 + px[:, 2] * 0.0722
p999 = float(np.percentile(lum, 99.9))
bpy.data.images.remove(probe)
k = 1.0 / max(p999, 1e-6)
print('luminance median %.6f, p95 %.6f, p99.9 %.6f -> MILKY_K = %.3f' % (float(np.median(lum)), float(np.percentile(lum, 95)), p999, k))

scene = bpy.context.scene
# linear in, times k (an exposure of log2 k stops), sRGB out, nothing else
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = math.log2(k)
scene.view_settings.gamma = 1.0
settings = scene.render.image_settings
settings.file_format = 'JPEG'
settings.color_mode = 'RGB'
settings.quality = 90

for width in (4096, 2048):
    if width > w:
        continue
    rung = img.copy()
    rung.scale(width, width // 2)
    path = os.path.join(out, 'milkyway-%d.jpg' % width)
    rung.save_render(os.path.abspath(path), scene=scene)
    print('wrote', path, os.path.getsize(path), 'bytes')
    bpy.data.images.remove(rung)
print('MILKY_K', round(k, 3))
