# Tiangong for the close-up (CHANGES-FROM-LEGACY.md, L72): the owner's chosen model, slimmed for a browser.
#
# Source: "tianGong" by w29572227 on Sketchfab (https://sketchfab.com/3d-models/aca22b1dd6d242c1ae7b88de2f483b77), CC BY 4.0. Sketchfab
# needs a login to download, so the owner downloads it (the GLB, or the glTF with its .bin and textures) to a folder outside the
# repository and runs this on it. The licence asks for the title, the author, the source, the licence and whether it was changed; the
# close-up's card says all five (src/lib/text/closeup-card.ts), "simplified for this page" being the change.
#
# The model's own axes and size are whatever its author chose, so they are arguments, checked by eye on the three previews this writes
# before the result is adopted (it must be the station as it is now: Tianhe with Wentian and Mengtian either side, the T):
#   --forward / --up   which of the source's own glTF axes points along the track and which away from the Earth (as the station
#                      flies: the long axis of Tianhe along the track, the lab modules' wings across it)
#   --span             its largest dimension in metres (the station's wings span about 55 m)
# It then does what scripts/models/iss.py does: one UV map, no vertex colours, decimated to about TARGET triangles, welded and
# smooth-shaded with sharp edges kept, base colour maps only at TEX pixels, one object, the page's canonical frame (+Z along the
# track, +Y away from the Earth, metres), centred, and a GLB with WebP textures and no compression extension.
#
#   blender --background --factory-startup --python scripts/models/tiangong.py -- <source.glb|.gltf> src/assets/models/css.glb \
#       --forward +Z --up +Y --span 55 [--preview <folder>]
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) < 2:
    sys.exit('usage: ... tiangong.py -- <source> <out.glb> [--forward +Z] [--up +Y] [--span 55] [--preview <folder>]')
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
opt = {argv[i][2:]: argv[i + 1] for i in range(2, len(argv) - 1, 2) if argv[i].startswith('--')}
FORWARD, UP, SPAN = opt.get('forward', '+Z'), opt.get('up', '+Y'), float(opt.get('span', '55'))
PREVIEW = os.path.abspath(opt['preview']) if 'preview' in opt else None
TARGET, TEX = 150_000, 1024


def gltf_axis(a):
    """A glTF axis of the source, as the Blender importer places it (glTF +Y is Blender +Z, glTF +Z is Blender -Y)."""
    k = -1 if a[0] == '-' else 1
    return {'X': Vector((k, 0, 0)), 'Y': Vector((0, 0, k)), 'Z': Vector((0, -k, 0))}[a[1]]


for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    sys.exit('nothing to draw in ' + SRC)

# ---- one object, so everything below is done once ----
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
st = bpy.context.active_object
with bpy.context.temp_override(object=st, active_object=st, selected_objects=[st], selected_editable_objects=[st]):
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o is not st:
        bpy.data.objects.remove(o, do_unlink=True)
st.name = 'Tiangong'

# ---- the canonical frame: forward -> Blender -Y, up -> Blender +Z, left (up x forward) -> Blender +X ----
f, u = gltf_axis(FORWARD), gltf_axis(UP)
if abs(f.dot(u)) > 1e-6:
    sys.exit('--forward and --up must be two different axes at right angles')
src = Matrix((u.cross(f), u, f)).transposed()
dst = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0))).transposed()
st.data.transform((dst @ src.inverted()).to_4x4())
lo = Vector([min(v.co[i] for v in st.data.vertices) for i in range(3)])
hi = Vector([max(v.co[i] for v in st.data.vertices) for i in range(3)])
st.data.transform(Matrix.Scale(SPAN / max(hi - lo), 4) @ Matrix.Translation(-(lo + hi) / 2))
print('size (m):', tuple(round(x * SPAN / max(hi - lo), 1) for x in (hi - lo)))

# ---- slimmer: one UV map, no colours, fewer triangles, welded and smooth with its folds kept ----
me = st.data
while len(me.uv_layers) > 1:
    me.uv_layers.remove(me.uv_layers[-1])
for a in list(me.color_attributes):
    me.color_attributes.remove(a)
before = sum(len(p.vertices) - 2 for p in me.polygons)
if before > TARGET:
    mod = st.modifiers.new('slim', 'DECIMATE')
    mod.decimate_type, mod.ratio, mod.use_collapse_triangulate = 'COLLAPSE', TARGET / before, True
    dg = bpy.context.evaluated_depsgraph_get()
    st.data = bpy.data.meshes.new_from_object(st.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
    st.modifiers.clear()
me = st.data
if me.has_custom_normals:
    with bpy.context.temp_override(object=st, active_object=st, selected_objects=[st], selected_editable_objects=[st]):
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=SPAN * 1e-5)
for e in bm.edges:
    e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(math.pi) < math.radians(35)
for fa in bm.faces:
    fa.smooth = True
bm.to_mesh(me)
bm.free()
print('triangles', before, '->', sum(len(p.vertices) - 2 for p in me.polygons))

# ---- base colour maps only, small ----
used = set()
for m in me.materials:
    if not (m and m.use_nodes):
        continue
    p = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if p is None:
        continue
    for name, value in (('Normal', None), ('Metallic', 0.0), ('Roughness', 0.6)):
        for link in list(p.inputs[name].links):
            m.node_tree.links.remove(link)
        if value is not None:
            p.inputs[name].default_value = value
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and n.outputs['Color'].is_linked:
            used.add(n.image)
for img in used:
    w, h = img.size
    if max(w, h) > TEX:
        k = TEX / max(w, h)
        img.scale(max(1, int(w * k)), max(1, int(h * k)))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_image_format='WEBP',
                          export_draco_mesh_compression_enable=False, export_vertex_color='NONE', export_animations=False,
                          export_cameras=False, export_lights=False)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')

# ---- three views to check it is today's station, the right way up ----
if PREVIEW:
    scene = bpy.context.scene
    cam = bpy.data.objects.new('preview', bpy.data.cameras.new('preview'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens, cam.data.clip_end = 35, 2000
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light, scene.display.shading.color_type = 'STUDIO', 'TEXTURE'
    scene.render.resolution_x, scene.render.resolution_y = 1000, 700
    for name, at in (('above', (0.01, 0.01, 1.6)), ('ahead', (0.01, -1.6, 0.3)), ('side', (1.6, 0.01, 0.3))):
        cam.location = Vector(at) * SPAN
        cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(PREVIEW, 'tiangong-' + name + '.png')
        bpy.ops.render.render(write_still=True)
        print('preview', scene.render.filepath)
