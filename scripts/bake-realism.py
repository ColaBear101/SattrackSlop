# The realistic globe's sharper maps (CHANGES-FROM-LEGACY.md, L71), baked from NASA's own sources, all public domain:
#
#   blackmarble-4096.jpg, blackmarble-8192.jpg   the night: NASA Black Marble 2016 (VIIRS), the 13500 x 6750 colour composite,
#       https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg
#   relief-8192.jpg                              the land's height, for the light and shade of its relief: NASA Visible Earth's
#       "Topography" (gebco_08_rev_elev_21600x10800, from GEBCO_08), resampled, one grey channel
#   ocean-8192.png                               where the sea is, for the Sun's glint: NASA Blue Marble Next Generation, April 2004
#       (world.200404.3x21600x10800), whose open water is one flat colour, resampled and softened at the shore
#
# The sources are large (8 MB, 233 MB and 174 MB) and stay outside the repository; src/scene/realism.ts picks up whatever these files
# the build finds (src/assets/globe), so baking them is all that adding them takes. Blender reads all three formats and is already the
# owner's tool; nothing is installed and nothing is saved but these files:
#
#   blender --background --factory-startup --python scripts/bake-realism.py -- <BlackMarble_2016_3km.jpg> <gebco_08_rev_elev.tif> \
#       <world.200404.3x21600x10800_geo.tif> src/assets/globe
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) != 4:
    sys.exit('usage: blender --background --factory-startup --python scripts/bake-realism.py -- <black marble> <gebco> <blue marble> <out>')
NIGHT, HEIGHT, DAY, OUT = [os.path.abspath(a) for a in argv]

scene = bpy.context.scene
# colour management off: what is read is what is written
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0
settings = scene.render.image_settings


def save(img, name, fmt, mode, quality=90):
    settings.file_format = fmt
    settings.color_mode = mode
    if fmt == 'JPEG':
        settings.quality = quality
    else:
        settings.compression = 90
    path = os.path.join(OUT, name)
    img.save_render(path, scene=scene)
    print('wrote', path, os.path.getsize(path), 'bytes')


def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    print('read', path, img.size[0], 'x', img.size[1])
    return img


def grey_from(pixels_rgba, w, h):
    return pixels_rgba.reshape(h, w, 4)


# ---- the night: two rungs of the Black Marble ----
night = load(NIGHT)
for width in (4096, 8192):
    rung = night.copy()
    rung.scale(width, width // 2)
    save(rung, 'blackmarble-%d.jpg' % width, 'JPEG', 'RGB', 88)
    bpy.data.images.remove(rung)
bpy.data.images.remove(night)

W, H = 8192, 4096

# ---- the land's height: GEBCO's, resampled (the shader takes the slopes from neighbouring texels) ----
height = load(HEIGHT)
height.scale(W, H)
save(height, 'relief-8192.jpg', 'JPEG', 'BW', 92)
bpy.data.images.remove(height)

# ---- the sea: the Blue Marble's flat open-water colour, found and softened over about a texel at the shore ----
day = load(DAY)
day.scale(W, H)
px = np.empty(W * H * 4, dtype=np.float32)
day.pixels.foreach_get(px)
rgb = px.reshape(H, W, 4)[..., :3]
sea = np.array([2, 5, 20], dtype=np.float32) / 255.0
d = np.abs(rgb - sea).max(axis=2)
mask = np.clip(1.0 - (d - 0.012) / 0.05, 0.0, 1.0)
print('open water', round(float((mask > 0.5).mean()) * 100, 1), '% of the map')
out = bpy.data.images.new('ocean', W, H, alpha=False)
flat = np.empty((H, W, 4), dtype=np.float32)
flat[..., 0] = flat[..., 1] = flat[..., 2] = mask
flat[..., 3] = 1.0
out.pixels.foreach_set(flat.ravel())
save(out, 'ocean-8192.png', 'PNG', 'BW')
