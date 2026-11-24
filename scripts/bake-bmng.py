# The realistic globe's day map (CHANGES-FROM-LEGACY.md, L74): NASA's Blue Marble Next Generation, August 2004, in the rungs the page
# ships for the realistic surface (src/assets/globe/bmng-<width>.jpg).
#
# The source is NASA Earth Observatory's 21600 x 10800 base map for August 2004 (1.85 km a pixel, about 21 MB), which is too large for
# the repository and is kept outside it:
#   https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/august/world.200408.3x21600x10800.jpg
# August 2004 is the month NASA GIBS serves as BlueMarble_NextGeneration, the 500 m tiles the realistic surface streams close up
# (src/scene/realism-detail.ts), so the detail it lays over these maps matches them in colour. The plain map, without relief shading,
# is taken: the realistic look lights the relief itself, with the real Sun. The old surfaces keep their own bluemarble-<width>.jpg.
#
# Run headless with Blender (already the owner's tool); nothing is installed, nothing saved but the JPEGs:
#
#   blender --background --factory-startup --python scripts/bake-bmng.py -- <world.200408.3x21600x10800.jpg> src/assets/globe
#
# Credit: NASA Earth Observatory, Blue Marble Next Generation, Reto Stoeckli. NASA imagery is not under copyright.
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) != 2:
    sys.exit('usage: blender --background --factory-startup --python scripts/bake-bmng.py -- <source image> <output folder>')
src, out = argv

scene = bpy.context.scene
# Colour management that round-trips: the source is an sRGB photograph and so are the rungs.
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0
settings = scene.render.image_settings
settings.file_format = 'JPEG'
settings.color_mode = 'RGB'
settings.quality = 90

img = bpy.data.images.load(os.path.abspath(src), check_existing=False)
w, h = img.size
print('source', src, w, 'x', h)
if w != 2 * h:
    sys.exit('the source is not an equirectangular map (2:1)')

for width in (8192, 4096, 2048):
    if width > w:
        continue
    rung = img.copy()
    rung.scale(width, width // 2)
    path = os.path.join(out, 'bmng-%d.jpg' % width)
    rung.save_render(os.path.abspath(path), scene=scene)
    print('wrote', path, os.path.getsize(path), 'bytes')
    bpy.data.images.remove(rung)
