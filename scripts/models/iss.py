# The ISS for the close-up (CHANGES-FROM-LEGACY.md, L72): NASA's own model, slimmed for a browser.
#
# Source: NASA 3D Resources, "International Space Station (ISS) (D) (IGOAL)", by NASA/JSC's Integrated Graphics, Operations and
# Analysis Laboratory (https://science.nasa.gov/3d-resources/international-space-station-iss-d-igoal/; the GLB is
# https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/International%20Space%20Station%20(ISS)%20(D)%20(IGOAL)/International%20Space%20Station%20(ISS).glb,
# 95.9 MB). NASA's 3D models are not under copyright; NASA asks to be credited and not to be taken as endorsing anything.
#
# The file is 2.7 million triangles in 555 meshes, Draco-compressed, with 220 images (64 MB). The page cannot decode Draco (that
# needs WebAssembly) and a browser does not need a 64 MB station, so this:
#   1. imports it (Blender decodes the Draco),
#   2. undoes the mirror its root carries (a uniform scale of -0.0026: every axis negated, which puts Columbus on the port side and
#      Kibo on the starboard; the nodes under it are the right way round, as Columbus at -Z and Kibo at +Z of Node 2 say),
#   3. turns it into the page's canonical frame from the modules themselves: forward is Zvezda -> Node 2 (the station flies
#      +XVV), down is Zvezda -> Nauka (Nauka is on Zvezda's nadir port), and the result is checked against the trusses (port is
#      port), then centred on its bounding box,
#   4. keeps one UV map and no vertex colours, decimates every mesh to about TARGET triangles in all (small parts are left whole),
#   5. keeps each material's base colour map, at most TEX pixels on a side, and drops the normal, metallic and roughness maps for
#      factors (at the close-up's ranges, tens of metres and more, they are not seen), and
#   6. exports a GLB with WebP textures (EXT_texture_webp, which three r128 reads) and no compression extension.
#
#   blender --background --factory-startup --python scripts/models/iss.py -- <iss-igoal.glb> src/assets/models/iss.glb [preview.png]
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) < 2:
    sys.exit('usage: blender --background --factory-startup --python scripts/models/iss.py -- <source.glb> <out.glb> [preview.png]')
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
PREVIEW = os.path.abspath(argv[2]) if len(argv) > 2 else None
TARGET = 60_000
TEX = 512
INCH = 0.0254

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=SRC)
dg = bpy.context.evaluated_depsgraph_get()

root = bpy.data.objects.get('SSREF_IGOAL')
if root is None:
    sys.exit('no SSREF_IGOAL root: not the file this script was written for')
if root.matrix_world.determinant() < 0:
    print('root mirror undone')
# The nodes are in inches (Node 2 to Zvezda is 1320 units, 33.5 m), and the root's scale is not 0.0254: metres, then.
root.scale = (INCH, INCH, INCH)
bpy.context.view_layer.update()


def centre(name):
    """The world-space middle of the bounding boxes of everything under the named node."""
    top = bpy.data.objects.get(name)
    if top is None:
        sys.exit('no node named ' + name)
    lo, hi = Vector((1e30,) * 3), Vector((-1e30,) * 3)
    for o in [top] + list(top.children_recursive):
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return (lo + hi) / 2


zvezda, node2, nauka = centre('Zvezda_SM'), centre('Node2'), centre('MLM')
port = centre('PORT_ALPHA_ROT') - centre('STBD_ALPHA_ROT')
forward = (node2 - zvezda).normalized()
down = nauka - zvezda
down = (down - forward * down.dot(forward)).normalized()
up = -down
left = up.cross(forward)                         # the canonical +X: up x forward, which is the port side
if left.dot(port) < 0:
    sys.exit('the station is still mirrored (up x forward is not the port side)')
# where those go in Blender, for the exporter's Y-up: forward -> -Y, up -> +Z, left (port) -> +X
src = Matrix((left, up, forward)).transposed()
dst = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0))).transposed()
rot = (dst @ src.inverted()).to_4x4()
root.matrix_world = rot @ root.matrix_world
bpy.context.view_layer.update()

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
lo, hi = Vector((1e30,) * 3), Vector((-1e30,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo, hi = Vector(map(min, lo, w)), Vector(map(max, hi, w))
mid = (lo + hi) / 2
root.matrix_world = Matrix.Translation(-mid) @ root.matrix_world
bpy.context.view_layer.update()
print('station size (m):', tuple(round(x, 1) for x in (hi - lo)))

# ---- one UV map, no colours, fewer triangles ----
total = sum(len(o.data.polygons) for o in meshes)
ratio = min(1.0, TARGET / max(total, 1))
print('triangles before', total, 'ratio', round(ratio, 3))
for o in meshes:
    me = o.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    if len(me.polygons) > 80 and ratio < 1.0:
        mod = o.modifiers.new('slim', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = max(ratio, 60 / len(me.polygons))
        mod.use_collapse_triangulate = True
dg = bpy.context.evaluated_depsgraph_get()
for o in meshes:
    if not o.modifiers:
        continue
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
    o.modifiers.clear()
    o.data = me

# Welded and smooth-shaded, split only where the surface really folds: the import's flat, per-face normals made the exporter write
# three vertices for every triangle.
for o in meshes:
    me = o.data
    if me.has_custom_normals:
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.02)        # model units are inches here, before the transform is applied
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(math.pi) < math.radians(35)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    if me.uv_layers:
        me.uv_layers[0].name = 'UVMap'
print('triangles after', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes))

# One object: one primitive per material, a few dozen draw calls instead of 555.
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
station = bpy.context.active_object
with bpy.context.temp_override(object=station, active_object=station, selected_objects=[station], selected_editable_objects=[station]):
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
station.name = 'ISS'
for o in list(bpy.data.objects):
    if o is not station:
        bpy.data.objects.remove(o, do_unlink=True)
print('station size (m) after joining:', tuple(round(x, 1) for x in station.dimensions))

# ---- base colour maps only, small ----
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    p = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if p is None:
        continue
    for name, value in (('Normal', None), ('Metallic', 0.0), ('Roughness', 0.62)):
        for link in list(p.inputs[name].links):
            nt.links.remove(link)
        if value is not None:
            p.inputs[name].default_value = value
used = set()
for m in bpy.data.materials:
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and n.outputs['Color'].is_linked:
                used.add(n.image.name)
for img in bpy.data.images:
    if img.name not in used:
        continue
    w, h = img.size
    if max(w, h) > TEX:
        k = TEX / max(w, h)
        img.scale(max(1, int(w * k)), max(1, int(h * k)))
print('base colour maps kept:', len(used))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_image_format='WEBP',
                          export_draco_mesh_compression_enable=False, export_vertex_color='NONE', export_animations=False,
                          export_cameras=False, export_lights=False)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')

if PREVIEW:
    scene = bpy.context.scene
    cam = bpy.data.objects.new('preview', bpy.data.cameras.new('preview'))
    scene.collection.objects.link(cam)
    cam.location = (95, -80, 55)
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 35
    cam.data.clip_end = 1000
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x, scene.render.resolution_y = 1100, 700
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)
