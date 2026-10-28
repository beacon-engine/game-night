# Building our people: each one is a recipe (body, skin, hair, clothes) made into a MakeHuman body
# by MPFB, dressed, and given the "game_engine" rig every game shares. A file of recipes becomes one
# .glb with each person as a separate armature, named after the recipe, so the textures they share
# (the kit, the boots...) are stored once.
#
# Materials are named for what they are, so a game can find and recolour them: "skin", "hair",
# "eyes", "brows", "lashes", and for clothes the recipe's role ("shirt", "shorts", "socks", "boots"...).
# A role listed in the recipe file's "plain" has its texture turned to grey, so the game's material
# colour (a team's colours) shows true through it.
#
#   blender -b -P tools/people/people.py -- recipes/footballers.json out.glb [--render out.png]
import bpy
import json
import math
import os
import sys

from bl_ext.user_default.mpfb.services.humanservice import HumanService

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gear  # noqa: E402
import helmets  # noqa: E402
import textures  # noqa: E402

SPACING = 0.9  # m between people when rendering a line-up


def clothes(r, defaults):
    return r.get('clothes', defaults.get('clothes', {}))


def human(r, defaults):
    # MPFB's description of a person, from a recipe
    info = HumanService._create_default_human_info_dict()
    info['phenotype'].update(defaults.get('phenotype', {}))
    info['phenotype'].update({k: v for k, v in r.get('body', {}).items() if k != 'race'})
    if 'race' in r.get('body', {}):
        info['phenotype']['race'] = r['body']['race']
    info['rig'] = 'game_engine'
    for part in ('eyes', 'eyebrows', 'eyelashes', 'hair'):
        v = r[part] if part in r else defaults.get(part)  # (null: none)
        info[part] = f'{v}.mhclo' if v else ''
    info['clothes'] = [f'{c}.mhclo' for c in clothes(r, defaults).values()]
    info['skin_mhmat'] = r['skin'] + '.mhmat'
    info['skin_material_type'] = 'MAKESKIN'
    info['name'] = r['name']
    info['proxy'] = r.get('proxy', defaults.get('proxy', ''))
    info['proxy'] = f"{info['proxy']}.proxy" if info['proxy'] else ''
    return info


def build(r, defaults, plain, flat=()):
    settings = HumanService.get_default_deserialization_settings()
    settings['subdiv_levels'] = 0
    before = set(bpy.data.objects)
    body = HumanService.deserialize_from_dict(human(r, defaults), settings)
    new = [o for o in bpy.data.objects if o not in before]
    rig = body.parent
    rig.name = r['name']
    rig.data.name = r['name']
    # name each part (and its material) for what it is
    parts = {'body': 'skin', r.get('proxy', defaults.get('proxy')): 'skin', defaults.get('eyes'): 'eyes', r.get('eyebrows', defaults.get('eyebrows')): 'brows',
             r.get('eyelashes', defaults.get('eyelashes')): 'lashes', r.get('hair', defaults.get('hair')): 'hair'}
    parts.update({asset: role for role, asset in clothes(r, defaults).items()})
    for o in new:
        if o.type != 'MESH':
            continue
        key = o.name.split('.', 1)[1] if '.' in o.name else o.name
        role = parts.get(key) or next((v for k, v in parts.items() if k and k in o.name), None)
        if role is None:
            continue
        o.name = f"{r['name']}.{role}"
        keep = r.get('detail', defaults.get('detail', {})).get(role, 1)
        if keep < 1:  # (fewer triangles: a decimate, applied on export like the rest)
            d = o.modifiers.new('fewer', 'DECIMATE')
            d.ratio = keep
            d.use_collapse_triangulate = True
        for slot in o.material_slots:
            if slot.material is not None:
                slot.material = (textures.flat(role) if role in flat else textures.plain(slot.material, role) if role in plain
                                 else textures.clean(slot.material, f"{role}.{r['name']}"))
    # props made to measure (a helmet; a modern soldier's whole kit)
    kind = r.get('helmet', defaults.get('helmet'))
    if kind:
        helmets.add(rig, body, kind, textures.flat('helmet'))
    if r.get('gear', defaults.get('gear')):
        top = bpy.data.objects[f"{r['name']}.top"]
        gear.add(rig, body, top, {role: textures.flat(role) for role in ('helmet', 'vest', 'pack', 'pads', 'gear')})
    return rig


def lineup(rigs, path):
    # a picture of everyone, for checking the recipes by eye
    sc = bpy.context.scene
    for i, rig in enumerate(rigs):
        rig.location.x = (i - (len(rigs) - 1) / 2) * SPACING
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = max(600, 260 * len(rigs)), 900
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.7, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(2.3, SPACING * len(rigs) * 900 / sc.render.resolution_x + 0.4) * sc.render.resolution_x / 900
    sc.collection.objects.link(cam)
    sc.camera = cam
    for i, (x, y, z, tilt) in enumerate([(0, -6, 0.95, 90), (0, 6, 0.95, 90)]):
        cam.location = (x, y, z)
        cam.rotation_euler = (math.radians(tilt), 0, 0 if y < 0 else math.pi)
        sc.render.filepath = path.replace('.png', f'-{"front" if y < 0 else "back"}.png')
        bpy.ops.render.render(write_still=True)
    for rig in rigs:
        rig.location.x = 0


def export(path):
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(o)
    textures.shrink()
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_animations=False, export_apply=True,
                              export_image_format='WEBP', export_yup=True, export_extras=False,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)


def main(argv):
    args = argv[argv.index('--') + 1:]
    recipes, out = args[0], args[1]
    render = args[args.index('--render') + 1] if '--render' in args else None
    with open(recipes if os.path.isabs(recipes) else os.path.join(HERE, recipes)) as f:
        book = json.load(f)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    only = os.environ.get('ONLY')
    rigs = [build(r, book.get('defaults', {}), set(book.get('plain', [])), set(book.get('flat', []))) for r in book['people'] if not only or r['name'] in only.split(',')]
    if render:
        lineup(rigs, render)
    export(out)
    print('BUILT', out, os.path.getsize(out), [r.name for r in rigs])


main(sys.argv)
