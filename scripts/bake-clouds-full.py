# The realistic globe's sharpest cloud map (CHANGES-FROM-LEGACY.md, L87): clouds-16384.jpg, 16384 x 8192 (2.4 km a pixel at the
# equator), from NASA's full-resolution Blue Marble cloud composite, the two halves of 21600 x 21600 (1.85 km a pixel):
#   cloud.W.2001210.21600x21600.png   longitudes -180 to 0
#   cloud.E.2001210.21600x21600.png   longitudes 0 to 180
# NASA Visible Earth record 57747 ("Blue Marble: Clouds", Terra MODIS, 29 July 2001; Reto Stoeckli, NASA Earth Observatory). NASA's own
# host no longer answers for them; the Internet Archive's copies of eoimages.gsfc.nasa.gov's files are the same bytes (the archive's
# payload SHA-1, the same in every complete capture from 2014 to 2023: W QQQKUDQLL56MHMZ2SFR6ITBUGQVP3NW2, E ZEENS7QJIUHDDBZSPTP4JXSTMLZWUO34,
# which this script checks). About 211 MB each, kept outside the repository.
#
# The two halves are the visible-light composite alone; NASA's combined map (cloud_combined_8192.tif, the 8192 rung's source) adds the
# polar clouds from the thermal infrared, which the halves lack (beyond 60 degrees they are nearly bare). So the halves are used to 55
# degrees of latitude, the combined map, enlarged, beyond 65, and the two are blended between.
#
# Blender, which bakes the other rungs (scripts/bake-clouds.py), would hold each half as 1.9 GB of pixels and more as it scaled them;
# Pillow reads them as one byte a pixel. Each half is shrunk to 8192 x 8192 with a Lanczos filter and the two are set side by side; the
# map is data (an opacity), so nothing is done to its values. src/scene/realism.ts offers it where the GPU takes 16384 and the pointer is
# not a finger, on a connection that is not lean.
#
#   python -I scripts/bake-clouds-full.py <cloud.W...png> <cloud.E...png> <cloud_combined_8192.tif> src/assets/globe
#
# Credit: NASA Goddard Space Flight Center; clouds by Reto Stoeckli (NASA Earth Observatory). NASA imagery is not under copyright.
import base64
import hashlib
import os
import sys

from PIL import Image

if len(sys.argv) != 5:
    sys.exit('usage: python -I scripts/bake-clouds-full.py <cloud.W.2001210.21600x21600.png> <cloud.E.2001210.21600x21600.png> '
             '<cloud_combined_8192.tif> <output folder>')
west, east, combined, out = sys.argv[1:]
WANT = {west: 'QQQKUDQLL56MHMZ2SFR6ITBUGQVP3NW2', east: 'ZEENS7QJIUHDDBZSPTP4JXSTMLZWUO34'}

Image.MAX_IMAGE_PIXELS = None          # 466 million pixels a half: NASA's files, checked below, not a decompression bomb
halves = []
for path, digest in WANT.items():
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    got = base64.b32encode(h.digest()).decode()
    if got != digest:
        sys.exit('%s is not NASA\'s file: SHA-1 %s, wanted %s' % (path, got, digest))
    im = Image.open(path)
    if im.size != (21600, 21600):
        sys.exit('%s is %d x %d, not 21600 x 21600' % (path, im.size[0], im.size[1]))
    im = im.convert('L')
    halves.append(im.resize((8192, 8192), Image.LANCZOS))
    print('read', path, digest)

full = Image.new('L', (16384, 8192))
full.paste(halves[0], (0, 0))
full.paste(halves[1], (8192, 0))
# the poles from the combined map: its weight 0 to 55 degrees of latitude, 1 from 65, smooth between, row by row
polar = Image.open(combined).convert('L')
if polar.size != (8192, 4096):
    sys.exit('%s is %d x %d, not 8192 x 4096' % (combined, polar.size[0], polar.size[1]))
polar = polar.resize((16384, 8192), Image.LANCZOS)
mask = Image.new('L', (1, 8192))
for y in range(8192):
    lat = abs(90.0 - (y + 0.5) * 180.0 / 8192)
    t = min(1.0, max(0.0, (lat - 55.0) / 10.0))
    mask.putpixel((0, y), round(255 * t * t * (3 - 2 * t)))
full = Image.composite(polar, full, mask.resize((16384, 8192)))
dest = os.path.join(out, 'clouds-16384.jpg')
full.save(dest, 'JPEG', quality=82, optimize=True)
print('wrote', dest, os.path.getsize(dest), 'bytes')
