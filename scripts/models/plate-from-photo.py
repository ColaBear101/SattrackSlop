# The image for KNACKSAT-2's marked plate (scripts/models/knacksat2.py --plaque), taken from a photograph of the flight model.
#
# The plate is a rectangle on the satellite; in a photograph it is any four-sided figure. Given where its four corners are in the
# photograph, this maps the figure back to the rectangle (a homography, each output pixel the mean of four bilinear samples), sets
# the levels so that the black plate is black and the printed marks white, paints over what the model draws for itself (the camera's
# cover, the screw pads), and writes the plate square on, as it stands in the photograph, at `--px-per-mm` pixels a millimetre.
#
#   blender --background --factory-startup --python scripts/models/plate-from-photo.py -- <photo> <out.png>
#           --corners TLx,TLy,TRx,TRy,BRx,BRy,BLx,BLy --size 81.4,120 [--px-per-mm 10] [--levels black,white] [--floor 0.11]
#           [--blank across0,along0,across1,along1 ...] [--dot across,along,radius ...] [--ungold across0,along0,across1,along1 ...]
#           [--logo image across0,along0,across1,along1 ...] [--white]
# Corners are pixels in the photograph (origin top left), in the order top left, top right, bottom right, bottom left of the plate
# as it stands in the photograph. --size is the plate across and along, in millimetres. --blank, --dot, --ungold and --logo are in
# millimetres on the plate: across from its middle towards the reader's right, along from its middle towards the top of the image. A
# blank or a dot is painted the plate's own black; --ungold paints over only the dull gold in its rectangle, so a mark printed over the
# edge of something gold keeps its bright strokes; --logo paints its rectangle out and draws a mark's own artwork (an image with an
# alpha channel) in it, white, where the photograph shows the mark too soft. --white makes the result grey: the printed marks white,
# whatever colour the photograph's light gave them, and the plate its own black. Corners are measured on the file as it is stored
# (Blender does not apply an EXIF orientation tag), and an option this script does not know stops it.

import os
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, many=False):
    vals = []
    while name in args:
        i = args.index(name)
        vals.append([float(v) for v in args[i + 1].split(',')])
        del args[i:i + 2]
    if not many and len(vals) > 1:
        sys.exit(name + ' is given more than once')
    return vals if many else (vals[0] if vals else None)


corners = opt('--corners')
size = opt('--size')
ppm = (opt('--px-per-mm') or [10.0])[0]
levels = opt('--levels')
floor = (opt('--floor') or [0.11])[0]       # the black the plate is lifted to: knacksat2.py's board, (0.012, 0.012, 0.013) linear, in sRGB
blanks = opt('--blank', many=True)
dots = opt('--dot', many=True)
ungold = opt('--ungold', many=True)
white = '--white' in args
if white:
    args.remove('--white')
logos = []
while '--logo' in args:
    i = args.index('--logo')
    logos.append((os.path.abspath(args[i + 1]), [float(v) for v in args[i + 2].split(',')]))
    del args[i:i + 3]
if len(args) != 2 or any(a.startswith('--') for a in args) or not corners or len(corners) != 8 or not size:
    sys.exit('usage: blender --background --factory-startup --python scripts/models/plate-from-photo.py -- <photo> <out.png> '
             '--corners TLx,TLy,TRx,TRy,BRx,BRy,BLx,BLy --size across,along [--px-per-mm 10] [--levels black,white] '
             '[--blank a0,l0,a1,l1 ...] [--dot a,l,r ...] [--ungold a0,l0,a1,l1 ...] [--logo image a0,l0,a1,l1 ...] [--white]')
PHOTO, OUT = os.path.abspath(args[0]), os.path.abspath(args[1])

img = bpy.data.images.load(PHOTO)
img.colorspace_settings.name = 'Non-Color'      # the stored values as they are, whatever the file's depth (16-bit and float files would come in linear)
pw, ph = img.size
src = np.empty(pw * ph * 4, np.float32)
img.pixels.foreach_get(src)
src = src.reshape(ph, pw, 4)[::-1, :, :3]            # Blender keeps rows from the bottom; here row 0 is the top, as the corners are

ow, oh = int(round(size[0] * ppm)), int(round(size[1] * ppm))
# the homography taking output pixel corners (0,0) (ow,0) (ow,oh) (0,oh) to the photograph's four corners
dst = [(0.0, 0.0), (ow, 0.0), (ow, oh), (0.0, oh)]
srcp = [(corners[0], corners[1]), (corners[2], corners[3]), (corners[4], corners[5]), (corners[6], corners[7])]
A, b = [], []
for (x, y), (u, v) in zip(dst, srcp):
    A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.append(u)
    A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.append(v)
hm = np.append(np.linalg.solve(np.array(A), np.array(b)), 1.0).reshape(3, 3)


def sample(xs, ys):
    """Bilinear samples of the photograph at fractional pixel positions (pixel centres at .5)."""
    x = np.clip(xs - 0.5, 0, pw - 1.001)
    y = np.clip(ys - 0.5, 0, ph - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    a, b_, c, d = src[y0, x0], src[y0, x0 + 1], src[y0 + 1, x0], src[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b_ * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


acc = np.zeros((oh, ow, 3), np.float32)
gy, gx = np.mgrid[0:oh, 0:ow].astype(np.float64)
for ox, oy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
    X, Y = gx + ox, gy + oy
    w = hm[2, 0] * X + hm[2, 1] * Y + hm[2, 2]
    acc += sample((hm[0, 0] * X + hm[0, 1] * Y + hm[0, 2]) / w, (hm[1, 0] * X + hm[1, 1] * Y + hm[1, 2]) / w)
out = acc / 4.0

lum = out @ np.array([0.2126, 0.7152, 0.0722], np.float32)
lo, hi = levels if levels else (float(np.percentile(lum, 35)), float(np.percentile(lum, 99.7)))
out = floor + (1.0 - floor) * np.clip((out - lo) / max(hi - lo, 1e-4), 0.0, 1.0)
lum = out @ np.array([0.2126, 0.7152, 0.0722], np.float32)
ground = np.median(out[lum < floor + 0.25 * (1.0 - floor)], axis=0)        # the plate itself: its mean, grain and all
FEATHER = 4.0                                                               # pixels over which a painted patch fades in, inside it


def at(across, along):
    """Output pixel of a point on the plate, in millimetres from its middle."""
    return (across + size[0] / 2) * ppm, (size[1] / 2 - along) * ppm


px, py = gx + 0.5, gy + 0.5
hard = np.zeros((oh, ow), bool)
for a0, l0, a1, l1 in blanks + [[r[0] - 0.8, r[1] + 0.8, r[2] + 0.8, r[3] - 0.8] for _, r in logos]:
    (x0, y0), (x1, y1) = at(min(a0, a1), max(l0, l1)), at(max(a0, a1), min(l0, l1))
    hard |= (px >= x0) & (px <= x1) & (py >= y0) & (py <= y1)
for a, l, r in dots:
    cx, cy = at(a, l)
    hard |= np.hypot(px - cx, py - cy) <= r * ppm
# the painted patches, all together, fade in over FEATHER pixels inside their outline (the image's own edge counts as inside)
m, depth = hard.copy(), np.zeros((oh, ow), np.float32)
for _ in range(int(FEATHER)):
    q = np.pad(m, 1, constant_values=True)
    m = m & q[:-2, 1:-1] & q[2:, 1:-1] & q[1:-1, :-2] & q[1:-1, 2:]
    depth += m
mask = np.where(hard, (1.0 + depth) / (1.0 + FEATHER), 0.0).astype(np.float32)
for a0, l0, a1, l1 in ungold:
    # what is left of the camera's gold cover behind a mark printed over its edge: its dull gold goes, by how dull and how gold it is,
    # fully at the cover's own brightness (its brightest channel 0.30 or below) and not at all at a mark's strokes (0.60 and above),
    # and the box fades in over FEATHER pixels inside its edge like a blank's
    (x0, y0), (x1, y1) = at(min(a0, a1), max(l0, l1)), at(max(a0, a1), min(l0, l1))
    inside = np.minimum(np.minimum(px - x0, x1 - px), np.minimum(py - y0, y1 - py))
    edge = np.clip(inside / FEATHER, 0.0, 1.0)
    hi_ = out.max(axis=2)
    dull = np.clip((0.60 - hi_) / 0.30, 0.0, 1.0)
    gold = np.clip((out[..., 0] - out[..., 2] - 0.04) / 0.08, 0.0, 1.0)
    mask = np.maximum(mask, edge * dull * gold)
out = out * (1.0 - mask[..., None]) + ground * mask[..., None]

for path, (a0, l0, a1, l1) in logos:
    # the mark's artwork, white through its alpha, fitted to the rectangle with its proportions kept and centred in it; each output
    # pixel the mean of 4 x 4 bilinear samples, so a large artwork comes down smoothly
    li = bpy.data.images.load(path)
    lw, lh = li.size
    la = np.empty(lw * lh * 4, np.float32)
    li.pixels.foreach_get(la)
    la = la.reshape(lh, lw, 4)[::-1, :, 3]
    (x0, y0), (x1, y1) = at(min(a0, a1), max(l0, l1)), at(max(a0, a1), min(l0, l1))
    k = min((x1 - x0) / lw, (y1 - y0) / lh)
    bx, by = x0 + ((x1 - x0) - lw * k) / 2, y0 + ((y1 - y0) - lh * k) / 2
    rows = np.arange(int(np.floor(by)), int(np.ceil(by + lh * k)))
    cols = np.arange(int(np.floor(bx)), int(np.ceil(bx + lw * k)))
    cy_, cx_ = np.meshgrid(rows, cols, indexing='ij')
    alpha = np.zeros(cy_.shape, np.float32)
    for sy in (0.125, 0.375, 0.625, 0.875):
        for sx in (0.125, 0.375, 0.625, 0.875):
            u = (cx_ + sx - bx) / k - 0.5
            v = (cy_ + sy - by) / k - 0.5
            inside = (u >= -0.5) & (u <= lw - 0.5) & (v >= -0.5) & (v <= lh - 0.5)
            uc, vc = np.clip(u, 0, lw - 1.001), np.clip(v, 0, lh - 1.001)
            u0, v0 = np.floor(uc).astype(int), np.floor(vc).astype(int)
            fu, fv = uc - u0, vc - v0
            a = (la[v0, u0] * (1 - fu) + la[v0, u0 + 1] * fu) * (1 - fv) + (la[v0 + 1, u0] * (1 - fu) + la[v0 + 1, u0 + 1] * fu) * fv
            alpha += np.where(inside, a, 0.0) / 16.0
    ok = (cy_ >= 0) & (cy_ < oh) & (cx_ >= 0) & (cx_ < ow)
    yy, xx, aa = cy_[ok], cx_[ok], alpha[ok][:, None]
    out[yy, xx] = out[yy, xx] * (1.0 - aa) + aa
    print('logo', os.path.basename(path), 'drawn', round(lw * k / ppm, 1), 'x', round(lh * k / ppm, 1), 'mm')

if white:
    # every mark white, as the flight model's are: a pixel goes from its own grey (the plate, which keeps its floor and its grain) to
    # its brightest channel (a mark, whatever colour the photograph's light gave it) as it brightens from 0.3 to 0.6
    grey = out @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    t = np.clip((grey - 0.3) / 0.3, 0.0, 1.0)
    t = t * t * (3 - 2 * t)
    out = np.repeat((grey * (1 - t) + out.max(axis=2) * t)[..., None], 3, axis=2)

res = bpy.data.images.new('plate', ow, oh, alpha=False)
res.pixels.foreach_set(np.dstack([out[::-1], np.ones((oh, ow, 1), np.float32)]).astype(np.float32).ravel())
res.filepath_raw = OUT
res.file_format = 'PNG'
res.save()
print('plate', ow, 'x', oh, 'px, levels', round(lo, 3), round(hi, 3), 'ground', [round(float(v), 3) for v in ground], '->', OUT)
