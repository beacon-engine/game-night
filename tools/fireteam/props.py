# Fireteam's Poly Haven props and plants, made game-sized: each model (photogrammetry, often 20-150k
# triangles) thinned to a budget, its textures scaled down, saved as a Draco-compressed .glb in
# web/games/fireteam/models/props/. The originals stay in source/polyhaven/.
#
#   blender -b -P tools/fireteam/props.py
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'games', 'fireteam'))
SRC = os.path.join(ROOT, 'source', 'polyhaven')
OUT = os.path.join(ROOT, 'models', 'props')

# triangles to keep, and the biggest texture (px)
BUDGET = {
    'ammo_box': (1200, 512), 'wooden_crate_02': (1200, 512), 'wooden_military_crate': (1800, 512),
    'wooden_barrels_01': (3500, 512), 'metal_jerrycan_green': (1200, 512), 'rock_moss_set_01': (5000, 512),
    'tree_stump_01': (2200, 512), 'dead_tree_trunk': (4000, 512), 'shrub_02': (3500, 512), 'shrub_04': (3500, 512),
    'nettle_plant': (3000, 512),
}


def tris(objs):
    n = 0
    for o in objs:
        o.data.calc_loop_triangles()
        n += len(o.data.loop_triangles)
    return n


def one(name, budget, size):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    gltf = next(f for f in os.listdir(os.path.join(SRC, name)) if f.endswith('.gltf'))
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name, gltf))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    have = tris(meshes)
    k = min(1.0, budget / max(1, have))
    for o in meshes:
        if k < 1:
            d = o.modifiers.new('fewer', 'DECIMATE')
            d.ratio = k
            d.use_collapse_triangulate = True
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > size:
            f = size / max(w, h)
            img.scale(max(1, int(w * f)), max(1, int(h * f)))
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_image_format='WEBP',
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    print('PROP', name, have, '->', int(have * k), os.path.getsize(out))


only = os.environ.get('ONLY')
for n, (b, s) in BUDGET.items():
    if not only or n in only.split(','):
        one(n, b, s)
