# The realistic sky's Moon (CHANGES-FROM-LEGACY.md, L75): NASA's LRO colour map of the Moon, in the rungs the page ships
# (src/assets/sky/moon-<width>.jpg).
#
# The source is the CGI Moon Kit's colour map (NASA SVS 4720, LROC WAC, poles filled in), kept outside the repository:
#   https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif   (4096 x 2048, 12.5 MB)
# Simple cylindrical, longitude 0 (the near side's middle, Sinus Medii) in the middle, east to the right, north up. The Moon is half a
# degree across, so even a narrow POV lens shows it a few tens of pixels wide: 2048 is the top rung, and 1024 the phone's.
#
#   blender --background --factory-startup --python scripts/bake-moon.py -- <lroc_color_poles_4k.tif> src/assets/sky
#
# Credit: NASA's Scientific Visualization Studio; LRO LROC WAC (NASA/GSFC/Arizona State University). NASA imagery is not under copyright.
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) != 2:
    sys.exit('usage: blender --background --factory-startup --python scripts/bake-moon.py -- <lroc_color_poles_4k.tif> <output folder>')
src, out = argv
os.makedirs(out, exist_ok=True)

scene = bpy.context.scene
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
for width in (2048, 1024):
    rung = img.copy()
    rung.scale(width, width // 2)
    path = os.path.join(out, 'moon-%d.jpg' % width)
    rung.save_render(os.path.abspath(path), scene=scene)
    print('wrote', path, os.path.getsize(path), 'bytes')
    bpy.data.images.remove(rung)
