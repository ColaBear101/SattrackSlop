# KNACKSAT-2, built for the close-up (CHANGES-FROM-LEGACY.md, L72).
#
# No model of KNACKSAT-2 is published, so this one is built from its team's pictures and the owner's notes on them: the reception
# sheet (KMUTNB / INSTED, J-CUBE, deployed from the ISS on 3 February 2026), the photographs of the flight model, and the owner's
# CAD views and platform diagram. It is a 3U CubeSat, 100 x 100 x 340.5 mm:
#   - a black anodised frame: four rails with their feet (one with its separation plunger), and end frames;
#   - on each long side a black solar panel of large cells in one column, six on three sides and four, two either side of its plate,
#     on the marked side, all the same way round, as the photographs show them. A cell is black under its cover glass, with fine dark
#     fingers along the satellite's length and a thin light edge, and the two corners of its forward end cut off, where the black
#     board shows; at its after end three silver tabs on the edge, joined by a fine wire that zigzags between them, and below them a
#     matte gold interconnect bar across the joint; at its forward end one tab, right of the middle, on a short piece of gold. The
#     screws are silver heads in gold rims, in the cut corners and at the panel's ends;
#   - on one side, between two pairs of cells, a 120 mm plate: the camera (a lens down a round opening), two windows, and the name
#     and the marks of the team and its partners as the flight model carries them, all white, from an image of the plate (--plaque);
#   - at each end a flat black plate between the rails, a little inside their ends, with silver screws beside the rails, covering
#     NBSPACE's deployable antenna module, whose antennas are flat tape-measure elements, light as photographed, coiled inside it and
#     each deployed out of a slot in the module's edge near a corner, under a strip of gold Kapton, and out past the rails, the same
#     way round the end: at the
#     forward end the VHF dipole for the APRS digipeater up and down (145.825 MHz, a quarter-wave a rod, 514 mm) and the UHF dipole
#     for the downlink left and right (400.630 MHz, 187 mm), seen from ahead with +Z up; at the after end the store-and-forward
#     payload's LoRa dipole, left and right the same way.
# Nothing is taken from any team's CAD files. The materials are the ones the owner tuned in Blender for KNACKSAT-4 (PRPR.blend: cell,
# gold tabs, black structure); the cells' fingers and bus bars are metal in a roughness-and-metalness map over the tuned cell.
#
# The model is exported in the page's canonical frame (src/lib/models/attitude.ts): glTF +Z along the track and +Y away from the
# Earth, metres. Blender is Z-up and its glTF exporter writes Blender +Z as glTF +Y and Blender -Y as glTF +Z, so here the long axis
# is Blender Y (the forward end, with the VHF and UHF antennas, at -Y) and Blender +Z is the side away from the Earth. The
# page turns it slowly about its long axis (src/lib/models/registry.ts), because its reception sheet says it rotates.
#
#   blender --background --factory-startup --python scripts/models/knacksat2.py -- src/assets/models/knacksat2.glb [preview.png]
#           [--plaque scripts/models/knacksat2-plate.png]
# The plate's image is the marked plate seen square on, the forward end up, from rail to rail across and from the cells on one side
# of it to the cells on the other along (81.4 x 120 mm: 814 x 1200 pixels at ten a millimetre). scripts/models/plate-from-photo.py
# makes it from a photograph; knacksat2-plate.png beside this script is the one the page's model wears, and README.md ("The
# close-up", the paragraph after its table of models) gives the command that made it. Without it the plate is bare but for the name.
import math
import os
import sys

import bmesh
from mathutils import Vector
import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def image_arg(name):
    if name not in args:
        return None
    i = args.index(name)
    path = os.path.abspath(args[i + 1])
    del args[i:i + 2]
    return path


PLAQUE = image_arg('--plaque')
if not args:
    sys.exit('usage: blender --background --factory-startup --python scripts/models/knacksat2.py -- <out.glb> [preview.png] '
             '[--plaque plate.png]')
OUT = os.path.abspath(args[0])
PREVIEW = os.path.abspath(args[1]) if len(args) > 1 else None

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

MM = 0.001
C = 299.792458                       # the speed of light in metres per microsecond, so MHz gives metres
W, L = 100 * MM, 340.5 * MM          # the 3U envelope: 100 x 100 across, 340.5 long, rails included
RAIL = 8.5 * MM                      # the CubeSat standard's rail section
INNER = W / 2 - 0.8 * MM             # where a side panel's outer face sits, just inside the rails' outer faces
PANEL_T = 1.6 * MM
PANEL_W, PANEL_L = W - 2 * RAIL - 0.6 * MM, 318 * MM
CELL_W, CELL_L = 76 * MM, 42 * MM    # a cell across the side, and along it
CUT_A, CUT_L = 12 * MM, 15 * MM      # the two corners cut off a cell's forward end, as photographed: their legs across and along
PITCH = 52 * MM                      # six cells: centres at +-26, +-78, +-130 mm
PLATE_L, PLATE_W, PLATE_T = 120 * MM, PANEL_W - 1 * MM, 0.6 * MM     # the marked plate, rail to rail, between the cells above and below it


def material(name, color, metallic, roughness, image=None, coat=0.0, orm=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1.0)           # what the preview (Workbench) shows; the export uses the node below
    m.metallic, m.roughness = metallic, roughness
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1.0)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    if coat:
        p.inputs['Coat Weight'].default_value = coat         # glTF's clear coat: the face of the lens
        p.inputs['Coat Roughness'].default_value = 0.03
    if image is not None:
        t = nodes.new('ShaderNodeTexImage')
        t.image = image
        links.new(t.outputs['Color'], p.inputs['Base Color'])
    if orm is not None:
        # roughness from green and metalness from blue, which the glTF exporter writes as the material's metallicRoughnessTexture
        t = nodes.new('ShaderNodeTexImage')
        t.image = orm
        sep = nodes.new('ShaderNodeSeparateColor')
        links.new(t.outputs['Color'], sep.inputs['Color'])
        links.new(sep.outputs['Green'], p.inputs['Roughness'])
        links.new(sep.outputs['Blue'], p.inputs['Metallic'])
    return m


def cell_images(w=1024, h=566):
    """One cell, 76 x 42 mm at 13.5 pixels a millimetre, in the cell's own frame: u across the side, v along it from the forward
    end (v = 0, where its two corners are cut) to the after end. As the close-up photographs of the flight model show it: black
    under its cover glass, the fine fingers running along the satellite's length and only a shade lighter than the cell, a thin
    light edge all round (the cut edges too), and along the after edge the fine wire that zigzags between the three tabs. Two
    images: the colour, and the roughness and metalness (green and blue). The cell is glass, not metal, so its sheen is the cover
    glass's (metalness 0, roughness .14); the fingers, the edge and the wire are metal. Colours are linear and written through the
    sRGB curve. Outside the cut the geometry has no face, so what the image holds there is never seen."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    a = x / w * 76.0 - 38.0                         # across, mm
    t = y / h * 42.0                                # along from the forward edge, mm
    mottle = 0.0004 * np.sin(x * 0.017 + 1.3) * np.sin(y * 0.029) + 0.0003 * np.sin((x + y) * 0.009)
    r, g, b = 0.0050 + mottle, 0.0046 + mottle, 0.0068 + mottle * 1.3
    rough, metal = np.full_like(r, 0.14), np.zeros_like(r)

    def paint(mask, rgb, ro, me):
        r[mask], g[mask], b[mask] = rgb
        rough[mask], metal[mask] = ro, me

    paint((x % 13) < 1.2, (0.010, 0.0098, 0.012), 0.30, 0.35)          # a finger every mm, faint, as the photographs have them
    # the edge, 0.3 mm, on the four straight sides and the two cut ones
    e = 0.3
    # distance inside each cut's line, the legs 12 mm across and 15 along
    d_cut_l = ((a + 38.0) / 12.0 + t / 15.0 - 1.0) / np.hypot(1 / 12.0, 1 / 15.0)
    d_cut_r = ((38.0 - a) / 12.0 + t / 15.0 - 1.0) / np.hypot(1 / 12.0, 1 / 15.0)
    edge = (a < -38 + e) | (a > 38 - e) | (t < e) | (t > 42 - e) | ((d_cut_l >= 0) & (d_cut_l < e)) | ((d_cut_r >= 0) & (d_cut_r < e))
    paint(edge, (0.10, 0.10, 0.105), 0.35, 0.8)
    # the after edge's wire: from each side to the tabs (at -19.5, 0, 19.5 mm), up to a peak between them, 3.4 mm inside the edge
    pts = [(-38.0, 40.2), (-19.5, 41.6), (-9.75, 38.2), (0.0, 41.6), (9.75, 38.2), (19.5, 41.6), (38.0, 40.2)]
    wire = np.zeros_like(r, dtype=bool)
    for (a0, t0), (a1, t1) in zip(pts, pts[1:]):
        k = np.clip(((a - a0) * (a1 - a0) + (t - t0) * (t1 - t0)) / ((a1 - a0) ** 2 + (t1 - t0) ** 2), 0, 1)
        wire |= np.hypot(a - (a0 + k * (a1 - a0)), t - (t0 + k * (t1 - t0))) < 0.22
    paint(wire, (0.30, 0.30, 0.31), 0.30, 1.0)
    one = np.ones_like(r)
    srgb = lambda c: np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)
    out = []
    for name, planes, data in (('knacksat2-cell', (srgb(r), srgb(g), srgb(b)), False), ('knacksat2-cell-orm', (one, rough, metal), True)):
        img = bpy.data.images.new(name, w, h, alpha=False)
        if data:
            img.colorspace_settings.name = 'Non-Color'
        img.pixels.foreach_set(np.dstack([*planes, one]).astype(np.float32).ravel())
        img.update()
        img.pack()
        out.append(img)
    return out


FRAME = material('black anodised', (0.017, 0.017, 0.016), 0.92, 0.63)
BOARD = material('board', (0.008, 0.008, 0.009), 0.0, 0.42)              # the panels' black solder mask, and the plate: satin black
CELL_RGB, CELL_ORM = cell_images()
CELL = material('cell', (1.0, 1.0, 1.0), 0.0, 0.14, CELL_RGB, orm=CELL_ORM)
GOLD = material('gold', (0.214, 0.146, 0.047), 0.80, 0.34)
INTERCONNECT = material('interconnect', (0.40, 0.23, 0.065), 0.6, 0.5)     # the cells' gold bars, matte tan as photographed
TAB = material('cell tab', (0.62, 0.62, 0.60), 0.85, 0.32)                 # the cells' welded silver tabs
SCREW = material('screw', (0.55, 0.56, 0.57), 0.9, 0.3)
LENS = material('lens', (0.012, 0.016, 0.030), 0.0, 0.03, coat=1.0)
WINDOW = material('window', (0.01, 0.01, 0.012), 0.0, 0.05)
BEZEL = material('bezel', (0.08, 0.08, 0.085), 0.9, 0.35)
WHITE = material('lettering', (0.85, 0.86, 0.86), 0.0, 0.5)
TAPE = material('antenna tape', (0.50, 0.46, 0.38), 0.6, 0.38)          # the tape-measure elements, light as photographed
KAPTON = material('kapton', (0.42, 0.24, 0.045), 1.0, 0.22)              # gold Kapton tape over the tie-downs
MARKS = None
if PLAQUE:
    MARKS = material('marked plate', (1.0, 1.0, 1.0), 0.0, 0.45, bpy.data.images.load(PLAQUE))
    MARKS.node_tree.nodes['Image Texture'].image.pack()

parts = []


def keep(o, mat):
    o.data.materials.append(mat)
    parts.append(o)
    return o


def box(name, size, loc, mat):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return keep(o, mat)


AXES = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}


def disc(name, radius, depth, loc, axis, mat, sides=10, open_ends=False):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=depth, location=loc, rotation=AXES[axis],
                                        end_fill_type='NOTHING' if open_ends else 'NGON')
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return keep(o, mat)


def ring(name, r_out, r_in, thick, loc, rot, mat, sides=12):
    """A flat annulus round its own Z before `rot`, its face and outer wall only: a gold pad round a screw, a lens's bezel."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    to, ti, bo = [], [], []
    for k in range(sides):
        a = 2 * math.pi * k / sides
        cs, sn = math.cos(a), math.sin(a)
        to.append(bm.verts.new((r_out * cs, r_out * sn, thick / 2)))
        ti.append(bm.verts.new((r_in * cs, r_in * sn, thick / 2)))
        bo.append(bm.verts.new((r_out * cs, r_out * sn, -thick / 2)))
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new((to[k], to[j], ti[j], ti[k]))      # counter-clockwise seen from +Z: the face looks out
        bm.faces.new((bo[k], bo[j], to[j], to[k]))      # the outer wall looks outwards
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location, o.rotation_euler = loc, rot
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    o.select_set(False)
    return keep(o, mat)


def quad(name, size, loc, rot, mat):
    """A flat rectangle facing +Z before `rot`, UV-mapped 0..1: a cell. Every side's rotation keeps the plane's own Y along the length."""
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0], size[1], 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return keep(o, mat)


def drill(objs, loc, radius, axis):
    """A round hole through each of `objs`, along `axis` at `loc` (a boolean difference, applied)."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=20 * MM, location=loc, rotation=AXES[axis])
    cutter = bpy.context.active_object
    for o in objs:
        # the cutter wears the object's own first material, so the hole's wall is that material (a bare cutter leaves its faces on
        # an empty slot, and the export a primitive with no material)
        cutter.data.materials.clear()
        cutter.data.materials.append(o.data.materials[0])
        mod = o.modifiers.new('hole', 'BOOLEAN')
        mod.operation, mod.object, mod.solver = 'DIFFERENCE', cutter, 'EXACT'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


# ---- the frame: four black anodised rails the whole length (their ends are the feet the deployer bears on), the separation
# plunger out of one, and between the side panels and each end plate a band of the frame, flush with the panels ----
h = W / 2 - RAIL / 2
for sx in (-1, 1):
    for sz in (-1, 1):
        box('rail', (RAIL, L, RAIL), (sx * h, 0, sz * h), FRAME)
disc('separation plunger', 2.2 * MM, 3 * MM, (h, L / 2 + 1.5 * MM, h), 'Y', SCREW, sides=12)
END_IN, END_T = 1.5 * MM, 2.0 * MM       # an end plate's outer face, inside the rails' ends; its thickness
band = L / 2 - END_IN - END_T - PANEL_L / 2               # from a panel's end to the end plate
for sy in (-1, 1):
    y = sy * (PANEL_L / 2 + band / 2)
    for s in (-1, 1):
        box('end frame', (PANEL_T, band, W - 2 * RAIL), (s * (INNER - PANEL_T / 2), y, 0), FRAME)
        box('end frame', (W - 2 * RAIL, band, PANEL_T), (0, y, s * (INNER - PANEL_T / 2)), FRAME)

# ---- the four long sides ----
sides = {                              # normal, and the rotation that turns a +Z quad to face it
    '+X': ((1, 0, 0), (0, math.pi / 2, 0)),
    '-X': ((-1, 0, 0), (0, -math.pi / 2, 0)),
    '+Z': ((0, 0, 1), (0, 0, 0)),
    '-Z': ((0, 0, -1), (math.pi, 0, 0)),
}


def on_side(n, along, across, lift):
    """A point on a side: `along` the length, `across` it, `lift` off the panel's face."""
    nx, _, nz = n
    d = INNER + lift
    return (nx * d, along, nz * d + across) if nx else (nx * d + across, along, nz * d)


def cell(n, along):
    """A cell on side `n`, its middle `along` the length: its own outline, a rectangle with the two corners of its forward end
    (towards -Y) cut, a hair off the board, UV-mapped in its own frame (u across the side towards the `across` of on_side, v along
    it from the forward edge), so that every cell on every side is the same way round."""
    hw, hl = CELL_W / 2, CELL_L / 2
    outline = [(-hw, -hl + CUT_L), (-hw + CUT_A, -hl), (hw - CUT_A, -hl), (hw, -hl + CUT_L), (hw, hl), (-hw, hl)]   # (across, along)
    me = bpy.data.meshes.new('cell')
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    f = bm.faces.new([bm.verts.new(on_side(n, along + dl, da, 0.05 * MM)) for da, dl in outline])
    f.normal_update()
    if f.normal.dot(Vector(n)) < 0:
        f.normal_flip()
    for lp in f.loops:
        p = lp.vert.co
        da = (p.z if n[0] else p.x)
        lp[uv].uv = ((da + hw) / CELL_W, (p.y - along + hl) / CELL_L)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('cell', me)
    bpy.context.collection.objects.link(o)
    return keep(o, CELL)


SLOTS = [(k - 2.5) * PITCH for k in range(6)]          # -130, -78, -26, 26, 78, 130 mm
# The marked side, as photographed: two cells, the 120 mm plate, two cells, the pairs closer than on the other sides. The plate reads
# with the forward end up: its camera and the first marks are on the side of the VHF and UHF antennas (the owner's CAD views put
# them at that end, and the photograph shows that end's gold Kapton). The camera is where the photograph shows its gold
# cover (taken off in the photograph of the flight model at its hand-over), and the screws are where the photograph has them: on the
# plate two a side, level with each other, and one a side in the cut corners of the cells after it. Millimetres; along the side from
# its middle towards the after end, across it towards +Z (the reader's left, the plate read upright).
MARKED_SLOTS = [-132 * MM, -84 * MM, 84 * MM, 132 * MM]
MARKED_PADS = [(150, 37.5), (150, -37.5), (61.5, 37.5), (61.5, -37.5), (-4.8, 37.5), (-4.8, -37.5), (-40.8, 37.5), (-40.8, -37.5),
               (-150, 37.5), (-150, -37.5)]
CAMERA = (-13.6 * MM, 14.4 * MM)
WINDOWS = [(31 * MM, 9 * MM, 30.6 * MM), (31 * MM, -19.6 * MM, 17.75 * MM)]     # along, across, wide; 7.2 mm high
for key, (n, rot) in sides.items():
    nx, _, nz = n
    marked = key == '-X'
    size = (PANEL_T, PANEL_L, PANEL_W) if nx else (PANEL_W, PANEL_L, PANEL_T)
    panel = box('panel', size, on_side(n, 0, 0, -PANEL_T / 2), BOARD)
    cells = MARKED_SLOTS if marked else SLOTS
    sz = lambda da, dl, dn: (dn, dl, da) if nx else (da, dl, dn)     # a box's size: across, along, off the face
    for c in cells:
        cell(n, c)
        fwd, aft = c - CELL_L / 2, c + CELL_L / 2
        # the after end: three silver tabs on the edge (the wire between them is in the cell's image) and the gold bar below them
        for a in (-19.5 * MM, 0, 19.5 * MM):
            box('cell tab', sz(4.6 * MM, 2.2 * MM, 0.25 * MM), on_side(n, aft - 0.3 * MM, a, 0.17 * MM), TAB)
        box('interconnect', sz(50 * MM, 5.0 * MM, 0.15 * MM), on_side(n, aft + 2.0 * MM, 0, 0.09 * MM), INTERCONNECT)
        # the forward end: one tab, right of the middle as the side is read, on a short piece of gold
        box('interconnect', sz(8 * MM, 2.4 * MM, 0.15 * MM), on_side(n, fwd - 1.2 * MM, -9 * MM, 0.09 * MM), INTERCONNECT)
        box('cell tab', sz(4.6 * MM, 2.2 * MM, 0.25 * MM), on_side(n, fwd + 0.3 * MM, -9 * MM, 0.17 * MM), TAB)
    # the screws: silver heads in gold rims; on the plain sides in the cut corners of every other cell, where the board shows, and
    # at the panel's after end; on the marked side where the photograph has them, the plate's on the plate
    inset = CUT_A * CUT_L / (CUT_A + CUT_L + math.hypot(CUT_A, CUT_L))   # the circle that fits a cut corner's triangle: its radius
    pads = MARKED_PADS if marked else (
        [((c - CELL_L / 2) / MM + inset / MM, s * (CELL_W / 2 - inset) / MM) for c in SLOTS[::2] for s in (-1, 1)]
        + [(PANEL_L / 2 / MM - 2.6, s * 37.5) for s in (-1, 1)])
    for y, a in pads:
        lift = PLATE_T + 0.05 * MM if marked and abs(y) < 60 else 0.04 * MM
        ring('screw rim', 2.2 * MM, 1.35 * MM, 0.08 * MM, on_side(n, y * MM, a * MM, lift), rot, INTERCONNECT)
        disc('screw', 1.4 * MM, 0.7 * MM, on_side(n, y * MM, a * MM, lift + 0.25 * MM), 'X' if nx else 'Z', SCREW, sides=10)
    if marked:
        plate = box('marked plate', (PLATE_T, PLATE_L, PLATE_W), on_side(n, 0, 0, PLATE_T / 2), BOARD)
        # the camera: a round opening through the plate and the board, a black barrel down it, and the lens at its foot
        drill((plate, panel), on_side(n, CAMERA[0], CAMERA[1], 0), 12.1 * MM, 'X')
        disc('camera barrel', 12 * MM, 7 * MM, on_side(n, CAMERA[0], CAMERA[1], PLATE_T - 3.5 * MM), 'X', FRAME, sides=32,
             open_ends=True)
        disc('camera floor', 12 * MM, 0.2 * MM, on_side(n, CAMERA[0], CAMERA[1], PLATE_T - 6.9 * MM), 'X', FRAME, sides=32)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=10.5 * MM,
                                             location=on_side(n, CAMERA[0], CAMERA[1], PLATE_T - 5.6 * MM))
        lens = bpy.context.active_object
        lens.name = 'camera lens'
        lens.scale = (0.35, 1.0, 1.0)                 # a shallow dome, its crown 2 mm down the opening
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        # the sphere operator hands its faces back in an order of its own each run; sorted by their vertices, the file is the same
        # byte for byte from one run to the next
        bm = bmesh.new()
        bm.from_mesh(lens.data)
        bm.faces.sort(key=lambda f: sum(i * 1000.0 ** (3 - k) for k, i in enumerate(sorted(v.index for v in f.verts))))
        bm.to_mesh(lens.data)
        bm.free()
        keep(lens, LENS)
        ring('camera bezel', 14 * MM, 12 * MM, 0.4 * MM, on_side(n, CAMERA[0], CAMERA[1], PLATE_T + 0.2 * MM), rot, BEZEL, sides=32)
        # the two windows under the marks
        for along, across, wide in WINDOWS:
            box('window', (0.3 * MM, 7.2 * MM, wide), on_side(n, along, across, PLATE_T + 0.1 * MM), WINDOW)
        if MARKS:
            # the plate's own face wears the image, square on: u across the side (towards -Z, the reader's right), v along it
            # (towards the forward end, up)
            plate.data.materials.append(MARKS)
            slot = list(plate.data.materials).index(MARKS)
            bm = bmesh.new()
            bm.from_mesh(plate.data)
            uv = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')   # the primitives' own layer, so the join keeps one UV set
            mw = plate.matrix_world
            for f in bm.faces:
                if (mw.to_3x3() @ f.normal).x < -0.9:
                    f.material_index = slot
                    for lp in f.loops:
                        p = mw @ lp.vert.co
                        lp[uv].uv = ((PLATE_W / 2 - p.z) / PLATE_W, (PLATE_L / 2 - p.y) / PLATE_L)
            bm.to_mesh(plate.data)
            bm.free()
        else:
            bpy.ops.object.text_add(location=on_side(n, 44.5 * MM, 0, PLATE_T + 0.02 * MM))
            txt = bpy.context.active_object
            txt.data.body = 'KNACKSAT - II'
            txt.data.size = 9.5 * MM
            txt.data.extrude = 0.12 * MM
            txt.data.align_x = 'CENTER'
            txt.data.align_y = 'CENTER'
            txt.rotation_euler = (0, -math.pi / 2, 0)    # facing -X, reading across the side
            bpy.ops.object.convert(target='MESH')
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
            txt.rotation_euler = (math.pi, 0, 0)         # and turned in its plane, so it reads with the forward end up, as photographed
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
            keep(txt, WHITE)

# ---- the two ends: a flat black plate between the rails (notched round them, its face 1.5 mm inside their ends), silver screws
# beside each rail and nothing else on it; under it NBSPACE's antenna module, whose elements are flat tapes coiled inside it, as a
# deployed CubeSat's are photographed: each deploys out of a slot in the module's edge, in the band of frame between the panels and the
# plate, near a corner and under a strip of gold Kapton where it was tied down for launch, and runs straight out past the rails: up,
# down, left or right as seen from outside the end with +Z up (from ahead, +X is the right; from behind, -X). ----
# The store-and-forward payload's frequency is not published: Thailand's LoRa band, AS923, is assumed here; changing LORA_MHZ is all
# a correction needs.
LORA_MHZ = 923.0
RODS = {   # end: (name, MHz, a point on the tape's line inside the end (x, z) in mm, the way the tape runs (x, z))
    -1: [('VHF antenna', 145.825, (37, 27), (0, 1)), ('VHF antenna', 145.825, (-37, -27), (0, -1)),
         ('UHF antenna', 400.630, (-27, 37), (-1, 0)), ('UHF antenna', 400.630, (27, -37), (1, 0))],
    1: [('LoRa antenna', LORA_MHZ, (-27, 37), (-1, 0)), ('LoRa antenna', LORA_MHZ, (27, -37), (1, 0))],
}
TAPE_W, TAPE_T = 6 * MM, 0.2 * MM
STUB = 30 * MM                           # where a tape starts inside the module, from the middle, so that it plainly comes out of it
EDGE = W / 2 - 0.5 * MM                  # the plate's edge, a hair inside the envelope
for name, sy in (('forward plate', -1), ('after plate', 1)):
    face = sy * (L / 2 - END_IN)                       # the plate's outer face
    y = face - sy * END_T / 2
    # notched round the rails: the middle band the full height, and the two strips between the rails either side of it
    box(name, (2 * (EDGE - RAIL), END_T, 2 * EDGE), (0, y, 0), FRAME)
    for sx in (-1, 1):
        box(name, (RAIL, END_T, 2 * (EDGE - RAIL)), (sx * (EDGE - RAIL / 2), y, 0), FRAME)
    for x in (-36.5 * MM, 36.5 * MM):
        for z in (-36.5 * MM, 36.5 * MM):
            disc('screw', 1.6 * MM, 0.6 * MM, (x, face + sy * 0.3 * MM, z), 'Y', SCREW, sides=10)
    ym = sy * (PANEL_L / 2 + band / 2)                 # the middle of the band of frame the tapes come out of
    for rod, mhz, (hx, hz), (dx, dz) in RODS[sy]:
        line = (hz if dx else hx) * MM                 # the tape's line across the end, inside the rails (41.5 mm)
        arm = C / mhz / 4                              # the quarter wave outside the body, from the band's outer face
        a, b = STUB, INNER + arm                       # from inside the module to the tape's tip, along its way
        along = (a + b) / 2
        mid = (dx * along, ym, line) if dx else (line, ym, dz * along)
        box(rod, (b - a, TAPE_T, TAPE_W) if dx else (TAPE_W, TAPE_T, b - a), mid, TAPE)
        # the slot in the band's side face it deploys from, and the gold Kapton strip over the slot's lip, towards the plate
        out = INNER + 0.05 * MM
        at = lambda off, dy: (dx * off, ym + dy, line) if dx else (line, ym + dy, dz * off)
        box('antenna slot', (0.1 * MM, 1.6 * MM, 8 * MM) if dx else (8 * MM, 1.6 * MM, 0.1 * MM), at(out, 0), WINDOW)
        box('kapton', (0.08 * MM, 2.5 * MM, 12 * MM) if dx else (12 * MM, 2.5 * MM, 0.08 * MM), at(out + 0.02 * MM, sy * 2.4 * MM), KAPTON)
    print(name, [(r, round(C / f / 4 * 1000)) for r, f, _, _ in RODS[sy]], 'mm')

# ---- one object, one primitive per material ----
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
sat = bpy.context.active_object
sat.name = 'KNACKSAT-2'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

tris = sum(len(p.vertices) - 2 for p in sat.data.polygons)
mats = list(sat.data.materials)
used = {p.material_index for p in sat.data.polygons}
bare = [i for i in used if i >= len(mats) or mats[i] is None]
if bare:
    sys.exit('faces on an empty material slot: ' + repr(bare) + ' of ' + repr([m.name if m else None for m in mats]))
print('KNACKSAT-2:', len(sat.data.polygons), 'faces,', tris, 'triangles,', len(used), 'materials (' +
      ', '.join(mats[i].name for i in sorted(used)) + '), dimensions', tuple(round(d, 4) for d in sat.dimensions))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_image_format='JPEG',
                          export_animations=False, export_cameras=False, export_lights=False, use_selection=False)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')

if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x, scene.render.resolution_y = 1000, 700
    stem, ext = os.path.splitext(PREVIEW)
    views = ((PREVIEW, (-0.40, -0.46, 0.32), 50, (0, -0.03, 0)),                     # the marked side and the forward end
             (stem + '-aft' + ext, (0.30, 0.50, 0.34), 50, (0, 0.06, 0)),            # the after end and its LoRa dipole
             (stem + '-wide' + ext, (-1.15, -1.25, 0.85), 35, (0, -0.1, 0)))         # the antennas out
    cam = bpy.data.objects.new('preview', bpy.data.cameras.new('preview'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    from mathutils import Vector
    for path, where, lens, at in views:
        cam.location = where
        cam.rotation_euler = (Vector(at) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print('preview', path)
