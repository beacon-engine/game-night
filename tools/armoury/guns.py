# The armoury: guns for the games, from the CC0 "Low Poly Weapon Pack" (OpenGameArt, in
# web/armoury/source/). Each is laid with its barrel along +x and its top up, scaled to the real gun's
# length, coloured (the pack's models have parts but no textures: wood, steel, a synthetic stock), and
# placed so its grip (where the trigger hand holds it) is at the origin. Its extras say where the
# other hand goes on the fore-end (`support`, m along the barrel) and where the muzzle is.
#
#   blender -b -P tools/armoury/guns.py -- web/armoury/models/guns.glb
import bpy
import math
import os
import sys

from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'armoury', 'source', 'low-poly-weapon-pack'))

FINISH = {
    'steel': ((0.10, 0.105, 0.115), 0.85, 0.42),  # colour, metallic, roughness
    'wood': ((0.30, 0.16, 0.075), 0.0, 0.62),
    'olive': ((0.22, 0.24, 0.15), 0.0, 0.7),
    'polymer': ((0.045, 0.045, 0.048), 0.0, 0.55),  # a modern rifle's black furniture
    'blade': ((0.5, 0.52, 0.55), 0.9, 0.3),
}

# name: (file, real length m, the finish of each of its materials in order, grip and fore-end as
# fractions of the length from the butt)
GUNS = {
    'rifle': ('kar98k_0.obj', 1.11, ['steel', 'wood', 'steel'], 0.30, 0.58),  # Karabiner 98k: bolt action
    'assault': ('stg44.obj', 0.94, ['steel', 'wood', 'steel'], 0.36, 0.62),  # StG 44: automatic
    'sniper': ('sniper.obj', 1.2, ['steel', 'steel', 'steel', 'olive'], 0.30, 0.55),  # scoped bolt action
    'shotgun': ('12_gauge.obj', 1.0, ['steel', 'steel', 'wood'], 0.32, 0.6),  # pump action
    'pistol': ('colt_1911.obj', 0.22, ['steel', 'steel', 'wood'], 0.2, 0.2),  # M1911
    'machine-pistol': ('mauser_c96.obj', 0.31, ['steel', 'wood', 'steel'], 0.18, 0.18),  # C96
    # modern
    'carbine': ('m16.obj', 0.84, ['polymer', 'steel', 'polymer'], 0.4, 0.66),  # an M4-length carbine (the pack's M16, shortened)
    'ak': ('ak47.obj', 0.88, ['steel', 'wood', 'steel'], 0.37, 0.6),  # AK-47
    'knife': ('karambit.obj', 0.2, ['blade', 'polymer'], 0.22, 0.22),
    'launcher': ('rpg7_1.obj', 0.95, ['olive', 'wood', 'steel'], 0.45, 0.62),  # RPG-7
}

_materials = {}


def finish(kind):
    if kind not in _materials:
        color, metal, rough = FINISH[kind]
        m = bpy.data.materials.new(kind)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        _materials[kind] = m
    return _materials[kind]


def bounds(objs):
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def end_height(objs, lo, hi, at_high):
    # how tall the gun is near one end (the muzzle end is the thin one)
    span = hi.x - lo.x
    zs = []
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            if (at_high and w.x > hi.x - span * 0.08) or (not at_high and w.x < lo.x + span * 0.08):
                zs.append(w.z)
    return (max(zs) - min(zs)) if zs else 0


def build(name, spec):
    path, length, finishes, grip, fore = spec
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=os.path.join(SOURCE, path))
    objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    # its longest side along x
    lo, hi = bounds(objs)
    ext = hi - lo
    turn = Matrix.Identity(4)
    if ext.y >= ext.x and ext.y >= ext.z:
        turn = Matrix.Rotation(math.radians(90), 4, 'Z')
    elif ext.z >= ext.x:
        turn = Matrix.Rotation(math.radians(90), 4, 'Y')
    for o in objs:
        o.matrix_world = turn @ o.matrix_world
    bpy.context.view_layer.update()
    lo, hi = bounds(objs)
    # muzzle toward +x
    if end_height(objs, lo, hi, False) < end_height(objs, lo, hi, True):
        for o in objs:
            o.matrix_world = Matrix.Rotation(math.pi, 4, 'Z') @ o.matrix_world
        bpy.context.view_layer.update()
        lo, hi = bounds(objs)
    # its real size, the grip at the origin
    k = length / (hi.x - lo.x)
    grip_at = Vector((lo.x + (hi.x - lo.x) * grip, 0, (lo.z + hi.z) / 2))
    grip_at.y = (lo.y + hi.y) / 2
    for o in objs:
        o.matrix_world = Matrix.Scale(k, 4) @ Matrix.Translation(-grip_at) @ o.matrix_world
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # its parts' finishes, in the order the model lists them
        for i, slot in enumerate(o.material_slots):
            slot.material = finish(finishes[min(i, len(finishes) - 1)])
    # one object per gun, named for it
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    gun = bpy.context.view_layer.objects.active
    gun.name = name
    gun.data.name = name
    gun['support'] = round((fore - grip) * length, 3)  # m along the barrel from the grip
    gun['muzzle'] = round((1 - grip) * length, 3)
    gun['length'] = length
    return gun


def main(argv):
    out = argv[argv.index('--') + 1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    guns = [build(n, s) for n, s in GUNS.items()]
    for i, g in enumerate(guns):
        g.location.y = 0  # (all at the origin: the game places each)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_extras=True, export_yup=True)
    print('BUILT', out, os.path.getsize(out), [g.name for g in guns])


main(sys.argv)
