# The realistic globe's cloud map (CHANGES-FROM-LEGACY.md, L71): NASA's Blue Marble cloud composite, in the rungs the page ships.
#
# src/assets/globe/clouds-2048.jpg is NASA's own 2048 x 1024 JPEG as published, unchanged:
#   https://assets.science.nasa.gov/content/dam/science/esd/eo/content-feature/bluemarble/images/cloud_combined_2048.jpg
# The sharper rungs are made here from NASA's larger file (Visible Earth #57747, "Blue Marble: Clouds", cloud_combined_8192.tif,
# about 34 MB; or the two 21600 x 21600 halves cloud.W/E.2001210.21600x21600.png set side by side), which is too large for the
# repository and is kept outside it. Every rung the build finds (src/assets/globe/clouds-<width>.jpg) is offered by
# src/scene/realism.ts, the widest the GPU and the connection allow, so a baked 4096 needs no code change.
#
# Run headless with Blender (it reads TIFF and big PNGs, and is already the owner's tool); nothing is installed, nothing saved
# but the JPEGs:
#
#   blender --background --factory-startup --python scripts/bake-clouds.py -- <cloud_combined_8192.tif> src/assets/globe
#
# Credit: NASA Goddard Space Flight Center; clouds by Reto Stoeckli (NASA Earth Observatory). NASA imagery is not under copyright.
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) != 2:
    sys.exit('usage: blender --background --factory-startup --python scripts/bake-clouds.py -- <source image> <output folder>')
src, out = argv

scene = bpy.context.scene
# Colour management off: the map is data (an opacity), so what is read is what is written.
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0
settings = scene.render.image_settings
settings.file_format = 'JPEG'
settings.color_mode = 'BW'
settings.quality = 88

img = bpy.data.images.load(os.path.abspath(src), check_existing=False)
w, h = img.size
print('source', src, w, 'x', h)
if w != 2 * h:
    sys.exit('the source is not an equirectangular map (2:1)')

for width in (4096, 8192):
    if width > w:
        continue
    rung = img.copy()
    rung.scale(width, width // 2)
    path = os.path.join(out, 'clouds-%d.jpg' % width)
    rung.save_render(os.path.abspath(path), scene=scene)
    print('wrote', path, os.path.getsize(path), 'bytes')
    bpy.data.images.remove(rung)
