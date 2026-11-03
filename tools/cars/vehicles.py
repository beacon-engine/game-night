# The car library's other vehicles: what isn't a car to drive (police car, van, lorry, bus, single-seaters,
# a plane and a helicopter), for the games that need them: City Runners' and Street Racing's streets, Grand Prix's
# grid, the skies. Made-up makes, CC Attribution, from Sketchfab. Two steps:
#
#   python3 tools/cars/vehicles.py fetch [ids]
#       downloads each as its author published it into web/cars/source/vehicles/<id>/ (model.glb isn't kept in
#       git; its README, with the author, link and licence, is). Needs a Sketchfab API token in ~/.sketchfab_token
#       or SKETCHFAB_TOKEN. Resumes: what's there is kept.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/cars/vehicles.py -- build [ids] [--preview]
#       bakes each one's transforms, turns it to face the game's forward (-z in three.js), scales it to its real
#       length, stands it on the ground in the middle, and writes it small (Draco, JPEG textures) to
#       web/cars/vehicles/<id>.glb, with web/cars/vehicles.json (sizes and credits). --preview renders each from
#       the front into web/cars/source/vehicles/previews/ instead, to check it.
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', 'web', 'cars'))
SOURCE = os.path.join(ROOT, 'source', 'vehicles')
OUT = os.path.join(ROOT, 'vehicles')

# our id: Sketchfab uid, what it is, its length in metres, which way its nose points in the file (+x/-x/+y/-y, or
# None to guess from the longest side and the names), anything to hide (a regex of object or material names: a
# ground plane, logos), and whether the guess comes out backwards (flip)
VEHICLES = {
    'police': ('61766c1e6e1e4b2b803c174f33433a74', 'police cruiser', 5.2, None, None),
    'lorry': ('663a0953c038434a918cb85725c88ffa', 'box lorry', 7.0, None, None),
    'van': ('09d718c9cf72401b8534d265a06a803f', 'panel van', 5.0, None, None),
    'bus': ('14fe03d792914d51b6c6250b393c44fd', 'town bus', 11.5, None, None),
    'airliner': ('f06d488f08764e3ca26f2917d4053c69', 'airliner', 38, None, None),
    'helicopter': ('5bbed2de9baa4a13a7faa72653b78b64', 'helicopter', 12, None, None),
}


def fetch():
    import urllib.request
    tok = os.environ.get('SKETCHFAB_TOKEN') or (open(os.path.expanduser('~/.sketchfab_token')).read().strip() if os.path.exists(os.path.expanduser('~/.sketchfab_token')) else '')
    if not tok:
        sys.exit('No Sketchfab API token: put it in ~/.sketchfab_token or SKETCHFAB_TOKEN')
    api = lambda url: json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': f'Token {tok}'}), timeout=60))
    only = set(sys.argv[2:])
    for id, (uid, what, *_) in VEHICLES.items():
        if only and id not in only:
            continue
        folder = os.path.join(SOURCE, id)
        os.makedirs(folder, exist_ok=True)
        info = api(f'https://api.sketchfab.com/v3/models/{uid}')
        licence = (info.get('license') or {}).get('label', '?')
        if licence not in ('CC Attribution', 'CC0 Public Domain'):
            print(f'{id}: skipped, licence is {licence}')
            continue
        with open(os.path.join(folder, 'README.md'), 'w') as f:
            f.write(f"# {info['name']}\n\n{what}\n\n- By: {info['user']['displayName']} ({info['user']['profileUrl']})\n"
                    f"- From: {info['viewerUrl']}\n- Licence: {licence} ({(info.get('license') or {}).get('url', '')})\n"
                    f"- Triangles: {info.get('faceCount')}\n")
        glb = os.path.join(folder, 'model.glb')
        if os.path.exists(glb) and os.path.getsize(glb) > 0:
            print(f'{id}: have it')
            continue
        links = api(f'https://api.sketchfab.com/v3/models/{uid}/download')
        if 'glb' not in links:
            print(f'{id}: no .glb to download ({", ".join(links)})')
            continue
        print(f"{id}: downloading {links['glb']['size'] / 1e6:.1f} MB")
        with urllib.request.urlopen(links['glb']['url'], timeout=600) as r, open(glb + '.part', 'wb') as f:
            while chunk := r.read(1 << 16):
                f.write(chunk)
        os.replace(glb + '.part', glb)


MAX_TRIS = 60000  # (more than this is decimated: a TV draws a grid of them)
FRONT = re.compile(r'head|front|grill|bonnet|hood|windshield|windscreen|bumper_?f', re.I)
REAR = re.compile(r'tail|rear|back|trunk|boot|exhaust|bumper_?r', re.I)


def build(ids, preview):
    import bpy
    from mathutils import Matrix, Vector
    meshes = lambda: [o for o in bpy.context.scene.objects if o.type == 'MESH']

    def bounds(objs):
        lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
        for o in objs:
            for v in o.data.vertices:
                for i in range(3):
                    lo[i] = min(lo[i], v.co[i]); hi[i] = max(hi[i], v.co[i])
        return lo, hi

    catalogue_path = os.path.join(ROOT, 'vehicles.json')
    catalogue = json.load(open(catalogue_path)) if os.path.exists(catalogue_path) else {'vehicles': {}}
    for id in ids:
        uid, what, length, front, hide, *rest = VEHICLES[id]
        flip = bool(rest and rest[0])
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCE, id, 'model.glb'))
        world = {o.name: o.matrix_world.copy() for o in meshes()}
        for o in meshes():
            o.parent = None
            o.data = o.data.copy()
            o.data.transform(world[o.name])
            o.matrix_world = Matrix()
        for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']:
            bpy.data.objects.remove(o)
        for o in meshes():
            names = o.name + ' ' + ' '.join(m.name for m in o.data.materials if m)
            if len(o.data.vertices) == 0 or (hide and re.search(hide, names)) or re.search(r'shadow|plane$', o.name, re.I):
                bpy.data.objects.remove(o)
        objs = meshes()
        # (Blender: z up) the long side along y
        lo, hi = bounds(objs)
        if hi.x - lo.x > hi.y - lo.y:
            for o in objs: o.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
            if front: front = {'+x': '+y', '-x': '-y', '+y': '-x', '-y': '+x'}[front]
        lo, hi = bounds(objs)
        mid = (lo + hi) / 2
        if not front:
            score = 0.0
            for o in objs:
                c = sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
                n = o.name + ' ' + ' '.join(m.name for m in o.data.materials if m)
                if FRONT.search(n): score += c.y - mid.y
                if REAR.search(n): score -= c.y - mid.y
            front = '+y' if score >= 0 else '-y'
        # nose to -y in Blender is nose to +z in glTF... we want the game's forward, -z: so nose to +y here
        if (front == '-y') != flip:
            for o in objs: o.data.transform(Matrix.Rotation(math.pi, 4, 'Z'))
        lo, hi = bounds(objs)
        k = length / (hi.y - lo.y)
        for o in objs: o.data.transform(Matrix.Scale(k, 4))
        lo, hi = bounds(objs)
        shift = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
        for o in objs: o.data.transform(Matrix.Translation(shift))
        lo, hi = bounds(objs)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
        if tris > MAX_TRIS:
            for o in objs:
                d = o.modifiers.new('decimate', 'DECIMATE')
                d.ratio = MAX_TRIS / tris
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            tris = sum(sum(len(p.vertices) - 2 for p in o.evaluated_get(dg).data.polygons) for o in objs)
        if preview:
            render(bpy, objs, id, lo, hi)
            continue
        # textures: JPEG when they've no transparency, at most 1024
        for img in bpy.data.images:
            if not img.size[0]:
                continue
            if max(img.size) > 1024:
                s = 1024 / max(img.size)
                img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))
            img.pack()
        os.makedirs(OUT, exist_ok=True)
        out = os.path.join(OUT, f'{id}.glb')
        for o in bpy.context.scene.objects: o.select_set(o in objs)
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                                  export_image_format='JPEG', export_materials='EXPORT', export_extras=False,
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
        text = open(os.path.join(SOURCE, id, 'README.md')).read()
        get = lambda key: (re.search(rf'- {key}: (.*)', text) or [None, ''])[1].strip()
        catalogue['vehicles'][id] = {
            'what': what, 'length': round(hi.y - lo.y, 2), 'width': round(hi.x - lo.x, 2), 'height': round(hi.z - lo.z, 2),
            'triangles': tris, 'bytes': os.path.getsize(out),
            'credit': {'title': text.splitlines()[0].lstrip('# ').strip(), 'by': get('By'), 'from': get('From'), 'licence': get('Licence')},
        }
        print(f'{id}: {tris} triangles, {hi.x - lo.x:.2f} x {hi.z - lo.z:.2f} x {hi.y - lo.y:.2f} m, {os.path.getsize(out) / 1e6:.2f} MB')
    if not preview:
        with open(catalogue_path, 'w') as f:
            json.dump(catalogue, f, indent=1)


# A quick look from the front three-quarter, to check which way it faces and that it's clean of logos
def render(bpy, objs, id, lo, hi):
    import mathutils
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x, scene.render.resolution_y = 900, 600
    size = max(hi.y - lo.y, 3)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.location = (size * 0.9, size * 1.1, size * 0.55)  # (in front: the nose is +y)
    target = mathutils.Vector((0, 0, (hi.z - lo.z) / 2))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    folder = os.path.join(SOURCE, 'previews')
    os.makedirs(folder, exist_ok=True)
    scene.render.filepath = os.path.join(folder, f'{id}.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    if argv[:1] == ['fetch']:
        fetch()
    elif argv[:1] == ['build']:
        rest = [a for a in argv[1:] if not a.startswith('--')]
        build(rest or list(VEHICLES), '--preview' in argv)
    else:
        sys.exit(__doc__ if __doc__ else 'fetch | build')
